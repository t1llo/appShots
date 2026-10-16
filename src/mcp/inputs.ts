import { z } from "zod";
import { BACKGROUNDS } from "../design.ts";
import { creativeSchema, deviceSchema, mockupsSchema, slideSchema, themeSchema } from "../schema.ts";

// A model reads tools/list before its first call, and a small local one has little room for it. Written out in
// full, the schemas the tools check with name every field of every part, every icon and every font, over 100 KB,
// most of it the same parts repeated. What the tools take here is checked by exactly those schemas, so every value
// they took is still taken and the tool gets the same, but tools/list shows only the fields a model sets most and
// lists the rest as objects, with the design guide topic that has their fields. get_design_guide with the topic
// "fields" writes all of them out from the same schemas.

/**
 * Checked by `full`, shown in tools/list as `shown`. `shown` takes everything `full` takes and passes it on
 * unchanged, so the tool gets what `full` makes of the value and refuses what `full` refuses.
 */
const shownAs = <T extends z.ZodType>(shown: z.ZodType, full: T) => shown.pipe(full);

/** An object whose fields a topic of the design guide lists. */
const part = <T extends z.ZodType>(full: T, description: string) => shownAs(z.looseObject({}), full).describe(description);

/** A list of such objects. */
const parts = <T extends z.ZodType>(full: T, description: string) => shownAs(z.array(z.looseObject({})), full).describe(description);

const s = slideSchema.shape;

/** A text field: a string, or one per language. */
const text = (full: typeof s.headline, description: string) => shownAs(z.union([z.string(), z.record(z.string(), z.string())]), full.unwrap()).optional().describe(description);

const background = shownAs(z.union([z.string(), z.looseObject({})]), s.background.unwrap())
  .optional()
  .describe(`A preset (${Object.keys(BACKGROUNDS).join(", ")}), "auto" (from the slide's screenshot), a hex colour, or {"type":"mesh","colors":["#0B1020","#1A2B52"]}. Topic backgrounds`);

const font = shownAs(z.string(), s.font.unwrap()).optional().describe('A font id such as "inter", "manrope" or "fraunces". Topic fonts lists them all');

const device = part(deviceSchema, "How the device is drawn and where it stands: frame, style, color, shadow, statusBar, and on a slide scale, offsetX, offsetY, rotate, perspective, spread, gap. Topic device").optional();

/** The look every slide shares, shown with the fields of the device and the background left to the guide. */
export const themeInput = themeSchema.extend({ background, font, device });

/** A slide, shown with its top-level fields and the parts below them left to the guide. */
export const slideInput = slideSchema.extend({
  eyebrow: text(s.eyebrow, "Small uppercase line above the headline"),
  headline: text(s.headline, 'Two to five words. A string, or {"en-US": "…", "de-DE": "…"} in a project with several languages. *Asterisks* mark words for the accent colour, \\n breaks the line'),
  subheadline: text(s.subheadline, "One short sentence, or none"),
  badges: parts(s.badges.unwrap(), "Ratings, awards, reviews: {type, title, subtitle, stars, icon, tone}. Only real ones. Topic badges").optional(),
  features: parts(s.features.unwrap(), "Feature points or cards: {icon or value, title, text}. Topics feature-points and feature-slides; the icons in topic icons").optional(),
  featureCards: part(s.featureCards.unwrap(), "How the cards of a features slide look: {look, icons, columns}. Topic feature-slides").optional(),
  iconRow: part(s.iconRow.unwrap(), "A row of icons or brand logos: {icons, label, style, tone, size, position}. Topic icon-rows").optional(),
  logo: part(s.logo.unwrap(), 'An uploaded image above the copy: {"image": "<name>", size, shape}. Topic images').optional(),
  images: parts(s.images.unwrap(), "Uploaded images placed freely: {image, x, y, size, rotate, layer, shadow, flip, opacity}. Topic images").optional(),
  background,
  font,
  device,
});

/**
 * The fields of a slide to change, which set_slides shows already. Loose, so that a field slides do not have reaches
 * the tool and can be named in the answer.
 */
export const slideChangesInput = part(slideSchema.loose(), "Slide fields to set, as set_slides takes them, such as {\"headline\": \"…\"} or {\"device\": {\"scale\": 0.9}}").optional();

/** One header, search results or banner image. Its fields are listed once, in the tool's description. */
export const creativeInput = (description: string) => part(creativeSchema, description).optional();

/** The device every mockup is drawn in. */
export const mockupDeviceInput = (description: string) => part(mockupsSchema.shape.device.unwrap(), description).optional();
