import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { TooLargeError } from "../domain/errors.ts";
import { allSlides, SLUG } from "../schema.ts";
import { createMutex } from "./mutex.ts";
import { IMAGE_FILE, projectsDir, SHOT_FILE, type Space } from "./paths.ts";
import { projects } from "./projects.ts";

export interface Usage {
  projects: number;
  slides: number;
  shots: number;
  images: number;
  /** Everything the projects keep on disk, rendered files included. */
  bytes: number;
  /** The part of it that is uploaded screenshots and images: what the account's room is counted in. */
  uploadBytes: number;
  /** The room the account has for uploads, in bytes. Only for an account that has a limit. */
  uploadLimit?: number;
}

/** How long the numbers of a space are reused. Uploads and project changes made here forget them at once. */
const FRESH_FOR = 30_000;

const MB = 1024 * 1024;

/**
 * A number of bytes as people read it: 300 KB, 1.5 MB, 512 MB, 2 GB. `round` rounds what is shown, so that a refusal
 * can round what an upload needs up and the room left down: neither then looks enough when it is not.
 */
export function megabytes(bytes: number, round: (value: number) => number = Math.round): string {
  if (bytes >= 1024 * MB) return `${round((bytes / (1024 * MB)) * 10) / 10} GB`;
  if (bytes >= 10 * MB || bytes === 0) return `${round(bytes / MB)} MB`;
  if (bytes >= MB) return `${round((bytes / MB) * 10) / 10} MB`;
  return `${round(bytes / 1024)} KB`;
}

async function folders(space: Space): Promise<string[]> {
  const entries = await readdir(projectsDir(space), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && SLUG.test(entry.name)).map((entry) => entry.name);
}

/** The files of one kind in a folder, and their bytes. */
async function filesIn(dir: string, pattern: RegExp): Promise<{ count: number; bytes: number }> {
  const names = (await readdir(dir).catch(() => [])).filter((name) => pattern.test(name));
  const sizes = await Promise.all(names.map((name) => stat(path.join(dir, name)).then((info) => info.size, () => 0)));
  return { count: names.length, bytes: sizes.reduce((sum, size) => sum + size, 0) };
}

/** How many files a folder holds with everything below it, and their bytes. Its subfolders are walked side by side. */
async function weigh(dir: string): Promise<{ files: number; bytes: number }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const parts = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return weigh(full);
      if (!entry.isFile()) return { files: 0, bytes: 0 };
      return { files: 1, bytes: await stat(full).then((info) => info.size, () => 0) };
    }),
  );
  return parts.reduce((total, part) => ({ files: total.files + part.files, bytes: total.bytes + part.bytes }), { files: 0, bytes: 0 });
}

/** Bytes of screenshots and images in all of a space's projects, counted file by file: the room is checked against it. */
export async function uploadBytes(space: Space): Promise<number> {
  const sizes = await Promise.all(
    (await folders(space)).map(async (id) => {
      const dir = path.join(projectsDir(space), id);
      const [shots, images] = await Promise.all([filesIn(path.join(dir, "shots"), SHOT_FILE), filesIn(path.join(dir, "images"), IMAGE_FILE)]);
      return shots.bytes + images.bytes;
    }),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function measure(space: Space): Promise<Usage> {
  const usage: Usage = { projects: 0, slides: 0, shots: 0, images: 0, bytes: 0, uploadBytes: 0, ...(space.limits?.bytes !== undefined ? { uploadLimit: space.limits.bytes } : {}) };
  const parts = await Promise.all(
    (await folders(space)).map(async (id) => {
      const dir = path.join(projectsDir(space), id);
      return Promise.all([
        projects.get(space, id).then(
          (stored) => allSlides(stored.project).length,
          () => 0,
        ),
        filesIn(path.join(dir, "shots"), SHOT_FILE),
        filesIn(path.join(dir, "images"), IMAGE_FILE),
        weigh(dir),
      ]);
    }),
  );
  for (const [slides, shots, images, all] of parts) {
    usage.projects++;
    usage.slides += slides;
    usage.shots += shots.count;
    usage.images += images.count;
    usage.uploadBytes += shots.bytes + images.bytes;
    usage.bytes += all.bytes;
  }
  return usage;
}

const measured = new Map<string, { at: number; usage: Promise<Usage> }>();

/**
 * What one account keeps, as numbers only. The admin's overview adds these up without opening anybody's work. The
 * numbers are reused for a few seconds, so the overview of many accounts and the settings page do not walk every
 * folder each time; what changes through this server forgets them at once, renders only after those seconds.
 */
export async function usageOf(space: Space): Promise<Usage> {
  const now = Date.now();
  let entry = measured.get(space.root);
  if (!entry || now - entry.at > FRESH_FOR) {
    if (measured.size > 1000) for (const [root, old] of measured) if (now - old.at > FRESH_FOR) measured.delete(root);
    const fresh = { at: now, usage: measure(space) };
    measured.set(space.root, fresh);
    fresh.usage.catch(() => measured.get(space.root) === fresh && measured.delete(space.root));
    entry = fresh;
  }
  return { ...(await entry.usage) };
}

/** Forgets the numbers of a space, after a change to what it keeps. */
export function usageChanged(space: Space): void {
  measured.delete(space.root);
}

/** How many accounts' numbers are kept, for a health page. */
export const usageCache = () => ({ entries: measured.size });

const withRoomLock = createMutex();

/**
 * Runs an upload's write once the account has room for it: `write` gets to check the room with `assertRoom` and
 * write, one upload of the account at a time, so two cannot both take the last of it. An account without a limit
 * does not wait.
 */
export function withRoom<T>(space: Space, write: () => Promise<T>): Promise<T> {
  return space.limits?.bytes === undefined ? write() : withRoomLock(space.id, write);
}

/**
 * Refuses an upload of `adding` bytes, which replaces `freeing` bytes, that would take the account past its room.
 * Answered 413 with the room the account has left and what the upload needs.
 */
export async function assertRoom(space: Space, adding: number, freeing = 0): Promise<void> {
  const limit = space.limits?.bytes;
  if (limit === undefined || adding <= freeing) return;
  const used = await uploadBytes(space);
  const left = limit - used;
  if (adding - freeing <= left) return;
  throw new TooLargeError(
    left > 0
      ? `This upload needs ${megabytes(adding - freeing, Math.ceil)}, and this account has ${megabytes(left, Math.floor)} left of the ${megabytes(limit)} it has for screenshots and images. Delete some to make room.`
      : `This account has no room left of the ${megabytes(limit)} it has for screenshots and images. Delete some to make room.`,
  );
}
