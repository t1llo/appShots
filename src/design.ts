/** Design vocabulary shared by the schema, the template and the design guide. */

export const LAYOUTS = {
  "device-bottom": "Copy on top, device below and bleeding off the bottom edge. The classic store slide.",
  "device-top": "Device bleeding off the top edge, copy underneath.",
  "device-center": "Copy on top, the whole device visible below it.",
  tilted: "Like device-bottom, with the device rotated and pushed off-centre for energy.",
  duo: "Two overlapping devices (screenshot in front, screenshot2 behind) under the copy.",
  hero: "Social-proof opener: big badges above the headline, device peeking in from the bottom. Without a screenshot it becomes a centred text slide.",
} as const;

export type LayoutId = keyof typeof LAYOUTS;
export const LAYOUT_IDS = Object.keys(LAYOUTS) as [LayoutId, ...LayoutId[]];

/** Layouts for the wide header and search results assets, which are composed around a small safe area. */
export const CREATIVE_LAYOUTS = {
  fan: "Copy at the top of the safe area, up to five devices fanned out below it and bleeding off the bottom edge. The first screenshot takes the centre.",
  sides: "Copy in the middle of the safe area, up to four devices standing left and right of it. With one screenshot the device stands on the right.",
  wall: "Copy over a dimmed, tilted wall of bare screenshots that fills the whole canvas.",
} as const;

export type CreativeLayoutId = keyof typeof CREATIVE_LAYOUTS;
export const CREATIVE_LAYOUT_IDS = Object.keys(CREATIVE_LAYOUTS) as [CreativeLayoutId, ...CreativeLayoutId[]];

export interface FontDef {
  family: string;
  pkg: string;
  css: string;
  /** Weight used for headlines; variable fonts clamp to their own range. */
  weight: number;
  tracking: string;
  /** Optical compensation so light or narrow faces read as large as the grotesques. */
  scale: number;
  note: string;
}

export const FONTS = {
  inter: { family: "Inter Variable", pkg: "@fontsource-variable/inter", css: "wght.css", weight: 800, tracking: "-0.035em", scale: 1, note: "Neutral, closest to the system look" },
  manrope: { family: "Manrope Variable", pkg: "@fontsource-variable/manrope", css: "wght.css", weight: 800, tracking: "-0.03em", scale: 1, note: "Rounded geometric sans" },
  "plus-jakarta-sans": { family: "Plus Jakarta Sans Variable", pkg: "@fontsource-variable/plus-jakarta-sans", css: "wght.css", weight: 800, tracking: "-0.03em", scale: 1, note: "Friendly modern sans" },
  sora: { family: "Sora Variable", pkg: "@fontsource-variable/sora", css: "wght.css", weight: 700, tracking: "-0.035em", scale: 0.94, note: "Wide, techy sans" },
  "space-grotesk": { family: "Space Grotesk Variable", pkg: "@fontsource-variable/space-grotesk", css: "wght.css", weight: 700, tracking: "-0.035em", scale: 1, note: "Quirky grotesk" },
  "bricolage-grotesque": { family: "Bricolage Grotesque Variable", pkg: "@fontsource-variable/bricolage-grotesque", css: "wght.css", weight: 800, tracking: "-0.03em", scale: 1.02, note: "Expressive display grotesk" },
  fraunces: { family: "Fraunces Variable", pkg: "@fontsource-variable/fraunces", css: "wght.css", weight: 700, tracking: "-0.025em", scale: 1, note: "Soft, characterful serif" },
  "instrument-serif": { family: "Instrument Serif", pkg: "@fontsource/instrument-serif", css: "400.css", weight: 400, tracking: "-0.015em", scale: 1.2, note: "Elegant condensed serif, regular weight only" },
} as const satisfies Record<string, FontDef>;

export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as [FontId, ...FontId[]];

export interface BackgroundDef {
  type: "solid" | "gradient" | "mesh";
  colors: string[];
  angle?: number;
  noise?: number;
}

/**
 * In a mesh the first colour is the base and the rest are soft blobs laid over it.
 * Presets stay muted and close to one hue so the screenshot is the most colourful thing on a slide.
 */
export const BACKGROUNDS = {
  midnight: { type: "mesh", colors: ["#0B1020", "#1A2B52", "#2A2A5E", "#14364F"] },
  aurora: { type: "mesh", colors: ["#071917", "#0F4A44", "#1C5140", "#173F52"] },
  ember: { type: "mesh", colors: ["#170D0B", "#6E2A20", "#7A4424", "#47201A"] },
  ocean: { type: "gradient", colors: ["#3F7FB8", "#2A5590", "#182446"], angle: 165 },
  sunset: { type: "gradient", colors: ["#CF7755", "#B4506C", "#5E3672"], angle: 160 },
  candy: { type: "gradient", colors: ["#F6C6DC", "#DCCBF3", "#C6D8F5"], angle: 150 },
  forest: { type: "gradient", colors: ["#1F5238", "#0A2619"], angle: 170 },
  graphite: { type: "gradient", colors: ["#3F3F46", "#111113"], angle: 170 },
  peach: { type: "mesh", colors: ["#FFF7F1", "#FFDCC8", "#FBD5D2", "#FFEBCB"] },
  mint: { type: "mesh", colors: ["#F3FBF7", "#CBEEDC", "#CFE8EE", "#E1F1D0"] },
  lavender: { type: "mesh", colors: ["#F8F7FF", "#E3DEFA", "#EFDCEC", "#DAE3F8"] },
  sky: { type: "gradient", colors: ["#EAF4FC", "#CFE4F7", "#B4D2F0"], angle: 170 },
  paper: { type: "solid", colors: ["#F6F3EC"] },
  ink: { type: "solid", colors: ["#0B0B0F"] },
} as const satisfies Record<string, BackgroundDef>;

export type BackgroundId = keyof typeof BACKGROUNDS;

export const DEVICE_COLORS = {
  black: ["#55555A", "#1B1B1E", "#343438", "#0E0E10"],
  silver: ["#F6F6F4", "#C6C6C4", "#EDEDEB", "#B4B4B2"],
  natural: ["#BDB6AB", "#8C857A", "#ABA499", "#787167"],
  gold: ["#EAD2B4", "#C0A07C", "#DDC29F", "#AB8A66"],
  blue: ["#62779A", "#2D3D5A", "#4A5D7E", "#232F44"],
  orange: ["#F29257", "#C55C20", "#E67C3C", "#AC4E19"],
} as const;

export type DeviceColorId = keyof typeof DEVICE_COLORS;
export const DEVICE_COLOR_IDS = Object.keys(DEVICE_COLORS) as [DeviceColorId, ...DeviceColorId[]];

export const BADGE_TYPES = {
  laurel: "Laurel wreath around a title and subtitle. Add `stars` or `icon` for a top line. The award look.",
  stars: "A row of stars over a title and subtitle, no wreath.",
  icon: "An icon (trophy by default) next to a title and subtitle.",
  pill: "A small capsule label with an optional icon.",
} as const;

export type BadgeType = keyof typeof BADGE_TYPES;
export const BADGE_TYPE_IDS = Object.keys(BADGE_TYPES) as [BadgeType, ...BadgeType[]];

export const ICON_IDS = ["trophy", "crown", "medal", "star", "heart", "download", "bolt", "shield", "check"] as const;
export type IconId = (typeof ICON_IDS)[number];
