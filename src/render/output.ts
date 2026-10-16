import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type FitReport, type LintWarning, lintFit, lintTexts } from "../domain/lint.ts";
import { type Project, slidesFor } from "../schema.ts";
import { DEVICE_KINDS, DEVICE_LABELS, PLACEMENT_IDS, PLACEMENTS, type PlacementId, TARGETS, type TargetId } from "../sizes.ts";
import { creativeDir, InputError, projectDir, type Space } from "../store.ts";
import { type Commit, type StagedSet, stagingDir } from "../storage/outputs.ts";
import type { LayoutId } from "../template/layouts/index.ts";
import { openWindow } from "./capture.ts";
import { contactSheet, contactSheetOf, opaquePng, type Tile, tileOf, tileSize } from "./encode.ts";
import { local } from "./engine.ts";
import type { RenderPlan } from "./plan.ts";

// What a run writes: every picture it draws, into a staging folder of its own, and what storage is to put in place
// once the run has finished. Nothing here touches out/.

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

/** A strip of a device's slides to judge the set by. One per device and language: its other sizes look the same. */
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
  /** What the set breaks of the store's rules, and how its copy fitted, as data. Each is also one of `warnings`. */
  lint: LintWarning[];
  /** How the copy of each page drawn came out. The sizes that are scaled copies of a drawn one are named by the first. */
  fit: FitReport[];
}

/** What a run stops with when it is cancelled. */
export class Cancelled extends InputError {
  constructor() {
    super("The render was cancelled.");
  }
}

/** The run being drawn, as far as drawing goes: whether to stop, and where to count what is done. */
export interface Drawing {
  readonly cancelled: boolean;
  job: { id: string; done: number };
}

const slideFile = (index: number) => `${String(index + 1).padStart(2, "0")}.png`;

/** The largest social preview GitHub accepts, in bytes. */
const SOCIAL_LIMIT = 1_000_000;

/** Pictures being encoded while the browser draws the next ones. A few at most, for each holds a page's pixels. */
const AHEAD = 2;

/** Draws every picture of a run into its staging folder, and says what to put in place. */
export async function draw(run: Drawing, space: Space, project: Project, plan: RenderPlan): Promise<{ result: RenderResult; commit: Commit }> {
  const { id, deviceSlides } = project;
  const stage = stagingDir(projectDir(space, id), run.job.id);
  const warnings = new Set(plan.warnings);
  const files: Promise<RenderedFile[]>[] = [];
  const creatives: Promise<RenderedCreative>[] = [];
  const sheets: RenderedSheet[] = [];
  const sets: StagedSet[] = [];
  const fitted: { report: FitReport; layout?: LayoutId }[] = [];

  // Encoding a picture takes about as long as drawing the next, so the two overlap.
  const encoding = new Set<Promise<unknown>>();
  let failure: { error: unknown } | undefined;
  const meanwhile = async (work: Promise<unknown>) => {
    const tracked = work.then(
      () => {},
      (error: unknown) => {
        failure ??= { error };
      },
    );
    encoding.add(tracked);
    void tracked.then(() => encoding.delete(tracked));
    while (encoding.size > AHEAD) await Promise.race(encoding);
    if (failure) throw failure.error;
  };

  const first = plan.passes.find((pass) => pass.indexes.length);
  const window = await openWindow(space, first ? TARGETS[first.source] : PLACEMENTS[plan.placements[0]!]);
  try {
    for (const locale of plan.locales) {
      const query = `locale=${encodeURIComponent(locale)}&job=${run.job.id}`;
      const design = (device: string) => plan.designs[`${locale} ${device}`]!;
      for (const pass of plan.passes) {
        if (!pass.indexes.length) continue;
        const size = TARGETS[pass.source];
        await window.resize(size);
        for (const target of pass.targets) await mkdir(path.join(stage, locale, target), { recursive: true });
        const shown = pass.targets[0]!;
        // The sheet of a whole set is drawn from the pictures at hand; of a part, once the set's other slides are in place.
        const tile = pass.sheet && pass.full ? tileSize(TARGETS[shown], pass.indexes.length) : undefined;
        const tiles: Promise<Tile>[] = [];
        // A set of its own is named with its device, so it is clear which slide 2 is meant.
        const prefix = deviceSlides[pass.device] ? `${DEVICE_LABELS[pass.device]} slide` : "Slide";
        const own = deviceSlides[pass.device] ? { ownSet: pass.device } : {};
        for (const index of pass.indexes) {
          if (run.cancelled) throw new Cancelled();
          const fit = await window.load(`http://${local}/render/${id}/${index}?target=${pass.source}&${query}`, `${prefix} ${index + 1}`);
          const layout = slidesFor(project, pass.device)[index]?.layout ?? "device-bottom";
          if (fit) fitted.push({ report: { ...fit, locale, ...own, slide: index, device: pass.device, target: shown }, layout });
          const picture = await window.shoot(size);
          const file = slideFile(index);
          const encoded = pass.targets.map(async (target) => {
            const { width, height } = TARGETS[target];
            const data = await opaquePng(picture, target === pass.source ? undefined : TARGETS[target]);
            await writeFile(path.join(stage, locale, target, file), data);
            return { data, file: { slide: index, target, locale, path: path.join(locale, target, file), width, height, bytes: data.length } };
          });
          const written = Promise.all(encoded).then((each) => each.map(({ file }) => file));
          files.push(written);
          // The sheet shows the first size written. When that is a scaled copy, it is made from the copy, as from its file.
          if (tile) tiles.push(shown === pass.source ? tileOf(picture, tile) : encoded[0]!.then(({ data }) => tileOf(data, tile)));
          await meanwhile(
            Promise.all([written, ...tiles.slice(-1)]).then(() => {
              run.job.done++;
            }),
          );
        }
        if (tile) {
          await meanwhile(Promise.all(tiles).then(async (each) => writeFile(path.join(stage, locale, shown, "sheet.jpg"), await contactSheet(each, tile))));
        }
        if (pass.sheet) sheets.push({ target: shown, locale, path: path.join(locale, shown, "sheet.jpg") });
        for (const target of pass.targets) {
          sets.push({
            locale,
            target,
            device: pass.device,
            files: pass.indexes.map(slideFile),
            full: pass.full,
            count: pass.count,
            design: design(pass.device),
            ...(pass.sheet && !pass.full && target === shown ? { sheet: (all: string[]) => contactSheetOf(all, TARGETS[shown]) } : {}),
          });
        }
      }

      for (const placement of plan.placements) {
        if (run.cancelled) throw new Cancelled();
        const size = PLACEMENTS[placement];
        await window.resize(size);
        const fit = await window.load(`http://${local}/render/${id}/creative/${placement}?${query}`, size.label);
        if (fit) fitted.push({ report: { ...fit, locale, placement } });
        const picture = await window.shoot(size);
        const relative = path.join(locale, creativeDir(placement), `${placement}.png`);
        await mkdir(path.dirname(path.join(stage, relative)), { recursive: true });
        const written = opaquePng(picture).then(async (png) => {
          await writeFile(path.join(stage, relative), png);
          if (placement === "social" && png.length > SOCIAL_LIMIT) {
            warnings.add(`${size.label}: the file is ${(png.length / 1e6).toFixed(1)} MB, and GitHub takes a social preview of up to 1 MB. A plainer background without grain makes it smaller.`);
          }
          return { placement, locale, path: relative, width: size.width, height: size.height, bytes: png.length };
        });
        creatives.push(written);
        await meanwhile(
          written.then(() => {
            run.job.done++;
          }),
        );
      }
    }
    await Promise.all(encoding);
    if (failure) throw failure.error;
  } finally {
    await window.close();
    // Whatever is still being encoded after a failure has to finish before its folder is removed.
    await Promise.all(encoding);
  }

  // A render of everything also clears assets that have since been removed from the project.
  const remove = plan.everything
    ? plan.locales.flatMap((locale) => PLACEMENT_IDS.filter((placement) => !plan.placements.includes(placement)).map((placement) => ({ locale, placement, path: path.join(locale, creativeDir(placement), `${placement}.png`) })))
    : [];
  const drawnCreatives = await Promise.all(creatives);
  const fitLint = lintFit(fitted);
  for (const text of lintTexts(fitLint, plan.locales)) warnings.add(text);
  return {
    result: {
      files: (await Promise.all(files)).flat(),
      sheets,
      creatives: drawnCreatives,
      warnings: [...warnings],
      lint: [...plan.lint, ...fitLint],
      fit: fitted.map(({ report }) => report),
    },
    commit: {
      job: run.job.id,
      sets,
      creatives: drawnCreatives.map(({ locale, placement, path }) => ({ locale, placement, path })),
      remove,
      ...(plan.cleanup ? { cleanup: { locales: plan.locales, targets: plan.targets } } : {}),
      counts: Object.fromEntries(DEVICE_KINDS.map((kind) => [kind, slidesFor(project, kind).length])),
      deviceOf: (target: string) => (Object.hasOwn(TARGETS, target) ? TARGETS[target as TargetId].device : undefined),
    },
  };
}
