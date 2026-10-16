import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Project } from "./schema.ts";
import { PLACEMENT_IDS, PLACEMENTS, type PlacementId } from "./sizes.ts";
import { listSets } from "./storage/outputs.ts";
import { outDir, projectDir, type Space } from "./storage/paths.ts";
import { type NewProject, projects, type WriteOptions } from "./storage/projects.ts";
import { usageChanged } from "./storage/usage.ts";

// The functions the server, the MCP tools and the renderer call keep their names and shapes here. Projects are read
// and written by the repository in storage/projects.ts, which locks, counts revisions and keeps the history; the
// screenshots and images by storage/assets.ts, which lists them from an index and checks what is uploaded.
export { ConflictError, DamagedError, InputError, NotFoundError, TooLargeError } from "./domain/errors.ts";
export { deleteImage, deleteShot, type ImageFiles, listImages, listShots, moveShot, readImages, readShots, saveImage, saveShot, type Shot, type ShotFiles, shotLocale, type StoredImage } from "./storage/assets.ts";
export { imagesDir, outDir, projectDir, safeJoin, shotsDir, type Space } from "./storage/paths.ts";
export { countProjects, slugify } from "./storage/projects.ts";
export { type Usage, usageOf } from "./storage/usage.ts";
// The Studio picks its thumbnails with the same function, so the two cannot pick differently.
export { findShot } from "./domain/standins.ts";

/** The projects that can be opened, newest change first. The repository's list also names the damaged ones. */
export async function listProjects(space: Space): Promise<Project[]> {
  return (await projects.list(space)).flatMap((entry) => ("project" in entry ? [entry.project] : []));
}

export async function getProject(space: Space, id: string): Promise<Project> {
  return (await projects.get(space, id)).project;
}

export async function createProject(space: Space, input: NewProject, options?: Pick<WriteOptions, "actor">): Promise<Project> {
  const { project } = await projects.create(space, input, options);
  usageChanged(space);
  return project;
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
  usageChanged(space);
  return project;
}

/** Deletes a project with everything in it, one that cannot be read included. */
export async function deleteProject(space: Space, id: string): Promise<void> {
  await projects.tombstone(space, id);
  await projects.remove(space, id);
  usageChanged(space);
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
  return listSets(projectDir(space, id));
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
