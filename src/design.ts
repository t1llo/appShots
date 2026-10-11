/** Design vocabulary shared by the schema, the template and the design guide. */

import { ICON_GROUPS, ICON_IDS, type IconId } from "./icons.ts";

export { ICON_GROUPS, ICON_IDS, type IconId };

export const LAYOUTS = {
  "device-bottom": "Copy on top, device below and bleeding off the bottom edge. The classic store slide.",
  "device-top": "Device bleeding off the top edge, copy underneath.",
  "device-center": "Copy on top, the whole device visible below it.",
  tilted: "Like device-bottom, with the device rotated and pushed off-centre for energy.",
  closeup: "Like device-bottom, with the device larger than the canvas, so the top of the screen reads as a detail shot.",
  floating: "Copy on top, the whole device below it, turned in perspective.",
  duo: "Two overlapping devices (screenshot in front, screenshot2 behind) under the copy.",
  "side-by-side": "Two upright devices next to each other (screenshot left, screenshot2 right), for two steps or a before and after.",
  trio: "Three devices fanned out: screenshot in front, screenshot2 and screenshot3 behind it left and right.",
  "device-right": "Copy in a column on the left, the device standing on the right and bleeding off that edge. Made for more text: a headline with a list of feature points under it.",
  "device-left": "The mirror of device-right: the device on the left, the copy column on the right.",
  hero: "Social-proof opener: big badges above the headline, device peeking in from the bottom. Without a screenshot it becomes a centred text slide.",
  features: "No device: the copy on top and the slide's feature cards below it, each an icon or a big figure with a title. The card style picks the look.",
} as const;

export type LayoutId = keyof typeof LAYOUTS;
export const LAYOUT_IDS = Object.keys(LAYOUTS) as [LayoutId, ...LayoutId[]];

/** How many screenshots a layout shows: screenshot, screenshot2, screenshot3 in that order. */
export const LAYOUT_SHOTS: Record<LayoutId, number> = {
  "device-bottom": 1,
  "device-top": 1,
  "device-center": 1,
  tilted: 1,
  closeup: 1,
  floating: 1,
  duo: 2,
  "side-by-side": 2,
  trio: 3,
  "device-right": 1,
  "device-left": 1,
  hero: 1,
  features: 0,
};

/** Layouts that stand the copy in a column beside the device instead of above or below it. */
export const SIDE_LAYOUTS: readonly LayoutId[] = ["device-right", "device-left"];

/** Looks of the cards on a features slide. */
export const FEATURE_STYLES = {
  bento: "Tiles of mixed sizes, like the summary slide of a keynote. The first feature gets the large tile.",
  grid: "Even tiles side by side, icon above the title.",
  cards: "One wide card per feature, icon on the left, title and detail beside it.",
  list: "Plain rows without cards, like a What's New screen.",
} as const;

export type FeatureStyleId = keyof typeof FEATURE_STYLES;

/** Looks of the feature points a slide shows with its copy when it has a device as well. */
export const POINT_STYLES = {
  list: "Rows of an icon, a title and one line of detail.",
  cards: "The same rows, each on a card.",
  grid: "Cards two across, where the copy is wide enough for them.",
  chips: "Small pills with an icon and the title only, in rows.",
} as const;

export type PointStyleId = keyof typeof POINT_STYLES;
/** One field holds either kind of style: a features slide reads chips as list, and feature points read bento as list. */
export const FEATURE_STYLE_IDS = [...new Set([...Object.keys(FEATURE_STYLES), ...Object.keys(POINT_STYLES)])] as [FeatureStyleId | PointStyleId, ...(FeatureStyleId | PointStyleId)[]];

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
  rating: "A card with the score large on the left, the star row and a subtitle beside it. The App Store rating look.",
  review: "A card with a star row, a short quote as the title and who said it as the subtitle.",
} as const;

export type BadgeType = keyof typeof BADGE_TYPES;
export const BADGE_TYPE_IDS = Object.keys(BADGE_TYPES) as [BadgeType, ...BadgeType[]];

/** What colours a badge's wreath, stars and icon. */
export const BADGE_TONES = {
  plain: "The wreath in the text colour, stars and icon in the accent colour (gold stars without one).",
  gold: "Wreath, stars and icon in a metallic gold. The award look.",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;
export const BADGE_TONE_IDS = Object.keys(BADGE_TONES) as [BadgeTone, ...BadgeTone[]];

/** How a slide's row of icons and logos is drawn. */
export const ICON_ROW_STYLES = {
  tiles: "Each icon on a rounded square, like a row of app icons.",
  circles: "Each icon on a round disc.",
  plain: "The icons alone, side by side. The logo strip look.",
} as const;

export type IconRowStyle = keyof typeof ICON_ROW_STYLES;
export const ICON_ROW_STYLE_IDS = Object.keys(ICON_ROW_STYLES) as [IconRowStyle, ...IconRowStyle[]];

/** What colours the icons of a row. */
export const ICON_ROW_TONES = {
  brand: "Brand icons in the service's own colours, such as YouTube's red; every other icon in the accent colour.",
  accent: "Every icon in the accent colour.",
  text: "Every icon in the text colour, for a quiet strip of logos.",
} as const;

export type IconRowTone = keyof typeof ICON_ROW_TONES;
export const ICON_ROW_TONE_IDS = Object.keys(ICON_ROW_TONES) as [IconRowTone, ...IconRowTone[]];

/** Icon height in canvas units. A row with many icons shrinks them until it fits on one line. */
export const ICON_ROW_SIZES = { small: 8, medium: 11, large: 15 } as const;

export type IconRowSize = keyof typeof ICON_ROW_SIZES;
export const ICON_ROW_SIZE_IDS = Object.keys(ICON_ROW_SIZES) as [IconRowSize, ...IconRowSize[]];

/**
 * The colours a service is known by: what its tile is filled with (several colours make a gradient from the
 * bottom left) and the colour of the mark on it. Alone, without a tile, the mark takes the first `ink` colour.
 */
export const BRAND_COLORS: Partial<Record<IconId, { fill: string[]; mark: string; ink?: string }>> = {
  youtube: { fill: ["#FF0000"], mark: "#FFFFFF" },
  instagram: { fill: ["#FEDA75", "#FA7E1E", "#D62976", "#962FBF", "#4F5BD5"], mark: "#FFFFFF", ink: "#D62976" },
  tiktok: { fill: ["#010101"], mark: "#FFFFFF" },
  facebook: { fill: ["#0866FF"], mark: "#FFFFFF" },
  snapchat: { fill: ["#FFFC00"], mark: "#000000" },
  x: { fill: ["#000000"], mark: "#FFFFFF" },
  threads: { fill: ["#000000"], mark: "#FFFFFF" },
  reddit: { fill: ["#FF4500"], mark: "#FFFFFF" },
  whatsapp: { fill: ["#25D366"], mark: "#FFFFFF" },
  telegram: { fill: ["#26A5E4"], mark: "#FFFFFF" },
  messenger: { fill: ["#00B2FF", "#006AFF"], mark: "#FFFFFF", ink: "#0084FF" },
  discord: { fill: ["#5865F2"], mark: "#FFFFFF" },
  twitch: { fill: ["#9146FF"], mark: "#FFFFFF" },
  pinterest: { fill: ["#E60023"], mark: "#FFFFFF" },
  linkedin: { fill: ["#0A66C2"], mark: "#FFFFFF" },
  spotify: { fill: ["#1ED760"], mark: "#000000" },
  slack: { fill: ["#4A154B"], mark: "#FFFFFF" },
  notion: { fill: ["#FFFFFF"], mark: "#000000", ink: "#000000" },
  github: { fill: ["#181717"], mark: "#FFFFFF" },
  twitter: { fill: ["#1DA1F2"], mark: "#FFFFFF" },
  mastodon: { fill: ["#6364FF"], mark: "#FFFFFF" },
  tumblr: { fill: ["#001935"], mark: "#FFFFFF" },
  medium: { fill: ["#000000"], mark: "#FFFFFF" },
  patreon: { fill: ["#FF424D"], mark: "#FFFFFF" },
  wechat: { fill: ["#07C160"], mark: "#FFFFFF" },
  soundcloud: { fill: ["#FF5500"], mark: "#FFFFFF" },
  "apple-podcasts": { fill: ["#832BC1", "#D56EFC"], mark: "#FFFFFF", ink: "#9933CC" },
  steam: { fill: ["#171A21"], mark: "#FFFFFF" },
  meta: { fill: ["#0668E1"], mark: "#FFFFFF" },
  apple: { fill: ["#000000"], mark: "#FFFFFF" },
  google: { fill: ["#FFFFFF"], mark: "#4285F4", ink: "#4285F4" },
  android: { fill: ["#3DDC84"], mark: "#073042" },
  "app-store": { fill: ["#1D6FF2", "#1AC8FC"], mark: "#FFFFFF", ink: "#0D84F5" },
  "google-play": { fill: ["#FFFFFF"], mark: "#01875F", ink: "#01875F" },
  "google-drive": { fill: ["#FFFFFF"], mark: "#1A73E8", ink: "#1A73E8" },
  dropbox: { fill: ["#0061FF"], mark: "#FFFFFF" },
  figma: { fill: ["#1E1E1E"], mark: "#FFFFFF" },
  amazon: { fill: ["#232F3E"], mark: "#FF9900", ink: "#FF9900" },
  paypal: { fill: ["#003087"], mark: "#FFFFFF" },
  stripe: { fill: ["#635BFF"], mark: "#FFFFFF" },
  openai: { fill: ["#000000"], mark: "#FFFFFF" },
  windows: { fill: ["#0078D4"], mark: "#FFFFFF" },
  teams: { fill: ["#5059C9"], mark: "#FFFFFF" },
};
