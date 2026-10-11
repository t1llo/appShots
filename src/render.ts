import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import sharp from "sharp";
import { holdRender } from "./accounts.ts";
import { config } from "./config.ts";
import { CREATIVE_CAPACITY } from "./creative.ts";
import { LOCALE, type Project } from "./schema.ts";
import { DEVICE_LABELS, type DeviceKind, isTargetId, orderTargets, PLACEMENT_IDS, PLACEMENTS, type PlacementId, sourceOf, standardTargets, TARGETS, type TargetId } from "./sizes.ts";
import { CREATIVE_DIR, findShot, getProject, InputError, listImages, listShots, NotFoundError, outDir, type Shot, type Space } from "./store.ts";

export interface RenderRequest {
  targets?: TargetId[];
  locales?: string[];
  /** Zero-based slide indexes; everything when omitted. */
  slides?: number[];
  /**
   * Header and search results assets to render. Left out, every one the project defines is rendered along with
   * the slides. Naming only slides or only assets renders just those; an empty list means no assets.
   */
  creatives?: PlacementId[];
}

export interface RenderedFile {
  slide: number;
  target: TargetId;
  locale: string;
  /** Path relative to the project's output directory. */
  path: string;
  width: number;
  height: number;
  bytes: number;
}

/** A strip of one pass's slides to judge the set by. Sizes that are scaled copies of another have none of their own. */
export interface RenderedSheet {
  target: TargetId;
  locale: string;
  path: string;
}

export interface RenderedCreative {
  placement: PlacementId;
  locale: string;
  /** Path relative to the project's output directory. */
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export interface RenderResult {
  files: RenderedFile[];
  sheets: RenderedSheet[];
  creatives: RenderedCreative[];
  warnings: string[];
}

export type RenderState = "queued" | "running" | "done" | "failed" | "cancelled";

/** One run of the renderer, as GET /api/renders and the Studio's render list show it. */
export interface RenderJob {
  id: string;
  /** The project's id and its name. */
  project: string;
  name: string;
  state: RenderState;
  /** Pictures drawn so far, and how many the run draws. Both are zero while it waits. */
  done: number;
  total: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** What a finished run wrote. */
  files?: number;
  warnings?: string[];
  /** Why a run stopped short. */
  error?: string;
}

/** The project as it was when its render was asked for. A run draws that, whatever is edited while it works. */
interface Frozen {
  project: Project;
  shots: Shot[];
}

interface Run {
  job: RenderJob;
  space: string;
  cancelled: boolean;
  frozen?: Frozen;
  finished: Promise<RenderResult>;
}

class Cancelled extends InputError {
  constructor() {
    super("The render was cancelled.");
  }
}

let browser: Promise<Browser> | undefined;

function getBrowser(): Promise<Browser> {
  browser ??= chromium
    // Containers get a 64 MB /dev/shm by default, too small for a 2064×2752 page; this makes Chromium use /tmp instead.
    .launch({ args: ["--disable-dev-shm-usage"] })
    .then((instance) => {
      instance.on("disconnected", () => {
        browser = undefined;
      });
      return instance;
    })
    .catch((error) => {
      browser = undefined;
      throw error;
    });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const current = browser;
  browser = undefined;
  if (current) await current.then((instance) => instance.close()).catch(() => {});
}

/** The sizes a project exports: its own choice, or the standard sizes of every device it has screenshots of. iPhone while it has none. */
export function defaultTargets(shots: Shot[], chosen?: TargetId[]): TargetId[] {
  if (chosen?.length) return orderTargets(chosen);
  const kinds = new Set<DeviceKind>(shots.map((shot) => shot.device));
  if (kinds.size === 0) kinds.add("iphone");
  return standardTargets(kinds);
}

/** A size of the same proportions is the drawn one scaled, so every size of a device shows the identical design. */
const scaled = (png: Buffer, size: { width: number; height: number }) =>
  sharp(png).resize(size.width, size.height, { fit: "fill" }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();

const slideFile = (index: number) => `${String(index + 1).padStart(2, "0")}.png`;

// Renders run one at a time: a set is CPU-bound in a single browser, and two runs writing one project would interleave.
let queue: Promise<unknown> = Promise.resolve();
const waiting = new Map<string, number>();
/** One running plus one queued per account, so nobody can fill the shared queue. */
const MAX_WAITING = 2;


/** Every run that waits or works, and the finished ones of the last hour. */
const runs = new Map<string, Run>();
const KEPT_MS = 3600_000;
const KEPT_PER_SPACE = 8;

const ended = (run: Run) => run.job.finishedAt != null;

function forget(): void {
  const old = Date.now() - KEPT_MS;
  const kept = new Map<string, number>();
  // Newest first, so the cap drops the oldest finished runs of an account.
  for (const run of [...runs.values()].reverse()) {
    if (!ended(run)) continue;
    const count = (kept.get(run.space) ?? 0) + 1;
    kept.set(run.space, count);
    if (count > KEPT_PER_SPACE || Date.parse(run.job.finishedAt!) < old) runs.delete(run.job.id);
  }
}

/** The runs of one account, newest first. */
export function listRenders(space: Space): RenderJob[] {
  forget();
  return [...runs.values()]
    .filter((run) => run.space === space.id)
    .map((run) => run.job)
    .reverse();
}

export function getRender(space: Space, job: string): RenderJob {
  const run = runs.get(job);
  if (!run || run.space !== space.id) throw new NotFoundError("No such render. A finished one is listed for an hour.");
  return run.job;
}

/** Stops a run before its next picture. What it has drawn so far stays, and it uses no render. */
export function cancelRender(space: Space, job: string): RenderJob {
  const run = runs.get(job);
  if (!run || run.space !== space.id) throw new NotFoundError("No such render. A finished one is listed for an hour.");
  if (!ended(run)) run.cancelled = true;
  return run.job;
}

/** What a page of a running render draws: the project as it was when the render was asked for. */
export function frozenFor(space: Space, job: unknown): Frozen | undefined {
  const run = typeof job === "string" ? runs.get(job) : undefined;
  return run && run.space === space.id ? run.frozen : undefined;
}

/**
 * Queues a render and returns at once with the run. Refuses when the account has two waiting already or no
 * renders left. `finished` settles when the run does, and somebody has to catch what it throws. `name` is what
 * the run is called until the project has been read.
 */
export function startRender(space: Space, id: string, request: RenderRequest = {}, name = id): { job: RenderJob; finished: Promise<RenderResult> } {
  const count = waiting.get(space.id) ?? 0;
  if (count >= MAX_WAITING) throw new InputError("Two renders are already under way for this account. Try again when one has finished.");
  const settle = holdRender(space.id);
  waiting.set(space.id, count + 1);

  const job: RenderJob = { id: randomBytes(8).toString("hex"), project: id, name, state: "queued", done: 0, total: 0, createdAt: new Date().toISOString() };
  // Read now, not when the queue gets here, so the run draws what was there when it was asked for.
  const loaded = Promise.all([getProject(space, id), listShots(space, id)]);
  loaded.then(
    ([project]) => {
      job.name = project.name;
    },
    () => {},
  );
  const run: Run = { job, space: space.id, cancelled: false, finished: undefined as never };
  run.finished = queue
    .then(async () => {
      if (run.cancelled) throw new Cancelled();
      const [project, shots] = await loaded;
      run.frozen = { project, shots };
      job.state = "running";
      job.startedAt = new Date().toISOString();
      return renderNow(run, space, request);
    })
    .then(
      async (result) => {
        job.state = "done";
        job.files = result.files.length + result.creatives.length;
        job.warnings = result.warnings;
        await settle(true);
        return result;
      },
      async (error: unknown) => {
        job.state = run.cancelled ? "cancelled" : "failed";
        // Only what is meant for whoever asked; anything else is the server's own trouble and goes to its log.
        if (!run.cancelled) job.error = error instanceof InputError || error instanceof NotFoundError ? error.message : "The render stopped with an error on the server.";
        await settle(false);
        throw run.cancelled ? new Cancelled() : error;
      },
    )
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      run.frozen = undefined;
      const left = (waiting.get(space.id) ?? 1) - 1;
      if (left > 0) waiting.set(space.id, left);
      else waiting.delete(space.id);
    });
  queue = run.finished.catch(() => {});
  runs.set(job.id, run);
  forget();
  return { job, finished: run.finished };
}

/** Renders and waits for it. */
export async function renderProject(space: Space, id: string, request: RenderRequest = {}): Promise<RenderResult> {
  return startRender(space, id, request).finished;
}

async function renderNow(run: Run, space: Space, request: RenderRequest): Promise<RenderResult> {
  const { project, shots } = run.frozen!;
  const { id } = project;
  const defined = PLACEMENT_IDS.filter((placement) => project.creatives[placement]);
  const everything = !request.slides?.length && request.creatives === undefined;
  const placements = everything ? defined : [...new Set(request.creatives ?? [])];
  for (const placement of placements) {
    if (!project.creatives[placement]) throw new InputError(`This project has no ${PLACEMENTS[placement].label.toLowerCase()} asset yet. Design it first.`);
  }

  const targets = orderTargets(request.targets?.length ? request.targets : defaultTargets(shots, project.targets));
  // Sizes of one shape share a pass of the browser: it draws the first, and the others are that picture scaled.
  const passes = new Map<TargetId, TargetId[]>();
  for (const target of targets) passes.set(sourceOf(target), [...(passes.get(sourceOf(target)) ?? []), target]);
  const locales = request.locales?.length ? request.locales : project.locales;
  // Asking for assets alone leaves the slides as they are.
  const indexes = request.slides?.length ? [...new Set(request.slides)].sort((a, b) => a - b) : placements.length && !everything ? [] : project.slides.map((_, i) => i);
  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= project.slides.length) {
      throw new InputError(`Slide ${index + 1} does not exist; the project has ${project.slides.length}.`);
    }
  }
  if (indexes.length === 0 && placements.length === 0) {
    throw new InputError("This project has nothing to render yet. Add slides with set_slides, or a header or search results asset.");
  }
  const full = indexes.length === project.slides.length;
  run.job.total = locales.length * (indexes.length * passes.size + placements.length);

  const warnings = new Set<string>();
  const images = new Set((await listImages(space, id)).map((image) => image.name));
  const noImage = (where: string, name: string) => warnings.add(`${where}: no image named "${name}" has been uploaded, so it was left out.`);
  for (const index of indexes) {
    const slide = project.slides[index]!;
    for (const name of [slide.logo?.image, ...(slide.images ?? []).map((placed) => placed.image)]) {
      if (name && !images.has(name)) noImage(`Slide ${index + 1}`, name);
    }
    for (const name of [slide.screenshot, slide.screenshot2, slide.screenshot3]) {
      if (!name) continue;
      for (const kind of new Set(targets.map((target) => TARGETS[target].device))) {
        const shot = findShot(shots, name, kind);
        if (!shot) warnings.add(`Slide ${index + 1}: no screenshot named "${name}" has been uploaded, so a placeholder was drawn.`);
        else if (shot.device !== kind) warnings.add(`Slide ${index + 1}: "${name}" has no ${DEVICE_LABELS[kind]} screenshot, so the ${DEVICE_LABELS[shot.device]} one was used for the ${DEVICE_LABELS[kind]} sizes.`);
      }
    }
  }

  for (const placement of placements) {
    const creative = project.creatives[placement]!;
    const { label } = PLACEMENTS[placement];
    const names = creative.screenshots ?? [];
    const room = CREATIVE_CAPACITY[creative.layout ?? "fan"];
    for (const name of names.slice(0, room)) {
      if (!shots.some((shot) => shot.name === name)) warnings.add(`${label}: no screenshot named "${name}" has been uploaded, so ${creative.layout === "wall" ? "it was left out" : "a placeholder was drawn"}.`);
    }
    if (creative.logo && !images.has(creative.logo.image)) noImage(label, creative.logo.image);
    const extra = names.length - room;
    if (extra > 0) warnings.add(`${label}: the ${creative.layout ?? "fan"} layout shows ${room} screenshots, so the last ${extra === 1 ? "one was" : `${extra} were`} left out.`);
  }

  const local = `127.0.0.1:${config.port}`;
  const files: RenderedFile[] = [];
  const sheets: RenderedSheet[] = [];
  const creatives: RenderedCreative[] = [];

  /** Loads one page of this server at an exact size and returns it as the opaque PNG App Store Connect wants. */
  const capture = async (size: { width: number; height: number }, urls: string[], each: (png: Buffer, i: number) => Promise<void>) => {
    const instance = await getBrowser();
    const context = await instance.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      extraHTTPHeaders: { "x-appshots-internal": config.internalSecret, "x-appshots-space": space.id },
    });
    // The pages only ever need this server; nothing they contain may make the browser call out, least of all with those headers.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.protocol === "data:" || url.host === local ? route.continue() : route.abort();
    });
    try {
      const page = await context.newPage();
      for (const [i, url] of urls.entries()) {
        if (run.cancelled) throw new Cancelled();
        await page.goto(url, { waitUntil: "load" });
        await page.waitForFunction(() => document.body.dataset.ready === "1", undefined, { timeout: 20_000 });
        const raw = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size.width, height: size.height } });
        // App Store Connect rejects PNGs that carry an alpha channel, even a fully opaque one.
        await each(await sharp(raw).removeAlpha().png({ compressionLevel: 9 }).toBuffer(), i);
        run.job.done++;
      }
    } finally {
      await context.close();
    }
  };

  const root = outDir(space, id);
  // A render of everything at the project's own sizes also clears the sizes and languages it no longer has.
  if (everything && !request.targets?.length && !request.locales?.length) {
    for (const entry of await readdir(root).catch(() => [])) {
      if (!locales.includes(entry)) {
        if (LOCALE.test(entry)) await rm(path.join(root, entry), { recursive: true, force: true });
        continue;
      }
      for (const size of await readdir(path.join(root, entry)).catch(() => [])) {
        if (isTargetId(size) && !targets.includes(size)) await rm(path.join(root, entry, size), { recursive: true, force: true });
      }
    }
  }

  for (const locale of locales) {
    const query = `locale=${encodeURIComponent(locale)}&job=${run.job.id}`;
    for (const [source, wanted] of indexes.length ? passes : []) {
      for (const target of wanted) {
        const dir = path.join(root, locale, target);
        if (full) await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
      }
      await capture(
        TARGETS[source],
        indexes.map((index) => `http://${local}/render/${id}/${index}?target=${source}&${query}`),
        async (png, i) => {
          const index = indexes[i]!;
          const file = slideFile(index);
          const written = await Promise.all(
            wanted.map(async (target) => {
              const size = TARGETS[target];
              const data = target === source ? png : await scaled(png, size);
              await writeFile(path.join(root, locale, target, file), data);
              return { slide: index, target, locale, path: path.join(locale, target, file), width: size.width, height: size.height, bytes: data.length };
            }),
          );
          files.push(...written);
        },
      );
      const shown = wanted[0]!;
      await buildSheet(path.join(root, locale, shown));
      sheets.push({ target: shown, locale, path: path.join(locale, shown, "sheet.jpg") });
    }

    const relDir = path.join(locale, CREATIVE_DIR);
    const dir = path.join(root, relDir);
    // A render of everything also clears assets that have since been removed from the project.
    if (everything) await rm(dir, { recursive: true, force: true });
    if (placements.length) await mkdir(dir, { recursive: true });
    for (const placement of placements) {
      const size = PLACEMENTS[placement];
      await capture(size, [`http://${local}/render/${id}/creative/${placement}?${query}`], async (png) => {
        const file = `${placement}.png`;
        await writeFile(path.join(dir, file), png);
        creatives.push({ placement, locale, path: path.join(relDir, file), width: size.width, height: size.height, bytes: png.length });
      });
    }
  }
  return { files, sheets, creatives, warnings: [...warnings] };
}

/** Stitches a directory's rendered slides into one strip so the whole set can be judged at a glance. */
async function buildSheet(dir: string): Promise<void> {
  const names = (await readdir(dir)).filter((name) => /^\d{2}\.png$/.test(name)).sort();
  if (names.length === 0) return;
  const gap = 28;
  const meta = await sharp(path.join(dir, names[0]!)).metadata();
  const maxWidth = 2000;
  const height = Math.round(Math.min(620, ((maxWidth - gap * (names.length + 1)) / names.length) * (meta.height / meta.width)));
  const width = Math.round(height * (meta.width / meta.height));
  const tiles = await Promise.all(
    names.map(async (name, i) => ({
      input: await sharp(path.join(dir, name)).resize(width, height).toBuffer(),
      left: gap + i * (width + gap),
      top: gap,
    })),
  );
  const sheet = await sharp({
    create: { width: gap + names.length * (width + gap), height: height + gap * 2, channels: 3, background: "#141416" },
  })
    .composite(tiles)
    .jpeg({ quality: 84 })
    .toBuffer();
  await writeFile(path.join(dir, "sheet.jpg"), sheet);
}
