import type { Stats } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { createMutex } from "./mutex.ts";

// A folder of screenshots or images keeps what is known of each of its pictures in .index.json: what it would take
// decoding to find out again, such as its size in pixels. It is derived: the files are what counts, an entry is used
// only while its file is the very one it describes, and deleting the index costs one more reading of the pictures.
// Earlier versions of the server list the folder by file name and pass over it.

export const INDEX_FILE = ".index.json";

/** What tells one version of a file from another without reading it. A file written anew is a new inode. */
export interface Stamp {
  size: number;
  mtimeMs: number;
  ino: number;
}

/** A picture of the folder with what is known of it: null for a file that cannot be read as a picture. */
export interface Indexed<T> {
  file: string;
  stamp: Stamp;
  meta: T | null;
}

interface Entry<T> extends Stamp {
  meta: T | null;
}

export const stampOf = (info: Stats): Stamp => ({ size: info.size, mtimeMs: info.mtimeMs, ino: info.ino });
const stampKey = (stamp: Stamp) => `${stamp.ino}:${stamp.size}:${stamp.mtimeMs}`;
const sameStamp = (a: Stamp, b: Stamp) => stampKey(a) === stampKey(b);

/** What an interrupted writeFileAtomic leaves next to the file it was writing. */
const LEFTOVER = /\.[0-9a-f-]{36}\.tmp$/;
/** How long a temporary file is left alone. A write takes milliseconds; one older than this was cut short. */
const LEFTOVER_AGE = 60_000;

const isEntry = (value: unknown): value is Entry<unknown> => {
  const entry = value as Entry<unknown>;
  return typeof entry === "object" && entry !== null && [entry.size, entry.mtimeMs, entry.ino].every(Number.isFinite) && typeof entry.meta === "object";
};

/** The folder's index as it is on disk. One that is missing or cannot be read is an empty one. */
async function readIndex<T>(dir: string): Promise<Record<string, Entry<T>>> {
  try {
    const read = JSON.parse(await readFile(path.join(dir, INDEX_FILE), "utf8"));
    if (read?.version !== 1 || typeof read.files !== "object" || read.files === null) return {};
    return Object.fromEntries(Object.entries(read.files).filter((pair): pair is [string, Entry<T>] => isEntry(pair[1])));
  } catch {
    return {};
  }
}

/** One change to the index at a time per folder, so that two cannot each write it without the other's entries. */
const withIndexLock = createMutex();

/**
 * Changes the index of a folder: `change` gets its entries as they are and changes them in place. The index is
 * derived, so a write that fails, on a disk that is full say, only costs reading the pictures again.
 */
function changeIndex<T>(dir: string, change: (files: Record<string, Entry<T>>) => void): Promise<void> {
  return withIndexLock(dir, async () => {
    const files = await readIndex<T>(dir);
    change(files);
    await writeFileAtomic(path.join(dir, INDEX_FILE), JSON.stringify({ version: 1, files }));
  }).catch(() => {});
}

/** Records what is known of files that were just written, renamed or deleted (null), so the next listing reads none of them. */
export function recordFiles<T>(dir: string, changes: Record<string, { stamp: Stamp; meta: T | null } | null>): Promise<void> {
  return changeIndex<T>(dir, (files) => {
    for (const [file, change] of Object.entries(changes)) {
      if (change) files[file] = { ...change.stamp, meta: change.meta };
      else delete files[file];
    }
  });
}

/** Pictures being read, so that listings at the same time read each of them once. */
const reading = new Map<string, Promise<unknown>>();

/** Removes what writes cut short left in the folder, once it is old enough not to be a write still under way. */
async function sweep(dir: string, names: string[]): Promise<void> {
  const before = Date.now() - LEFTOVER_AGE;
  for (const name of names) {
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => null);
    if (info && info.mtimeMs < before) await rm(file, { force: true });
  }
}

/**
 * The pictures of a folder whose names match `pattern`, in name order, each with what is known of it. Costs a
 * directory listing, the index and a stat per file; only a file the index does not know yet is read, with
 * `describe`, which throws for one that is no picture. Such a file is reported once to `warn` and comes back without
 * meta. A file that was renamed keeps its entry, for its stamp stays the same.
 */
export async function readIndexed<T>(dir: string, pattern: RegExp, describe: (file: string) => Promise<T>, warn: (message: string) => void = console.warn): Promise<Indexed<T>[]> {
  const [names, index] = await Promise.all([readdir(dir).catch(() => null), readIndex<T>(dir)]);
  if (!names) return [];
  const leftovers = names.filter((name) => LEFTOVER.test(name));
  if (leftovers.length) void sweep(dir, leftovers).catch(() => {});

  const files = names.filter((name) => pattern.test(name)).sort();
  const byStamp = new Map(Object.values(index).map((entry) => [stampKey(entry), entry]));
  const found: Record<string, Entry<T>> = {};
  const listed = await Promise.all(
    files.map(async (file): Promise<Indexed<T> | null> => {
      const info = await stat(path.join(dir, file)).catch(() => null);
      // Deleted since the folder was listed.
      if (!info) return null;
      const stamp = stampOf(info);
      const known = index[file] && sameStamp(index[file], stamp) ? index[file] : byStamp.get(stampKey(stamp));
      if (known) {
        found[file] = known;
        return { file, stamp, meta: known.meta };
      }
      const full = path.join(dir, file);
      const key = `${full}:${stampKey(stamp)}`;
      let pending = reading.get(key) as Promise<T | null> | undefined;
      if (!pending) {
        pending = describe(full).catch((error: unknown) => {
          warn(`Left out ${full}, which cannot be read as a picture: ${error instanceof Error ? error.message : String(error)}. Upload it again or delete it.`);
          return null;
        });
        reading.set(key, pending);
        void pending.finally(() => reading.delete(key));
      }
      const meta = await pending;
      found[file] = { ...stamp, meta };
      return { file, stamp, meta };
    }),
  );

  const unchanged = Object.keys(found).length === Object.keys(index).length && Object.entries(found).every(([file, entry]) => index[file] === entry);
  if (!unchanged) {
    await changeIndex<T>(dir, (files) => {
      // Entries of files written since the folder was listed stay; those of files that are gone go.
      for (const file of Object.keys(files)) if (!(file in found) && file in index) delete files[file];
      Object.assign(files, found);
    });
  }
  return listed.filter((entry) => entry !== null);
}
