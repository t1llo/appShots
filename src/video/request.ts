import { z } from "zod";
import type { DeviceKind } from "../domain/devices.ts";
import { displayForSize, PREVIEW_DISPLAYS, type PreviewDisplay, PREVIEW_SPECS, previewDevice, previewSize } from "../domain/previews.ts";
import { resolveLocales } from "../render/plan.ts";
import { localeSchema, type Project } from "../schema.ts";
import { InputError } from "../store.ts";

/**
 * What POST /api/projects/:id/video-layers and the render_video_layers tool take: the layers of one app preview, for
 * one display and any of the project's languages. The video itself is recorded and cut on the Mac; the server only
 * draws what goes over and around it, in the project's style.
 */

export const MAX_CAPTIONS = 12;
export const MAX_LANGUAGES = 40;
export const DISCLOSURE_IDS = ["iap", "subscription", "login"] as const;
export type Disclosure = (typeof DISCLOSURE_IDS)[number];
export const CAPTION_STYLES = ["panel", "shadow", "band"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

const SIDE = { min: 320, max: 3840 };
const side = z
  .number()
  .int()
  .min(SIDE.min)
  .max(SIDE.max)
  .refine((value) => value % 2 === 0, "an even number of pixels, as the video encoder needs");

const projectText = z.union([z.string().min(1).max(400), z.record(localeSchema, z.string().max(400))]);
const slideText = z.strictObject({
  slide: z.number().int().min(1).max(10).describe("1-based, as the Studio numbers the slides"),
  field: z.enum(["headline", "eyebrow", "sub"]).optional().describe("Default headline"),
});
/** Copy as the project holds it, one string or one per language, or the text of one of the display's slides. */
const textRef = z.union([slideText, projectText]).describe('A string, {locale: string}, or {slide, field} to take a slide\'s text in every language: {"slide": 2} is its headline');
export type TextRef = z.infer<typeof textRef>;

const caption = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/, "lowercase letters, digits and - only, up to 32"),
  text: textRef,
  position: z.enum(["top", "bottom"]).optional().describe("Default top"),
});

// `seconds` belongs to the plan's timing, which the pictures do not depend on: taken so a plan's card can be sent as it is.
const seconds = z.number().min(0).max(10).optional();

export const videoLayersShape = {
  display: z.enum(PREVIEW_DISPLAYS).optional().describe("The display the preview is for. Either this or size"),
  orientation: z.enum(["portrait", "landscape"]).optional().describe("Default portrait; a Mac preview is landscape only"),
  size: z.tuple([side, side]).optional().describe("[width, height] in pixels, 320 to 3840 and even, for a size of your own"),
  locales: z.array(localeSchema).max(MAX_LANGUAGES).optional().describe("Default: every language of the project"),
  captionStyle: z.enum(CAPTION_STYLES).optional().describe("panel (default): a card in the theme's background; shadow: text with a soft shadow; band: a band the full width"),
  captions: z
    .array(caption)
    .max(MAX_CAPTIONS)
    .optional()
    .refine((list) => !list || new Set(list.map((entry) => entry.id)).size === list.length, "each caption id only once"),
  intro: z.union([z.literal(false), z.strictObject({ seconds, headline: textRef.optional(), logo: z.boolean().optional().describe("Default true") })]).optional(),
  outro: z
    .union([
      z.literal(false),
      z.strictObject({
        seconds,
        lines: z.array(textRef).max(3).optional(),
        logo: z.boolean().optional().describe("Default true"),
        disclosure: z.array(z.enum(DISCLOSURE_IDS)).max(DISCLOSURE_IDS.length).optional().describe("Small print the preview must show: in-app purchases, a subscription, a required sign-in"),
      }),
    ])
    .optional(),
  plate: z.boolean().optional().describe("The theme's background as an opaque picture, for the cards and a Mac window. Default true"),
  touch: z.boolean().optional().describe("A touch ring, for touches the recording logged. Default false"),
};

export const videoLayersBody = z.strictObject({
  ...videoLayersShape,
  /** Answer at once with the run instead of waiting for it. */
  background: z.boolean().optional(),
});

export type VideoLayersBody = z.infer<typeof videoLayersBody>;

/** The request with its defaults filled in and its size settled, before any text is looked up. */
export interface LayerRequest {
  size: [number, number];
  display: PreviewDisplay | null;
  /** The device whose slides `{slide}` refers to. */
  device: DeviceKind;
  locales: string[];
  captionStyle: CaptionStyle;
  captions: { id: string; text: TextRef; position: "top" | "bottom" }[];
  intro: { headline?: TextRef; logo: boolean } | null;
  outro: { lines: TextRef[]; logo: boolean; disclosure: Disclosure[] } | null;
  plate: boolean;
  touch: boolean;
}

function settleSize(body: VideoLayersBody): { size: [number, number]; display: PreviewDisplay | null } {
  const { display, orientation, size } = body;
  if (!display && !size) throw new InputError('Give the display the preview is for, such as "display": "iphone", or its "size" as [width, height].');
  if (display) {
    const upright = orientation ?? (PREVIEW_SPECS[display].portrait ? "portrait" : "landscape");
    const own = previewSize(display, upright);
    if (!own) throw new InputError(`A ${PREVIEW_SPECS[display].label} preview is landscape only.`);
    if (size && (size[0] !== own[0] || size[1] !== own[1])) {
      throw new InputError(`A ${upright} ${PREVIEW_SPECS[display].label} preview is ${own[0]}×${own[1]}, not ${size[0]}×${size[1]}. Leave out one of display and size.`);
    }
    return { size: [own[0], own[1]], display };
  }
  const [width, height] = size!;
  if (orientation && (orientation === "portrait") !== height >= width) throw new InputError(`${width}×${height} is not ${orientation}.`);
  return { size: [width, height], display: displayForSize(width, height) };
}

/** Checks the body against the project and fills in what was left out. */
export function normaliseRequest(project: Pick<Project, "locales">, body: VideoLayersBody): LayerRequest {
  const { size, display } = settleSize(body);
  const intro = body.intro ? { ...(body.intro.headline !== undefined ? { headline: body.intro.headline } : {}), logo: body.intro.logo ?? true } : null;
  const outro = body.outro ? { lines: body.outro.lines ?? [], logo: body.outro.logo ?? true, disclosure: [...new Set(body.outro.disclosure ?? [])] } : null;
  const wanted = resolveLocales(project, body.locales);
  return {
    size,
    display,
    // A size of no display takes the slides of the shape it has.
    device: display ? previewDevice(display) : size[0] > size[1] ? "mac" : "iphone",
    // In the project's order, so the same languages asked for in another order are the same set.
    locales: project.locales.filter((locale) => wanted.includes(locale)),
    captionStyle: body.captionStyle ?? "panel",
    captions: (body.captions ?? []).map((entry) => ({ id: entry.id, text: entry.text, position: entry.position ?? "top" })),
    intro,
    outro,
    plate: body.plate ?? true,
    touch: body.touch ?? false,
  };
}

export const isSlideText = (text: TextRef): text is z.infer<typeof slideText> => typeof text === "object" && "slide" in text && typeof text.slide === "number";
