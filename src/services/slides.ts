import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { InputError } from "../domain/errors.ts";
import { type Project, type Slide, slideSchema, type Theme, unknownFields } from "../schema.ts";
import { DEVICE_KINDS, DEVICE_LABELS, type DeviceKind } from "../sizes.ts";
import { projects } from "../storage/projects.ts";
import { listImages, listShots } from "../store.ts";
import { type Ctx, type Warning, writeOptions } from "./context.ts";
import { missingImages, missingNames, missingScreenshots, unknownImages, unknownScreenshots } from "./projects.ts";

// Slides are counted from 0 here, as in the HTTP API. The MCP tools count from 1 and convert at their door.

const slideList = z.array(slideSchema).max(10);

/** Slide fields given that slides do not have, such as a misspelt `headlne`: left out, and named so the call can be fixed. */
function ignoredFields(given: Array<{ index: number; slide: unknown }>): Warning[] {
  const names = given.flatMap(({ index, slide }) => unknownFields(slideSchema, slide).map((field) => (given.length > 1 ? `${field} (slide ${index + 1})` : field)));
  return names.length ? [{ kind: "field", names, text: `Ignored, because a slide has no such field: ${names.join(", ")}.` }] : [];
}

export interface SlidesSet {
  project: Project;
  /** For the shared set: the devices that have a set of their own and do not show it. */
  ownSets: DeviceKind[];
  warnings: Warning[];
}

/**
 * Replaces a whole slide set, and the theme when one is given. Without `device` it is the shared set, which needs
 * a slide at least; with it, that device's own set, which an empty list takes away again.
 */
export async function setSlides(ctx: Ctx, id: string, input: { slides: unknown[]; device?: DeviceKind; theme?: Theme }): Promise<SlidesSet> {
  const { device, theme } = input;
  const slides = slideList.parse(input.slides);
  if (!device && slides.length === 0) throw new InputError("Give at least one slide.");
  const ignored = ignoredFields(input.slides.map((slide, index) => ({ index, slide })));
  // The other sets are taken as they are when the change gets its turn, not as they were read before.
  const { project } = await projects.mutate(
    ctx.space,
    id,
    (current) => {
      if (!device) return { ...current, slides, ...(theme ? { theme } : {}) };
      const { [device]: _own, ...others } = current.deviceSlides;
      return { ...current, deviceSlides: slides.length ? { ...others, [device]: slides } : others, ...(theme ? { theme } : {}) };
    },
    writeOptions(ctx),
  );
  if (slides.length === 0) return { project, ownSets: [], warnings: [] };
  const ownSets = device ? [] : DEVICE_KINDS.filter((kind) => project.deviceSlides[kind]);
  return { project, ownSets, warnings: [...(await missingNames(ctx.space, project)), ...ignored] };
}

export interface SlideEdit {
  /** Fields merged over the slide, its `device` included. Fields a slide does not have are left out, and named. */
  changes?: Record<string, unknown>;
  /** Fields to clear. */
  remove?: string[];
}

export interface SlideAt {
  /** From 0. */
  index: number;
  /** A device's own set. Left out, the shared one. */
  of?: DeviceKind;
}

/** Thrown out of a change that leaves the slide as it was, so that nothing is written. */
const UNCHANGED = Symbol("unchanged");

/**
 * Changes one slide, merged into it as it is when the change gets its turn: parallel changes to other slides all
 * land. Warns about what the changed slide names without having it, and about fields it cannot set or clear.
 */
export async function updateSlide(ctx: Ctx, id: string, at: SlideAt, edit: SlideEdit): Promise<{ slide: Slide; project: Project; warnings: Warning[] }> {
  const { index, of } = at;
  const changes = edit.changes === undefined ? undefined : slideSchema.loose().parse(edit.changes);
  const remove = edit.remove ?? [];
  let changed: Slide | undefined;
  let project: Project | undefined;
  try {
    ({ project } = await projects.mutate(
      ctx.space,
      id,
      (current) => {
        const set = of ? current.deviceSlides[of] : current.slides;
        if (!set) throw new InputError(`The ${DEVICE_LABELS[of!]} has no slide set of its own. Give it one with set_slides and "device", or leave "of" out to change the shared slide.`);
        const existing = set[index];
        if (!existing) throw new InputError(`Slide ${index + 1} does not exist; ${of ? `the ${DEVICE_LABELS[of]} set` : "the project"} has ${set.length}.`);
        const next: Record<string, unknown> = { ...existing, ...changes };
        if (changes?.device) next.device = { ...existing.device, ...changes.device };
        for (const field of remove) if (Object.hasOwn(slideSchema.shape, field)) delete next[field];
        changed = slideSchema.parse(next);
        // An edit that sets nothing new, such as empty changes or only misspelt fields, saves no revision: the
        // history keeps the last 50, and an empty one would push out a version somebody may want back.
        if (isDeepStrictEqual(changed, existing)) {
          project = current;
          throw UNCHANGED;
        }
        const slides = set.map((slide, i) => (i === index ? changed! : slide));
        return of ? { ...current, deviceSlides: { ...current.deviceSlides, [of]: slides } } : { ...current, slides };
      },
      writeOptions(ctx),
    ));
  } catch (error) {
    if (error !== UNCHANGED) throw error;
  }
  const alone = { slides: [changed!], deviceSlides: {}, creatives: {} };
  const [shots, images] = await Promise.all([listShots(ctx.space, id, project!.locales), listImages(ctx.space, id)]);
  const unknownRemove = remove.filter((field) => !Object.hasOwn(slideSchema.shape, field));
  return {
    slide: changed!,
    project: project!,
    warnings: [
      ...missingScreenshots(unknownScreenshots(alone, shots)),
      ...missingImages(unknownImages(alone, images)),
      ...ignoredFields([{ index, slide: edit.changes }]),
      ...(unknownRemove.length ? [{ kind: "remove" as const, names: unknownRemove, text: `Not cleared, because a slide has no such field: ${unknownRemove.join(", ")}.` }] : []),
    ],
  };
}
