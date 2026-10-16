import { randomBytes } from "node:crypto";
import { copyFile, link, mkdir, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { LOCALE } from "../schema.ts";
import { writeFileAtomic } from "./atomic.ts";
import { withProjectLock } from "./mutex.ts";

// What a render leaves in a project's out/ folder, and how it gets there. A run draws into a staging folder of its
// own, outside out/, and only a finished run moves its folders into place, all at once under the project's lock.
// A run that fails or is cancelled is thrown away whole, so out/ keeps what the last good run left there.
//
// The staging folders sit beside the projects, in projects/.staging, which no listing of projects takes for one. Kept
// out of the project's own folder, a run never writes into it while it draws, so deleting the project meanwhile does
// not race with the run's files.
//
// outputs.json, next to project.json, says which run drew each set and from what design. out/ keeps the layout it
// always had, so a server without this file reads it as before.

const MANIFEST = "outputs.json";
const STAGING = ".staging";
const SLIDE_FILE = /^\d{2}\.png$/;

export interface OutputSet {
  locale: string;
  target: string;
  /** Rendered slide files, e.g. 01.png, in order. */
  files: string[];
  version: number;
}

interface ManifestSet {
  locale: string;
  target: string;
  files: string[];
  /** What the set was drawn from; sets of one device and language with another design are out of date. */
  design?: string;
  renderedAt: number;
  job: string;
}

interface ManifestCreative {
  locale: string;
  placement: string;
  renderedAt: number;
  job: string;
}

export interface Manifest {
  version: 1;
  sets: ManifestSet[];
  creatives: ManifestCreative[];
}

/** The manifest, or an empty one for a project rendered before it existed or one whose file cannot be read. */
export async function readManifest(dir: string): Promise<Manifest> {
  try {
    const read = JSON.parse(await readFile(path.join(dir, MANIFEST), "utf8"));
    if (read?.version === 1 && Array.isArray(read.sets) && Array.isArray(read.creatives)) return read;
  } catch {}
  return { version: 1, sets: [], creatives: [] };
}

/** Where a run draws before its pictures are moved into place: on the same disk as out/, for they are moved, not copied. */
export const stagingDir = (dir: string, job: string) => path.join(path.dirname(dir), STAGING, job);

/**
 * Makes a folder in a staging folder, and the staging folders on the way. The .staging folder they all sit in goes
 * as the last run or export in it ends, which can fall between the moments a recursive mkdir makes it and makes the
 * next folder in it. That mkdir then finds no parent, and is tried again.
 */
export async function makeStaged(folder: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mkdir(folder, { recursive: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || attempt === 3) throw error;
    }
  }
}

/**
 * The languages a project.json lists, in lower case: on a Mac's disk de-de and de-DE are one folder. None when it
 * lists none that can be read.
 */
function languagesOf(text: string | undefined): Set<string> {
  let locales: unknown;
  try {
    if (text !== undefined) locales = JSON.parse(text).locales;
  } catch {}
  return new Set((Array.isArray(locales) ? locales : []).map((code) => String(code).toLowerCase()));
}

/**
 * Lists what has been rendered so far, grouped by locale and size: every set folder with slides in it, in the
 * languages the project has. A language it no longer has is left out at once, though its folder stays until the next
 * render. A set the manifest knows is dated by the run that drew it, so a run that redrew only some of its slides
 * still shows as new.
 */
export async function listSets(dir: string): Promise<OutputSet[]> {
  const root = path.join(dir, "out");
  const languages = languagesOf(await readFile(path.join(dir, "project.json"), "utf8").catch(() => undefined));
  const sets: OutputSet[] = [];
  for (const locale of (await readdir(root).catch(() => [])).sort()) {
    if (languages.size && !languages.has(locale.toLowerCase())) continue;
    for (const target of (await readdir(path.join(root, locale)).catch(() => [])).sort()) {
      const folder = path.join(root, locale, target);
      const files = (await readdir(folder).catch(() => [])).filter((name) => SLIDE_FILE.test(name)).sort();
      if (files.length === 0) continue;
      const info = await stat(path.join(folder, files[0]!));
      sets.push({ locale, target, files, version: Math.round(info.mtimeMs) });
    }
  }
  const manifest = await readManifest(dir);
  for (const set of sets) {
    const known = manifest.sets.find((each) => each.locale === set.locale && each.target === set.target);
    // Files that differ from the record were written by something else since, and their own dates are the truth.
    if (known && known.files.join() === set.files.join()) set.version = Math.max(set.version, known.renderedAt);
  }
  return sets;
}

/** A set a run has drawn into its staging folder, at <locale>/<target> as in out/. */
export interface StagedSet {
  locale: string;
  target: string;
  device: string;
  /** The slide files the run drew. */
  files: string[];
  /** Whether it drew the whole set, so the folder holds just these. Otherwise the slides it did not draw are kept. */
  full: boolean;
  /** How many slides the set has: a kept file past that belongs to a slide that is gone. */
  count: number;
  design: string;
  /** Draws the contact sheet from the set's slide files, when it could not be drawn while the run was under way. */
  sheet?: (files: string[]) => Promise<Buffer>;
}

export interface Commit {
  job: string;
  sets: StagedSet[];
  /** Staged header, search results and banner files, as paths inside out/. */
  creatives: { locale: string; placement: string; path: string }[];
  /** Assets the project no longer has, as paths inside out/. */
  remove: { locale: string; placement: string; path: string }[];
  /** For a render of everything at the project's own sizes: the sizes each language keeps. */
  cleanup?: { locales: string[]; targets: string[] };
  /** How many slides each device's set has. A size the run did not draw keeps no file past that. */
  counts?: Record<string, number>;
  /** The device of a size folder's name, or nothing for a folder that is no size. */
  deviceOf: (target: string) => string | undefined;
}

const same = (a: { locale: string; target: string }, b: { locale: string; target: string }) => a.locale === b.locale && a.target === b.target;

/**
 * Moves a finished run's pictures into out/ under the project's lock, and clears what they make out of date: other
 * sizes of the same device and language drawn from another design, languages the project no longer has, slides
 * the sets no longer have, and on a render of everything its old sizes. False when the project was deleted
 * meanwhile; nothing is written then.
 */
export async function commitOutputs(key: string, dir: string, commit: Commit): Promise<boolean> {
  const stage = stagingDir(dir, commit.job);
  // What is replaced goes into the staging folder first and is removed after the lock is let go. Each under a name of
  // its own: a set and then the language it is in can both be retired, and the second must not land on the first.
  const replaced = path.join(stage, ".replaced");
  let retired = 0;
  const out = path.join(dir, "out");
  const exists = (file: string) => stat(file).then(
    () => true,
    () => false,
  );
  const retire = async (relative: string) => {
    if (!(await exists(path.join(out, relative)))) return;
    await mkdir(replaced, { recursive: true });
    await rename(path.join(out, relative), path.join(replaced, String(retired++)));
  };

  const committed = await withProjectLock(key, async () => {
    const text = await readFile(path.join(dir, "project.json"), "utf8").catch(() => undefined);
    if (text === undefined) return false;
    const languages = languagesOf(text);
    const current = (locale: string) => languages.size === 0 || languages.has(locale.toLowerCase());
    // A language taken out of the project while the run drew it is not put in place.
    const sets = commit.sets.filter((set) => current(set.locale));
    const manifest = await readManifest(dir);
    const now = Date.now();
    const gone: { locale: string; target?: string }[] = [];

    try {
      for (const set of sets) {
        const relative = path.join(set.locale, set.target);
        const staged = path.join(stage, relative);
        const live = path.join(out, relative);
        if (!set.full) {
          // Slides this run did not draw stay as they were, unless the set has since lost them.
          for (const name of await readdir(live).catch(() => [])) {
            if (!SLIDE_FILE.test(name) || Number(name.slice(0, 2)) > set.count || set.files.includes(name)) continue;
            await link(path.join(live, name), path.join(staged, name)).catch(() => copyFile(path.join(live, name), path.join(staged, name)));
          }
        }
        const files = (await readdir(staged)).filter((name) => SLIDE_FILE.test(name)).sort();
        if (set.sheet) await writeFileAtomic(path.join(staged, "sheet.jpg"), await set.sheet(files.map((name) => path.join(staged, name))));
        await retire(relative);
        await mkdir(path.join(out, set.locale), { recursive: true });
        await rename(staged, live);
        manifest.sets = manifest.sets.filter((each) => !same(each, set));
        manifest.sets.push({ locale: set.locale, target: set.target, files, design: set.design, renderedAt: now, job: commit.job });
      }

      for (const creative of commit.creatives.filter((each) => current(each.locale))) {
        await mkdir(path.dirname(path.join(out, creative.path)), { recursive: true });
        await rename(path.join(stage, creative.path), path.join(out, creative.path));
        manifest.creatives = manifest.creatives.filter((each) => each.locale !== creative.locale || each.placement !== creative.placement);
        manifest.creatives.push({ locale: creative.locale, placement: creative.placement, renderedAt: now, job: commit.job });
      }
      for (const creative of commit.remove) await rm(path.join(out, creative.path), { force: true });

      // Languages the project no longer has.
      for (const entry of languages.size ? await readdir(out).catch(() => []) : []) {
        if (LOCALE.test(entry) && !current(entry)) {
          await retire(entry);
          gone.push({ locale: entry });
        }
      }
      if (commit.cleanup) {
        for (const locale of commit.cleanup.locales) {
          for (const target of await readdir(path.join(out, locale)).catch(() => [])) {
            if (commit.deviceOf(target) && !commit.cleanup.targets.includes(target)) {
              await retire(path.join(locale, target));
              gone.push({ locale, target });
            }
          }
        }
      }
      // Other sizes of a device in a language, drawn from a design this run has changed. A set from before the
      // manifest has no design on record, and is left alone.
      for (const set of sets) {
        for (const target of await readdir(path.join(out, set.locale)).catch(() => [])) {
          if (commit.deviceOf(target) !== set.device || sets.some((each) => same(each, { locale: set.locale, target }))) continue;
          const known = manifest.sets.find((each) => same(each, { locale: set.locale, target }));
          if (known?.design && known.design !== set.design) {
            await retire(path.join(set.locale, target));
            gone.push({ locale: set.locale, target });
          }
        }
      }
      // Slides a set has lost, in the sizes this run did not draw, such as another device's after a render of the
      // iPhone alone: the export must not carry a slide that was deleted. The contact sheet pictures them, so it goes too.
      for (const locale of commit.counts ? await readdir(out).catch(() => []) : []) {
        for (const target of await readdir(path.join(out, locale)).catch(() => [])) {
          const count = commit.counts?.[commit.deviceOf(target) ?? ""];
          if (count === undefined || sets.some((each) => same(each, { locale, target }))) continue;
          const names: string[] = await readdir(path.join(out, locale, target)).catch(() => []);
          const slides = names.filter((name) => SLIDE_FILE.test(name));
          const lost = slides.filter((name) => Number(name.slice(0, 2)) > count);
          if (lost.length === 0) continue;
          if (lost.length === slides.length) {
            await retire(path.join(locale, target));
            gone.push({ locale, target });
            continue;
          }
          for (const name of [...lost, ...(names.includes("sheet.jpg") ? ["sheet.jpg"] : [])]) await retire(path.join(locale, target, name));
          const known = manifest.sets.find((each) => same(each, { locale, target }));
          if (known) known.files = known.files.filter((name) => !lost.includes(name));
        }
      }
    } finally {
      // Written even when a step fails part of the way, so that it says what out/ holds by then.
      const kept = (each: { locale: string; target?: string }) => !gone.some((dropped) => dropped.locale === each.locale && (dropped.target == null || dropped.target === each.target));
      manifest.sets = manifest.sets.filter(kept);
      manifest.creatives = manifest.creatives.filter((each) => kept(each) && !commit.remove.some((removed) => removed.locale === each.locale && removed.placement === each.placement));
      await writeFileAtomic(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return true;
  });
  await discardStaging(dir, commit.job);
  return committed;
}

/** Throws away what a run staged. Of a project deleted meanwhile, nothing is left behind. */
export async function discardStaging(dir: string, job: string): Promise<void> {
  await rm(stagingDir(dir, job), { recursive: true, force: true });
  // Both only go when empty: another run may be staging, and a deleted project's folder must not come back.
  await rmdir(path.join(path.dirname(dir), STAGING)).catch(() => {});
  await stat(path.join(dir, "project.json")).catch(() => rmdir(dir).catch(() => {}));
}

/** The staging folders exports are sending from, by name. A sweep leaves them alone, as it does a running render's. */
const exporting = new Set<string>();

/**
 * A staging folder for an export to link the files it sends into: on the same disk as out/, so a link stands in for
 * a copy. Released once the archive is sent; one a server left behind goes with the next sweep.
 */
export async function exportStage(dir: string): Promise<{ dir: string; release(): Promise<void> }> {
  const name = `export-${randomBytes(8).toString("hex")}`;
  exporting.add(name);
  const release = async () => {
    await discardStaging(dir, name);
    exporting.delete(name);
  };
  try {
    await makeStaged(stagingDir(dir, name));
  } catch (error) {
    await release();
    throw error;
  }
  return { dir: stagingDir(dir, name), release };
}

/**
 * Removes staging folders no run is using, such as those of a server that stopped in the middle of a render. They
 * are shared by an account's projects, so `running` holds every run that has not ended.
 */
export async function sweepStaging(dir: string, running: Set<string>): Promise<void> {
  const root = path.join(path.dirname(dir), STAGING);
  for (const job of await readdir(root).catch(() => [])) {
    if (!running.has(job) && !exporting.has(job)) await rm(path.join(root, job), { recursive: true, force: true });
  }
}
