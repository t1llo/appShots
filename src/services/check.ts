import { outOfRenders, rendersLeft } from "../accounts.ts";
import { planRender, type RenderPlan, type RenderRequest } from "../render/plan.ts";
import type { DeviceKind, PlacementId, TargetId } from "../sizes.ts";
import type { Space } from "../storage/paths.ts";
import { projects } from "../storage/projects.ts";
import { InputError, listImages, listShots } from "../store.ts";

/** What a render asked for in the same way would do, found out without drawing anything or using a render. */
export interface RenderCheck {
  /** Whether the render would start. */
  ok: boolean;
  /** Why it would not, each in the words the render would be refused with. Empty when it would start. */
  refused: string[];
  /** What it would warn about, in its words, such as a screenshot name nothing is uploaded under. */
  warnings: string[];
  /** What it would draw. Left out when what was asked for cannot be drawn. */
  plan?: {
    locales: string[];
    targets: TargetId[];
    /** The slides each device would draw, zero-based. A device with a set of its own counts in that set. */
    slides: Partial<Record<DeviceKind, number[]>>;
    creatives: PlacementId[];
    /** How many pictures the browser draws, every language counted. A size scaled from another adds none. */
    pictures: number;
  };
  /** Renders the account has left, which a check does not touch. Null where they are not counted. */
  rendersLeft: number | null;
}

const planned = (plan: RenderPlan): RenderCheck["plan"] => ({
  locales: plan.locales,
  targets: plan.targets,
  slides: Object.fromEntries(plan.passes.filter((pass) => pass.indexes.length).map((pass) => [pass.device, pass.indexes])),
  creatives: plan.placements,
  pictures: plan.total,
});

/**
 * Checks a render before it is asked for: the same plan a render makes, from the same project, screenshots and
 * images, and the same count of the account's renders, but it queues nothing and holds no render. A small model can
 * call it as often as it likes and fix what it names before it spends a render.
 */
export async function checkRender(space: Space, id: string, request: RenderRequest = {}): Promise<RenderCheck> {
  const stored = await projects.get(space, id);
  const { project } = stored;
  const [shots, images] = await Promise.all([listShots(space, id, project.locales), listImages(space, id)]);
  const refused: string[] = [];
  const account = outOfRenders(space.id);
  if (account) refused.push(account);
  let plan: RenderPlan | undefined;
  try {
    plan = planRender(project, shots, images, request);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    refused.push(error.message);
  }
  return {
    ok: refused.length === 0,
    refused,
    warnings: [...stored.warnings, ...(plan?.warnings ?? [])],
    ...(plan ? { plan: planned(plan) } : {}),
    rendersLeft: rendersLeft(space.id),
  };
}
