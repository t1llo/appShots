import { createHash } from "node:crypto";
import { CREATIVE_CAPACITY, creativeLayout } from "../creative.ts";
import { type LintWarning, lintCreative, lintSlide, lintTexts } from "../domain/lint.ts";
import { LOCALE, type Project, type Slide, slidesFor } from "../schema.ts";
import { DEVICE_LABELS, type DeviceKind, orderTargets, PLACEMENT_IDS, PLACEMENTS, type PlacementId, sourceOf, standardTargets, TARGETS, type TargetId } from "../sizes.ts";
import { findShot, InputError, type Shot } from "../store.ts";

// What a render will draw, worked out before it waits for its turn: a request that cannot be drawn is refused at
// once and costs nothing. Nothing here touches the disk or the browser.

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

/** The sizes a project exports: its own choice, or the standard sizes of every device it has screenshots of. iPhone while it has none. */
export function defaultTargets(shots: Shot[], chosen?: TargetId[]): TargetId[] {
  if (chosen?.length) return orderTargets(chosen);
  const kinds = new Set<DeviceKind>(shots.map((shot) => shot.device));
  if (kinds.size === 0) kinds.add("iphone");
  return standardTargets(kinds);
}

/** The most languages one render takes, as many as a project can have. */
export const MAX_LOCALES = 40;

/**
 * The project's own codes for the languages asked for, each once: matched without regard to case, and a bare
 * language such as "de" to the project's "de-DE", the way screenshots are matched to languages.
 */
export function resolveLocales(project: Pick<Project, "locales">, wanted: string[] | undefined): string[] {
  if (!wanted?.length) return project.locales;
  if (wanted.length > MAX_LOCALES) throw new InputError(`A render takes up to ${MAX_LOCALES} languages; ${wanted.length} were asked for.`);
  const language = (code: string) => code.toLowerCase().split("-")[0];
  const found = wanted.map((code) => {
    const lower = code.toLowerCase();
    const match =
      project.locales.find((each) => each.toLowerCase() === lower) ??
      project.locales.find((each) => language(each) === lower) ??
      project.locales.find((each) => each.toLowerCase() === language(code));
    if (!match) throw new InputError(`This project has no language "${code}". Its languages are ${project.locales.join(", ")}. Add "${code}" to the project first.`);
    return match;
  });
  return [...new Set(found)];
}

export interface Pass {
  /** The size the browser draws at. */
  source: TargetId;
  /** Every size the pass writes: the drawn one where it was asked for, and that picture scaled to the others. */
  targets: TargetId[];
  device: DeviceKind;
  /** The slides it draws, zero-based. */
  indexes: number[];
  /** How many slides the device's set has. A set folder holds no more than that. */
  count: number;
  /** Whether it draws the whole set. */
  full: boolean;
  /** Whether its drawn size gets the device's contact sheet. One per device is enough to judge the design. */
  sheet: boolean;
}

export interface RenderPlan {
  /** The project's own codes, each once. */
  locales: string[];
  targets: TargetId[];
  /** The browser's passes, the same for every language. */
  passes: Pass[];
  placements: PlacementId[];
  /** Neither slides nor assets were picked. */
  everything: boolean;
  /** Everything at the project's own sizes and in all its languages, which also clears the sizes it no longer has. */
  cleanup: boolean;
  /** Pictures the run draws. */
  total: number;
  warnings: string[];
  /** What the copy and the logos break of the store's rules. Each is also one of `warnings`, in fewer words. */
  lint: LintWarning[];
  /** The screenshot files the pages will read. */
  shots: Shot[];
  /** What a device's set looks like in a language, keyed `<locale> <device>`: a set drawn from another design is out of date. */
  designs: Record<string, string>;
}

/** A text of every language turned into the one a locale shows, so the design of one language ignores edits to another's. */
function localized(value: unknown, locale: string, fallback: string, languages: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((each) => localized(each, locale, fallback, languages));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  const isText =
    entries.length > 0 &&
    entries.every(([key, text]) => LOCALE.test(key) && typeof text === "string") &&
    entries.some(([key]) => languages.has(key.toLowerCase()) || languages.has(key.toLowerCase().split("-")[0]!));
  if (isText) {
    // As the slide pages pick it.
    const text = value as Record<string, string>;
    return text[locale] ?? text[locale.split("-")[0]!] ?? text[fallback] ?? Object.values(text)[0] ?? "";
  }
  return Object.fromEntries(entries.map(([key, each]) => [key, localized(each, locale, fallback, languages)]));
}

const shotNames = (slide: Slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3, ...(slide.features ?? []).map((feature) => feature.screenshot)];
const imageNames = (slide: Slide) => [slide.logo?.image, ...(slide.images ?? []).map((placed) => placed.image), ...(slide.features ?? []).map((feature) => feature.image)];

/** Works out a render and refuses one that cannot be drawn, with what to do about it. */
export function planRender(project: Project, shots: Shot[], images: { name: string; version: number }[], request: RenderRequest = {}): RenderPlan {
  const locales = resolveLocales(project, request.locales);
  const defined = PLACEMENT_IDS.filter((placement) => project.creatives[placement]);
  const everything = !request.slides?.length && request.creatives === undefined;
  const placements = everything ? defined : [...new Set(request.creatives ?? [])];
  for (const placement of placements) {
    if (!project.creatives[placement]) throw new InputError(`This project has no ${PLACEMENTS[placement].label.toLowerCase()} asset yet. Design it first.`);
  }

  const targets = orderTargets(request.targets?.length ? request.targets : defaultTargets(shots, project.targets));
  // A device with a slide set of its own draws that one, which may be longer or shorter than the others.
  const kinds = [...new Set(targets.map((target) => TARGETS[target].device))];
  const sets = new Map(kinds.map((kind) => [kind, slidesFor(project, kind)]));
  const longest = Math.max(0, ...[...sets.values()].map((set) => set.length));
  const asked = request.slides?.length ? [...new Set(request.slides)].sort((a, b) => a - b) : undefined;
  for (const index of asked ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= longest) {
      throw new InputError(`Slide ${index + 1} does not exist; the project has ${longest}.`);
    }
  }
  /** The slides to draw for a device: the ones asked for that its set has, or all of it. Asking for assets alone leaves the slides as they are. */
  const indexesFor = (kind: DeviceKind): number[] => {
    const count = sets.get(kind)!.length;
    if (asked) return asked.filter((index) => index < count);
    return placements.length && !everything ? [] : Array.from({ length: count }, (_, i) => i);
  };

  // Sizes of one shape share a pass of the browser: it draws the size the others copy, and they are that picture
  // scaled. The size table says which size copies which, so the Studio previews exactly the shapes drawn here.
  const grouped = new Map<TargetId, TargetId[]>();
  for (const target of targets) grouped.set(sourceOf(target), [...(grouped.get(sourceOf(target)) ?? []), target]);
  const sheeted = new Set<DeviceKind>();
  const passes: Pass[] = [...grouped].map(([source, wanted]) => {
    const device = TARGETS[source].device;
    const indexes = indexesFor(device);
    const count = sets.get(device)!.length;
    const sheet = indexes.length > 0 && !sheeted.has(device);
    if (sheet) sheeted.add(device);
    // The drawn size is written only when it was asked for: it may be there just to be scaled.
    return { source, targets: wanted, device, indexes, count, full: indexes.length === count, sheet };
  });

  const drawn = passes.reduce((sum, pass) => sum + pass.indexes.length, 0);
  if (drawn === 0 && placements.length === 0) {
    throw new InputError("This project has nothing to render yet. Add slides with set_slides, or a header or search results asset.");
  }

  const warnings = new Set<string>();
  const imageNamesKnown = new Set(images.map((image) => image.name));
  const noImage = (where: string, name: string) => warnings.add(`${where}: no image named "${name}" has been uploaded, so it was left out.`);
  for (const kind of kinds) {
    // A set of its own is named with its device, so it is clear which slide 2 is meant.
    const prefix = project.deviceSlides[kind] ? `${DEVICE_LABELS[kind]} slide` : "Slide";
    for (const index of indexesFor(kind)) {
      const slide = sets.get(kind)![index]!;
      const where = `${prefix} ${index + 1}`;
      for (const name of imageNames(slide)) {
        if (name && !imageNamesKnown.has(name)) noImage(where, name);
      }
      for (const name of shotNames(slide)) {
        if (!name) continue;
        const shot = findShot(shots, name, kind);
        if (!shot) warnings.add(`${where}: no screenshot named "${name}" has been uploaded, so ${slide.screenshot === name || slide.screenshot2 === name || slide.screenshot3 === name ? "a placeholder was drawn" : "it was left out"}.`);
        else if (shot.device !== kind) warnings.add(`${where}: "${name}" has no ${DEVICE_LABELS[kind]} screenshot, so the ${DEVICE_LABELS[shot.device]} one was used for the ${DEVICE_LABELS[kind]} sizes.`);
      }
    }
  }
  for (const placement of placements) {
    const creative = project.creatives[placement]!;
    const { label } = PLACEMENTS[placement];
    const names = creative.screenshots ?? [];
    const layout = creativeLayout(creative, placement);
    const room = CREATIVE_CAPACITY[layout];
    for (const name of names.slice(0, room)) {
      if (!shots.some((shot) => shot.name === name)) warnings.add(`${label}: no screenshot named "${name}" has been uploaded, so ${layout === "wall" ? "it was left out" : "a placeholder was drawn"}.`);
    }
    if (creative.logo && !imageNamesKnown.has(creative.logo.image)) noImage(label, creative.logo.image);
    const extra = names.length - room;
    if (extra > 0) warnings.add(`${label}: the ${layout} layout shows ${room} screenshots, so the last ${extra === 1 ? "one was" : `${extra} were`} left out.`);
  }

  // The copy and the logos, checked once per slide: the shared set is the same slides on every device that has no set of its own.
  const lint: LintWarning[] = [];
  const fallback = project.locales[0]!;
  const shared = new Set(kinds.filter((kind) => !project.deviceSlides[kind]).flatMap(indexesFor));
  for (const index of [...shared].sort((a, b) => a - b)) lint.push(...lintSlide(project.slides[index]!, { slide: index }, locales, fallback));
  for (const kind of kinds.filter((each) => project.deviceSlides[each])) {
    for (const index of indexesFor(kind)) lint.push(...lintSlide(sets.get(kind)![index]!, { ownSet: kind, slide: index }, locales, fallback));
  }
  for (const placement of placements) lint.push(...lintCreative(project.creatives[placement]!, placement, locales, fallback));
  for (const text of lintTexts(lint, locales)) warnings.add(text);

  // The screenshots the pages read, and what each device's set looks like in each language.
  const used = new Set<Shot>();
  const designs: Record<string, string> = {};
  const languages = new Set(project.locales.flatMap((code) => [code.toLowerCase(), code.toLowerCase().split("-")[0]!]));
  const versions = new Map(images.map((image) => [image.name, image.version]));
  for (const locale of locales) {
    for (const kind of kinds) {
      const slides = sets.get(kind)!;
      const drawnShots = slides.flatMap((slide) => shotNames(slide).map((name) => findShot(shots, name, kind, locale)));
      if (passes.some((pass) => pass.device === kind && pass.indexes.length)) {
        for (const index of indexesFor(kind)) {
          for (const name of shotNames(slides[index]!)) {
            const shot = findShot(shots, name, kind, locale);
            if (shot) used.add(shot);
          }
        }
      }
      const design = {
        theme: localized(project.theme, locale, project.locales[0]!, languages),
        slides: localized(slides, locale, project.locales[0]!, languages),
        shots: drawnShots.map((shot) => shot && `${shot.file}@${shot.version}`),
        images: slides.flatMap((slide) => imageNames(slide).map((name) => name && versions.get(name))),
      };
      designs[`${locale} ${kind}`] = createHash("sha256").update(JSON.stringify(design)).digest("hex").slice(0, 24);
    }
    for (const placement of placements) {
      const names = new Set(project.creatives[placement]!.screenshots ?? []);
      for (const shot of shots) if (names.has(shot.name)) used.add(shot);
    }
  }

  return {
    locales,
    targets,
    passes,
    placements,
    everything,
    cleanup: everything && !request.targets?.length && !request.locales?.length,
    total: locales.length * (drawn + placements.length),
    warnings: [...warnings],
    lint,
    shots: [...used],
    designs,
  };
}
