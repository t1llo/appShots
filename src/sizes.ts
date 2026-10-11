export type DeviceKind = "iphone" | "duo" | "ipad";

/** The device families a set is designed for, in the order they are offered. */
export const DEVICE_KINDS = ["iphone", "duo", "ipad"] as const satisfies DeviceKind[];

export const DEVICE_LABELS: Record<DeviceKind, string> = { iphone: "iPhone", duo: "iPhone Duo", ipad: "iPad" };

export function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === "string" && (DEVICE_KINDS as readonly string[]).includes(value);
}

export interface Target {
  label: string;
  /** The screenshot slot of App Store Connect this size is uploaded to, as it is named there. */
  slot: string;
  device: DeviceKind;
  width: number;
  height: number;
  /** Exported whenever the project has screenshots of this device, unless it picks its own sizes. */
  standard?: boolean;
  /** A size of the same proportions. This one is that render scaled, so the two cannot differ in design. */
  from?: string;
}

/**
 * Portrait sizes App Store Connect accepts, one per screenshot slot. A set is designed once per device family,
 * and the first size of each family is the one it is designed at.
 */
export const TARGETS = {
  "iphone-6.9": { label: 'iPhone 6.9"', slot: "iPhone with Dynamic Island (large display)", device: "iphone", width: 1320, height: 2868, standard: true },
  "iphone-6.3": { label: 'iPhone 6.3"', slot: "iPhone with Dynamic Island (medium display)", device: "iphone", width: 1206, height: 2622, standard: true, from: "iphone-6.9" },
  "iphone-6.5": { label: 'iPhone 6.5"', slot: "iPhone with Face ID (large display)", device: "iphone", width: 1284, height: 2778, standard: true, from: "iphone-6.9" },
  "iphone-6.1": { label: 'iPhone 6.1"', slot: "iPhone with Face ID (medium display)", device: "iphone", width: 1170, height: 2532, standard: true, from: "iphone-6.9" },
  "iphone-5.5": { label: 'iPhone 5.5"', slot: "iPhone with Home Button (large display)", device: "iphone", width: 1242, height: 2208 },
  "iphone-4.7": { label: 'iPhone 4.7"', slot: "iPhone with Home Button (medium display)", device: "iphone", width: 750, height: 1334, from: "iphone-5.5" },
  "iphone-4": { label: 'iPhone 4"', slot: 'iPhone with Home Button (4" display)', device: "iphone", width: 640, height: 1136, from: "iphone-5.5" },
  "iphone-3.5": { label: 'iPhone 3.5"', slot: 'iPhone with Home Button (3.5" display)', device: "iphone", width: 640, height: 960 },
  "iphone-duo": { label: "iPhone Duo", slot: "iPhone Duo", device: "duo", width: 2007, height: 2853, standard: true },
  "iphone-duo-cover": { label: "iPhone Duo cover display", slot: "iPhone Duo", device: "duo", width: 1398, height: 2034 },
  "ipad-13": { label: 'iPad 13"', slot: 'iPad 13" display', device: "ipad", width: 2064, height: 2752, standard: true },
  "ipad-11": { label: 'iPad 11"', slot: 'iPad 11" display', device: "ipad", width: 1668, height: 2420, standard: true },
  "ipad-12.9": { label: 'iPad 12.9"', slot: 'iPad Pro (2nd generation) 12.9" display', device: "ipad", width: 2048, height: 2732, from: "ipad-13" },
  "ipad-10.5": { label: 'iPad 10.5"', slot: 'iPad 10.5" display', device: "ipad", width: 1668, height: 2224, from: "ipad-13" },
  "ipad-9.7": { label: 'iPad 9.7"', slot: 'iPad 9.7" display', device: "ipad", width: 1536, height: 2048, from: "ipad-13" },
} as const satisfies Record<string, Target>;

export type TargetId = keyof typeof TARGETS;

export const TARGET_IDS = Object.keys(TARGETS) as [TargetId, ...TargetId[]];

export function isTargetId(value: string): value is TargetId {
  return value in TARGETS;
}

/** The size a target is drawn at: itself, or the one it is a scaled copy of. */
export function sourceOf(id: TargetId): TargetId {
  const from = (TARGETS[id] as Target).from;
  return from && isTargetId(from) ? from : id;
}

/** The size a device family is designed and previewed at. */
export function designTarget(device: DeviceKind): TargetId {
  return TARGET_IDS.find((id) => TARGETS[id].device === device)!;
}

/** The sizes exported for the given device families when the project has not picked its own. */
export function standardTargets(devices: Iterable<DeviceKind>): TargetId[] {
  const wanted = new Set(devices);
  return TARGET_IDS.filter((id) => (TARGETS[id] as Target).standard && wanted.has(TARGETS[id].device));
}

/** Puts target ids in the order of the table and drops repeats. */
export function orderTargets(ids: Iterable<TargetId>): TargetId[] {
  const wanted = new Set(ids);
  return TARGET_IDS.filter((id) => wanted.has(id));
}

/** The two displays of an iPhone Duo. Their proportions are those of a tablet, so only the exact size tells them apart. */
const DUO_SCREENS = [
  [2007, 2853],
  [1398, 2034],
] as const;

/** Portrait phones are roughly 0.46 wide per unit of height, tablets 0.70 to 0.75. */
export function deviceKindOf(width: number, height: number): DeviceKind {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (DUO_SCREENS.some(([w, h]) => w === short && h === long)) return "duo";
  return short / long < 0.6 ? "iphone" : "ipad";
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
