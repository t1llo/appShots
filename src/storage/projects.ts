import { mkdir, readdir, readFile, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { ConflictError, DamagedError, InputError, NotFoundError } from "../domain/errors.ts";
import { readStored, withUnknownKeys } from "../domain/stored.ts";
import { type Creatives, type Project, projectSchema, SLUG, type Slide, type Theme } from "../schema.ts";
import type { DeviceKind } from "../sizes.ts";
import { writeFileAtomic } from "./atomic.ts";
import { loadRaw, migrate, SCHEMA_VERSION } from "./migrate.ts";
import { withProjectLock } from "./mutex.ts";
import { historyDir, projectDir, projectFile, projectKey, projectsDir, SHOT_FILE, shotFile, shotsDir, type Space } from "./paths.ts";

/** A project as stored, with the revision it is at. */
export interface Stored {
  project: Project;
  revision: number;
  /** What reading it had to leave out, in words. Empty for a project that reads cleanly. */
  warnings: string[];
}

/** A project whose project.json cannot be read. It is listed with what is wrong, so it can be restored or deleted. */
export interface Damaged {
  id: string;
  damaged: string;
  updatedAt: string;
}

/** One version of a project, as its history keeps it. */
export interface Revision {
  revision: number;
  /** When it was written. */
  time: string;
  /** Who wrote it: studio, api or mcp, and unknown for a version written before the history was kept. */
  actor: string;
  /** Bytes. */
  size: number;
}

export interface NewProject {
  name: string;
  locales?: string[];
  targets?: Project["targets"] | null;
  theme?: Theme;
  slides?: Slide[];
  deviceSlides?: Project["deviceSlides"];
  creatives?: Creatives;
}

export interface WriteOptions {
  /** The revision the change was made on. When another one is current, the change is refused with a ConflictError. */
  ifRevision?: number;
  /** Who makes the change, for the history: studio, api or mcp. */
  actor?: string;
}

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

/** Folders in the projects directory, a project's whether its project.json reads or not: the quota counts them all. */
export async function countProjects(space: Space): Promise<number> {
  const entries = await readdir(projectsDir(space), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && SLUG.test(entry.name)).length;
}

/** Pages of the Studio that stand where a project's id would: a project named so gets a number behind its id. */
const RESERVED_IDS = new Set(["settings", "admin"]);

/** A version in a project's .history folder: its revision and who wrote it. */
const HISTORY_FILE = /^(\d{1,9})-([a-z]{1,16})\.json$/;

const actorOf = (actor?: string) => (actor && /^[a-z]{1,16}$/.test(actor) ? actor : "api");
const isRevision = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

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
 * Where every project.json is read and written. Each change runs under the project's lock, on the project as it is
 * at that moment, and is written whole as the next revision; the versions before it stay in a .history folder
 * beside it, the last `keepHistory` of them.
 */
export function createProjectRepository(options: { now?: () => Date; keepHistory?: number; log?: (message: string) => void } = {}) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const keepHistory = Math.max(1, options.keepHistory ?? 50);
  const log = options.log ?? ((message: string) => console.warn(message));
  /** Projects being deleted: nothing writes to them any more. */
  const tombstones = new Set<string>();
  /** Projects whose folder exists while their first project.json is still being written. */
  const creating = new Set<string>();
  /** Versions whose left-out fields are in the log already, so a Studio polling every few seconds does not repeat it. */
  const reported = new Set<string>();

  async function quietly(work: Promise<unknown>, what: string): Promise<void> {
    await work.catch((error: unknown) => log(`Could not ${what}: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** The versions in the project's history, oldest first. */
  async function kept(space: Space, id: string): Promise<Array<{ revision: number; actor: string; file: string }>> {
    const dir = historyDir(space, id);
    return (await readdir(dir).catch(() => []))
      .map((name) => HISTORY_FILE.exec(name))
      .filter((match) => match != null)
      .map((match) => ({ revision: Number(match[1]), actor: match[2]!, file: path.join(dir, match[0]) }))
      .sort((a, b) => a.revision - b.revision);
  }

  async function read(space: Space, id: string): Promise<Stored> {
    const file = projectFile(space, id);
    if (tombstones.has(projectKey(space, id))) throw new NotFoundError(`No project "${id}"`);
    const loaded = await loadRaw(file);
    if (!loaded) throw new NotFoundError(`No project "${id}"`);
    if ("damaged" in loaded) {
      throw new DamagedError(`Project "${id}" cannot be opened: its stored file is damaged. Restore an earlier revision of it, or delete it.`, loaded.damaged);
    }
    // No revision: written before there were any, or by such a release after a rollback. Either way it is newer
    // than every version the history keeps.
    const revision = isRevision(loaded.raw.revision) ? loaded.raw.revision : ((await kept(space, id)).at(-1)?.revision ?? -1) + 1;
    const { project, dropped } = readStored({ ...migrate(loaded.raw, { revision }), revision }, id, loaded.mtime.toISOString());
    if (dropped.length === 0) return { project, revision, warnings: [] };
    const version = `${file}:${loaded.mtime.getTime()}`;
    if (!reported.has(version)) {
      if (reported.size > 1000) reported.clear();
      reported.add(version);
      log(`Project ${space.id}/${id} has values that are no longer valid, left out as it is read: ${dropped.join(", ")}`);
    }
    return { project, revision, warnings: [`Left out of the stored project because no longer valid: ${dropped.join(", ")}.`] };
  }

  /** Copies the version on disk into the history, for one written before the history was kept. */
  async function keepOriginal(space: Space, id: string, revision: number): Promise<void> {
    const file = projectFile(space, id);
    const [text, info] = await Promise.all([readFile(file), stat(file)]);
    await mkdir(historyDir(space, id), { recursive: true });
    const copy = path.join(historyDir(space, id), `${revision}-unknown.json`);
    await writeFileAtomic(copy, text);
    // Listed by when it was written, not by when it was copied.
    await utimes(copy, info.atime, info.mtime);
  }

  /** Adds a version to the history and lets the oldest go beyond the limit. */
  async function record(space: Space, id: string, revision: number, actor: string, text: string): Promise<void> {
    await mkdir(historyDir(space, id), { recursive: true });
    const name = `${revision}-${actor}.json`;
    await writeFileAtomic(path.join(historyDir(space, id), name), text);
    const versions = await kept(space, id);
    const others = versions.filter((version) => version.revision === revision && path.basename(version.file) !== name);
    const rest = versions.filter((version) => !others.includes(version));
    for (const version of [...others, ...rest.slice(0, Math.max(0, rest.length - keepHistory))]) await rm(version.file, { force: true });
  }

  /** Writes `changed` as the revision after `current`. Called under the project's lock. */
  async function write(space: Space, id: string, current: Stored, changed: Project, actor: string, keepCurrent = true): Promise<Stored> {
    const revision = current.revision + 1;
    // One a newer build wrote stays at its version: the fields this one does not know are kept as they are, and
    // marking them older would have that build migrate them a second time.
    const schemaVersion = Math.max(SCHEMA_VERSION, changed.schemaVersion ?? current.project.schemaVersion ?? 0);
    const parsed = projectSchema.parse({ ...changed, id, createdAt: current.project.createdAt, updatedAt: now(), schemaVersion, revision });
    const next = withUnknownKeys(changed, parsed);
    const text = JSON.stringify(next, null, 2);
    if (keepCurrent && !(await kept(space, id)).some((version) => version.revision === current.revision)) {
      await quietly(keepOriginal(space, id, current.revision), `keep revision ${current.revision} of ${space.id}/${id}`);
    }
    await writeFileAtomic(projectFile(space, id), text);
    // The history is derived: a write it misses still counts, and the next one catches up.
    await quietly(record(space, id, revision, actor, text), `keep revision ${revision} of ${space.id}/${id}`);
    // Only once the project names its new first language: a write that failed leaves the shots filed as it says.
    if (next.locales[0] !== current.project.locales[0]) await refileShots(space, id, current.project.locales[0]!, next.locales);
    return { project: next, revision, warnings: [] };
  }

  /** Takes the folder for a new project. mkdir refuses one that exists, so two creates never share a folder. */
  async function claim(space: Space, id: string): Promise<boolean> {
    const key = projectKey(space, id);
    if (tombstones.has(key)) return false;
    creating.add(key);
    try {
      await mkdir(projectDir(space, id));
      return true;
    } catch (error) {
      creating.delete(key);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  return {
    /** The project, read leniently and brought up to the current version in memory. */
    get: read,

    /** Every project of the space, newest change first, with the ones that cannot be read among them. */
    async list(space: Space): Promise<Array<Stored | Damaged>> {
      const entries = await readdir(projectsDir(space), { withFileTypes: true }).catch(() => []);
      const found = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && SLUG.test(entry.name))
          .map(async ({ name: id }): Promise<Stored | Damaged | null> => {
            const key = projectKey(space, id);
            if (creating.has(key) || tombstones.has(key)) return null;
            try {
              return await read(space, id);
            } catch (error) {
              if (!(error instanceof DamagedError || error instanceof NotFoundError)) throw error;
              const info = await stat(projectDir(space, id)).catch(() => null);
              const damaged = error instanceof DamagedError ? `project.json ${error.reason}` : "project.json is missing";
              return { id, damaged, updatedAt: (info?.mtime ?? new Date(0)).toISOString() };
            }
          }),
      );
      const updatedAt = (entry: Stored | Damaged) => ("project" in entry ? entry.project.updatedAt : entry.updatedAt);
      return found.filter((entry) => entry != null).sort((a, b) => updatedAt(b).localeCompare(updatedAt(a)));
    },

    async create(space: Space, input: NewProject, options: Pick<WriteOptions, "actor"> = {}): Promise<Stored> {
      // One at a time per space, so the quota and the choice of id see the projects made just before.
      return withProjectLock(`${space.id}:create`, async () => {
        if (space.limits && (await countProjects(space)) >= space.limits.projects) {
          throw new InputError(`This account is limited to ${space.limits.projects} projects. Delete one to make room.`);
        }
        const base = slugify(input.name);
        const time = now();
        const project = projectSchema.parse({
          id: base,
          name: input.name,
          createdAt: time,
          updatedAt: time,
          schemaVersion: SCHEMA_VERSION,
          revision: 1,
          locales: input.locales?.length ? input.locales : ["en"],
          ...(input.targets?.length ? { targets: input.targets } : {}),
          theme: input.theme ?? {},
          slides: input.slides ?? [],
          deviceSlides: input.deviceSlides ?? {},
          creatives: input.creatives ?? {},
        });
        await mkdir(projectsDir(space), { recursive: true });
        let id = base;
        for (let n = 2; RESERVED_IDS.has(id) || !(await claim(space, id)); n++) id = `${base}-${n}`;
        try {
          const created = { ...project, id };
          const text = JSON.stringify(created, null, 2);
          await writeFileAtomic(projectFile(space, id), text);
          await quietly(record(space, id, 1, actorOf(options.actor), text), `keep revision 1 of ${space.id}/${id}`);
          return { project: created, revision: 1, warnings: [] };
        } catch (error) {
          await rm(projectDir(space, id), { recursive: true, force: true });
          throw error;
        } finally {
          creating.delete(projectKey(space, id));
        }
      });
    },

    /**
     * Changes a project: `change` gets it as it is now, under its lock, and returns it as it should be. Nothing is
     * written when it throws. With `ifRevision`, a project at another revision is not changed.
     */
    async mutate(space: Space, id: string, change: (project: Project) => Project | Promise<Project>, options: WriteOptions = {}): Promise<Stored> {
      return withProjectLock(projectKey(space, id), async () => {
        const current = await read(space, id);
        if (options.ifRevision !== undefined && options.ifRevision !== current.revision) {
          throw new ConflictError(`Project "${id}" was changed since revision ${options.ifRevision} and is at revision ${current.revision} now. Load it again and make the change on that.`, current.revision);
        }
        return write(space, id, current, await change(structuredClone(current.project)), actorOf(options.actor));
      });
    },

    /** Marks a project as being deleted: from here on it is not found, and nothing writes to it. */
    async tombstone(space: Space, id: string): Promise<void> {
      projectDir(space, id);
      // Under the lock, so a change already under way finishes first and none starts after.
      await withProjectLock(projectKey(space, id), () => void tombstones.add(projectKey(space, id)));
    },

    /** Deletes a project with everything in it. Its project.json is never read, so a damaged one goes too. */
    async remove(space: Space, id: string): Promise<void> {
      const dir = projectDir(space, id);
      const key = projectKey(space, id);
      try {
        await withProjectLock(key, async () => {
          if (!(await stat(dir).then((info) => info.isDirectory(), () => false))) throw new NotFoundError(`No project "${id}"`);
          await rm(dir, { recursive: true, force: true });
        });
      } finally {
        tombstones.delete(key);
      }
    },

    /** The versions the history keeps, newest first, and the revision the project is at: null while it is damaged. */
    async revisions(space: Space, id: string): Promise<{ revision: number | null; revisions: Revision[] }> {
      let revision: number | null = null;
      try {
        revision = (await read(space, id)).revision;
      } catch (error) {
        if (!(error instanceof DamagedError)) throw error;
      }
      const rows: Revision[] = [];
      for (const version of await kept(space, id)) {
        const info = await stat(version.file).catch(() => null);
        if (info) rows.push({ revision: version.revision, time: info.mtime.toISOString(), actor: version.actor, size: info.size });
      }
      // Written before the history was kept: the version on disk is one all the same.
      if (revision !== null && !rows.some((row) => row.revision === revision)) {
        const info = await stat(projectFile(space, id));
        rows.push({ revision, time: info.mtime.toISOString(), actor: "unknown", size: info.size });
      }
      return { revision, revisions: rows.sort((a, b) => b.revision - a.revision) };
    },

    /**
     * Makes an earlier version the current one again, as a new revision, so the restore can be undone the same way.
     * Works on a damaged project too: that is how one gets its work back.
     */
    async restore(space: Space, id: string, revision: number, options: WriteOptions = {}): Promise<Stored> {
      return withProjectLock(projectKey(space, id), async () => {
        let current: Stored | null = null;
        try {
          current = await read(space, id);
        } catch (error) {
          if (!(error instanceof DamagedError)) throw error;
        }
        if (current && options.ifRevision !== undefined && options.ifRevision !== current.revision) {
          throw new ConflictError(`Project "${id}" was changed since revision ${options.ifRevision} and is at revision ${current.revision} now.`, current.revision);
        }
        const versions = await kept(space, id);
        const version = versions.find((each) => each.revision === revision);
        let restored: Project;
        if (version) {
          const loaded = await loadRaw(version.file);
          if (!loaded || "damaged" in loaded) throw new InputError(`Revision ${revision} of project "${id}" cannot be read, so it cannot be restored.`);
          restored = readStored({ ...migrate(loaded.raw, { revision }), revision }, id, loaded.mtime.toISOString()).project;
        } else if (current?.revision === revision) restored = current.project;
        else {
          const known = versions.map((each) => each.revision);
          throw new NotFoundError(`Project "${id}" keeps no revision ${revision}.${known.length ? ` Its history holds ${known.length === 1 ? `revision ${known[0]}` : `revisions ${known[0]} to ${known.at(-1)}`}.` : ""}`);
        }
        // A damaged project.json is written over: the restore follows the newest version the history keeps.
        const base = current ?? { project: restored, revision: versions.at(-1)!.revision, warnings: [] };
        return write(space, id, base, restored, actorOf(options.actor), current !== null);
      });
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;

/** The repository the server uses. Its lock and its marks for projects being deleted are shared by every caller. */
export const projects = createProjectRepository();
