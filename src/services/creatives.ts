import { CREATIVE_CAPACITY, creativeLayout } from "../creative.ts";
import { creativeSchema, type Creative, type Project } from "../schema.ts";
import { PLACEMENT_IDS, PLACEMENTS, type PlacementId } from "../sizes.ts";
import { projects } from "../storage/projects.ts";
import { type Ctx, type Warning, writeOptions } from "./context.ts";
import { missingNames } from "./projects.ts";

/** One wide picture the project defines, with the layout it is drawn in. */
export interface Asset {
  placement: PlacementId;
  label: string;
  layout: keyof typeof CREATIVE_CAPACITY;
  /** How many of its screenshots the layout shows. */
  shown: number;
  /** How many screenshots it names beyond that, which are left out. */
  extra: number;
}

/** The header, search results and banner images a project defines, in the order of the placements. */
export function assetsOf(project: Project): Asset[] {
  return PLACEMENT_IDS.filter((placement) => project.creatives[placement]).map((placement) => {
    const creative = project.creatives[placement]!;
    const layout = creativeLayout(creative, placement);
    const shown = CREATIVE_CAPACITY[layout];
    return { placement, label: PLACEMENTS[placement].label, layout, shown, extra: Math.max(0, (creative.screenshots?.length ?? 0) - shown) };
  });
}

/** Replaces each asset given and deletes those in `remove`; the others stay as they are. */
export async function setCreatives(ctx: Ctx, id: string, given: Partial<Record<PlacementId, Creative>>, remove: PlacementId[] = []): Promise<{ project: Project; assets: Asset[]; warnings: Warning[] }> {
  const set = Object.fromEntries(PLACEMENT_IDS.filter((placement) => given[placement]).map((placement) => [placement, creativeSchema.parse(given[placement])]));
  const { project } = await projects.mutate(
    ctx.space,
    id,
    (current) => {
      const creatives = { ...current.creatives, ...set };
      for (const placement of remove) delete creatives[placement];
      return { ...current, creatives };
    },
    writeOptions(ctx),
  );
  return { project, assets: assetsOf(project), warnings: await missingNames(ctx.space, project) };
}
