import { z } from "zod";
import { FONT_IDS, ICON_IDS } from "../../design.ts";
import {
  backgroundSchema,
  badgeSchema,
  creativeSchema,
  creativesSchema,
  deviceSchema,
  featureCardsSchema,
  featureSchema,
  iconRowSchema,
  logoSchema,
  mockupsSchema,
  placedImageSchema,
  SLUG,
  slideSchema,
  themeSchema,
} from "../../schema.ts";
import type { Topic } from "./topic.ts";

// tools/list shows the parts of a slide as plain objects (see src/mcp/inputs.ts). This topic writes their fields
// out from the schemas the tools check with, so it can never name a field or a value the tools would refuse.

type Json = {
  type?: string;
  enum?: unknown[];
  anyOf?: Json[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: Json;
  properties?: Record<string, Json>;
  additionalProperties?: Json | boolean;
  required?: string[];
  description?: string;
  default?: unknown;
};

const jsonOf = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Json;

/** The parts that have a section of their own, by the field that holds them. */
const PARTS: Record<string, { title: string; schema: z.ZodObject }> = {
  device: { title: "Device", schema: deviceSchema },
  badges: { title: "Badge", schema: badgeSchema },
  features: { title: "Feature", schema: featureSchema },
  featureCards: { title: "Feature cards", schema: featureCardsSchema },
  iconRow: { title: "Icon row", schema: iconRowSchema },
  logo: { title: "Logo", schema: logoSchema },
  images: { title: "Image", schema: placedImageSchema },
  background: { title: "Background", schema: backgroundSchema.options[2] as z.ZodObject },
};

const same = (values: unknown[], ids: readonly string[]) => values.length === ids.length && ids.every((id) => values.includes(id));
const code = (value: unknown) => `\`${typeof value === "string" ? value : JSON.stringify(value)}\``;
const range = (json: Json) => (json.minimum !== undefined && json.maximum !== undefined ? ` from ${json.minimum} to ${json.maximum}` : "");
const isText = (json: Json) => json.anyOf?.length === 2 && json.anyOf[0]!.type === "string" && json.anyOf[1]!.type === "object" && !json.anyOf[1]!.properties;

/** What a field takes, in a few words. */
function kind(json: Json, field: string): string {
  if (isText(json)) return "text";
  if (json.anyOf) return json.anyOf.map((each) => kind(each, field)).join(", or ");
  if (json.enum) {
    if (same(json.enum, ICON_IDS)) return "an icon id (topic icons)";
    if (same(json.enum, FONT_IDS)) return "a font id (topic fonts)";
    return json.enum.length === 1 ? code(json.enum[0]) : `one of ${json.enum.map(code).join(", ")}`;
  }
  switch (json.type) {
    case "string":
      if (json.pattern === SLUG.source) return "a name";
      if (json.pattern?.startsWith("^#")) return "a hex colour";
      return "a string";
    case "integer":
      return `a whole number${range(json)}`;
    case "number":
      return `a number${range(json)}`;
    case "boolean":
      return "true or false";
    case "array": {
      const count = json.minItems ? `${json.minItems} to ${json.maxItems}` : `up to ${json.maxItems}`;
      return `a list of ${count}, each ${kind(json.items!, field)}`;
    }
    case "object": {
      const part = PARTS[field];
      const keys = Object.keys(json.properties ?? {});
      if (!part) return keys.length ? `an object with ${keys.join(", ")}` : "an object";
      return keys.length === Object.keys(part.schema.shape).length ? `an object, see ${part.title}` : `an object with ${keys.join(", ")}, as in ${part.title}`;
    }
  }
  return "any value";
}

/** One line per field of `schema`, in the order the schema has them. */
function lines(schema: z.ZodType, only?: string[]): string {
  const json = jsonOf(schema);
  return Object.entries(json.properties ?? {})
    .filter(([field]) => !only || only.includes(field))
    .map(([field, value]) => {
      const notes = [kind(value, field)];
      if (json.required?.includes(field) && value.default === undefined) notes.push("required");
      if (value.default !== undefined && !/default/i.test(value.description ?? "")) notes.push(`default ${code(value.default)}`);
      return `- \`${field}\`: ${notes.join(", ")}.${value.description ? ` ${value.description.replace(/\.?$/, ".")}` : ""}`;
    })
    .join("\n");
}

const section = (title: string, intro: string, body: string) => `### ${title}\n${intro}\n${body}`;
const themeFields = Object.keys(themeSchema.shape);
const placements = Object.entries(creativesSchema.shape).map(([id, schema]) => `\`${id}\` (${schema.description})`);

export const FIELDS_TOPIC: Topic = {
  id: "fields",
  title: "Fields",
  body: () =>
    [
      `Every field of a slide, the theme and their parts, written out from what the tools check. A text field is a string, or one string per language such as \`{"en-US": "…", "de-DE": "…"}\` when the project has several. A name is that of something uploaded, as \`get_project\` lists it: lowercase letters, digits, - and _. A style field a slide leaves out comes from the theme.`,
      section("Slide", "What `set_slides` takes for each slide and `update_slide` in `changes`.", lines(slideSchema)),
      section("Theme", `The look every slide shares, for \`theme\` in \`create_project\`, \`update_project\` and \`set_slides\`. It takes the slide fields ${themeFields.map(code).join(", ")}, as above; a slide that sets one of them overrides it.`, ""),
      section("Device", "In the theme, on a slide, and in part on an asset or a mockup.", lines(deviceSchema)),
      section("Background", "`background` takes a preset, `\"auto\"`, a hex colour, or this object.", lines(PARTS.background!.schema)),
      section("Badge", "One entry of `badges`.", lines(badgeSchema)),
      section("Feature", "One entry of `features`.", lines(featureSchema)),
      section("Feature cards", "`featureCards`.", lines(featureCardsSchema)),
      section("Icon row", "`iconRow`.", lines(iconRowSchema)),
      section("Logo", "`logo`.", lines(logoSchema)),
      section("Image", "One entry of `images`.", lines(placedImageSchema)),
      section("Asset", `What \`set_creative_assets\` takes for each of ${placements.join(", ")}. What an asset leaves out comes from the theme.`, lines(creativeSchema)),
      section("Mockups", "What `render_mockups` takes besides the project and the screenshots.", lines(mockupsSchema)),
    ]
      .join("\n\n")
      .replace(/\n\n\n/g, "\n\n"),
};
