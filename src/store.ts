import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { InputError, NotFoundError } from "./domain/errors.ts";
import { allSlides, type Project, SLUG } from "./schema.ts";
import { type DeviceKind, deviceKindOf, PLACEMENT_IDS, PLACEMENTS, type PlacementId } from "./sizes.ts";
import { withProjectLock } from "./storage/mutex.ts";
import { assertSlug, imagesDir, outDir, projectKey, projectsDir, SHOT_FILE, shotFile, shotsDir, type Space } from "./storage/paths.ts";
import { type Damaged, type NewProject, projects, type Stored, type WriteOptions } from "./storage/projects.ts";

// The functions the server, the MCP tools and the renderer call keep their names and shapes here. Projects are read
// and written by the repository in storage/projects.ts, which locks, counts revisions and keeps the history.
export { ConflictError, DamagedError, InputError, NotFoundError } from "./domain/errors.ts";
export { imagesDir, outDir, projectDir, safeJoin, shotsDir, type Space } from "./storage/paths.ts";
export { countProjects, slugify } from "./storage/projects.ts";
// The Studio picks its thumbnails with the same function, so the two cannot pick differently.
export { findShot } from "./domain/standins.ts";

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

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
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

/** The projects that can be opened, newest change first. The repository's list also names the damaged ones. */
export async function listProjects(space: Space): Promise<Project[]> {
  return (await projects.list(space)).flatMap((entry) => ("project" in entry ? [entry.project] : []));
}

/**
 * A project as the lists show it, to the Studio, the CLI and agents alike. One that cannot be read has the same
 * keys, so a client that does not know `damaged` still lists it and can delete it.
 */
export function projectSummary(entry: Stored | Damaged) {
  if (!("project" in entry)) return { id: entry.id, name: entry.id, slides: 0, ownSets: [] as string[], locales: [] as string[], updatedAt: entry.updatedAt, damaged: entry.damaged };
  const { project } = entry;
  return { id: project.id, name: project.name, slides: project.slides.length, ownSets: Object.keys(project.deviceSlides), locales: project.locales, updatedAt: project.updatedAt };
}

export async function getProject(space: Space, id: string): Promise<Project> {
  return (await projects.get(space, id)).project;
}

export async function createProject(space: Space, input: NewProject, options?: Pick<WriteOptions, "actor">): Promise<Project> {
  return (await projects.create(space, input, options)).project;
}

/**
 * Replaces the fields given and keeps the rest, on the project as it is when the change gets its turn: two updates
 * at once both land. With `ifRevision`, one made on an older revision is refused instead.
 */
export async function updateProject(
  space: Space,
  id: string,
  patch: Partial<Pick<Project, "name" | "locales" | "theme" | "slides" | "deviceSlides" | "creatives" | "mockups">> & { targets?: Project["targets"] | null },
  options: WriteOptions = {},
): Promise<Project> {
  const defined: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  // An empty choice of sizes means the standard ones again.
  if (defined.targets === null || (Array.isArray(defined.targets) && defined.targets.length === 0)) defined.targets = undefined;
  const { project } = await projects.mutate(space, id, (current) => ({ ...current, ...defined }), options);
  return project;
}

/** Deletes a project with everything in it, one that cannot be read included. */
export async function deleteProject(space: Space, id: string): Promise<void> {
  await projects.tombstone(space, id);
  await projects.remove(space, id);
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
  // Refused before the picture is decoded: a project or a language that is not there.
  shotLocale(await getProject(space, id), language);
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
  const dir = shotsDir(space, id);
  // Filed under the project's lock: a change of its first language renames the files around this one.
  const { file, locale, info } = await withProjectLock(projectKey(space, id), async () => {
    const project = await getProject(space, id);
    const locale = shotLocale(project, language);
    const file = shotFile(name, kind, locale);
    await mkdir(dir, { recursive: true });
    if (space.limits && !(await exists(path.join(dir, file)))) {
      // Counted per language, so that a project in many languages has room for each.
      const count = (await readdir(dir)).map((entry) => SHOT_FILE.exec(entry)).filter((match) => match && match[3] === locale).length;
      if (count >= space.limits.shots) throw new InputError(`A project is limited to ${space.limits.shots} screenshots${locale ? ` per language, and ${locale} has that many` : ""}. Delete some to make room.`);
    }
    await writeFile(path.join(dir, file), png);
    // One filed under the first language while that was not the first yet would otherwise keep hiding this one.
    if (!locale) await rm(path.join(dir, shotFile(name, kind, project.locales[0])), { force: true });
    return { file, locale, info: await stat(path.join(dir, file)) };
  });
  const corner = window ? await cornerRadius(sharp(png), width, height) : 0;
  return { name, device: kind, ...(locale ? { locale } : {}), file, width, height, bytes: info.size, version: Math.round(info.mtimeMs), ...(corner ? { corner } : {}) };
}

export async function deleteShot(space: Space, id: string, file: string): Promise<void> {
  if (!SHOT_FILE.test(file)) throw new InputError(`Invalid screenshot file "${file}"`);
  await withProjectLock(projectKey(space, id), () => rm(path.join(shotsDir(space, id), file), { force: true }));
}

/**
 * Files a screenshot under another device, for one whose size did not give it away, or under another language
 * (null: every language). It replaces what was there under the name.
 */
export async function moveShot(space: Space, id: string, file: string, to: { device?: DeviceKind; locale?: string | null }): Promise<Shot> {
  return withProjectLock(projectKey(space, id), async () => {
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
  });
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
