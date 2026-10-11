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

export const FONT_GROUPS = ["Sans", "Rounded", "Display", "Serif", "Handwritten", "Mono"] as const;
export type FontGroup = (typeof FONT_GROUPS)[number];

export interface FontDef {
  family: string;
  pkg: string;
  css: string;
  /** Weight used for headlines; variable fonts clamp to their own range. */
  weight: number;
  tracking: string;
  /** Optical compensation so light or narrow faces read as large as the grotesques. */
  scale: number;
  group: FontGroup;
  /** The face for small print, where this one only works large: a display, script or single-weight face. */
  body?: string;
  note: string;
}

const variable = (name: string, slug: string, weight: number, tracking: string, scale: number, group: FontGroup, note: string, body?: string): FontDef => ({
  family: `${name} Variable`,
  pkg: `@fontsource-variable/${slug}`,
  css: "wght.css",
  weight,
  tracking,
  scale,
  group,
  note,
  ...(body ? { body } : {}),
});
/** A face that comes in single weights. It sets headlines only, so it always names a face for the small print. */
const fixed = (name: string, slug: string, weight: number, tracking: string, scale: number, group: FontGroup, note: string, body = "inter"): FontDef => ({
  family: name,
  pkg: `@fontsource/${slug}`,
  css: `${weight}.css`,
  weight,
  tracking,
  scale,
  group,
  note,
  body,
});

export const FONTS = {
  inter: variable("Inter", "inter", 800, "-0.035em", 1, "Sans", "Neutral, closest to the system look"),
  manrope: variable("Manrope", "manrope", 800, "-0.03em", 1, "Sans", "Rounded geometric sans"),
  "plus-jakarta-sans": variable("Plus Jakarta Sans", "plus-jakarta-sans", 800, "-0.03em", 1, "Sans", "Friendly modern sans"),
  "dm-sans": variable("DM Sans", "dm-sans", 800, "-0.035em", 1, "Sans", "Low-contrast geometric sans"),
  outfit: variable("Outfit", "outfit", 700, "-0.025em", 1.02, "Sans", "Clean geometric sans"),
  figtree: variable("Figtree", "figtree", 800, "-0.03em", 1, "Sans", "Even and friendly"),
  geist: variable("Geist", "geist", 700, "-0.04em", 1, "Sans", "Sharp and technical"),
  onest: variable("Onest", "onest", 700, "-0.03em", 1, "Sans", "Calm humanist sans"),
  urbanist: variable("Urbanist", "urbanist", 800, "-0.025em", 1.03, "Sans", "Geometric with a soft edge"),
  lexend: variable("Lexend", "lexend", 700, "-0.035em", 0.94, "Sans", "Wide and very readable"),
  montserrat: variable("Montserrat", "montserrat", 800, "-0.03em", 0.95, "Sans", "The wide geometric classic"),
  rubik: variable("Rubik", "rubik", 700, "-0.025em", 1, "Sans", "Slightly rounded corners"),
  "red-hat-display": variable("Red Hat Display", "red-hat-display", 800, "-0.025em", 1, "Sans", "A sans with some character"),
  archivo: variable("Archivo", "archivo", 800, "-0.03em", 1, "Sans", "Sturdy grotesk"),
  sora: variable("Sora", "sora", 700, "-0.035em", 0.94, "Sans", "Wide, techy sans"),
  "space-grotesk": variable("Space Grotesk", "space-grotesk", 700, "-0.035em", 1, "Sans", "Quirky grotesk"),
  nunito: variable("Nunito", "nunito", 900, "-0.02em", 1, "Rounded", "Round and warm"),
  quicksand: variable("Quicksand", "quicksand", 700, "-0.02em", 1, "Rounded", "Light, round and airy"),
  fredoka: variable("Fredoka", "fredoka", 600, "-0.01em", 1, "Rounded", "Chunky and playful"),
  "baloo-2": variable("Baloo 2", "baloo-2", 800, "-0.01em", 1.06, "Rounded", "Bubbly, for games and children's apps"),
  "bricolage-grotesque": variable("Bricolage Grotesque", "bricolage-grotesque", 800, "-0.03em", 1.02, "Display", "Expressive display grotesk"),
  unbounded: variable("Unbounded", "unbounded", 700, "-0.03em", 0.8, "Display", "Very wide and loud", "inter"),
  syne: variable("Syne", "syne", 800, "-0.03em", 0.8, "Display", "Wide and eccentric", "inter"),
  oswald: variable("Oswald", "oswald", 700, "-0.01em", 1.12, "Display", "Condensed headline sans", "inter"),
  anton: fixed("Anton", "anton", 400, "0em", 1.14, "Display", "Tall condensed poster face"),
  "bebas-neue": fixed("Bebas Neue", "bebas-neue", 400, "0.01em", 1.26, "Display", "Condensed, capitals only"),
  "archivo-black": fixed("Archivo Black", "archivo-black", 400, "-0.02em", 0.95, "Display", "Heavy grotesk", "archivo"),
  fraunces: variable("Fraunces", "fraunces", 700, "-0.025em", 1, "Serif", "Soft, characterful serif"),
  "playfair-display": variable("Playfair Display", "playfair-display", 800, "-0.02em", 1, "Serif", "High-contrast editorial serif", "inter"),
  lora: variable("Lora", "lora", 700, "-0.02em", 1, "Serif", "Bookish serif"),
  newsreader: variable("Newsreader", "newsreader", 700, "-0.025em", 1.06, "Serif", "Newspaper serif"),
  cormorant: variable("Cormorant", "cormorant", 700, "-0.015em", 1.2, "Serif", "Fine, classical serif", "inter"),
  "roboto-slab": variable("Roboto Slab", "roboto-slab", 800, "-0.03em", 0.98, "Serif", "Slab serif"),
  "instrument-serif": fixed("Instrument Serif", "instrument-serif", 400, "-0.015em", 1.2, "Serif", "Elegant condensed serif"),
  "dm-serif-display": fixed("DM Serif Display", "dm-serif-display", 400, "-0.015em", 1.05, "Serif", "Elegant display serif", "dm-sans"),
  "young-serif": fixed("Young Serif", "young-serif", 400, "-0.02em", 1, "Serif", "Warm, sturdy serif"),
  caveat: variable("Caveat", "caveat", 700, "0em", 1.22, "Handwritten", "Quick handwriting", "inter"),
  pacifico: fixed("Pacifico", "pacifico", 400, "0em", 1, "Handwritten", "Brush script"),
  "permanent-marker": fixed("Permanent Marker", "permanent-marker", 400, "0em", 1, "Handwritten", "Marker pen"),
  "jetbrains-mono": variable("JetBrains Mono", "jetbrains-mono", 800, "-0.04em", 0.86, "Mono", "The code editor look"),
  "space-mono": fixed("Space Mono", "space-mono", 700, "-0.04em", 0.86, "Mono", "Retro typewriter mono"),
} as const satisfies Record<string, FontDef>;

export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as [FontId, ...FontId[]];

/**
 * Where a slide loads the font faces from. Browsers keep the stylesheet for a day, so its address changes
 * with the list of fonts: a font added in a new version shows at once instead of a day later.
 */
export const FONT_CSS_URL = `/fonts/fonts.css?v=${[...FONT_IDS.join(",")].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0).toString(36)}`;

/** The face a font's small print is set in: itself, unless it only works large. */
export function bodyFont(id: FontId): FontDef {
  const font: FontDef = FONTS[id];
  return font.body ? FONTS[font.body as FontId] : font;
}

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

/** How tall a slide's logo stands, in canvas units. A wide wordmark is held to the width of the copy instead. */
export const LOGO_SIZES = { small: 9, medium: 13, large: 19 } as const;

export type LogoSize = keyof typeof LOGO_SIZES;
export const LOGO_SIZE_IDS = Object.keys(LOGO_SIZES) as [LogoSize, ...LogoSize[]];

/** How a slide's logo is cut out. */
export const LOGO_SHAPES = {
  plain: "The image as it is. For a wordmark or a logo with a transparent background.",
  "app-icon": "Cropped square with the rounded corners of an iOS icon and a soft shadow. For the app's own icon.",
  circle: "Cropped round.",
} as const;

export type LogoShape = keyof typeof LOGO_SHAPES;
export const LOGO_SHAPE_IDS = Object.keys(LOGO_SHAPES) as [LogoShape, ...LogoShape[]];

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
