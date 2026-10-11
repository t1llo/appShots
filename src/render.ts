import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Browser, chromium } from "playwright";
import sharp from "sharp";
import { config } from "./config.ts";
import { CREATIVE_CAPACITY } from "./creative.ts";
import { LOCALE } from "./schema.ts";
import { DEVICE_LABELS, type DeviceKind, isTargetId, orderTargets, PLACEMENT_IDS, PLACEMENTS, type PlacementId, sourceOf, standardTargets, TARGETS, type TargetId } from "./sizes.ts";
import { CREATIVE_DIR, findShot, getProject, InputError, listImages, listShots, outDir, type Shot, type Space } from "./store.ts";

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

export function renderProject(space: Space, id: string, request: RenderRequest = {}): Promise<RenderResult> {
  const count = waiting.get(space.id) ?? 0;
  if (count >= MAX_WAITING) return Promise.reject(new InputError("A render is already running for this account. Try again when it has finished."));
  waiting.set(space.id, count + 1);
  const run = queue
    .then(() => renderNow(space, id, request))
    .finally(() => {
      const left = (waiting.get(space.id) ?? 1) - 1;
      if (left > 0) waiting.set(space.id, left);
      else waiting.delete(space.id);
    });
  queue = run.catch(() => {});
  return run;
}

async function renderNow(space: Space, id: string, request: RenderRequest): Promise<RenderResult> {
  const project = await getProject(space, id);
  const shots = await listShots(space, id);
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
        await page.goto(url, { waitUntil: "load" });
        await page.waitForFunction(() => document.body.dataset.ready === "1", undefined, { timeout: 20_000 });
        const raw = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size.width, height: size.height } });
        // App Store Connect rejects PNGs that carry an alpha channel, even a fully opaque one.
        await each(await sharp(raw).removeAlpha().png({ compressionLevel: 9 }).toBuffer(), i);
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
    const query = `locale=${encodeURIComponent(locale)}`;
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
