import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { type Creatives, type Project, projectSchema, SLUG, type Slide, type Theme } from "./schema.ts";
import { type DeviceKind, deviceKindOf, PLACEMENT_IDS, type PlacementId } from "./sizes.ts";

export class NotFoundError extends Error {}
export class InputError extends Error {}

export interface Shot {
  name: string;
  device: DeviceKind;
  /** File name inside the project's shots directory. */
  file: string;
  width: number;
  height: number;
  bytes: number;
  /** Changes whenever the file is replaced, so previews can bust their cache. */
  version: number;
}

/**
 * One account's private storage. Every lookup below takes one, so a request can only ever
 * reach the files of the account it was authenticated as.
 */
export interface Space {
  id: string;
  root: string;
  /** Caps for accounts other than the owner. */
  limits?: { projects: number; shots: number };
}

const projectsDir = (space: Space) => path.join(space.root, "projects");

function assertSlug(value: string, what: string): void {
  if (!SLUG.test(value)) throw new InputError(`Invalid ${what} "${value}": use lowercase letters, digits, - and _`);
}

export function projectDir(space: Space, id: string): string {
  assertSlug(id, "project id");
  return path.join(projectsDir(space), id);
}

export const shotsDir = (space: Space, id: string) => path.join(projectDir(space, id), "shots");
export const outDir = (space: Space, id: string) => path.join(projectDir(space, id), "out");

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "project";
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

export async function countProjects(space: Space): Promise<number> {
  const entries = await readdir(projectsDir(space), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && SLUG.test(entry.name)).length;
}

export async function listProjects(space: Space): Promise<Project[]> {
  const entries = await readdir(projectsDir(space), { withFileTypes: true }).catch(() => []);
  const projects: Project[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
    const project = await getProject(space, entry.name).catch(() => null);
    if (project) projects.push(project);
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(space: Space, id: string): Promise<Project> {
  const file = path.join(projectDir(space, id), "project.json");
  const raw = await readFile(file, "utf8").catch(() => null);
  if (raw === null) throw new NotFoundError(`No project "${id}"`);
  return projectSchema.parse(JSON.parse(raw));
}

async function writeProject(space: Space, project: Project): Promise<void> {
  const dir = projectDir(space, project.id);
  await mkdir(dir, { recursive: true });
  // Write-then-rename so a crash mid-write cannot leave a truncated project file behind.
  const tmp = path.join(dir, `project.json.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(project, null, 2));
  await rename(tmp, path.join(dir, "project.json"));
}

export async function createProject(
  space: Space,
  input: { name: string; locales?: string[]; theme?: Theme; slides?: Slide[]; creatives?: Creatives },
): Promise<Project> {
  if (space.limits && (await countProjects(space)) >= space.limits.projects) {
    throw new InputError(`This account is limited to ${space.limits.projects} projects. Delete one to make room.`);
  }
  const base = slugify(input.name);
  let id = base;
  for (let n = 2; await exists(projectDir(space, id)); n++) id = `${base}-${n}`;
  const now = new Date().toISOString();
  const project = projectSchema.parse({
    id,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    locales: input.locales?.length ? input.locales : ["en"],
    theme: input.theme ?? {},
    slides: input.slides ?? [],
    creatives: input.creatives ?? {},
  });
  await writeProject(space, project);
  return project;
}

export async function updateProject(
  space: Space,
  id: string,
  patch: Partial<Pick<Project, "name" | "locales" | "theme" | "slides" | "creatives">>,
): Promise<Project> {
  const current = await getProject(space, id);
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const next = projectSchema.parse({ ...current, ...defined, updatedAt: new Date().toISOString() });
  await writeProject(space, next);
  return next;
}

export async function deleteProject(space: Space, id: string): Promise<void> {
  await getProject(space, id);
  await rm(projectDir(space, id), { recursive: true, force: true });
}

const SHOT_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.(iphone|ipad)\.png$/;

export async function listShots(space: Space, id: string): Promise<Shot[]> {
  const dir = shotsDir(space, id);
  const files = await readdir(dir).catch(() => []);
  const shots: Shot[] = [];
  for (const file of files.sort()) {
    const match = SHOT_FILE.exec(file);
    if (!match) continue;
    const full = path.join(dir, file);
    const [info, meta] = await Promise.all([stat(full), sharp(full).metadata()]);
    shots.push({
      name: match[1]!,
      device: match[2] as DeviceKind,
      file,
      width: meta.width,
      height: meta.height,
      bytes: info.size,
      version: Math.round(info.mtimeMs),
    });
  }
  return shots;
}

/** Stores a raw screenshot as PNG. One name can hold an iPhone and an iPad variant side by side. */
export async function saveShot(space: Space, id: string, name: string, data: Buffer, device?: DeviceKind): Promise<Shot> {
  await getProject(space, id);
  assertSlug(name, "screenshot name");
  let png: Buffer;
  let width: number;
  let height: number;
  try {
    const result = await sharp(data).rotate().png().toBuffer({ resolveWithObject: true });
    png = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    throw new InputError("Not a readable image. Upload a PNG, JPEG or WebP screenshot.");
  }
  if (Math.min(width, height) < 300) throw new InputError(`Image is only ${width}×${height}; that is too small for a screenshot.`);
  const kind = device ?? deviceKindOf(width, height);
  const file = `${name}.${kind}.png`;
  const dir = shotsDir(space, id);
  await mkdir(dir, { recursive: true });
  if (space.limits && !(await exists(path.join(dir, file)))) {
    const count = (await readdir(dir)).filter((entry) => SHOT_FILE.test(entry)).length;
    if (count >= space.limits.shots) throw new InputError(`A project is limited to ${space.limits.shots} screenshots. Delete some to make room.`);
  }
  await writeFile(path.join(dir, file), png);
  const info = await stat(path.join(dir, file));
  return { name, device: kind, file, width, height, bytes: info.size, version: Math.round(info.mtimeMs) };
}

export async function deleteShot(space: Space, id: string, file: string): Promise<void> {
  if (!SHOT_FILE.test(file)) throw new InputError(`Invalid screenshot file "${file}"`);
  await rm(path.join(shotsDir(space, id), file), { force: true });
}

export interface OutputSet {
  locale: string;
  target: string;
  /** Rendered slide files, e.g. 01.png, in order. */
  files: string[];
  version: number;
}

/** Lists what has been rendered so far, grouped by locale and size. */
export async function listOutputs(space: Space, id: string): Promise<OutputSet[]> {
  const root = outDir(space, id);
  const sets: OutputSet[] = [];
  for (const locale of (await readdir(root).catch(() => [])).sort()) {
    for (const target of (await readdir(path.join(root, locale)).catch(() => [])).sort()) {
      const dir = path.join(root, locale, target);
      const files = (await readdir(dir).catch(() => [])).filter((name) => /^\d{2}\.png$/.test(name)).sort();
      if (files.length === 0) continue;
      const info = await stat(path.join(dir, files[0]!));
      sets.push({ locale, target, files, version: Math.round(info.mtimeMs) });
    }
  }
  return sets;
}

/** Where the header and search results assets of one locale are written, inside the output directory. */
export const CREATIVE_DIR = "creative-assets";

export interface CreativeOutput {
  locale: string;
  placement: PlacementId;
  /** Path relative to the project's output directory. */
  path: string;
  version: number;
}

/** Lists the header and search results assets rendered so far. */
export async function listCreativeOutputs(space: Space, id: string): Promise<CreativeOutput[]> {
  const root = outDir(space, id);
  const found: CreativeOutput[] = [];
  for (const locale of (await readdir(root).catch(() => [])).sort()) {
    for (const placement of PLACEMENT_IDS) {
      const relative = path.join(locale, CREATIVE_DIR, `${placement}.png`);
      const info = await stat(path.join(root, relative)).catch(() => null);
      if (info) found.push({ locale, placement, path: relative, version: Math.round(info.mtimeMs) });
    }
  }
  return found;
}

/** Resolves a file inside a project subdirectory, refusing anything that would escape it. */
export function safeJoin(root: string, relative: string): string {
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) throw new InputError("Invalid path");
  return full;
}

/** Picks the variant for the target's device, falling back to the other one. */
export function findShot(shots: Shot[], name: string | undefined, device: DeviceKind): Shot | undefined {
  if (!name) return undefined;
  const named = shots.filter((shot) => shot.name === name);
  return named.find((shot) => shot.device === device) ?? named[0];
}
