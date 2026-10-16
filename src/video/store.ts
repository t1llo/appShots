import { mkdir, readdir, readFile, rename, rm, rmdir, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { NotFoundError, projectDir, safeJoin, type Space } from "../store.ts";
import { withProjectLock } from "../storage/mutex.ts";
import { projectKey, projectsDir } from "../storage/paths.ts";
import type { LayerKind, LayerWarning } from "./cards.ts";

/**
 * Where a project's video layers are kept: `<project>/video/<set>/` holds manifest.json, plate.png and touch.png, and
 * one folder per language with its layers. It sits beside out/, never in it, so the renders, the export and the
 * Studio do not see it, and neither does a server of an older version. A set is drawn into a staging folder of its
 * own and moved into place whole, so a set folder is either complete or not there.
 */

export const SET_ID = /^[0-9a-f]{16}$/;
/** Sets kept per project. A set that is asked for again counts as new. */
export const KEPT_SETS = 3;
/** Beside the renders' .staging folder, which a render sweeps of every run but its own. */
const STAGING = ".video-staging";

export interface Layer {
  id: string;
  locale: string | null;
  kind: LayerKind;
  /** Where the server serves it, under /files. */
  file: string;
  width: number;
  height: number;
  /** The drawn part: [x, y, width, height] in the layer's pixels. */
  box?: [number, number, number, number];
  /** The copy as plain text, without its emphasis marks. */
  text?: string;
  /** Drawn in another language than its own. */
  fallback?: boolean;
  /** The share of its size the copy was drawn at, 1 when it fitted as it was. */
  fit?: number;
}

/** What a set is, as manifest.json holds it. The answers add whether this request was charged for it. */
export interface Manifest {
  set: string;
  size: [number, number];
  display: string | null;
  locales: string[];
  warnings: LayerWarning[];
  layers: Layer[];
  zip: string;
}

export const videoDir = (space: Space, id: string) => path.join(projectDir(space, id), "video");
export const setDir = (space: Space, id: string, set: string) => path.join(videoDir(space, id), set);
export const videoStaging = (space: Space, job: string) => path.join(projectsDir(space), STAGING, job);

/** The path of a layer inside its set folder. */
export const layerPath = (layer: Pick<Layer, "id" | "locale">) => (layer.locale ? `${layer.locale}/${layer.id}.png` : `${layer.id}.png`);

/** A set's manifest, or null when there is no such set. */
export async function readSet(space: Space, id: string, set: string): Promise<Manifest | null> {
  if (!SET_ID.test(set)) return null;
  const raw = await readFile(path.join(setDir(space, id, set), "manifest.json"), "utf8").catch(() => null);
  return raw === null ? null : (JSON.parse(raw) as Manifest);
}

/** Marks a set as just used, so the next one drawn does not push it out. */
export async function touchSet(space: Space, id: string, set: string): Promise<void> {
  const now = new Date();
  await withProjectLock(projectKey(space, id), () => utimes(path.join(setDir(space, id, set), "manifest.json"), now, now)).catch(() => {});
}

/** The file of one layer, resolved inside its set folder only. */
export function layerFile(space: Space, id: string, set: string, relative: string): string {
  if (!SET_ID.test(set)) throw new NotFoundError("Not found");
  return safeJoin(setDir(space, id, set), relative);
}

/**
 * Moves a staged set into place and drops the oldest sets beyond the ones kept. Returns false, keeping nothing, when
 * the project was deleted meanwhile. A set that is there already, drawn by a run that finished first, stays as it is.
 */
export async function commitSet(space: Space, id: string, staging: string, set: string): Promise<boolean> {
  const dir = projectDir(space, id);
  const placed = await withProjectLock(projectKey(space, id), async () => {
    if (!(await stat(path.join(dir, "project.json")).then(() => true, () => false))) return false;
    const target = setDir(space, id, set);
    await mkdir(videoDir(space, id), { recursive: true });
    if (await stat(target).then(() => true, () => false)) await rm(staging, { recursive: true, force: true });
    else await rename(staging, target);
    const now = new Date();
    await utimes(path.join(target, "manifest.json"), now, now);
    await prune(space, id, set);
    return true;
  });
  await discardStaging(space, staging);
  return placed;
}

/** Keeps the newest sets, by when each was last drawn or asked for, and always the one just placed. */
async function prune(space: Space, id: string, keep: string): Promise<void> {
  const root = videoDir(space, id);
  const sets = await Promise.all(
    (await readdir(root).catch(() => []))
      .filter((name) => SET_ID.test(name))
      .map(async (name) => ({ name, at: name === keep ? Infinity : ((await stat(path.join(root, name, "manifest.json")).catch(() => null))?.mtimeMs ?? 0) })),
  );
  sets.sort((a, b) => b.at - a.at);
  for (const old of sets.slice(KEPT_SETS)) await rm(path.join(root, old.name), { recursive: true, force: true });
}

/** Removes a run's staging folder, and the staging folder itself once nothing else is in it. */
export async function discardStaging(space: Space, staging: string): Promise<void> {
  await rm(staging, { recursive: true, force: true });
  await rmdir(path.dirname(staging)).catch(() => {});
}

/** Every file of a set, as the ZIP lays it out: the manifest first, then the layers. */
export async function setEntries(space: Space, id: string, manifest: Manifest): Promise<{ name: string; file?: string; data?: Buffer }[]> {
  const dir = setDir(space, id, manifest.set);
  return [{ name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }, ...manifest.layers.map((layer) => ({ name: layerPath(layer), file: path.join(dir, layerPath(layer)) }))];
}
