import { z } from "zod";
import { defaultTargets } from "../render.ts";
import { allSlides, creativesSchema, deviceSlidesSchema, localesSchema, mockupsSchema, type Project, repeatedLocales, slideSchema, targetsSchema, themeSchema, unknownFields } from "../schema.ts";
import type { Space } from "../storage/paths.ts";
import { projects, type Stored } from "../storage/projects.ts";
import { createProject, listCreativeOutputs, listImages, listOutputs, listShots, projectSummary, readImages, readShots, type Shot, type StoredImage, updateProject } from "../store.ts";
import { deviceShape } from "../template.ts";
import { type Ctx, type Warning, writeOptions } from "./context.ts";
import { deleteProject } from "./lifecycle.ts";

/** What a change to a project may set. Each field given replaces that field as a whole. */
export const projectPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  locales: localesSchema.optional(),
  targets: targetsSchema.nullable().optional(),
  theme: themeSchema.optional(),
  slides: z.array(slideSchema).max(10).optional(),
  deviceSlides: deviceSlidesSchema.optional(),
  creatives: creativesSchema.optional(),
  mockups: mockupsSchema.optional(),
});

const newProject = projectPatch.extend({ name: z.string().min(1).max(80) });

/** Fields the HTTP API's answer carries that are not changed by sending them back, so not misspelt either. */
const STORED_ONLY = new Set(["id", "createdAt", "updatedAt", "schemaVersion", "revision"]);

/** The projects of the account, newest change first, a damaged one among them, each as projectSummary() lists it. */
export async function list(space: Space) {
  return (await projects.list(space)).map(projectSummary);
}

/**
 * Renders of assets the project no longer defines stay on disk until the next full render, but are not offered. Nor
 * are those of a language it no longer has, which go with the next render, as its slides do.
 */
export async function creativeOutputs(space: Space, id: string) {
  const [project, outputs] = await Promise.all([projects.get(space, id), listCreativeOutputs(space, id)]);
  const languages = new Set(project.project.locales.map((code) => code.toLowerCase()));
  return outputs.filter((output) => project.project.creatives[output.placement] && languages.has(output.locale.toLowerCase()));
}

/**
 * A project with everything the Studio shows of it, as the HTTP API answers it. `orphanedShots` are the screenshots of
 * languages it no longer has: kept, so that adding the language again brings them back, but drawn for no other
 * language, and listed so they can be deleted.
 */
export async function detail(space: Space, id: string) {
  const withShots = projects.get(space, id).then(async (stored) => ({ ...stored, files: await readShots(space, id, stored.project.locales) }));
  const [{ project, revision, warnings: stored, files }, art, outputs, creatives] = await Promise.all([withShots, readImages(space, id), listOutputs(space, id), creativeOutputs(space, id)]);
  const { shots, orphaned } = files;
  const unreadable = (kind: string) => (file: string) => `The ${kind} ${file} cannot be read and is left out. Upload it again or delete it.`;
  const warnings = [...stored, ...files.unreadable.map(unreadable("screenshot")), ...art.unreadable.map(unreadable("image"))];
  return { project, revision, shots, orphanedShots: orphaned, images: art.images, outputs, creativeOutputs: creatives, defaultTargets: defaultTargets(shots, project.targets), ...(warnings.length ? { warnings } : {}) };
}

export type Detail = Awaited<ReturnType<typeof detail>>;

/** A project as the MCP tools describe it: slides numbered from 1, the screenshots by name and what they show as. */
export function describe(project: Project, shots: Shot[], images: StoredImage[], base: string) {
  return {
    id: project.id,
    name: project.name,
    locales: project.locales,
    theme: project.theme,
    slides: project.slides.map((slide, i) => ({ slide: i + 1, ...slide })),
    // Devices that draw a set of their own. Any other device draws `slides`.
    deviceSlides: Object.fromEntries(Object.entries(project.deviceSlides).map(([device, set]) => [device, (set ?? []).map((slide, i) => ({ slide: i + 1, ...slide }))])),
    creativeAssets: project.creatives,
    mockups: project.mockups,
    screenshots: shots.map((shot) => ({
      name: shot.name,
      device: shot.device,
      ...(shot.locale ? { locale: shot.locale } : {}),
      size: `${shot.width}×${shot.height}`,
      // What a Mac screenshot is drawn as while no slide asks for the other.
      ...(shot.device === "mac" ? { shown: deviceShape(shot, {}, "mac").frame === "none" ? "window" : "MacBook" } : {}),
    })),
    images: images.map((image) => ({ name: image.name, size: `${image.width}×${image.height}` })),
    exportSizes: defaultTargets(shots, project.targets),
    studio: `${base}/#/${project.id}`,
    // The version this is, as list_revisions and restore_project count them.
    revision: project.revision,
  };
}

/** The project described for an agent, read at once with its screenshots and images. */
export async function overview(space: Space, id: string, base: string) {
  const withShots = projects.get(space, id).then(async ({ project }) => ({ project, shots: await listShots(space, id, project.locales) }));
  const [{ project, shots }, images] = await Promise.all([withShots, listImages(space, id)]);
  return describe(project, shots, images, base);
}

export async function create(ctx: Ctx, body: unknown): Promise<Project> {
  const input = newProject.parse(body);
  return createProject(ctx.space, input, { actor: ctx.actor });
}

/**
 * Replaces the fields given and keeps the rest, on the project as it is when the change gets its turn: two updates
 * at once both land. Fields a project does not have are left out, as before, but said so: a misspelt one would
 * otherwise go unnoticed.
 */
export async function update(ctx: Ctx, id: string, body: unknown): Promise<{ project: Project; warnings: Warning[] }> {
  const patch = projectPatch.parse(body);
  const warnings: Warning[] = [];
  const ignored = unknownFields(projectPatch, body).filter((field) => !STORED_ONLY.has(field));
  if (ignored.length) warnings.push({ kind: "field", names: ignored, text: `Ignored, because a project has no such field: ${ignored.join(", ")}.` });
  const given = (body as { locales?: unknown }).locales;
  const repeated = patch.locales && Array.isArray(given) ? repeatedLocales(given as string[]) : [];
  if (repeated.length) warnings.push({ kind: "locale", names: repeated, text: `Each language is kept once, in the first of its spellings: left out ${repeated.join(", ")} from locales.` });

  return { project: await updateProject(ctx.space, id, patch, writeOptions(ctx)), warnings };
}

/** Makes an earlier version current again, as a new revision. Works on a damaged project too. */
export async function restore(ctx: Ctx, id: string, revision: number): Promise<{ stored: Stored; warnings: Warning[] }> {
  const stored = await projects.restore(ctx.space, id, revision, writeOptions(ctx));
  return { stored, warnings: await missingNames(ctx.space, stored.project) };
}

/** The versions kept of a project, newest first. */
export const revisions = (space: Space, id: string) => projects.revisions(space, id);

/** Deletes a project with everything in it, one that cannot be read included. */
export const remove = (space: Space, id: string) => deleteProject(space, id);

/** Screenshot names the slides and assets of `project` use that nothing is uploaded under. */
export function unknownScreenshots(project: Pick<Project, "slides" | "deviceSlides" | "creatives">, shots: Shot[]): string[] {
  const known = new Set(shots.map((shot) => shot.name));
  const named = [
    ...allSlides(project).flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3, ...(slide.features ?? []).map((feature) => feature.screenshot)]),
    ...Object.values(project.creatives).flatMap((creative) => creative?.screenshots ?? []),
  ];
  return [...new Set(named.filter((name) => name != null && !known.has(name)))] as string[];
}

/** Image names the slides and assets of `project` use that nothing is uploaded under. */
export function unknownImages(project: Pick<Project, "slides" | "deviceSlides" | "creatives">, images: StoredImage[]): string[] {
  const known = new Set(images.map((image) => image.name));
  const named = [
    ...allSlides(project).flatMap((slide) => [slide.logo?.image, ...(slide.images ?? []).map((placed) => placed.image), ...(slide.features ?? []).map((feature) => feature.image)]),
    ...Object.values(project.creatives).map((creative) => creative?.logo?.image),
  ];
  return [...new Set(named.filter((name) => name != null && !known.has(name)))] as string[];
}

export const missingScreenshots = (names: string[]): Warning[] =>
  names.length ? [{ kind: "screenshot", names, text: `Not uploaded yet, so these will render as placeholders: ${names.join(", ")}.` }] : [];

export const missingImages = (names: string[]): Warning[] =>
  names.length ? [{ kind: "image", names, text: `No image is uploaded under these names, so they will be left out: ${names.join(", ")}.` }] : [];

/** What a project names without having it: screenshots come out as placeholders, images are left out. */
export async function missingNames(space: Space, project: Project, shots?: Shot[]): Promise<Warning[]> {
  const [known, images] = await Promise.all([shots ?? listShots(space, project.id, project.locales), listImages(space, project.id)]);
  return [...missingScreenshots(unknownScreenshots(project, known)), ...missingImages(unknownImages(project, images))];
}
