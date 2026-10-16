import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { isAdmin, rendersLeft } from "../../accounts.ts";
import { config } from "../../config.ts";
import { CREATIVE_CAPACITY } from "../../creative.ts";
import { BACKGROUNDS, BADGE_TONES, BADGE_TYPES, BADGES_SHOWN, CARD_ICONS, CARD_LOOKS, CREATIVE_LAYOUTS, EMPHASIS, FEATURE_LAYOUTS, REVIEWS_SHOWN, DEVICE_COLOR_IDS, DEVICE_STYLES, FEATURE_STYLES, LAYOUT_SPREAD, STATUS_BARS, POINT_STYLES, ICON_ROW_SIZE_IDS, ICON_ROW_STYLES, ICON_ROW_TONES, FONT_IDS, FONTS, ICON_GROUPS, ICON_IDS, LAYOUT_SHOTS, LAYOUTS, LOGO_SHAPES, LOGO_SIZE_IDS } from "../../design.ts";
import { defaultTargets } from "../../render.ts";
import { creativesSchema, deviceSlidesSchema, localesSchema, mockupsSchema, repeatedLocales, slideSchema, targetsSchema, themeSchema, unknownFields } from "../../schema.ts";
import { DEVICE_KINDS, DEVICE_LABELS, PLACEMENTS, TARGETS } from "../../sizes.ts";
import { projects, type WriteOptions } from "../../storage/projects.ts";
import { ConflictError, createProject, deleteProject, getProject, InputError, listCreativeOutputs, listOutputs, projectSummary, readImages, readShots, type Space, updateProject, usageOf } from "../../store.ts";
import { identityOf, spaceOf } from "../auth.ts";

const projectPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  locales: localesSchema.optional(),
  targets: targetsSchema.nullable().optional(),
  theme: themeSchema.optional(),
  slides: z.array(slideSchema).max(10).optional(),
  deviceSlides: deviceSlidesSchema.optional(),
  creatives: creativesSchema.optional(),
  mockups: mockupsSchema.optional(),
});

/**
 * Renders of assets the project no longer defines stay on disk until the next full render, but are not offered. Nor
 * are those of a language it no longer has, which go with the next render, as its slides do.
 */
export async function creativeOutputs(space: Space, id: string) {
  const [project, outputs] = await Promise.all([getProject(space, id), listCreativeOutputs(space, id)]);
  const languages = new Set(project.locales.map((code) => code.toLowerCase()));
  return outputs.filter((output) => project.creatives[output.placement] && languages.has(output.locale.toLowerCase()));
}

/**
 * A project with everything it has. `orphanedShots` are the screenshots of languages it no longer has: kept, so that
 * adding the language again brings them back, but drawn for no other language, and listed so they can be deleted.
 */
async function projectDetail(space: Space, id: string) {
  const withShots = projects.get(space, id).then(async (stored) => ({ ...stored, files: await readShots(space, id, stored.project.locales) }));
  const [{ project, revision, warnings: stored, files }, art, outputs, creatives] = await Promise.all([withShots, readImages(space, id), listOutputs(space, id), creativeOutputs(space, id)]);
  const { shots, orphaned } = files;
  const unreadable = (kind: string) => (file: string) => `The ${kind} ${file} cannot be read and is left out. Upload it again or delete it.`;
  const warnings = [...stored, ...files.unreadable.map(unreadable("screenshot")), ...art.unreadable.map(unreadable("image"))];
  return { project, revision, shots, orphanedShots: orphaned, images: art.images, outputs, creativeOutputs: creatives, defaultTargets: defaultTargets(shots, project.targets), ...(warnings.length ? { warnings } : {}) };
}

/**
 * The revision is the ETag, for the If-Match of the next change. Not kept by anything: an upload changes the
 * screenshots without a new revision, so a cached copy would be answered 304 while out of date.
 */
function sendDetail(res: Response, detail: Awaited<ReturnType<typeof projectDetail>>) {
  res.set({ ETag: `"${detail.revision}"`, "Cache-Control": "private, no-store" }).json(detail);
}

/** The revision a change was made on, from If-Match: "5", W/"5" or 5. None, or "*", takes whatever is current. */
function ifMatch(req: Request): number | undefined {
  const header = req.get("if-match")?.trim();
  if (!header || header === "*") return undefined;
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header);
  if (!match) throw new InputError('If-Match takes the revision the change was made on, as the ETag of the project gave it, such as "5".');
  return Number(match[1]);
}

/** Who saves, for the history. Browsers say where a request comes from; the CLI and scripts do not. */
const actorOf = (req: Request) => (req.get("sec-fetch-site") ? "studio" : "api");

/** Fields the detail carries that are not changed by sending them back. */
const STORED_ONLY = new Set(["id", "createdAt", "updatedAt", "schemaVersion", "revision"]);

/**
 * Makes a change and answers with the project. One made on a revision that is no longer current is answered 409,
 * with the project as it is now, so the caller can make it again on that.
 */
async function change(req: Request<{ id: string }>, res: Response, work: (options: WriteOptions) => Promise<unknown>, warnings: string[] = []) {
  const space = spaceOf(res);
  const options = { ifRevision: ifMatch(req), actor: actorOf(req) };
  try {
    await work(options);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    const current = await projectDetail(space, req.params.id);
    return void res.status(409).set({ ETag: `"${current.revision}"`, "Cache-Control": "private, no-store" }).json({ error: error.message, revision: error.revision, project: current });
  }
  const detail = await projectDetail(space, req.params.id);
  const all = [...(detail.warnings ?? []), ...warnings];
  sendDetail(res, all.length ? { ...detail, warnings: all } : detail);
}

/** What the Studio needs to know about this server, and the projects themselves. */
export function projectRoutes(): Router {
  const api = express.Router();

  api.get("/meta", (_req, res) => {
    const { user, space } = identityOf(res);
    res.json({
      targets: TARGETS,
      devices: DEVICE_KINDS.map((id) => ({ id, label: DEVICE_LABELS[id] })),
      layouts: LAYOUTS,
      layoutShots: LAYOUT_SHOTS,
      placements: PLACEMENTS,
      creativeLayouts: Object.fromEntries(Object.entries(CREATIVE_LAYOUTS).map(([id, note]) => [id, { note, screenshots: CREATIVE_CAPACITY[id as keyof typeof CREATIVE_LAYOUTS] }])),
      fonts: FONT_IDS,
      fontList: Object.entries(FONTS).map(([id, font]) => ({ id, family: font.family, group: font.group, note: font.note, weight: font.weight })),
      backgrounds: ["auto", ...Object.keys(BACKGROUNDS)],
      deviceColors: DEVICE_COLOR_IDS,
      deviceStyles: DEVICE_STYLES,
      statusBars: STATUS_BARS,
      layoutSpread: LAYOUT_SPREAD,
      badgeTypes: BADGE_TYPES,
      badgeTones: BADGE_TONES,
      featureStyles: FEATURE_STYLES,
      pointStyles: POINT_STYLES,
      featureLayouts: FEATURE_LAYOUTS,
      cardLooks: CARD_LOOKS,
      cardIcons: CARD_ICONS,
      emphasis: EMPHASIS,
      badgesShown: BADGES_SHOWN,
      reviewsShown: REVIEWS_SHOWN,
      logoShapes: LOGO_SHAPES,
      logoSizes: LOGO_SIZE_IDS,
      iconRowStyles: ICON_ROW_STYLES,
      iconRowTones: ICON_ROW_TONES,
      iconRowSizes: ICON_ROW_SIZE_IDS,
      icons: ICON_IDS,
      iconGroups: ICON_GROUPS,
      authEnabled: config.auth,
      /** Null only while sign-in is off. */
      account: user ? { email: user.email, name: user.name, admin: isAdmin(user) } : null,
      /** How many renders the account has left. Null where they are not counted: for the admin, and while sign-in is off. */
      rendersLeft: rendersLeft(space.id),
    });
  });

  // A project whose project.json cannot be read is listed too, with `damaged`, so it can be restored or deleted.
  api.get("/projects", async (_req, res) => {
    res.json((await projects.list(spaceOf(res))).map(projectSummary));
  });
  /** How much the caller keeps here: what the settings page shows. */
  api.get("/usage", async (_req, res) => {
    res.json(await usageOf(spaceOf(res)));
  });
  api.post("/projects", async (req, res) => {
    const body = projectPatch.extend({ name: z.string().min(1).max(80) }).parse(req.body);
    res.status(201).json(await createProject(spaceOf(res), body, { actor: actorOf(req) }));
  });
  api.get("/projects/:id", async (req, res) => {
    sendDetail(res, await projectDetail(spaceOf(res), req.params.id));
  });
  api.put("/projects/:id", async (req, res) => {
    const patch = projectPatch.parse(req.body);
    // Fields a project does not have are left out, as before, but said so: a misspelt one would otherwise go unnoticed.
    const ignored = unknownFields(projectPatch, req.body).filter((field) => !STORED_ONLY.has(field));
    const warnings = ignored.length ? [`Ignored, because a project has no such field: ${ignored.join(", ")}.`] : [];
    const repeated = patch.locales ? repeatedLocales(req.body.locales) : [];
    if (repeated.length) warnings.push(`Each language is kept once, in the first of its spellings: left out ${repeated.join(", ")} from locales.`);
    await change(req, res, (options) => updateProject(spaceOf(res), req.params.id, patch, options), warnings);
  });
  /** The versions kept of a project, newest first: every change is one, the last 50 of them. */
  api.get("/projects/:id/revisions", async (req, res) => {
    res.json(await projects.revisions(spaceOf(res), req.params.id));
  });
  /** Makes an earlier version current again, as a new revision. Works on a damaged project too. */
  api.post("/projects/:id/restore", async (req, res) => {
    const { revision } = z.object({ revision: z.number().int().min(0) }).parse(req.body);
    await change(req, res, (options) => projects.restore(spaceOf(res), req.params.id, revision, options));
  });
  api.delete("/projects/:id", async (req, res) => {
    await deleteProject(spaceOf(res), req.params.id);
    res.status(204).end();
  });

  return api;
}
