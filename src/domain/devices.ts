/**
 * The devices appShots knows: the families a set is designed for, the display classes App Store Connect groups
 * screenshots by with the sizes it accepts for each, the frames they are drawn in, and the sizes a set is exported
 * at. Everything else about devices is read from here.
 */

export type DeviceKind = "iphone" | "duo" | "ipad" | "mac";

/** The device families a set is designed for, in the order they are offered. */
export const DEVICE_KINDS = ["iphone", "duo", "ipad", "mac"] as const satisfies DeviceKind[];

export const DEVICE_LABELS: Record<DeviceKind, string> = { iphone: "iPhone", duo: "iPhone Duo", ipad: "iPad", mac: "Mac" };

export function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === "string" && (DEVICE_KINDS as readonly string[]).includes(value);
}

/** Which device's screenshot stands in when a name has none for the device asked for: the one closest in shape first. */
export const STAND_INS: Record<DeviceKind, readonly DeviceKind[]> = {
  iphone: ["iphone", "duo", "ipad", "mac"],
  duo: ["duo", "ipad", "iphone", "mac"],
  ipad: ["ipad", "duo", "iphone", "mac"],
  mac: ["mac", "ipad", "duo", "iphone"],
};

// ---------------------------------------------------------------- frames

export type FrameId = "iphone" | "iphone-notch" | "iphone-home" | "duo" | "ipad" | "ipad-home" | "mac";

/** A button on one of the long edges of a device, from its top: where it starts and how long it is, in percent of the device's height. */
export interface SideButton {
  side: "l" | "r";
  top: number;
  length: number;
}

/** Frame geometry as fractions of the device width, with the device upright. */
export interface Frame {
  device: DeviceKind;
  outer: number;
  band: number;
  bezel: number;
  /** The bezel above and below the screen where it is deeper than at the sides: the forehead and chin of a device with a home button. */
  bezelY?: number;
  inner: number;
  aspect: [number, number];
  /** Corner radius of the screenshot shown without a frame. */
  bare: number;
  /** The proportions, width by height, of the upright screenshots the frame can plausibly hold. */
  fits: [number, number];
  /** A laptop's lid is narrower than the base it stands on, which is the full device width. */
  lid?: number;
  /** How tall that base is. */
  base?: number;
  /** What the hardware cuts out of the top of the screen. */
  cutout: "island" | "notch" | "none";
  /** The diameter of the round home button under the screen. */
  home?: number;
  buttons: readonly SideButton[];
  /** The colour the frame is drawn in unless another is asked for. */
  color: "black" | "silver";
}

const IPHONE_BUTTONS: readonly SideButton[] = [
  { side: "l", top: 17.5, length: 3.2 },
  { side: "l", top: 24.5, length: 6.2 },
  { side: "l", top: 32.5, length: 6.2 },
  { side: "r", top: 28, length: 10 },
];

/**
 * The frames, measured off the real hardware. The Duo is its unfolded inner display in a plain thin frame, with no
 * camera or hinge drawn. The Mac is a MacBook seen from the front: the lid with its display, and the front edge of
 * the base under it. A phone with a home button has a square screen between a deep forehead and chin.
 */
export const FRAMES: Record<FrameId, Frame> = {
  iphone: { device: "iphone", outer: 0.165, band: 0.011, bezel: 0.023, inner: 0.131, aspect: [1320, 2868], bare: 0.085, fits: [0.44, 0.58], cutout: "island", buttons: IPHONE_BUTTONS, color: "black" },
  "iphone-notch": { device: "iphone", outer: 0.165, band: 0.011, bezel: 0.023, inner: 0.131, aspect: [1284, 2778], bare: 0.085, fits: [0.44, 0.58], cutout: "notch", buttons: IPHONE_BUTTONS, color: "black" },
  "iphone-home": {
    device: "iphone",
    outer: 0.15,
    band: 0.011,
    bezel: 0.053,
    bezelY: 0.235,
    inner: 0,
    aspect: [1242, 2208],
    bare: 0,
    fits: [0.5, 0.7],
    cutout: "none",
    home: 0.15,
    buttons: [
      { side: "l", top: 13, length: 3.6 },
      { side: "l", top: 20, length: 6.4 },
      { side: "l", top: 28.5, length: 6.4 },
      { side: "r", top: 21, length: 7 },
    ],
    color: "black",
  },
  duo: { device: "duo", outer: 0.082, band: 0.007, bezel: 0.019, inner: 0.058, aspect: [2007, 2853], bare: 0.045, fits: [0.64, 0.76], cutout: "none", buttons: [], color: "black" },
  ipad: { device: "ipad", outer: 0.058, band: 0.006, bezel: 0.034, inner: 0.024, aspect: [2064, 2752], bare: 0.03, fits: [0.66, 0.78], cutout: "none", buttons: [], color: "black" },
  "ipad-home": {
    device: "ipad",
    outer: 0.058,
    band: 0.006,
    bezel: 0.058,
    bezelY: 0.121,
    inner: 0,
    aspect: [1536, 2048],
    bare: 0,
    fits: [0.66, 0.78],
    cutout: "none",
    home: 0.062,
    buttons: [],
    color: "black",
  },
  mac: { device: "mac", outer: 0.019, band: 0.0024, bezel: 0.0105, inner: 0.0075, aspect: [2880, 1800], bare: 0.011, fits: [1.45, 1.85], lid: 0.83, base: 0.019, cutout: "none", buttons: [], color: "silver" },
};

/** The frame a family is drawn in when nothing tells which of its models a screenshot is from. */
export const DEFAULT_FRAMES: Record<DeviceKind, FrameId> = { iphone: "iphone", duo: "duo", ipad: "ipad", mac: "mac" };

// ---------------------------------------------------------------- models

/**
 * One display class of App Store Connect: the models whose screenshots go into the same slot. Its sizes are the
 * ones Apple accepts for the slot, in both orientations as Apple lists them; `native` adds sizes its models take
 * screenshots at that Apple files under it without accepting them as they are.
 */
export interface DeviceModel {
  label: string;
  device: DeviceKind;
  /** The screenshot slot of App Store Connect, as it is named there. */
  slot: string;
  /** The screenshot display type of the App Store Connect API. A slot without one is filled in by hand. */
  display?: string;
  sizes: readonly (readonly [number, number])[];
  native?: readonly (readonly [number, number])[];
  frame: FrameId;
}

export const MODELS = {
  "iphone-6.9": {
    label: 'iPhone 6.9"',
    device: "iphone",
    slot: "iPhone with Dynamic Island (large display)",
    display: "APP_IPHONE_67",
    sizes: [[1260, 2736], [2736, 1260], [1290, 2796], [2796, 1290], [1320, 2868], [2868, 1320]],
    frame: "iphone",
  },
  "iphone-6.3": {
    label: 'iPhone 6.3"',
    device: "iphone",
    slot: "iPhone with Dynamic Island (medium display)",
    display: "APP_IPHONE_61",
    sizes: [[1179, 2556], [2556, 1179], [1206, 2622], [2622, 1206]],
    frame: "iphone",
  },
  "iphone-6.5": {
    label: 'iPhone 6.5"',
    device: "iphone",
    slot: "iPhone with Face ID (large display)",
    display: "APP_IPHONE_65",
    sizes: [[1284, 2778], [2778, 1284], [1242, 2688], [2688, 1242]],
    native: [[828, 1792]],
    frame: "iphone-notch",
  },
  "iphone-6.1": {
    label: 'iPhone 6.1"',
    device: "iphone",
    slot: "iPhone with Face ID (medium display)",
    display: "APP_IPHONE_58",
    sizes: [[1170, 2532], [2532, 1170], [1125, 2436], [2436, 1125], [1080, 2340], [2340, 1080]],
    frame: "iphone-notch",
  },
  "iphone-5.5": {
    label: 'iPhone 5.5"',
    device: "iphone",
    slot: "iPhone with Home Button (large display)",
    display: "APP_IPHONE_55",
    sizes: [[1242, 2208], [2208, 1242]],
    native: [[1080, 1920]],
    frame: "iphone-home",
  },
  "iphone-4.7": {
    label: 'iPhone 4.7"',
    device: "iphone",
    slot: "iPhone with Home Button (medium display)",
    display: "APP_IPHONE_47",
    sizes: [[750, 1334], [1334, 750]],
    frame: "iphone-home",
  },
  "iphone-4": {
    label: 'iPhone 4"',
    device: "iphone",
    slot: 'iPhone with Home Button (4" display)',
    display: "APP_IPHONE_40",
    sizes: [[640, 1096], [640, 1136], [1136, 600], [1136, 640]],
    frame: "iphone-home",
  },
  "iphone-3.5": {
    label: 'iPhone 3.5"',
    device: "iphone",
    slot: 'iPhone with Home Button (3.5" display)',
    display: "APP_IPHONE_35",
    sizes: [[640, 920], [640, 960], [960, 600], [960, 640]],
    frame: "iphone-home",
  },
  "iphone-duo": {
    label: "iPhone Duo",
    device: "duo",
    slot: "iPhone Duo",
    sizes: [[2007, 2853], [2853, 2007]],
    frame: "duo",
  },
  "iphone-duo-cover": {
    label: "iPhone Duo cover display",
    device: "duo",
    slot: "iPhone Duo",
    sizes: [[1398, 2034], [2034, 1398]],
    frame: "duo",
  },
  "ipad-13": {
    label: 'iPad 13"',
    device: "ipad",
    slot: 'iPad 13" display',
    display: "APP_IPAD_PRO_3GEN_129",
    sizes: [[2064, 2752], [2752, 2064], [2048, 2732], [2732, 2048]],
    frame: "ipad",
  },
  "ipad-11": {
    label: 'iPad 11"',
    device: "ipad",
    slot: 'iPad 11" display',
    display: "APP_IPAD_PRO_3GEN_11",
    sizes: [[1488, 2266], [2266, 1488], [1668, 2420], [2420, 1668], [1668, 2388], [2388, 1668], [1640, 2360], [2360, 1640]],
    frame: "ipad",
  },
  "ipad-12.9": {
    label: 'iPad 12.9"',
    device: "ipad",
    slot: 'iPad Pro (2nd generation) 12.9" display',
    display: "APP_IPAD_PRO_129",
    sizes: [[2048, 2732], [2732, 2048]],
    frame: "ipad-home",
  },
  "ipad-10.5": {
    label: 'iPad 10.5"',
    device: "ipad",
    slot: 'iPad 10.5" display',
    display: "APP_IPAD_105",
    sizes: [[1668, 2224], [2224, 1668]],
    native: [[1620, 2160]],
    frame: "ipad-home",
  },
  "ipad-9.7": {
    label: 'iPad 9.7"',
    device: "ipad",
    slot: 'iPad 9.7" display',
    display: "APP_IPAD_97",
    sizes: [[1536, 2008], [1536, 2048], [2048, 1496], [2048, 1536], [768, 1004], [768, 1024], [1024, 748], [1024, 768]],
    frame: "ipad-home",
  },
  mac: {
    label: "Mac",
    device: "mac",
    slot: "Mac",
    display: "APP_DESKTOP",
    sizes: [[1280, 800], [1440, 900], [2560, 1600], [2880, 1800]],
    frame: "mac",
  },
} as const satisfies Record<string, DeviceModel>;

export type ModelId = keyof typeof MODELS;

export const MODEL_IDS = Object.keys(MODELS) as [ModelId, ...ModelId[]];

/**
 * The display class a screenshot of this size is from, or none when the size is not one Apple lists. An iPhone, a
 * Duo or an iPad screenshot counts turned either way; a Mac's is landscape only. Where two classes share a size, the
 * first one listed, the current hardware, wins.
 */
export function modelOf(width: number, height: number): ModelId | undefined {
  return MODEL_IDS.find((id) => {
    const model: DeviceModel = MODELS[id];
    return [...model.sizes, ...(model.native ?? [])].some(([w, h]) => (w === width && h === height) || (model.device !== "mac" && w === height && h === width));
  });
}

/**
 * The family a screenshot belongs to. A size Apple lists decides it. Otherwise a picture wider than it is tall is a
 * Mac's, and a portrait one goes by its proportions: phones are roughly 0.46 wide per unit of height, tablets 0.70 to 0.75.
 */
export function deviceKindOf(width: number, height: number): DeviceKind {
  const model = modelOf(width, height);
  if (model) return MODELS[model].device;
  if (width > height) return "mac";
  return width / height < 0.6 ? "iphone" : "ipad";
}

/**
 * The frame a screenshot is drawn in when it is shown as a device of the given family. Its own size tells its model.
 * A phone screenshot of a size Apple does not list, but as stubby as one with a home button, gets that frame.
 */
export function frameOf(device: DeviceKind, width: number, height: number): FrameId {
  const model = modelOf(width, height);
  if (model && MODELS[model].device === device) return MODELS[model].frame;
  if (device === "iphone" && Math.min(width, height) / Math.max(width, height) >= 0.53) return "iphone-home";
  return DEFAULT_FRAMES[device];
}

// ---------------------------------------------------------------- export sizes

export interface Target {
  label: string;
  /** The screenshot slot of App Store Connect this size is uploaded to, as it is named there. */
  slot: string;
  device: DeviceKind;
  width: number;
  height: number;
  /** Exported whenever the project has screenshots of this device, unless it picks its own sizes. */
  standard?: boolean;
  /**
   * The size this one is a resized copy of, so the two cannot differ in design. The two are close in shape, not
   * always equal: what the resize does with the difference is up to the renderer.
   */
  from?: string;
}

interface Size {
  model: ModelId;
  width: number;
  height: number;
  standard?: boolean;
  from?: string;
  /** Where the model's label does not tell the sizes of one slot apart. */
  label?: string;
}

/**
 * The sizes a set is exported at, one per screenshot slot: portrait for the iPhone and the iPad, 16:10 for the
 * Mac. A set is designed once per device family, and the first size of each family is the one it is designed at.
 */
const SIZES = {
  "iphone-6.9": { model: "iphone-6.9", width: 1320, height: 2868, standard: true },
  "iphone-6.3": { model: "iphone-6.3", width: 1206, height: 2622, standard: true, from: "iphone-6.9" },
  "iphone-6.5": { model: "iphone-6.5", width: 1284, height: 2778, standard: true, from: "iphone-6.9" },
  "iphone-6.1": { model: "iphone-6.1", width: 1170, height: 2532, standard: true, from: "iphone-6.9" },
  "iphone-5.5": { model: "iphone-5.5", width: 1242, height: 2208 },
  "iphone-4.7": { model: "iphone-4.7", width: 750, height: 1334, from: "iphone-5.5" },
  "iphone-4": { model: "iphone-4", width: 640, height: 1136, from: "iphone-5.5" },
  "iphone-3.5": { model: "iphone-3.5", width: 640, height: 960 },
  "iphone-duo": { model: "iphone-duo", width: 2007, height: 2853, standard: true },
  "iphone-duo-cover": { model: "iphone-duo-cover", width: 1398, height: 2034 },
  "ipad-13": { model: "ipad-13", width: 2064, height: 2752, standard: true },
  "ipad-11": { model: "ipad-11", width: 1668, height: 2420, standard: true },
  "ipad-12.9": { model: "ipad-12.9", width: 2048, height: 2732, from: "ipad-13" },
  "ipad-10.5": { model: "ipad-10.5", width: 1668, height: 2224, from: "ipad-13" },
  "ipad-9.7": { model: "ipad-9.7", width: 1536, height: 2048, from: "ipad-13" },
  // The Mac App Store takes any one of its four sizes, so only the largest is exported unless the others are asked for.
  "mac-2880": { model: "mac", width: 2880, height: 1800, standard: true },
  "mac-2560": { model: "mac", width: 2560, height: 1600, from: "mac-2880", label: "Mac 2560" },
  "mac-1440": { model: "mac", width: 1440, height: 900, from: "mac-2880", label: "Mac 1440" },
  "mac-1280": { model: "mac", width: 1280, height: 800, from: "mac-2880", label: "Mac 1280" },
} as const satisfies Record<string, Size>;

export type TargetId = keyof typeof SIZES;

export const TARGET_IDS = Object.keys(SIZES) as [TargetId, ...TargetId[]];

/** The sizes App Store Connect accepts that a set is exported at, with the slot and the family of each. */
export const TARGETS = Object.fromEntries(
  TARGET_IDS.map((id) => {
    const size: Size = SIZES[id];
    const model: DeviceModel = MODELS[size.model];
    const target: Target = { label: size.label ?? model.label, slot: model.slot, device: model.device, width: size.width, height: size.height };
    if (size.standard) target.standard = true;
    if (size.from) target.from = size.from;
    return [id, target];
  }),
) as Record<TargetId, Target>;

/** The display class each export size is uploaded as. */
export const modelOfTarget = (id: TargetId): ModelId => SIZES[id].model;

export function isTargetId(value: string): value is TargetId {
  return Object.hasOwn(SIZES, value);
}

/** The size a target is drawn at: itself, or the one it is a scaled copy of. */
export function sourceOf(id: TargetId): TargetId {
  const from = TARGETS[id].from;
  return from && isTargetId(from) ? from : id;
}

/** The size a device family is designed and previewed at. */
export function designTarget(device: DeviceKind): TargetId {
  return TARGET_IDS.find((id) => TARGETS[id].device === device)!;
}

/** The sizes exported for the given device families when the project has not picked its own. */
export function standardTargets(devices: Iterable<DeviceKind>): TargetId[] {
  const wanted = new Set(devices);
  return TARGET_IDS.filter((id) => TARGETS[id].standard && wanted.has(TARGETS[id].device));
}

/** Puts target ids in the order of the table and drops repeats. */
export function orderTargets(ids: Iterable<TargetId>): TargetId[] {
  const wanted = new Set(ids);
  return TARGET_IDS.filter((id) => wanted.has(id));
}

/** The registry as the API describes it: per family, its display classes with their slots, sizes and frames. */
export function deviceCatalog() {
  return DEVICE_KINDS.map((id) => ({
    id,
    label: DEVICE_LABELS[id],
    models: MODEL_IDS.filter((model) => MODELS[model].device === id).map((model) => {
      const entry: DeviceModel = MODELS[model];
      return {
        id: model,
        label: entry.label,
        slot: entry.slot,
        display: entry.display ?? null,
        sizes: entry.sizes.map(([width, height]) => ({ width, height })),
        frame: entry.frame,
        targets: TARGET_IDS.filter((target) => SIZES[target].model === model),
      };
    }),
  }));
}
