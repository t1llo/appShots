import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { InputError, NotFoundError, TooLargeError } from "../domain/errors.ts";
import type { Project } from "../schema.ts";
import { DEVICE_KINDS, type DeviceKind, deviceKindOf } from "../sizes.ts";
import { writeFileAtomic } from "./atomic.ts";
import { checkPixels, decodeError, JPEG_MAX_PIXELS, MAX_PIXELS, MAX_SIDE, openImage, readHeader } from "./images.ts";
import { readIndexed, recordFiles, stampOf } from "./index-cache.ts";
import { loadRaw } from "./migrate.ts";
import { withProjectLock } from "./mutex.ts";
import { assertSlug, IMAGE_FILE, imagesDir, projectFile, projectKey, SHOT_FILE, shotFile, shotsDir, type Space } from "./paths.ts";
import { projects } from "./projects.ts";
import { assertRoom, usageChanged, withRoom } from "./usage.ts";

// A project's uploads: its screenshots, one per name, device and language, and its logos and other images. They are
// listed from the folder and its index (index-cache.ts), so a listing reads no picture it has read before.

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

/** What the index keeps of an image. */
interface Size {
  width: number;
  height: number;
}

/** And of a screenshot: also the radius of its top left corner as stored, 0 where that is filled. */
interface ShotMeta extends Size {
  corner: number;
}

const NOT_A_SCREENSHOT = "Not a readable image. Upload a PNG, JPEG or WebP screenshot.";
const NOT_AN_IMAGE = "Not a readable image. Upload a PNG, SVG, JPEG or WebP file.";
/** No slide shows an image larger than this, and a logo needs far less. */
const IMAGE_MAX = 2048;

const getProject = async (space: Space, id: string) => (await projects.get(space, id)).project;

/** The bytes of a stored file, 0 where there is none. */
const sizeOnDisk = async (file: string) => (await stat(file).catch(() => null))?.size ?? 0;

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

// ---------------------------------------------------------------- corners and windows

/** A pixel counts as part of the window from this much opacity on. Its shadow never reaches it. */
const SOLID = 250;

/** How far into a picture its corner is looked for: 3% of its shorter side. */
const cornerSide = (width: number, height: number) => Math.max(2, Math.round(Math.min(width, height) * 0.03));

/**
 * How round a corner is, from the opacity along its diagonal (`alphaAt(d)` is that of the pixel d along and d down):
 * the radius of the circle that fits its see-through part, in pixels, or 0 where the corner is filled.
 */
function cornerFrom(alphaAt: (d: number) => number, side: number): number {
  let reach = 0;
  while (reach < side && alphaAt(reach) < 128) reach++;
  // A circle leaves 1 - 1/sqrt(2) of its radius bare along the diagonal of its corner.
  return reach === 0 ? 0 : Math.round(reach / (1 - Math.SQRT1_2));
}

/** The size of a stored picture, from its header. Without the pixel limit: one stored before there was a limit is still listed, and can be deleted. */
async function sizeOf(file: string): Promise<Size> {
  const { width, height } = await sharp(file, { limitInputPixels: false }).metadata();
  return { width, height };
}

/** What the index keeps of a stored screenshot: its size, and the corner of one with see-through parts. */
async function describeShot(file: string): Promise<ShotMeta> {
  const { width, height, hasAlpha } = await sharp(file, { limitInputPixels: false }).metadata();
  if (!hasAlpha) return { width, height, corner: 0 };
  const side = cornerSide(width, height);
  const region = await openImage(file)
    .extract({ left: 0, top: 0, width: side, height: side })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(() => null);
  if (!region) return { width, height, corner: 0 };
  const { channels } = region.info;
  return { width, height, corner: cornerFrom((d) => region.data[(d * side + d) * channels + channels - 1]!, side) };
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A capture of a Mac window comes with see-through round corners, and with the window's shadow around it unless that
 * was left out. Finds the window in a picture's opacity, one byte a pixel: the box around its solid pixels. Null for
 * a picture that is no such capture.
 */
function windowBox(alpha: Uint8Array, width: number, height: number): Box | null {
  const at = (x: number, y: number) => alpha[y * width + x]!;
  if (at(0, 0) >= 128) return null;
  const solidRow = (y: number) => {
    for (let x = 0; x < width; x++) if (at(x, y) >= SOLID) return true;
    return false;
  };
  let top = 0;
  while (top < height && !solidRow(top)) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (!solidRow(bottom)) bottom--;
  // Each row is searched from either end only as far as the box reaches so far: inside the window that is the width
  // of its shadow, so most of the picture is never looked at.
  let [left, right] = [width, -1];
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < left; x++) {
      if (at(x, y) < SOLID) continue;
      left = x;
      break;
    }
    for (let x = width - 1; x > right; x--) {
      if (at(x, y) < SOLID) continue;
      right = x;
      break;
    }
  }
  const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
  // Mostly see-through: artwork with a cut-out subject, not a window.
  if (box.width < width * 0.5 || box.height < height * 0.5 || Math.min(box.width, box.height) < 300) return null;
  return box;
}

/** An upload as it is stored, with the corner its index entry records. `window` says it was a capture of a Mac window, cut down to the window. */
interface Encoded extends ShotMeta {
  png: Buffer;
  window: boolean;
}

/**
 * Encodes a screenshot as PNG. Of one with see-through parts only the opacity is decoded first, a quarter of its
 * pixels' bytes: a window is looked for in it where it may be a Mac's, and the corner is measured. The picture is
 * then encoded from the upload, as it is or cut down to the window, so its depth and colours stay as they were.
 */
async function encodeShot(data: Buffer, header: Metadata, device?: DeviceKind): Promise<Encoded> {
  const encode = (box?: Box) => {
    const image = openImage(data).rotate();
    return (box ? image.extract(box) : image).png().toBuffer({ resolveWithObject: true });
  };
  // The opacity is the last channel of a picture in colour or in grey.
  const opacity = header.hasAlpha ? ({ 2: 1, 4: 3 } as const)[header.channels as 2 | 4] : undefined;
  if (opacity === undefined) {
    const { data: png, info } = await encode();
    return { png, width: info.width, height: info.height, corner: 0, window: false };
  }
  const { data: alpha, info } = await openImage(data).rotate().extractChannel(opacity).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  // Only a Mac window is captured with see-through corners, so one is a Mac's whatever its shape.
  const box = header.channels === 4 && (!device || device === "mac") ? windowBox(alpha, width, height) : null;
  const kept = box ?? { left: 0, top: 0, width, height };
  const corner = cornerFrom((d) => alpha[(kept.top + d) * width + kept.left + d]!, cornerSide(kept.width, kept.height));
  const whole = kept.width === width && kept.height === height;
  const { data: png } = await encode(whole ? undefined : kept);
  return { png, width: kept.width, height: kept.height, corner, window: box !== null };
}

// ---------------------------------------------------------------- screenshots

/** The languages of a project as its project.json lists them, without reading the rest. Null when it cannot be read. */
async function languagesOf(space: Space, id: string): Promise<string[] | null> {
  const loaded = await loadRaw(projectFile(space, id));
  const locales = loaded && "raw" in loaded ? loaded.raw.locales : null;
  return Array.isArray(locales) && locales.every((code) => typeof code === "string") ? locales : null;
}

/** The screenshots on disk: those of the project's languages, those of languages it no longer has, and the files that cannot be read. */
export interface ShotFiles {
  shots: Shot[];
  /**
   * Of languages taken out of the project. They are kept, so adding the language again brings them back, but stand in
   * for no other language. They can be moved to another language or deleted.
   */
  orphaned: Shot[];
  /** Files that cannot be read as a picture: left out, and named so they can be uploaded again or deleted. */
  unreadable: string[];
}

/**
 * Reads a project's screenshots. `locales` are the project's languages, read from its project.json when not given and
 * there are screenshots of other languages than the first.
 */
export async function readShots(space: Space, id: string, locales?: string[]): Promise<ShotFiles> {
  const listed = await readIndexed(shotsDir(space, id), SHOT_FILE, describeShot);
  const result: ShotFiles = { shots: [], orphaned: [], unreadable: [] };
  const languages = locales ?? (listed.some(({ file }) => SHOT_FILE.exec(file)![3]) ? await languagesOf(space, id) : null);
  const current = languages && new Set(languages.map((code) => code.toLowerCase()));
  for (const { file, stamp, meta } of listed) {
    if (!meta) {
      result.unreadable.push(file);
      continue;
    }
    const match = SHOT_FILE.exec(file)!;
    const device = match[2] as DeviceKind;
    const shot: Shot = {
      name: match[1]!,
      device,
      ...(match[3] ? { locale: match[3] } : {}),
      file,
      width: meta.width,
      height: meta.height,
      bytes: stamp.size,
      version: Math.round(stamp.mtimeMs),
      ...(device === "mac" && meta.corner ? { corner: meta.corner } : {}),
    };
    (shot.locale && current && !current.has(shot.locale.toLowerCase()) ? result.orphaned : result.shots).push(shot);
  }
  return result;
}

/**
 * The screenshots of a project's languages: what slides, renders and mockups draw from. A caller that holds the
 * project passes its `locales`, so that they are not read from its project.json again.
 */
export async function listShots(space: Space, id: string, locales?: string[]): Promise<Shot[]> {
  return (await readShots(space, id, locales)).shots;
}

/** The screenshots of a language filed in a folder, the first language's being those without one. */
const countIn = async (dir: string, locale: string | undefined) => (await readdir(dir)).map((entry) => SHOT_FILE.exec(entry)).filter((match) => match && match[3] === locale).length;

/** Refuses a screenshot that would take a language past the limit of a project. */
async function assertShotRoom(space: Space, dir: string, locale: string | undefined): Promise<void> {
  if (!space.limits || (await countIn(dir, locale)) < space.limits.shots) return;
  // Counted per language, so that a project in many languages has room for each.
  throw new InputError(`A project is limited to ${space.limits.shots} screenshots${locale ? ` per language, and ${locale} has that many` : ""}. Delete some to make room.`);
}

/** Stores a raw screenshot as PNG. One name can hold an iPhone, an iPhone Duo and an iPad variant side by side, and each of them once per language. */
export async function saveShot(space: Space, id: string, name: string, data: Buffer, device?: DeviceKind, language?: string): Promise<Shot> {
  // Refused before the picture is decoded: a project or a language that is not there, a picture larger than any
  // screen, and an account that has no room left.
  const filedUnder = shotLocale(await getProject(space, id), language);
  assertSlug(name, "screenshot name");
  const header = await readHeader(data, NOT_A_SCREENSHOT);
  checkPixels(header.width, header.height);
  // A full account can still replace a screenshot with a smaller one. Without a device, which one it replaces is
  // known only once it is decoded, so the largest it may replace counts as freed.
  const replaced = await Promise.all((device ? [device] : DEVICE_KINDS).map((kind) => sizeOnDisk(path.join(shotsDir(space, id), shotFile(name, kind, filedUnder)))));
  await assertRoom(space, 1, Math.max(...replaced));
  let encoded: Encoded;
  try {
    encoded = await encodeShot(data, header, device);
  } catch (error) {
    throw decodeError(error, NOT_A_SCREENSHOT);
  }
  const { png, width, height, corner, window } = encoded;
  if (Math.min(width, height) < 300) throw new InputError(`Image is only ${width}×${height}; that is too small for a screenshot.`);
  const kind = device ?? (window ? "mac" : deviceKindOf(width, height));
  const dir = shotsDir(space, id);
  // Filed under the project's lock: a change of its first language renames the files around this one.
  const shot = await withProjectLock(projectKey(space, id), async () => {
    const project = await getProject(space, id);
    const locale = shotLocale(project, language);
    const file = shotFile(name, kind, locale);
    const full = path.join(dir, file);
    await mkdir(dir, { recursive: true });
    const before = await stat(full).catch(() => null);
    if (!before) await assertShotRoom(space, dir, locale);
    const info = await withRoom(space, async () => {
      await assertRoom(space, png.length, before?.size ?? 0);
      await writeFileAtomic(full, png);
      return stat(full);
    });
    // One filed under the first language while that was not the first yet would otherwise keep hiding this one.
    const hidden = locale ? null : shotFile(name, kind, project.locales[0]);
    if (hidden) await rm(path.join(dir, hidden), { force: true });
    await recordFiles(dir, { [file]: { stamp: stampOf(info), meta: { width, height, corner } }, ...(hidden ? { [hidden]: null } : {}) });
    const shown = window ? corner : 0;
    return { name, device: kind, ...(locale ? { locale } : {}), file, width, height, bytes: info.size, version: Math.round(info.mtimeMs), ...(shown ? { corner: shown } : {}) } satisfies Shot;
  });
  usageChanged(space);
  return shot;
}

export async function deleteShot(space: Space, id: string, file: string): Promise<void> {
  if (!SHOT_FILE.test(file)) throw new InputError(`Invalid screenshot file "${file}"`);
  const dir = shotsDir(space, id);
  await withProjectLock(projectKey(space, id), async () => {
    await rm(path.join(dir, file), { force: true });
    await recordFiles(dir, { [file]: null });
  });
  usageChanged(space);
}

/**
 * Files a screenshot under another device, for one whose size did not give it away, or under another language
 * (null: every language). It replaces what was there under the name. A screenshot of a language the project no
 * longer has can be moved to one of its languages.
 */
export async function moveShot(space: Space, id: string, file: string, to: { device?: DeviceKind; locale?: string | null }): Promise<Shot> {
  const shot = await withProjectLock(projectKey(space, id), async () => {
    const project = await getProject(space, id);
    const match = SHOT_FILE.exec(file);
    if (!match) throw new InputError(`Invalid screenshot file "${file}"`);
    const dir = shotsDir(space, id);
    const device = to.device ?? (match[2] as DeviceKind);
    const locale = to.locale === undefined ? match[3] : shotLocale(project, to.locale);
    const moved = shotFile(match[1]!, device, locale);
    if (!(await stat(path.join(dir, file)).catch(() => null))) throw new NotFoundError(`No screenshot "${file}"`);
    if (moved !== file) {
      // Into another language it counts as one more of that language's, unless it replaces one.
      if (locale !== match[3] && !(await stat(path.join(dir, moved)).catch(() => null))) await assertShotRoom(space, dir, locale);
      await rename(path.join(dir, file), path.join(dir, moved));
    }
    // A rename keeps the file's stamp, so the index knows it under its new name without reading it.
    const listed = await readShots(space, id, project.locales);
    const found = [...listed.shots, ...listed.orphaned].find((each) => each.file === moved);
    if (!found) throw new InputError(`"${moved}" cannot be read as a picture. Upload it again.`);
    return found;
  });
  usageChanged(space);
  return shot;
}

// ---------------------------------------------------------------- images

export async function listImages(space: Space, id: string): Promise<StoredImage[]> {
  const listed = await readIndexed(imagesDir(space, id), IMAGE_FILE, sizeOf);
  return listed.flatMap(({ file, stamp, meta }) =>
    meta ? [{ name: IMAGE_FILE.exec(file)![1]!, file, width: meta.width, height: meta.height, bytes: stamp.size, version: Math.round(stamp.mtimeMs) }] : [],
  );
}

/** How an image is read: an SVG at the density it is drawn at, anything with the most pixels it may decode. */
interface Reading {
  density?: number;
  limitInputPixels: number;
}

/**
 * How an upload that is not a screenshot is read, from its header. Unlike a screenshot an image may be a photo, with
 * more pixels than any screen: it is kept at no more than IMAGE_MAX a side, so what counts is how many pixels reading
 * it decodes. One that would decode more than a screenshot may have is refused before anything of it is decoded.
 */
function imageReading(header: Metadata): Reading {
  const { format, width, height } = header;
  // Without a size in its header, the limit still holds as it is decoded.
  if (!width || !height) return { limitInputPixels: MAX_PIXELS };
  if (format === "svg") {
    // An SVG is drawn at the size it declares, which for a logo is often a few dozen pixels and for a drawing many
    // thousands: a small one is drawn at 1600 pixels to stay sharp, a large one no larger than it is kept.
    const longest = Math.max(width, height);
    const density = longest > IMAGE_MAX ? Math.max(1, (72 * IMAGE_MAX) / longest) : Math.min(2400, Math.max(72, Math.round((72 * 1600) / longest)));
    const [drawnWidth, drawnHeight] = [width, height].map((side) => Math.round((side * density) / 72)) as [number, number];
    if (drawnWidth * drawnHeight > MAX_PIXELS || Math.max(drawnWidth, drawnHeight) > MAX_SIDE) {
      throw new TooLargeError(`The SVG says it is ${width}×${height} pixels, too large to draw. Give it a width and height of a few thousand pixels at most.`);
    }
    return { density, limitInputPixels: MAX_PIXELS };
  }
  const jpegMillions = Math.floor(JPEG_MAX_PIXELS / 1_000_000);
  // A JPEG the way a camera saves it is read already shrunk to about the size it is kept at.
  if (format === "jpeg" && !header.isProgressive) {
    if (width * height <= JPEG_MAX_PIXELS) return { limitInputPixels: JPEG_MAX_PIXELS };
    throw new TooLargeError(`The image is ${width}×${height} pixels. Upload one of at most ${jpegMillions} million pixels: it is kept at no more than ${IMAGE_MAX} pixels a side.`);
  }
  if (width * height <= MAX_PIXELS && Math.max(width, height) <= MAX_SIDE) return { limitInputPixels: MAX_PIXELS };
  throw new TooLargeError(
    `The image is ${width}×${height} pixels. Upload one of at most ${MAX_PIXELS / 1_000_000} million pixels and ${MAX_SIDE} pixels a side, or a JPEG of up to ${jpegMillions} million that is not progressive: it is kept at no more than ${IMAGE_MAX} pixels a side.`,
  );
}

/** Stores a logo or other artwork as a PNG, transparency included. An SVG is drawn large enough to stay sharp. */
export async function saveImage(space: Space, id: string, name: string, data: Buffer): Promise<StoredImage> {
  await getProject(space, id);
  assertSlug(name, "image name");
  const file = `${name}.png`;
  const dir = imagesDir(space, id);
  const full = path.join(dir, file);
  const reading = imageReading(await readHeader(data, NOT_AN_IMAGE));
  // A full account can still replace an image with a smaller one: what it replaces is counted as freed.
  await assertRoom(space, 1, await sizeOnDisk(full));
  let png: Buffer;
  let width: number;
  let height: number;
  try {
    const result = await openImage(data, reading)
      .rotate()
      .resize({ width: IMAGE_MAX, height: IMAGE_MAX, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    png = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch (error) {
    throw decodeError(error, NOT_AN_IMAGE, `The image has more pixels than its header says, more than ${Math.floor(reading.limitInputPixels / 1_000_000)} million.`);
  }
  if (Math.min(width, height) < 16) throw new InputError(`Image is only ${width}×${height}; that is too small to show.`);
  const image = await withProjectLock(projectKey(space, id), async () => {
    await mkdir(dir, { recursive: true });
    const before = await stat(full).catch(() => null);
    if (space.limits && !before) {
      const count = (await readdir(dir)).filter((entry) => IMAGE_FILE.test(entry)).length;
      if (count >= space.limits.shots) throw new InputError(`A project is limited to ${space.limits.shots} images. Delete some to make room.`);
    }
    const info = await withRoom(space, async () => {
      await assertRoom(space, png.length, before?.size ?? 0);
      await writeFileAtomic(full, png);
      return stat(full);
    });
    await recordFiles(dir, { [file]: { stamp: stampOf(info), meta: { width, height } } });
    return { name, file, width, height, bytes: info.size, version: Math.round(info.mtimeMs) } satisfies StoredImage;
  });
  usageChanged(space);
  return image;
}

export async function deleteImage(space: Space, id: string, file: string): Promise<void> {
  if (!IMAGE_FILE.test(file)) throw new InputError(`Invalid image file "${file}"`);
  const dir = imagesDir(space, id);
  await withProjectLock(projectKey(space, id), async () => {
    await rm(path.join(dir, file), { force: true });
    await recordFiles(dir, { [file]: null });
  });
  usageChanged(space);
}
