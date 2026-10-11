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
