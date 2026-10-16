/**
 * The App Store's app preview videos: the displays one is made for, the pixel size Apple takes for each, the
 * device its footage is recorded on and the placement group of App Store Connect it goes into. The server draws the
 * layers of a preview at these sizes; the CLI cuts and checks the video against the same table, mirrored in
 * cli/src/video/specs.mjs because it cannot import TypeScript. A test keeps the two equal.
 */

export type PreviewDisplay = "iphone" | "iphone-5.5" | "iphone-4.7" | "ipad" | "ipad-9.7" | "mac";

export type PreviewOrientation = "portrait" | "landscape";

export interface PreviewSpec {
  label: string;
  /** Width and height upright. A Mac preview is landscape only. */
  portrait: readonly [number, number] | null;
  landscape: readonly [number, number];
  /** The model of the device registry (domain/devices.ts) the footage is recorded on: smaller displays reuse a larger one's. */
  record: string;
  /** The placement group of App Store Connect, as a hint for a dry run. The upload matches the real one from Apple's reference data. */
  group: string;
  /** Made unless asked otherwise. The others are only for apps that still target those devices. */
  standard: boolean;
}

export const PREVIEW_SPECS = {
  iphone: { label: "iPhone", portrait: [886, 1920], landscape: [1920, 886], record: "iphone-6.9", group: "iPhone with Dynamic Island (large display)", standard: true },
  "iphone-5.5": { label: 'iPhone 5.5"', portrait: [1080, 1920], landscape: [1920, 1080], record: "iphone-6.9", group: "iPhone with Home Button (large display)", standard: false },
  "iphone-4.7": { label: 'iPhone 4.7"', portrait: [750, 1334], landscape: [1334, 750], record: "iphone-6.9", group: "iPhone with Home Button (medium display)", standard: false },
  ipad: { label: "iPad", portrait: [1200, 1600], landscape: [1600, 1200], record: "ipad-13", group: 'iPad 13" display', standard: true },
  "ipad-9.7": { label: 'iPad 9.7"', portrait: [900, 1200], landscape: [1200, 900], record: "ipad-13", group: 'iPad 9.7" display', standard: false },
  mac: { label: "Mac", portrait: null, landscape: [1920, 1080], record: "mac", group: "Mac", standard: true },
} as const satisfies Record<PreviewDisplay, PreviewSpec>;

export const PREVIEW_DISPLAYS = Object.keys(PREVIEW_SPECS) as [PreviewDisplay, ...PreviewDisplay[]];

/** What every preview has to be, whatever its display. */
export const PREVIEW_RULES = {
  fps: 30,
  minSeconds: 15,
  maxSeconds: 30,
  /** 500 MB, as App Store Connect counts it. */
  maxBytes: 524_288_000,
} as const;

export function isPreviewDisplay(value: unknown): value is PreviewDisplay {
  return typeof value === "string" && Object.hasOwn(PREVIEW_SPECS, value);
}

/** The size of a display's preview in an orientation. Null where it has none: a Mac preview is never portrait. */
export function previewSize(display: PreviewDisplay, orientation: PreviewOrientation): readonly [number, number] | null {
  const spec: PreviewSpec = PREVIEW_SPECS[display];
  return orientation === "portrait" ? spec.portrait : spec.landscape;
}

/**
 * The display a video of this size is for, or null when Apple takes it for none. 1920×1080 is both a Mac preview and a
 * landscape one of the 5.5-inch iPhone: the device settles it, and without one the display made by default wins.
 */
export function displayForSize(width: number, height: number, device?: "iphone" | "ipad" | "mac"): PreviewDisplay | null {
  const matches = PREVIEW_DISPLAYS.filter((display) => {
    const spec: PreviewSpec = PREVIEW_SPECS[display];
    return [spec.portrait, spec.landscape].some((size) => size && size[0] === width && size[1] === height);
  });
  const fitting = device ? matches.filter((display) => previewDevice(display) === device) : matches;
  return fitting.find((display) => PREVIEW_SPECS[display].standard) ?? fitting[0] ?? null;
}

/** The device family whose slide set a display's captions are taken from. */
export const previewDevice = (display: PreviewDisplay): "iphone" | "ipad" | "mac" => (display.startsWith("ipad") ? "ipad" : display === "mac" ? "mac" : "iphone");
