// The device families, their display classes and the export sizes live in the device registry. This module keeps
// the names the rest of the code has always imported them by, and the wide pictures a project has besides its slides.
export {
  type DeviceKind,
  DEVICE_KINDS,
  DEVICE_LABELS,
  deviceKindOf,
  designTarget,
  isDeviceKind,
  isTargetId,
  orderTargets,
  sourceOf,
  standardTargets,
  type Target,
  TARGET_IDS,
  TARGETS,
  type TargetId,
} from "./domain/devices.ts";

export interface Placement {
  label: string;
  /** What the picture is for: a slot of App Store Connect, or a banner for a README, a link or a post. */
  kind: "store" | "banner";
  ratio: string;
  width: number;
  height: number;
  /**
   * Where the copy and the focal subject belong. In a store asset it is the part no device or orientation crops
   * away; a banner is shown whole, so there it is only the middle the copy is set in.
   */
  safe: { x: number; y: number; width: number; height: number };
  note: string;
}

/**
 * The wide pictures a project can have besides its slides. The first three are the creative assets on the "Header
 * and Search Results" tab of App Store Connect, at the largest size it accepts: Apple publishes the safe areas only
 * as a design template, and these are the rectangles drawn in it. The rest are banners for outside the store.
 */
export const PLACEMENTS = {
  header: {
    label: "Product page header",
    kind: "store",
    ratio: "21:9",
    width: 3840,
    height: 1646,
    safe: { x: 1097, y: 493, width: 1646, height: 661 },
    note: "Shown at the top of the product page.",
  },
  search: {
    label: "Search results",
    kind: "store",
    ratio: "3:2",
    width: 3840,
    height: 2560,
    safe: { x: 836, y: 765, width: 2168, height: 1030 },
    note: "Shown with the app in search results.",
  },
  universal: {
    label: "Universal",
    kind: "store",
    ratio: "16:9",
    width: 5244,
    height: 2950,
    safe: { x: 1921, y: 660, width: 1402, height: 962 },
    note: "One file that App Store Connect crops for both places.",
  },
  readme: {
    label: "README banner",
    kind: "banner",
    ratio: "3:1",
    width: 2400,
    height: 800,
    safe: { x: 660, y: 120, width: 1080, height: 560 },
    note: "The wide picture at the top of a README or a web page.",
  },
  social: {
    label: "Social preview",
    kind: "banner",
    ratio: "2:1",
    width: 1280,
    height: 640,
    safe: { x: 290, y: 110, width: 700, height: 420 },
    note: "The picture a link to a GitHub repository shows, at the size GitHub asks for.",
  },
  link: {
    label: "Link preview",
    kind: "banner",
    ratio: "1.91:1",
    width: 1200,
    height: 630,
    safe: { x: 270, y: 108, width: 660, height: 414 },
    note: "The picture a link to a web page shows in chats and feeds: its og:image.",
  },
  post: {
    label: "Post",
    kind: "banner",
    ratio: "16:9",
    width: 1920,
    height: 1080,
    safe: { x: 420, y: 190, width: 1080, height: 700 },
    note: "For a post, a slide of a deck or a video thumbnail.",
  },
} as const satisfies Record<string, Placement>;

export type PlacementId = keyof typeof PLACEMENTS;

export const PLACEMENT_IDS = Object.keys(PLACEMENTS) as [PlacementId, ...PlacementId[]];

/** The placements of one kind, in the order they are offered. */
export const placementsOf = (kind: Placement["kind"]): PlacementId[] => PLACEMENT_IDS.filter((id) => PLACEMENTS[id].kind === kind);

export function isPlacementId(value: string): value is PlacementId {
  return Object.hasOwn(PLACEMENTS, value);
}
