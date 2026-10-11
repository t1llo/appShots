import { z } from "zod";
import { BACKGROUNDS, BADGE_TYPE_IDS, DEVICE_COLOR_IDS, FONT_IDS, ICON_IDS, LAYOUT_IDS } from "./design.ts";

/** Ids and screenshot names end up in file paths and URLs, so they stay strictly slug-shaped. */
export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const LOCALE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

const slug = z.string().regex(SLUG, "lowercase letters, digits, - and _ only");
const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "hex colour like #1E3A8A");
const locale = z.string().regex(LOCALE, "BCP-47 code like en or de-CH");

const text = z
  .union([z.string().max(400), z.record(locale, z.string().max(400))])
  .describe("A string, or {locale: string} for localized sets. In headlines *asterisks* mark words to tint with the accent colour and \\n forces a line break.");

export const badgeSchema = z.object({
  type: z.enum(BADGE_TYPE_IDS).default("laurel"),
  title: text.optional().describe('The big line, e.g. "10K+", "4.9" or "App of the Day"'),
  subtitle: text.optional().describe('The small line, e.g. "Downloads" or "App Store rating"'),
  stars: z.number().min(0).max(5).optional().describe("Shows a star row filled to this value"),
  icon: z.enum(ICON_IDS).optional(),
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
  frame: z.enum(["auto", "iphone", "ipad", "none"]).optional().describe("auto picks the frame matching the screenshot; none shows the bare rounded screenshot"),
  color: z.enum(DEVICE_COLOR_IDS).optional(),
  scale: z.number().min(0.4).max(1.6).optional().describe("Size multiplier, default 1"),
  rotate: z.number().min(-45).max(45).optional().describe("Rotation in degrees"),
  perspective: z.enum(["none", "left", "right"]).optional().describe("3D turn towards one side"),
  offsetX: z.number().min(-60).max(60).optional().describe("Horizontal shift in % of canvas width"),
  offsetY: z.number().min(-60).max(60).optional().describe("Vertical shift in % of canvas height"),
  shadow: z.enum(["none", "soft", "strong"]).optional(),
});

/** Style fields a project sets once in its theme and any slide can override. */
const styleFields = {
  background: backgroundSchema.optional(),
  textColor: hex.optional().describe("Defaults to black or white, whichever reads on the background"),
  accentColor: hex.optional().describe("Colour for *emphasised* headline words, the eyebrow and badge stars"),
  font: z.enum(FONT_IDS).optional(),
  align: z.enum(["center", "left"]).optional(),
  textScale: z.number().min(0.5).max(1.5).optional().describe("Headline size multiplier; text still shrinks to fit"),
  device: deviceSchema.optional(),
};

export const themeSchema = z.object(styleFields);

export const slideSchema = z.object({
  layout: z.enum(LAYOUT_IDS).optional().describe("Default device-bottom"),
  eyebrow: text.optional().describe("Small uppercase line above the headline"),
  headline: text.optional(),
  subheadline: text.optional(),
  screenshot: slug.optional().describe("Name of an uploaded raw screenshot"),
  screenshot2: slug.optional().describe("Second screenshot, used by the duo layout"),
  badges: z.array(badgeSchema).max(4).optional(),
  badgePosition: z.enum(["top", "bottom"]).optional().describe("Above the headline or below the subheadline"),
  ...styleFields,
});

export const projectSchema = z.object({
  id: slug,
  name: z.string().min(1).max(80),
  createdAt: z.string(),
  updatedAt: z.string(),
  locales: z.array(locale).min(1).max(40),
  theme: themeSchema,
  slides: z.array(slideSchema).max(10),
});

export type Text = z.infer<typeof text>;
export type Badge = z.infer<typeof badgeSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type DeviceStyle = z.infer<typeof deviceSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type Project = z.infer<typeof projectSchema>;

export const localeSchema = locale;
export const slugSchema = slug;
