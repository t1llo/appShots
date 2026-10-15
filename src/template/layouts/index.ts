/**
 * The slide layouts and what each needs to be drawn. This table is data only: the schema and the design guide read
 * it through design.ts, so it must not import anything that draws.
 */

/** How a layout draws the part of the slide that is not copy. */
export type LayoutFamily = "device" | "group" | "features" | "statement" | "stat" | "steps" | "reviews";

export interface LayoutDef {
  note: string;
  family: LayoutFamily;
  /** How many screenshots it shows: screenshot, screenshot2, screenshot3 in that order. */
  shots: number;
  /** Device width before the canvas and the frame are taken into account. */
  width: number;
  /** Share of the canvas height the copy block may take before the text starts shrinking. */
  copyMax: number;
  /** Stands the copy in a column beside the device instead of above or below it. */
  side?: boolean;
  /** Draws the slide's features itself. Every other layout lists them with the copy as feature points. */
  features?: boolean;
  /** The angle between its devices, in degrees, before a slide sets its own. */
  spread?: number;
}

export const LAYOUT_DEFS = {
  "device-bottom": {
    note: "Copy on top, device below and bleeding off the bottom edge. The classic store slide.",
    family: "device",
    shots: 1,
    width: 1,
    copyMax: 0.34,
  },
  "device-top": {
    note: "Device bleeding off the top edge, copy underneath.",
    family: "device",
    shots: 1,
    width: 1,
    copyMax: 0.34,
  },
  "device-center": {
    note: "Copy on top, the whole device visible below it.",
    family: "device",
    shots: 1,
    width: 1,
    copyMax: 0.36,
  },
  tilted: {
    note: "Like device-bottom, with the device rotated and pushed off-centre for energy.",
    family: "device",
    shots: 1,
    width: 1.04,
    copyMax: 0.34,
  },
  closeup: {
    note: "Like device-bottom, with the device larger than the canvas, so the top of the screen reads as a detail shot.",
    family: "device",
    shots: 1,
    width: 1.42,
    copyMax: 0.34,
  },
  floating: {
    note: "Copy on top, the whole device below it, turned in perspective.",
    family: "device",
    shots: 1,
    width: 0.92,
    copyMax: 0.36,
  },
  duo: {
    note: "Two overlapping devices (screenshot in front, screenshot2 behind) under the copy.",
    family: "group",
    shots: 2,
    width: 0.7,
    copyMax: 0.32,
    spread: 11,
  },
  "side-by-side": {
    note: "Two upright devices next to each other (screenshot left, screenshot2 right), for two steps or a before and after.",
    family: "group",
    shots: 2,
    width: 0.52,
    copyMax: 0.32,
    spread: 0,
  },
  trio: {
    note: "Three devices fanned out: screenshot in front, screenshot2 and screenshot3 behind it left and right.",
    family: "group",
    shots: 3,
    width: 0.6,
    copyMax: 0.32,
    spread: 14,
  },
  "device-right": {
    note: "Copy in a column on the left, the device standing on the right and bleeding off that edge. Made for more text: a headline with a list of feature points under it.",
    family: "device",
    shots: 1,
    width: 0.7,
    copyMax: 0.84,
    side: true,
  },
  "device-left": {
    note: "The mirror of device-right: the device on the left, the copy column on the right.",
    family: "device",
    shots: 1,
    width: 0.7,
    copyMax: 0.84,
    side: true,
  },
  hero: {
    note: "Social-proof opener: big badges above the headline, device peeking in from the bottom. Without a screenshot it becomes a centred text slide.",
    family: "device",
    shots: 1,
    width: 0.9,
    copyMax: 0.48,
  },
  features: {
    note: "No device: the copy on top and the slide's feature cards below it, each an icon, a big figure or a small picture with a title. The card style picks the look.",
    family: "features",
    shots: 0,
    width: 1,
    copyMax: 0.3,
    features: true,
  },
  statement: {
    note: "No device: the headline set very large, as the picture itself. For a claim, a promise or a question.",
    family: "statement",
    shots: 0,
    width: 1,
    // The headline of a statement is the slide, so it may take nearly all of it.
    copyMax: 0.84,
  },
  stat: {
    note: "No device: the slide's first feature as one giant figure with what it counts under it, and the next ones as a row of smaller figures.",
    family: "stat",
    shots: 0,
    width: 1,
    copyMax: 0.28,
    features: true,
  },
  steps: {
    note: "No device: the slide's features as numbered steps joined by a line, each a title and one line. A step can show a small picture of its screen.",
    family: "steps",
    shots: 0,
    width: 1,
    copyMax: 0.28,
    features: true,
  },
  reviews: {
    note: "No device: the slide's review badges as a wall of quote cards under the copy, each with its stars, the quote and who wrote it.",
    family: "reviews",
    shots: 0,
    width: 1,
    copyMax: 0.3,
  },
} as const satisfies Record<string, LayoutDef>;

export type LayoutId = keyof typeof LAYOUT_DEFS;

export const layoutDef = (id: LayoutId): LayoutDef => LAYOUT_DEFS[id];
