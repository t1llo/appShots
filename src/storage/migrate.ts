import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { SLUG } from "../schema.ts";

/** The shape project.json is written in now. */
export const SCHEMA_VERSION = 1;

type Raw = Record<string, unknown>;

/**
 * MIGRATIONS[n] turns a project written in version n into version n + 1. They run as a project is read, in memory:
 * the next write saves the result, so starting the server rewrites nothing. A step only adds or renames, so the
 * code of an earlier release can still read what a later one wrote.
 */
const MIGRATIONS: Record<number, (raw: Raw, context: { revision: number }) => Raw> = {
  // Written before projects counted their writes: the version on disk is the first one there is.
  0: (raw, context) => ({ ...raw, schemaVersion: 1, revision: context.revision }),
};

/**
 * Brings a parsed project.json up to the current version. `revision` is the one to give a file that carries none.
 * A file from a newer build is left as it is: what this one does not know it reads around.
 */
export function migrate(raw: Raw, context: { revision: number }): Raw {
  let version = Number.isInteger(raw.schemaVersion) ? (raw.schemaVersion as number) : 0;
  let migrated = raw;
  for (; version < SCHEMA_VERSION; version++) migrated = MIGRATIONS[version]!(migrated, context);
  return migrated;
}

export type Loaded = { raw: Raw; mtime: Date } | { damaged: string; mtime?: Date };

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads a stored project file as JSON. Null when there is none. A file that cannot be read or parsed comes back
 * with what is wrong with it, in words for a person: such a project is listed as damaged rather than hidden.
 */
export async function loadRaw(file: string): Promise<Loaded | null> {
  let text: string;
  let mtime: Date;
  try {
    [text, { mtime }] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    return { damaged: "cannot be read" };
  }
  if (!text.trim()) return { damaged: "is empty", mtime };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { damaged: "is not valid JSON", mtime };
  }
  return isRecord(raw) ? { raw, mtime } : { damaged: "holds no project", mtime };
}

/** What writeFileAtomic leaves behind when the process stops midway, and what the code before it left. */
const LEFTOVER = /^(?:project\.json|\d{1,9}-[a-z]{1,16}\.json)\.[0-9a-f-]+\.tmp$/;

/** How long a temporary file is left alone. A write takes milliseconds; one older than this was cut short. */
const LEFTOVER_AGE = 60_000;

/**
 * Runs once before the server takes requests: removes the temporary files that writes cut short left behind, and
 * names the projects that can no longer be read, in the log, before anybody opens one. Only old temporary files go,
 * because this process may not be the only one on the data: the one it replaces can still be finishing a write.
 */
export async function sweepProjects(dataDir: string, log: (message: string) => void = console.warn): Promise<{ removed: number; damaged: string[] }> {
  const users = await readdir(path.join(dataDir, "users")).catch(() => []);
  const roots = [dataDir, ...users.map((user) => path.join(dataDir, "users", user))];
  const before = Date.now() - LEFTOVER_AGE;
  let removed = 0;
  const damaged: string[] = [];
  for (const root of roots) {
    const dir = path.join(root, "projects");
    for (const id of (await readdir(dir).catch(() => [])).filter((name) => SLUG.test(name))) {
      const project = path.join(dir, id);
      for (const folder of [project, path.join(project, ".history")]) {
        for (const name of await readdir(folder).catch(() => [])) {
          if (!LEFTOVER.test(name)) continue;
          const file = path.join(folder, name);
          const info = await stat(file).catch(() => null);
          if (!info || info.mtimeMs > before) continue;
          await rm(file, { force: true });
          removed++;
        }
      }
      const loaded = await loadRaw(path.join(project, "project.json"));
      if (loaded && "damaged" in loaded) {
        const where = path.relative(dataDir, project);
        damaged.push(where);
        log(`Project ${where} cannot be opened: its project.json ${loaded.damaged}. It is listed as damaged, and can be restored from its history or deleted.`);
      }
    }
  }
  if (removed) log(`Removed ${removed} temporary file${removed === 1 ? "" : "s"} left behind by writes that were cut short.`);
  return { removed, damaged };
}
