import { z } from "zod";
import {
  BACKGROUNDS,
  BADGE_TONE_IDS,
  BADGE_TYPE_IDS,
  CARD_ICON_IDS,
  CARD_LOOK_IDS,
  CREATIVE_LAYOUT_IDS,
  DEVICE_COLOR_IDS,
  DEVICE_STYLE_IDS,
  EMPHASIS_IDS,
  FEATURE_STYLE_IDS,
  FONT_IDS,
  ICON_IDS,
  ICON_ROW_SIZE_IDS,
  ICON_ROW_STYLE_IDS,
  ICON_ROW_TONE_IDS,
  LAYOUT_IDS,
  LOGO_SHAPE_IDS,
  LOGO_SIZE_IDS,
  STATUS_BAR_IDS,
} from "./design.ts";
import { type DeviceKind, TARGET_IDS } from "./sizes.ts";

/** Ids and screenshot names end up in file paths and URLs, so they stay strictly slug-shaped. */
export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const LOCALE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

const slug = z.string().regex(SLUG, "lowercase letters, digits, - and _ only");
const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "hex colour like #1E3A8A");
const locale = z.string().regex(LOCALE, "BCP-47 code like en or de-CH");

/**
 * A project's languages, each once. Case does not tell two apart: screenshots are matched to a language without it,
 * and a disk that ignores case files "de-DE" and "de-de" into one folder.
 */
const locales = z
  .array(locale)
  .min(1)
  .max(40)
  .refine((list) => new Set(list.map((code) => code.toLowerCase())).size === list.length, "each language only once, whatever its case");

const text = z
  .union([z.string().max(400), z.record(locale, z.string().max(400))])
  .describe("A string, or {locale: string} for localized sets. In headlines *asterisks* mark words to tint with the accent colour and \\n forces a line break.");

export const badgeSchema = z.object({
  type: z.enum(BADGE_TYPE_IDS).default("laurel"),
  title: text.optional().describe('The big line, e.g. "10K+" or "4.9". On a review it is the quote'),
  subtitle: text.optional().describe('The small line, e.g. "Downloads" or "App Store rating". On a review it is who said it'),
  stars: z.number().min(0).max(5).optional().describe("Shows a star row filled to this value"),
  icon: z.enum(ICON_IDS).optional(),
  tone: z.enum(BADGE_TONE_IDS).optional().describe("Default plain"),
});

export const featureSchema = z.object({
  icon: z.enum(ICON_IDS).optional(),
  value: text.optional().describe('A big figure or word shown in place of the icon, e.g. "0", "24h" or "100%". On the stat layout it is the figure itself; on the steps layout it replaces the step\'s number'),
  title: text.describe("The feature in two to four words"),
  text: text.optional().describe("One short supporting line. The small tiles of a full slide leave it out."),
  color: hex.optional().describe("This card's own colour, for its icon, its figure and its wash. Left out, the accent colour"),
  image: slug.optional().describe("Name of an uploaded image shown in place of the icon, such as a small illustration"),
  screenshot: slug.optional().describe("Name of an uploaded screenshot shown small: on a feature card it stands under the title and runs off the card's lower edge, on a step it stands beside the text"),
});

export const featureCardsSchema = z.object({
  look: z.enum(CARD_LOOK_IDS).optional().describe("What the cards are made of. Default glass"),
  icons: z.enum(CARD_ICON_IDS).optional().describe("How the icons are drawn. Default gradient"),
  columns: z.number().int().min(1).max(4).optional().describe("Cards across, for the grid, cards and list styles. Left out, the canvas decides. The bento arranges itself"),
});

export const iconRowSchema = z.object({
  icons: z.array(z.enum(ICON_IDS)).min(1).max(8).describe("The icons and brand logos, in the order shown"),
  label: text.optional().describe('A short line over the row, e.g. "Works with"'),
  style: z.enum(ICON_ROW_STYLE_IDS).optional().describe("Default tiles"),
  tone: z.enum(ICON_ROW_TONE_IDS).optional().describe("Default brand"),
  size: z.enum(ICON_ROW_SIZE_IDS).optional().describe("Default medium"),
  position: z.enum(["top", "bottom"]).optional().describe("Above the headline or below the subheadline. Default bottom"),
});

export const logoSchema = z.object({
  image: slug.describe("Name of an uploaded image, such as the app's logo or icon"),
  size: z.enum(LOGO_SIZE_IDS).optional().describe("Default medium"),
  shape: z.enum(LOGO_SHAPE_IDS).optional().describe("Default plain"),
});

export const placedImageSchema = z.object({
  image: slug.describe("Name of an uploaded image"),
  x: z.number().min(-30).max(130).optional().describe("Where its centre is, in % of the canvas width from the left. Default 50"),
  y: z.number().min(-30).max(130).optional().describe("Where its centre is, in % of the canvas height from the top. Default 50"),
  size: z.number().min(2).max(200).optional().describe("Its width in % of the canvas width. Default 30"),
  rotate: z.number().min(-180).max(180).optional().describe("Rotation in degrees"),
  layer: z.enum(["front", "behind"]).optional().describe("front lies over the device and the copy; behind lies on the background, under both. Default front"),
  opacity: z.number().min(0.05).max(1).optional(),
  shadow: z.enum(["none", "soft", "strong"]).optional().describe("A shadow that follows the image's outline. Default none"),
  flip: z.boolean().optional().describe("Mirrored left to right"),
});

const backgroundPreset = z.enum(["auto", ...(Object.keys(BACKGROUNDS) as [string, ...string[]])]);

export const backgroundSchema = z
  .union([
    backgroundPreset,
    hex,
    z.object({
      type: z.enum(["solid", "gradient", "mesh"]).default("gradient"),
      colors: z.array(hex).min(1).max(5),
      angle: z.number().min(0).max(360).optional().describe("Gradient direction in degrees, default 165"),
      noise: z.number().min(0).max(1).optional().describe("Film grain strength"),
    }),
  ])
  .describe('A preset name, "auto" (derived from the slide\'s screenshot), a hex colour, or a custom {type, colors} object');

export const deviceSchema = z.object({
  frame: z
    .enum(["auto", "iphone", "duo", "ipad", "mac", "none"])
    .optional()
    .describe("auto picks the frame matching the screenshot; duo is the unfolded iPhone Duo; mac is a MacBook; none shows the bare rounded screenshot, which for a Mac is the window alone"),
  style: z.enum(DEVICE_STYLE_IDS).optional().describe("How the frame is drawn: real (default), clay (one matte colour), outline (a line drawing) or sketch (the line drawing, hand-drawn)"),
  color: z.enum(DEVICE_COLOR_IDS).optional(),
  scale: z.number().min(0.4).max(1.6).optional().describe("Size multiplier, default 1"),
  rotate: z.number().min(-45).max(45).optional().describe("Rotation in degrees. On a layout with several devices it turns them all"),
  spread: z.number().min(0).max(60).optional().describe("The angle between the devices of duo, side-by-side and trio, in degrees. 0 stands them parallel. Default 11 for duo, 14 for trio, 0 for side-by-side"),
  gap: z.number().min(-30).max(30).optional().describe("Pushes the devices of duo, side-by-side and trio apart (positive) or together (negative), in % of canvas width"),
  perspective: z.enum(["none", "left", "right"]).optional().describe("3D turn towards one side"),
  offsetX: z.number().min(-60).max(60).optional().describe("Horizontal shift in % of canvas width"),
  offsetY: z.number().min(-60).max(60).optional().describe("Vertical shift in % of canvas height"),
  shadow: z.enum(["none", "soft", "strong"]).optional(),
  statusBar: z.enum(STATUS_BAR_IDS).optional().describe("A clean status bar at the top of the screenshot: cover paints it over the screenshot's own, overlay draws it on a screenshot that has none. Default none"),
  statusBarTime: z.string().regex(/^\d{1,2}[:.]\d{2}$/, "a time like 9:41").optional().describe("The time the status bar shows, default 9:41"),
  statusBarColor: z.enum(["auto", "light", "dark"]).optional().describe("White (light) or black (dark) status bar. auto reads it off the screenshot"),
});

/** Style fields a project sets once in its theme and any slide can override. */
const styleFields = {
  background: backgroundSchema.optional(),
  textColor: hex.optional().describe("Defaults to black or white, whichever reads on the background"),
  accentColor: hex.optional().describe("Colour for *emphasised* headline words, the eyebrow and badge stars"),
  font: z.enum(FONT_IDS).optional(),
  align: z.enum(["center", "left"]).optional(),
  textScale: z.number().min(0.5).max(1.5).optional().describe("Headline size multiplier; text still shrinks to fit"),
  emphasis: z.enum(EMPHASIS_IDS).optional().describe("How a headline marks its *emphasised* words: tint (default), marker or underline"),
  device: deviceSchema.optional(),
};

export const themeSchema = z.object(styleFields);

export const slideSchema = z.object({
  layout: z.enum(LAYOUT_IDS).optional().describe("Default device-bottom"),
  eyebrow: text.optional().describe("Small uppercase line above the headline"),
  headline: text.optional(),
  subheadline: text.optional(),
  screenshot: slug.optional().describe("Name of an uploaded raw screenshot"),
  screenshot2: slug.optional().describe("Second screenshot, for the layouts with two or three devices"),
  screenshot3: slug.optional().describe("Third screenshot, for the trio layout"),
  badges: z.array(badgeSchema).max(10).optional().describe("A slide draws the first four with its copy. The reviews layout also takes up to six review badges for its wall"),
  badgePosition: z.enum(["top", "bottom"]).optional().describe("Above the headline or below the subheadline"),
  features: z
    .array(featureSchema)
    .max(8)
    .optional()
    .describe("Most important first. The cards of the features layout, the figures of the stat layout, the steps of the steps layout; on every other layout a short list of feature points with the copy"),
  featureStyle: z.enum(FEATURE_STYLE_IDS).optional().describe("bento, grid, cards or list on the features layout (default bento); list, cards, grid or chips for feature points (default list)"),
  featureCards: featureCardsSchema.optional().describe("How the cards of the features layout look"),
  iconRow: iconRowSchema.optional().describe("A row of icons or brand logos with the copy, such as the services the app works with"),
  logo: logoSchema.optional().describe("An uploaded image at the top of the copy, above the eyebrow and headline: the app's logo or icon"),
  images: z.array(placedImageSchema).max(10).optional().describe("Uploaded images placed freely on the slide: stickers, characters, shapes. Later ones lie over earlier ones"),
  ...styleFields,
});

/**
 * One header or search results asset. It takes its look from the project theme like a slide does, but the copy
 * is always centred, because it has to stay inside the placement's safe area.
 */
export const creativeSchema = z.object({
  layout: z.enum(CREATIVE_LAYOUT_IDS).optional().describe("Default fan"),
  eyebrow: text.optional().describe("Small uppercase line above the headline"),
  headline: text.optional(),
  subheadline: text.optional(),
  screenshots: z.array(slug).max(6).optional().describe("Names of uploaded raw screenshots, most important first. Without any, the asset is copy on the background."),
  badges: z.array(badgeSchema).max(3).optional(),
  badgePosition: z.enum(["top", "bottom"]).optional().describe("Above the headline or below the subheadline"),
  logo: logoSchema.optional().describe("An uploaded image at the top of the copy: the app's own logo or icon, never another company's"),
  background: backgroundSchema.optional(),
  textColor: styleFields.textColor,
  accentColor: styleFields.accentColor,
  font: styleFields.font,
  textScale: styleFields.textScale,
  emphasis: styleFields.emphasis,
  device: deviceSchema.pick({ frame: true, style: true, color: true, scale: true, shadow: true, statusBar: true }).optional(),
});

export const creativesSchema = z.object({
  header: creativeSchema.optional().describe("Product page header, 21:9, 3840×1646"),
  search: creativeSchema.optional().describe("Search results asset, 3:2, 3840×2560"),
  universal: creativeSchema.optional().describe("One 16:9 file, 5244×2950, that App Store Connect crops for both places"),
  readme: creativeSchema.optional().describe("Banner for the top of a README or a web page, 3:1, 2400×800"),
  social: creativeSchema.optional().describe("Social preview of a GitHub repository, 2:1, 1280×640"),
  link: creativeSchema.optional().describe("Link preview of a web page, its og:image, 1.91:1, 1200×630"),
  post: creativeSchema.optional().describe("Picture for a post, a deck or a video thumbnail, 16:9, 1920×1080"),
});

/**
 * How the project's screenshots are drawn as mockups: each one in its device on a transparent background, for a
 * website or a README. Kept apart from the theme, because a mockup has no slide around it.
 */
export const mockupsSchema = z.object({
  device: deviceSchema
    .pick({ frame: true, style: true, color: true, shadow: true, rotate: true, perspective: true, statusBar: true, statusBarTime: true, statusBarColor: true })
    .optional()
    .describe("The device every mockup is drawn in. Without a shadow unless `shadow` asks for one"),
  width: z.number().int().min(200).max(4000).optional().describe("Width of each PNG in pixels. Left out, the screenshot is shown pixel for pixel"),
});

/** The sizes a project exports. Left out, it is the standard sizes of each device the project has screenshots of. */
export const targetsSchema = z
  .array(z.enum(TARGET_IDS))
  .max(TARGET_IDS.length)
  .describe("Sizes to export. Left out or empty: the standard sizes of every device the project has screenshots of");

/**
 * Slide sets a device has of its own. A device named here draws these in place of the project's `slides`, so an
 * iPad or a Mac can be composed for its own canvas instead of repeating the iPhone's design at another size.
 */
export const deviceSlidesSchema = z.object({
  iphone: z.array(slideSchema).min(1).max(10).optional(),
  duo: z.array(slideSchema).min(1).max(10).optional(),
  ipad: z.array(slideSchema).min(1).max(10).optional(),
  mac: z.array(slideSchema).min(1).max(10).optional(),
});

export const projectSchema = z.object({
  id: slug,
  name: z.string().min(1).max(80),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The shape project.json was written in. storage/migrate.ts brings older ones up to date as they are read. */
  schemaVersion: z.number().int().min(0).optional(),
  /** One up with every write. A client that sends it back with a change learns when it would save over another's. */
  revision: z.number().int().min(0).optional(),
  locales,
  targets: targetsSchema.optional(),
  theme: themeSchema,
  slides: z.array(slideSchema).max(10),
  deviceSlides: deviceSlidesSchema.default({}),
  creatives: creativesSchema.default({}),
  mockups: mockupsSchema.default({}),
});

export type Text = z.infer<typeof text>;
export type Badge = z.infer<typeof badgeSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type FeatureCards = z.infer<typeof featureCardsSchema>;
export type IconRow = z.infer<typeof iconRowSchema>;
export type Logo = z.infer<typeof logoSchema>;
export type PlacedImage = z.infer<typeof placedImageSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type DeviceStyle = z.infer<typeof deviceSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type Creative = z.infer<typeof creativeSchema>;
export type Creatives = z.infer<typeof creativesSchema>;
export type Mockups = z.infer<typeof mockupsSchema>;
export type DeviceSlides = z.infer<typeof deviceSlidesSchema>;
export type Project = z.infer<typeof projectSchema>;

/** Every slide of a project: the shared set and each device's own. */
export const allSlides = (project: Pick<Project, "slides" | "deviceSlides">): Slide[] => [...project.slides, ...Object.values(project.deviceSlides ?? {}).flatMap((set) => set ?? [])];

/** The slides a device shows: its own set where it has one, the project's otherwise. */
export const slidesFor = (project: Pick<Project, "slides" | "deviceSlides">, device: DeviceKind): Slide[] => project.deviceSlides?.[device] ?? project.slides;

export const localeSchema = locale;
export const localesSchema = locales;
export const slugSchema = slug;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The keys in `value` that `schema` has no place for, as paths such as `slides[0].headlne`. Parsing drops them
 * without a word, so this is how a caller hears about a misspelt field: as a warning beside a change that went through.
 */
export function unknownFields(schema: z.ZodType, value: unknown, at = ""): string[] {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) return unknownFields(schema.unwrap() as z.ZodType, value, at);
  if (schema instanceof z.ZodArray) return Array.isArray(value) ? value.flatMap((item, i) => unknownFields(schema.element as z.ZodType, item, `${at}[${i}]`)) : [];
  if (schema instanceof z.ZodUnion) {
    // Of a preset, a colour or a {type, colors} object, only the object has fields to misspell.
    const objects = (schema.options as z.ZodType[]).filter((option) => option instanceof z.ZodObject);
    return objects.length === 1 && isRecord(value) ? unknownFields(objects[0]!, value, at) : [];
  }
  if (!(schema instanceof z.ZodObject) || !isRecord(value)) return [];
  const shape = schema.shape as Record<string, z.ZodType>;
  return Object.entries(value).flatMap(([key, field]) => {
    const where = at ? `${at}.${key}` : key;
    return Object.hasOwn(shape, key) ? unknownFields(shape[key]!, field, where) : [where];
  });
}
