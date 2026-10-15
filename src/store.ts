import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { allSlides, type Creatives, type Project, projectSchema, SLUG, type Slide, type Theme } from "./schema.ts";
import { type DeviceKind, deviceKindOf, PLACEMENT_IDS, PLACEMENTS, type PlacementId } from "./sizes.ts";
import { writeFileAtomic } from "./storage/atomic.ts";

export class NotFoundError extends Error {}
export class InputError extends Error {}

export interface Shot {
  name: string;
  device: DeviceKind;
  /** The language this one is for. Without it, it is the screenshot every language shows that has none of its own. */
  locale?: string;
  /** File name inside the project's shots directory. */
  file: string;
  width: number;
  height: number;
  bytes: number;
  /** Changes whenever the file is replaced, so previews can bust their cache. */
  version: number;
  /** The radius of its round, see-through corners in pixels. Only a capture of a Mac window has them; a screenshot of a display has none. */
  corner?: number;
}

/**
 * One account's private storage. Every lookup below takes one, so a request can only ever
 * reach the files of the account it was authenticated as.
 */
export interface Space {
  id: string;
  root: string;
  /** Caps for accounts other than the admin. */
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
export const imagesDir = (space: Space, id: string) => path.join(projectDir(space, id), "images");
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

/** How many files a folder holds with everything below it, and their bytes. */
async function weigh(dir: string): Promise<{ files: number; bytes: number }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const total = { files: 0, bytes: 0 };
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const below = await weigh(full);
      total.files += below.files;
      total.bytes += below.bytes;
    } else if (entry.isFile()) {
      total.files++;
      total.bytes += await stat(full).then(
        (info) => info.size,
        () => 0,
      );
    }
  }
  return total;
}

export interface Usage {
  projects: number;
  slides: number;
  shots: number;
  images: number;
  /** Everything the projects keep on disk, rendered files included. */
  bytes: number;
}

/** What one account keeps, as numbers only. The admin's overview adds these up without opening anybody's work. */
export async function usageOf(space: Space): Promise<Usage> {
  const usage: Usage = { projects: 0, slides: 0, shots: 0, images: 0, bytes: 0 };
  const entries = await readdir(projectsDir(space), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG.test(entry.name)) continue;
    const dir = path.join(projectsDir(space), entry.name);
    const [project, shots, images, all] = await Promise.all([
      getProject(space, entry.name).catch(() => null),
      readdir(path.join(dir, "shots")).catch(() => []),
      readdir(path.join(dir, "images")).catch(() => []),
      weigh(dir),
    ]);
    usage.projects++;
    usage.slides += project ? allSlides(project).length : 0;
    usage.shots += shots.filter((file) => SHOT_FILE.test(file)).length;
    usage.images += images.filter((file) => IMAGE_FILE.test(file)).length;
    usage.bytes += all.bytes;
  }
  return usage;
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
  // Agents send their tool calls in parallel and the Studio saves while they work, so writes overlap: each one
  // replaces the file whole, and none can leave it truncated or mixed with another.
  await writeFileAtomic(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
}

/** Pages of the Studio that stand where a project's id would: a project named so gets a number behind its id. */
const RESERVED_IDS = new Set(["settings", "admin"]);

export async function createProject(
  space: Space,
  input: { name: string; locales?: string[]; targets?: Project["targets"] | null; theme?: Theme; slides?: Slide[]; deviceSlides?: Project["deviceSlides"]; creatives?: Creatives },
): Promise<Project> {
  if (space.limits && (await countProjects(space)) >= space.limits.projects) {
    throw new InputError(`This account is limited to ${space.limits.projects} projects. Delete one to make room.`);
  }
  const base = slugify(input.name);
  let id = base;
  for (let n = 2; RESERVED_IDS.has(id) || (await exists(projectDir(space, id))); n++) id = `${base}-${n}`;
  const now = new Date().toISOString();
  const project = projectSchema.parse({
    id,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    locales: input.locales?.length ? input.locales : ["en"],
    ...(input.targets?.length ? { targets: input.targets } : {}),
    theme: input.theme ?? {},
    slides: input.slides ?? [],
    deviceSlides: input.deviceSlides ?? {},
    creatives: input.creatives ?? {},
  });
  await writeProject(space, project);
  return project;
}

export async function updateProject(
  space: Space,
  id: string,
  patch: Partial<Pick<Project, "name" | "locales" | "theme" | "slides" | "deviceSlides" | "creatives" | "mockups">> & { targets?: Project["targets"] | null },
): Promise<Project> {
  const current = await getProject(space, id);
  const defined: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  // An empty choice of sizes means the standard ones again.
  if (defined.targets === null || (Array.isArray(defined.targets) && defined.targets.length === 0)) defined.targets = undefined;
  const next = projectSchema.parse({ ...current, ...defined, updatedAt: new Date().toISOString() });
  if (next.locales[0] !== current.locales[0]) await refileShots(space, id, current.locales[0]!, next.locales);
  await writeProject(space, next);
  return next;
}

export async function deleteProject(space: Space, id: string): Promise<void> {
  await getProject(space, id);
  await rm(projectDir(space, id), { recursive: true, force: true });
}

const SHOT_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.(iphone|duo|ipad|mac)(?:\.([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*))?\.png$/;
const shotFile = (name: string, device: DeviceKind, locale?: string) => `${name}.${device}${locale ? `.${locale}` : ""}.png`;

/**
 * Keeps every language's screenshots its own when another language becomes the first: the old first language's
 * move under its code, provided the project still has it, and the new first language's become the ones without one.
 */
async function refileShots(space: Space, id: string, was: string, locales: string[]): Promise<void> {
  const dir = shotsDir(space, id);
  const files = (await readdir(dir).catch(() => [])).map((file) => SHOT_FILE.exec(file)).filter((match) => match != null);
  const first = locales[0]!.toLowerCase();
  const move = (match: RegExpExecArray, locale?: string) => rename(path.join(dir, match[0]), path.join(dir, shotFile(match[1]!, match[2] as DeviceKind, locale)));
  if (locales.includes(was)) for (const match of files) if (!match[3]) await move(match, was);
  for (const match of files) if (match[3]?.toLowerCase() === first) await move(match);
}

/**
 * The language a screenshot is filed under. The project's first language has none: its screenshots are the ones
 * every other language shows until it gets its own. A bare language such as "de" finds the project's "de-DE".
 */
export function shotLocale(project: Project, wanted: string | null | undefined): string | undefined {
  if (!wanted) return undefined;
  const lower = wanted.toLowerCase();
  const language = (code: string) => code.toLowerCase().split("-")[0];
  const found =
    project.locales.find((code) => code.toLowerCase() === lower) ??
    project.locales.find((code) => language(code) === lower) ??
    project.locales.find((code) => code.toLowerCase() === language(wanted));
  if (!found) throw new InputError(`This project has no language "${wanted}". Its languages are ${project.locales.join(", ")}. Add "${wanted}" to the project first.`);
  return found === project.locales[0] ? undefined : found;
}

export async function listShots(space: Space, id: string): Promise<Shot[]> {
  const dir = shotsDir(space, id);
  const files = await readdir(dir).catch(() => []);
  const shots: Shot[] = [];
  for (const file of files.sort()) {
    const match = SHOT_FILE.exec(file);
    if (!match) continue;
    const full = path.join(dir, file);
    const [info, meta] = await Promise.all([stat(full), sharp(full).metadata()]);
    const version = Math.round(info.mtimeMs);
    const corner = match[2] === "mac" && meta.hasAlpha ? await cornerOf(full, version, meta.width, meta.height) : 0;
    shots.push({
      name: match[1]!,
      device: match[2] as DeviceKind,
      ...(match[3] ? { locale: match[3] } : {}),
      file,
      width: meta.width,
      height: meta.height,
      bytes: info.size,
      version,
      ...(corner ? { corner } : {}),
    });
  }
  return shots;
}

/** A pixel counts as part of the window from this much opacity on. Its shadow never reaches it. */
const SOLID = 250;

/**
 * How round the corners of a picture are: the radius of the circle that fits its see-through top left corner,
 * in pixels, or 0 where the corner is filled.
 */
async function cornerRadius(image: Sharp, width: number, height: number): Promise<number> {
  const side = Math.max(2, Math.round(Math.min(width, height) * 0.03));
  const alpha = await image.extract({ left: 0, top: 0, width: side, height: side }).ensureAlpha().extractChannel(3).raw().toBuffer();
  let reach = 0;
  while (reach < side && alpha[reach * side + reach]! < 128) reach++;
  // A circle leaves 1 - 1/sqrt(2) of its radius bare along the diagonal of its corner.
  return reach === 0 ? 0 : Math.round(reach / (1 - Math.SQRT1_2));
}

const cornerCache = new Map<string, number>();

async function cornerOf(file: string, version: number, width: number, height: number): Promise<number> {
  const key = `${file}:${version}`;
  const cached = cornerCache.get(key);
  if (cached !== undefined) return cached;
  const corner = await cornerRadius(sharp(file), width, height).catch(() => 0);
  cornerCache.set(key, corner);
  return corner;
}

/**
 * A capture of a Mac window comes with see-through round corners, and with the window's shadow around it unless that
 * was left out. Cuts the picture down to the window itself. Null for a picture that is no such capture.
 */
async function windowCapture(png: Buffer, width: number, height: number): Promise<{ png: Buffer; width: number; height: number } | null> {
  const alpha = await sharp(png).extractChannel(3).raw().toBuffer();
  if (alpha[0]! >= 128) return null;
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x]! < SOLID) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    if (top > y) top = y;
    bottom = y;
    if (first < left) left = first;
    if (last > right) right = last;
  }
  const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
  // Mostly see-through: artwork with a cut-out subject, not a window.
  if (box.width < width * 0.5 || box.height < height * 0.5 || Math.min(box.width, box.height) < 300) return null;
  if (box.width === width && box.height === height) return { png, width, height };
  return { png: await sharp(png).extract(box).png().toBuffer(), width: box.width, height: box.height };
}

/** Stores a raw screenshot as PNG. One name can hold an iPhone, an iPhone Duo and an iPad variant side by side, and each of them once per language. */
export async function saveShot(space: Space, id: string, name: string, data: Buffer, device?: DeviceKind, language?: string): Promise<Shot> {
  const project = await getProject(space, id);
  const locale = shotLocale(project, language);
  assertSlug(name, "screenshot name");
  let png: Buffer;
  let width: number;
  let height: number;
  let window: Awaited<ReturnType<typeof windowCapture>>;
  try {
    const result = await sharp(data).rotate().png().toBuffer({ resolveWithObject: true });
    png = result.data;
    width = result.info.width;
    height = result.info.height;
    // Only a Mac window is captured with see-through corners, so one is a Mac's whatever its shape.
    window = result.info.channels === 4 && (!device || device === "mac") ? await windowCapture(png, width, height) : null;
    if (window) ({ png, width, height } = window);
  } catch {
    throw new InputError("Not a readable image. Upload a PNG, JPEG or WebP screenshot.");
  }
  if (Math.min(width, height) < 300) throw new InputError(`Image is only ${width}×${height}; that is too small for a screenshot.`);
  const kind = device ?? (window ? "mac" : deviceKindOf(width, height));
  const file = shotFile(name, kind, locale);
  const dir = shotsDir(space, id);
  await mkdir(dir, { recursive: true });
  if (space.limits && !(await exists(path.join(dir, file)))) {
    // Counted per language, so that a project in many languages has room for each.
    const count = (await readdir(dir)).map((entry) => SHOT_FILE.exec(entry)).filter((match) => match && match[3] === locale).length;
    if (count >= space.limits.shots) throw new InputError(`A project is limited to ${space.limits.shots} screenshots${locale ? ` per language, and ${locale} has that many` : ""}. Delete some to make room.`);
  }
  await writeFile(path.join(dir, file), png);
  // One filed under the first language while that was not the first yet would otherwise keep hiding this one.
  if (!locale) await rm(path.join(dir, shotFile(name, kind, project.locales[0])), { force: true });
  const info = await stat(path.join(dir, file));
  const corner = window ? await cornerRadius(sharp(png), width, height) : 0;
  return { name, device: kind, ...(locale ? { locale } : {}), file, width, height, bytes: info.size, version: Math.round(info.mtimeMs), ...(corner ? { corner } : {}) };
}

export async function deleteShot(space: Space, id: string, file: string): Promise<void> {
  if (!SHOT_FILE.test(file)) throw new InputError(`Invalid screenshot file "${file}"`);
  await rm(path.join(shotsDir(space, id), file), { force: true });
}

/**
 * Files a screenshot under another device, for one whose size did not give it away, or under another language
 * (null: every language). It replaces what was there under the name.
 */
export async function moveShot(space: Space, id: string, file: string, to: { device?: DeviceKind; locale?: string | null }): Promise<Shot> {
  const project = await getProject(space, id);
  const match = SHOT_FILE.exec(file);
  if (!match) throw new InputError(`Invalid screenshot file "${file}"`);
  const dir = shotsDir(space, id);
  const device = to.device ?? (match[2] as DeviceKind);
  const locale = to.locale === undefined ? match[3] : shotLocale(project, to.locale);
  const moved = shotFile(match[1]!, device, locale);
  if (!(await exists(path.join(dir, file)))) throw new NotFoundError(`No screenshot "${file}"`);
  if (moved !== file) await rename(path.join(dir, file), path.join(dir, moved));
  const [info, meta] = await Promise.all([stat(path.join(dir, moved)), sharp(path.join(dir, moved)).metadata()]);
  return { name: match[1]!, device, ...(locale ? { locale } : {}), file: moved, width: meta.width, height: meta.height, bytes: info.size, version: Math.round(info.mtimeMs) };
}

/** An uploaded image that is not a screenshot: a logo, a sticker, a character. Slides place it by name. */
export interface StoredImage {
  name: string;
  /** File name inside the project's images directory. */
  file: string;
  width: number;
  height: number;
  bytes: number;
  version: number;
}

const IMAGE_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.png$/;
/** No slide shows an image larger than this, and a logo needs far less. */
const IMAGE_MAX = 2048;

export async function listImages(space: Space, id: string): Promise<StoredImage[]> {
  const dir = imagesDir(space, id);
  const files = await readdir(dir).catch(() => []);
  const images: StoredImage[] = [];
  for (const file of files.sort()) {
    const match = IMAGE_FILE.exec(file);
    if (!match) continue;
    const full = path.join(dir, file);
    const [info, meta] = await Promise.all([stat(full), sharp(full).metadata()]);
    images.push({ name: match[1]!, file, width: meta.width, height: meta.height, bytes: info.size, version: Math.round(info.mtimeMs) });
  }
  return images;
}

/** Stores a logo or other artwork as a PNG, transparency included. An SVG is drawn large enough to stay sharp. */
export async function saveImage(space: Space, id: string, name: string, data: Buffer): Promise<StoredImage> {
  await getProject(space, id);
  assertSlug(name, "image name");
  let png: Buffer;
  let width: number;
  let height: number;
  try {
    const meta = await sharp(data).metadata();
    // An SVG is drawn at the size it declares, which for a logo is often a few dozen pixels.
    const vector = meta.format === "svg" && meta.width && meta.height;
    const density = vector ? Math.min(2400, Math.max(72, Math.round((72 * 1600) / Math.max(meta.width, meta.height)))) : undefined;
    const result = await sharp(data, density ? { density } : {})
      .rotate()
      .resize({ width: IMAGE_MAX, height: IMAGE_MAX, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    png = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    throw new InputError("Not a readable image. Upload a PNG, SVG, JPEG or WebP file.");
  }
  if (Math.min(width, height) < 16) throw new InputError(`Image is only ${width}×${height}; that is too small to show.`);
  const file = `${name}.png`;
  const dir = imagesDir(space, id);
  await mkdir(dir, { recursive: true });
  if (space.limits && !(await exists(path.join(dir, file)))) {
    const count = (await readdir(dir)).filter((entry) => IMAGE_FILE.test(entry)).length;
    if (count >= space.limits.shots) throw new InputError(`A project is limited to ${space.limits.shots} images. Delete some to make room.`);
  }
  await writeFile(path.join(dir, file), png);
  const info = await stat(path.join(dir, file));
  return { name, file, width, height, bytes: info.size, version: Math.round(info.mtimeMs) };
}

export async function deleteImage(space: Space, id: string, file: string): Promise<void> {
  if (!IMAGE_FILE.test(file)) throw new InputError(`Invalid image file "${file}"`);
  await rm(path.join(imagesDir(space, id), file), { force: true });
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

/** Where the wide pictures of one locale are written, inside the output directory: the App Store's in one folder, the banners in another. */
export const CREATIVE_DIR = "creative-assets";
export const BANNER_DIR = "banners";
export const creativeDir = (placement: PlacementId) => (PLACEMENTS[placement].kind === "banner" ? BANNER_DIR : CREATIVE_DIR);

export interface CreativeOutput {
  locale: string;
  placement: PlacementId;
  /** Path relative to the project's output directory. */
  path: string;
  version: number;
}

/** Lists the header and search results assets and the banners rendered so far. */
export async function listCreativeOutputs(space: Space, id: string): Promise<CreativeOutput[]> {
  const root = outDir(space, id);
  const found: CreativeOutput[] = [];
  for (const locale of (await readdir(root).catch(() => [])).sort()) {
    for (const placement of PLACEMENT_IDS) {
      const relative = path.join(locale, creativeDir(placement), `${placement}.png`);
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

/** Which device's screenshot stands in when a name has none for the device asked for: the one closest in shape first. */
const STAND_INS: Record<DeviceKind, DeviceKind[]> = {
  iphone: ["iphone", "duo", "ipad", "mac"],
  duo: ["duo", "ipad", "iphone", "mac"],
  ipad: ["ipad", "duo", "iphone", "mac"],
  mac: ["mac", "ipad", "duo", "iphone"],
};

/**
 * Picks the variant for the target's device and the language: that language's own screenshot, else the one for
 * every language, else another language's. Only then another device's stands in, because the shape matters most.
 */
export function findShot(shots: Shot[], name: string | undefined, device: DeviceKind, locale?: string): Shot | undefined {
  if (!name) return undefined;
  const named = shots.filter((shot) => shot.name === name);
  const lower = locale?.toLowerCase();
  for (const kind of STAND_INS[device]) {
    const ofKind = named.filter((shot) => shot.device === kind);
    const found = ofKind.find((shot) => lower != null && shot.locale?.toLowerCase() === lower) ?? ofKind.find((shot) => !shot.locale) ?? ofKind[0];
    if (found) return found;
  }
  return undefined;
}
