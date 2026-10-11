export type DeviceKind = "iphone" | "ipad";

export interface Target {
  label: string;
  device: DeviceKind;
  width: number;
  height: number;
}

/** Portrait sizes App Store Connect accepts. The first of each device kind is the one Apple asks for. */
export const TARGETS = {
  "iphone-6.9": { label: 'iPhone 6.9"', device: "iphone", width: 1320, height: 2868 },
  "iphone-6.5": { label: 'iPhone 6.5"', device: "iphone", width: 1284, height: 2778 },
  "ipad-13": { label: 'iPad 13"', device: "ipad", width: 2064, height: 2752 },
  "ipad-12.9": { label: 'iPad 12.9"', device: "ipad", width: 2048, height: 2732 },
} as const satisfies Record<string, Target>;

export type TargetId = keyof typeof TARGETS;

export const TARGET_IDS = Object.keys(TARGETS) as [TargetId, ...TargetId[]];

export function isTargetId(value: string): value is TargetId {
  return value in TARGETS;
}

/** Portrait phones are roughly 0.46 wide per unit of height, tablets 0.70 to 0.75. */
export function deviceKindOf(width: number, height: number): DeviceKind {
  const ratio = Math.min(width, height) / Math.max(width, height);
  return ratio < 0.6 ? "iphone" : "ipad";
}

export interface Placement {
  label: string;
  ratio: string;
  width: number;
  height: number;
  /** The part of the canvas no device or orientation crops away. Copy and the focal subject belong inside it. */
  safe: { x: number; y: number; width: number; height: number };
  note: string;
}

/**
 * The creative assets on the "Header and Search Results" tab of App Store Connect, at the largest size it accepts.
 * Apple publishes the safe areas only as a design template; these are the rectangles drawn in it.
 */
export const PLACEMENTS = {
  header: {
    label: "Product page header",
    ratio: "21:9",
    width: 3840,
    height: 1646,
    safe: { x: 1097, y: 493, width: 1646, height: 661 },
    note: "Shown at the top of the product page.",
  },
  search: {
    label: "Search results",
    ratio: "3:2",
    width: 3840,
    height: 2560,
    safe: { x: 836, y: 765, width: 2168, height: 1030 },
    note: "Shown with the app in search results.",
  },
  universal: {
    label: "Universal",
    ratio: "16:9",
    width: 5244,
    height: 2950,
    safe: { x: 1921, y: 660, width: 1402, height: 962 },
    note: "One file that App Store Connect crops for both places.",
  },
} as const satisfies Record<string, Placement>;

export type PlacementId = keyof typeof PLACEMENTS;

export const PLACEMENT_IDS = Object.keys(PLACEMENTS) as [PlacementId, ...PlacementId[]];

export function isPlacementId(value: string): value is PlacementId {
  return value in PLACEMENTS;
}
