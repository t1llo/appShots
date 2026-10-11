import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import sharp from "sharp";
import { CREATIVE_CAPACITY } from "./creative.ts";
import {
  BACKGROUNDS,
  BADGE_TONES,
  BADGE_TYPES,
  CREATIVE_LAYOUTS,
  DEVICE_COLOR_IDS,
  FEATURE_STYLES,
  POINT_STYLES,
  FONT_GROUPS,
  FONTS,
  ICON_GROUPS,
  ICON_ROW_SIZE_IDS,
  ICON_ROW_STYLES,
  ICON_ROW_TONES,
  LAYOUTS,
  LOGO_SHAPES,
  LOGO_SIZE_IDS,
} from "./design.ts";
import { defaultTargets, renderProject } from "./render.ts";
import { creativeSchema, localeSchema, type Project, slideSchema, slugSchema, targetsSchema, themeSchema } from "./schema.ts";
import { PLACEMENT_IDS, PLACEMENTS, type PlacementId, sourceOf, type Target, TARGET_IDS, TARGETS } from "./sizes.ts";
import { createProject, getProject, listImages, listProjects, listShots, outDir, type Shot, type Space, type StoredImage, updateProject } from "./store.ts";

function uploadHelp(base: string, id: string): string {
  return [
    "This server cannot see the user's devices, so raw screenshots are captured on their Mac and uploaded:",
    `- With the bundled CLI: \`appshots upload ${id} <files or folders>\` sends screenshots that exist already. \`appshots capture --name home --project ${id} --clean\` grabs the booted simulator; add \`--device\` for a connected iPhone or iPad. \`appshots launch <bundle id> --capture home --to ${id} -- <launch arguments>\` starts an installed app on one screen and captures it in one go. \`appshots check\` reports what there is to work with.`,
    `- With curl: \`curl -fsS -X PUT -H "Authorization: Bearer $APPSHOTS_TOKEN" -H "Content-Type: image/png" --data-binary @home.png "${base}/api/projects/${id}/shots/home"\` (the token is the one this MCP connection uses)`,
    "The last path segment is the screenshot name slides refer to. iPhone, iPhone Duo or iPad is told from the size of the picture, and one name can hold a variant for each. `get_project` lists what each one was filed under; when that is wrong, upload it again with `--as iphone`, `--as duo` or `--as ipad` (`?device=` with curl).",
    `A logo or other artwork for the slides (see Logo and images) goes up the same way: \`appshots upload ${id} logo.png --image\`, or with curl to \`${base}/api/projects/${id}/images/<name>\`. PNG, SVG, JPEG and WebP are taken, and transparency is kept.`,
  ].join("\n");
}

function designGuide(base: string): string {
  const list = (entries: Record<string, string>) =>
    Object.entries(entries)
      .map(([key, value]) => `- \`${key}\`: ${value}`)
      .join("\n");
  return `# appShots: App Store screenshot generator

## Workflow
1. \`create_project\`, or \`list_projects\` / \`get_project\` to continue an existing one.
2. Get raw screenshots into the project (see Uploading below), then check them with \`get_project\`.
3. \`set_slides\` with the copy and design for the whole set. Put shared styling in \`theme\`; slides override it.
4. \`render\`. It returns a contact sheet image: look at it, fix what is off with \`update_slide\`, render again.
5. Optionally \`set_creative_assets\` for the product page header and the search results asset (see below), and \`render\` again.
6. The user downloads the PNGs from ${base}/#/<project> or with \`appshots pull <project>\`.

## Uploading
${uploadHelp(base, "<project>")}

## Output sizes
A set is designed once per device: iPhone, iPhone Duo and iPad. One slide set serves all three; each device shows its own variant of a screenshot name. App Store Connect has one screenshot slot per display, and each takes its own pixel size, so a render writes one folder per size:
${Object.entries(TARGETS as Record<string, Target>)
  .map(([id, target]) => `- \`${id}\`: ${target.width}×${target.height}, for "${target.slot}"${target.standard ? ", standard" : ""}${target.from ? `, the ${target.from} picture scaled` : ""}`)
  .join("\n")}
Left to itself, \`render\` writes the standard sizes of every device the project has screenshots of (iPhone while it has none). The others are for older displays and for the Duo's cover display: add them with \`update_project\` \`targets\` only when the user asks. Sizes marked as scaled are the same picture as the size they name, so judge the design on one contact sheet per device. Portrait only. Up to 10 slides per set.

## Layouts
${list(LAYOUTS)}
\`duo\` and \`side-by-side\` take \`screenshot\` and \`screenshot2\`; \`trio\` takes \`screenshot3\` as well. A name with nothing uploaded under it is drawn as a labelled placeholder. Slides with several devices suit two steps of one flow, light next to dark, or an overview; keep the headline to one line there.
\`device-right\` and \`device-left\` are the layouts for a slide that says more: the copy stands in a column beside the device, always left-aligned, with room for a headline, a subheadline and three or four feature points (see below).

## Feature slides
A slide with \`"layout":"features"\` shows no screenshot. It lists what the app does as cards, the way a keynote sums up a release, and suits a "what's new" or "everything you get" slide, or an app whose screens say little on their own. One or two per set is plenty; the rest should show the app.
\`features\` holds up to 8 entries, most important first. Each has a \`title\` of two to four words, an \`icon\` (see Icons) or a \`value\` (a big figure or word in its place, such as \`"0"\`, \`"24h"\` or \`"100%"\`), and optionally one short line of \`text\`. \`featureStyle\` picks the look:
${list(FEATURE_STYLES)}
- \`bento\` and \`grid\` read best with 3 to 6 features and little or no \`text\`; \`cards\` with 2 to 5, each with a line of \`text\`; \`list\` with 4 to 8.
- The type shrinks until every card fits, so shorter titles come out larger. With \`"align":"left"\` the cards go left-aligned too.
- The headline sits above the cards and stays short. Badges work here as on any slide.
Example: \`{"layout":"features","headline":"Everything you *need*","featureStyle":"bento","features":[{"icon":"video-off","title":"No short videos","text":"Reels and Shorts are gone."},{"value":"100%","title":"On your device"},{"icon":"timer","title":"Daily limits"}]}\`

## Feature points
On every other layout, \`features\` is a short list with the copy, under the subheadline: what this screen does, in two to four points, each with an \`icon\` or a \`value\`, a \`title\` and optionally one line of \`text\`. The device gives up room for them, so use them where the slide is meant to explain; a slide that should hit hard keeps to its headline. \`featureStyle\` picks the look, default \`list\`:
${list(POINT_STYLES)}
- \`chips\` under a centred headline is the lightest; \`list\` and \`cards\` belong in the column of \`device-right\` or \`device-left\`, or under the headline of a slide whose device is made smaller.
- The points shrink together with the headline when the copy grows too tall.
Example: \`{"layout":"device-right","headline":"Everything that *keeps you* on track","screenshot":"home","features":[{"icon":"timer","title":"Daily limits","text":"Set a cap for every app"},{"icon":"bell","title":"Gentle nudges","text":"A reminder before time is up"},{"icon":"chart-bar","title":"Weekly report"}]}\`
Take them off again with \`update_slide\` and \`"remove":["features"]\`.

## Backgrounds
Presets: ${Object.entries(BACKGROUNDS)
    .map(([id, def]) => `\`${id}\` (${def.type})`)
    .join(", ")}.
Also \`"auto"\` (a mesh gradient derived from the slide's own screenshot), any hex colour, or a custom object such as \`{"type":"mesh","colors":["#0B1020","#1A2B52","#2A2A5E"],"noise":0.4}\`. In a mesh the first colour is the base and the others are soft blobs over it. Text colour flips between black and white automatically.
The presets are deliberately muted. Keep custom colours the same way unless the user asks for something loud: one hue family, moderate saturation, so the screenshot stays the most colourful thing on the slide.

## Fonts
${FONT_GROUPS.map(
  (group) =>
    `- ${group}: ${Object.entries(FONTS)
      .filter(([, font]) => font.group === group)
      .map(([id, font]) => `\`${id}\` (${font.note.toLowerCase()})`)
      .join(", ")}`,
)
  .join("\n")}

## Device
\`frame\`: auto, iphone, duo, ipad or none (bare rounded screenshot). \`duo\` is the unfolded iPhone Duo, drawn as a plain thin frame. \`color\`: ${DEVICE_COLOR_IDS.join(", ")}. \`shadow\`: none, soft or strong.
Where the device stands and how large it is can be set per slide, in the slide's own \`device\`, on top of what the layout does:
- \`scale\`: 0.4 to 1.6, default 1. Smaller leaves the copy more room; larger turns the screen into a detail shot.
- \`offsetX\`, \`offsetY\`: a shift in percent of the canvas width and height, -60 to 60. Positive is right and down. \`"offsetY":8\` lets a device bleed further off the bottom; \`"offsetX":-12\` moves it left to make room on the right.
- \`rotate\`: a tilt in degrees, -45 to 45. \`perspective\`: \`left\` or \`right\` turns it in 3D.
Example: \`{"layout":"device-right","headline":"See the *whole week*","screenshot":"stats","device":{"scale":1.2,"offsetY":8,"rotate":-5}}\`
Move in small steps and render to look: the device is cut off at the canvas edge, and nothing stops it from covering the copy.

## Badges
${list(BADGE_TYPES)}
\`tone\` sets the colour of the wreath, stars and icon:
${list(BADGE_TONES)}
Up to 4 per slide; they shrink to stay on one row. On a slide without a device or cards they are drawn larger. Examples:
- \`{"type":"rating","title":"4.9","subtitle":"12K ratings","tone":"gold"}\`
- \`{"type":"laurel","icon":"trophy","title":"App of the Day","subtitle":"App Store","tone":"gold"}\`
- \`{"type":"laurel","title":"10K+","subtitle":"Downloads"}\`
- \`{"type":"review","stars":5,"title":"I got two hours of my day back.","subtitle":"Maya, App Store review"}\`
- \`{"type":"icon","icon":"shield","title":"Private","subtitle":"No account needed"}\`
A \`rating\` fills its stars from the score. A \`review\` is a card of its own: one per slide reads best, two at most, and the quote stays under about eight words.
Only use figures, awards and reviews the app really has, and quote a review as it was written: App Review rejects screenshots with invented ratings, download counts, accolades or testimonials. Ask the user for them; never make them up.

## Icon and logo rows
\`iconRow\` puts up to 8 icons or brand logos in one row with the copy: the services the app works with, the apps it blocks, the places it shares to. \`icons\` lists them in order (see Icons; the Brands group holds the logos). Optional fields: \`label\`, a short line over the row such as "Works with"; \`position\`, \`bottom\` (below the subheadline, the default) or \`top\` (above the headline); \`size\`, ${ICON_ROW_SIZE_IDS.join(", ")} (default medium). \`style\`, default tiles:
${list(ICON_ROW_STYLES)}
\`tone\`, default brand:
${list(ICON_ROW_TONES)}
The row stays on one line, so with many icons they come out smaller; three to five read best. On a slide with nothing but copy, a \`large\` row is the picture. A black logo on a dark background, or a white one on a light background, is drawn in the text colour in the \`plain\` style so it stays visible.
Example: \`{"layout":"device-bottom","headline":"Social apps without *short videos*","screenshot":"home","iconRow":{"icons":["instagram","youtube","tiktok"],"label":"Works with"}}\`
Take a row off again with \`update_slide\` and \`"remove":["iconRow"]\`.

## Logo and images
The user can upload pictures that are not screenshots: the app's logo or icon, and other artwork such as stickers, characters, hand-drawn arrows or shapes. \`get_project\` lists them under \`images\` by name. Upload more with \`appshots upload <project> <files> --image\` (PNG, SVG, JPEG or WebP; a PNG or SVG with a transparent background works best), or the user adds them in the Studio under "Logos and images". Never draw or generate artwork yourself and never take it from the web; use what the user gives you or what is in the app's project, such as its app icon.
\`logo\` puts one image at the top of the copy, above the eyebrow and headline: \`{"image":"logo","size":"medium","shape":"plain"}\`. \`size\`: ${LOGO_SIZE_IDS.join(", ")} (default medium). \`shape\`, default plain:
${list(LOGO_SHAPES)}
It suits the first slide and the header and search results assets, where it tells people whose app this is; on every slide it gets repetitive. A wordmark has to read on the background, so a white one needs a dark background.
\`images\` places up to 10 images freely on a slide. Each is \`{"image":"star","x":86,"y":12,"size":18}\`: \`x\` and \`y\` are where its centre is, in % of the canvas width from the left and of the canvas height from the top (default 50, 50), and \`size\` is its width in % of the canvas width (default 30). Values below 0 or above 100 let it run off the edge. Optional: \`rotate\` in degrees; \`layer\`, \`front\` (over the device and the copy, the default) or \`behind\` (on the background, under both); \`shadow\`, none, soft or strong, following the image's outline; \`flip\`, mirrored; \`opacity\`. Later images lie over earlier ones.
What works: a character peeking in from a bottom corner (\`"x":84,"y":92,"size":34\`), a sticker overlapping a corner of the device, two or three small shapes scattered around the headline at different angles, a large soft shape \`behind\` everything. Keep images off the headline and off the part of the screenshot the slide is about, and use few: one to three per slide. The same numbers land in different spots on the taller iPhone canvas and the wider iPad one, so look at both renders after placing anything.
Example: \`{"layout":"device-bottom","headline":"Habits that *stick*","screenshot":"home","logo":{"image":"app-icon","shape":"app-icon"},"images":[{"image":"mascot","x":84,"y":92,"size":34,"rotate":6,"shadow":"soft"}]}\`
Header and search results assets take a \`logo\`, which has to be the app's own, and no placed images. Take either off a slide again with \`update_slide\` and \`"remove":["logo"]\` or \`"remove":["images"]\`.

## Icons
For the \`icon\` of a badge or a feature, and the \`icons\` of an icon row. In a badge or a feature each is one colour: the accent colour, or gold on a gold badge.
${Object.entries(ICON_GROUPS)
  .map(([group, ids]) => `- ${group}: ${ids.join(", ")}`)
  .join("\n")}
The Brands group holds the logos of other companies, as simplified marks that an icon row can show in each company's own colours. They are trademarks, so use one only where the app really works with that service ("Works with Instagram", "Blocks Shorts on YouTube"), and never to suggest a partnership or an endorsement: App Review turns down screenshots that lean on another company's brand, and so can the company. Header and search results assets take no icon rows at all, because Apple allows no other company's logo there. A logo that is not in the list cannot be added; say so and leave it out, or name the service in the copy.

## Copy
- Headline: two to five words, one benefit per slide, verb first where it fits. It is set large so it still reads at the small size the store shows screenshots in search results; a longer one shrinks to fit, so shorten the words before reaching for \`textScale\`. Wrap a word in *asterisks* to tint it with \`accentColor\` (with no accent set, the rest of the headline dims instead). \`\\n\` forces a line break.
- Subheadline: one short sentence, or leave it out.
- Any text field also accepts \`{"en":"…","de":"…"}\`; list the locales on the project and every one is rendered.
- Slide 1 does the selling: lead with the main benefit, or use the \`hero\` layout with real social proof. Vary layouts across the set so it does not read as one template repeated.

## Header and search results assets
App Store Connect has a "Header and Search Results" tab under Product Page Information. The images uploaded there show at the top of the product page and with the app in search results on iOS 27 and iPadOS 27 or later. They are optional and set per language; without them the store keeps showing screenshots there. Build them with \`set_creative_assets\` from the same screenshots and theme as the slides:
${Object.entries(PLACEMENTS)
  .map(([id, p]) => `- \`${id}\`: ${p.label}, ${p.width}×${p.height} (${p.ratio}). ${p.note} Safe area ${p.safe.width}×${p.safe.height} at ${p.safe.x},${p.safe.y}.`)
  .join("\n")}
The store crops these images differently per device and orientation, and only the safe area is always shown. So the copy is always centred and kept inside it, and everything outside it has to work as decoration that may be cut off. A header and a search asset can be made separately, or one \`universal\` asset serves both (App Store Connect's "Use header asset in search results" switch needs the universal file).
Each asset takes \`layout\`, \`eyebrow\`, \`headline\`, \`subheadline\`, \`screenshots\` (a list of names, most important first), \`badges\` (up to 3), \`background\`, \`font\`, \`textColor\`, \`accentColor\`, \`textScale\` and \`device\` (\`frame\`, \`color\`, \`scale\`, \`shadow\`). What an asset leaves out comes from the project theme. Layouts:
${Object.entries(CREATIVE_LAYOUTS)
  .map(([id, note]) => `- \`${id}\`: ${note}`)
  .join("\n")}
Without screenshots an asset is copy on the background; without copy it is the devices alone.
Apple reviews these assets and is stricter than with screenshots:
- One clear idea. The headline is a short phrase that adds to the picture and makes the app's purpose obvious at a glance; a subheadline is rarely needed. Text is optional.
- No prices, discounts, web addresses or copyright symbols, and no logos of or references to other platforms.
- No claims or awards that cannot be verified, and no Apple accolades at all (Editors' Choice, App of the Day, Game of the Day, Apple Design Award).
- Translate the text for every language the asset is uploaded for, or leave it out. The content has to suit a 4+ age rating.
\`render\` returns a preview of each asset with the safe area drawn as a dashed frame, which is not part of the PNG. Check that nothing important falls outside it.`;
}

function describe(project: Project, shots: Shot[], images: StoredImage[], base: string) {
  return {
    id: project.id,
    name: project.name,
    locales: project.locales,
    theme: project.theme,
    slides: project.slides.map((slide, i) => ({ slide: i + 1, ...slide })),
    creativeAssets: project.creatives,
    screenshots: shots.map((shot) => ({ name: shot.name, device: shot.device, size: `${shot.width}×${shot.height}` })),
    images: images.map((image) => ({ name: image.name, size: `${image.width}×${image.height}` })),
    exportSizes: defaultTargets(shots, project.targets),
    studio: `${base}/#/${project.id}`,
  };
}

const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });
const json = (value: unknown): CallToolResult => text(JSON.stringify(value, null, 2));

/** Tool failures go back to the model as readable text so it can correct the call. */
async function guard(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

function unknownScreenshots(project: Project, shots: Shot[]): string[] {
  const known = new Set(shots.map((shot) => shot.name));
  const missing = new Set<string>();
  const named = [...project.slides.flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3]), ...Object.values(project.creatives).flatMap((creative) => creative?.screenshots ?? [])];
  for (const name of named) if (name && !known.has(name)) missing.add(name);
  return [...missing];
}

function unknownImages(project: Project, images: StoredImage[]): string[] {
  const known = new Set(images.map((image) => image.name));
  const missing = new Set<string>();
  const named = [
    ...project.slides.flatMap((slide) => [slide.logo?.image, ...(slide.images ?? []).map((placed) => placed.image)]),
    ...Object.values(project.creatives).map((creative) => creative?.logo?.image),
  ];
  for (const name of named) if (name && !known.has(name)) missing.add(name);
  return [...missing];
}

/** What a project names without having it: screenshots come out as placeholders, images are left out. */
async function missingNote(space: Space, project: Project, shots?: Shot[]): Promise<string> {
  const screenshots = unknownScreenshots(project, shots ?? (await listShots(space, project.id)));
  const images = unknownImages(project, await listImages(space, project.id));
  return [
    screenshots.length ? `\nNot uploaded yet, so these will render as placeholders: ${screenshots.join(", ")}.` : "",
    images.length ? `\nNo image is uploaded under these names, so they will be left out: ${images.join(", ")}.` : "",
  ].join("");
}

/** A small JPEG of a rendered asset with the safe area drawn in, so the model can check what a narrow crop keeps. */
async function creativePreview(file: string, placement: PlacementId): Promise<string> {
  const { width, height, safe } = PLACEMENTS[placement];
  const scale = 1400 / width;
  const [w, h] = [1400, Math.round(height * scale)];
  const frame = (colour: string, extra: string) =>
    `<rect x="${safe.x * scale}" y="${safe.y * scale}" width="${safe.width * scale}" height="${safe.height * scale}" fill="none" stroke="${colour}" stroke-width="3" ${extra}/>`;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${frame("#FFFFFF", 'stroke-opacity=".7"')}${frame("#FF2D78", 'stroke-dasharray="12 8"')}</svg>`;
  const data = await sharp(file)
    .resize(w, h)
    .composite([{ input: Buffer.from(overlay) }])
    .jpeg({ quality: 80 })
    .toBuffer();
  return data.toString("base64");
}

const project = slugSchema.describe("Project id");
const slideNumber = z.number().int().min(1).max(10).describe("Slide number, starting at 1");

/** `space` is the account the request was authenticated as; every tool works inside it. */
export function createMcpServer(base: string, space: Space): McpServer {
  const server = new McpServer(
    { name: "appshots", version: "0.1.0" },
    {
      instructions:
        "Generates App Store screenshots: raw app screenshots placed in device frames with headlines, backgrounds and social-proof badges, exported at exact store sizes. Also makes the product page header and search results assets of App Store Connect. Call get_design_guide first.",
    },
  );

  server.registerTool(
    "get_design_guide",
    {
      title: "Design guide",
      description:
        "How to use this server: the workflow, how screenshots get uploaded, every layout, background, font, device option and badge, and the rules for header and search results assets. Read this before building a set.",
      annotations: { readOnlyHint: true },
    },
    () => guard(async () => text(designGuide(base))),
  );

  server.registerTool(
    "list_projects",
    { title: "List projects", description: "Lists the screenshot projects of this account.", annotations: { readOnlyHint: true } },
    () =>
      guard(async () => {
        const projects = await listProjects(space);
        return json(projects.map((p) => ({ id: p.id, name: p.name, slides: p.slides.length, locales: p.locales, updatedAt: p.updatedAt })));
      }),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Creates a project (one per app) and returns its id plus how to upload raw screenshots into it.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("App or project name"),
        locales: z.array(localeSchema).min(1).max(40).optional().describe('Locales to render, default ["en"]'),
        theme: themeSchema.optional().describe("Styling shared by every slide"),
      },
    },
    (input) =>
      guard(async () => {
        const created = await createProject(space, input);
        return text(`Created project "${created.id}".\n\n${uploadHelp(base, created.id)}\n\nStudio: ${base}/#/${created.id}`);
      }),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Returns a project's theme, slides, header and search results assets, the raw screenshots, and the logos and other images uploaded so far.",
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    (input) => guard(async () => json(describe(await getProject(space, input.project), await listShots(space, input.project), await listImages(space, input.project), base))),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update project",
      description: "Changes a project's name, locales, theme or export sizes. The theme is replaced as a whole.",
      inputSchema: {
        project,
        name: z.string().min(1).max(80).optional(),
        locales: z.array(localeSchema).min(1).max(40).optional(),
        theme: themeSchema.optional(),
        targets: targetsSchema.optional().describe("Sizes every render and the ZIP hold from now on. [] goes back to the standard sizes of the devices the project has screenshots of"),
      },
    },
    ({ project: id, ...patch }) => guard(async () => json(describe(await updateProject(space, id, patch), await listShots(space, id), await listImages(space, id), base))),
  );

  server.registerTool(
    "set_slides",
    {
      title: "Set slides",
      description: "Replaces the project's whole slide set, in store order, and optionally its theme. Nothing is rendered until you call render.",
      inputSchema: {
        project,
        slides: z.array(slideSchema).min(1).max(10),
        theme: themeSchema.optional().describe("Replaces the project theme when given"),
      },
    },
    ({ project: id, slides, theme }) =>
      guard(async () => {
        const updated = await updateProject(space, id, { slides, theme });
        return text(`Saved ${slides.length} slide${slides.length === 1 ? "" : "s"}. Call render to see them.${await missingNote(space, updated)}`);
      }),
  );

  server.registerTool(
    "update_slide",
    {
      title: "Update slide",
      description: "Changes one slide. Fields in `changes` are merged over the slide (nested `device` included); list field names in `remove` to clear them.",
      inputSchema: {
        project,
        slide: slideNumber,
        changes: slideSchema.optional(),
        remove: z.array(z.string()).optional().describe("Slide fields to clear, e.g. [\"subheadline\", \"badges\"]"),
      },
    },
    ({ project: id, slide, changes, remove }) =>
      guard(async () => {
        const current = await getProject(space, id);
        const existing = current.slides[slide - 1];
        if (!existing) throw new Error(`Slide ${slide} does not exist; the project has ${current.slides.length}.`);
        const next: Record<string, unknown> = { ...existing, ...changes };
        if (changes?.device) next.device = { ...existing.device, ...changes.device };
        for (const field of remove ?? []) delete next[field];
        const slides = current.slides.map((s, i) => (i === slide - 1 ? slideSchema.parse(next) : s));
        await updateProject(space, id, { slides });
        const missing = unknownImages({ ...current, slides: [slides[slide - 1]!], creatives: {} }, await listImages(space, id));
        const result = json({ slide, ...slides[slide - 1] });
        if (missing.length) result.content.push({ type: "text", text: `No image is uploaded under these names, so they will be left out: ${missing.join(", ")}.` });
        return result;
      }),
  );

  server.registerTool(
    "set_creative_assets",
    {
      title: "Set header and search results assets",
      description:
        "Designs the wide images for the Header and Search Results tab of App Store Connect: the product page header, the search results asset, or one universal asset for both. Each asset given replaces that one; the others stay. Nothing is rendered until you call render.",
      inputSchema: {
        project,
        header: creativeSchema.optional().describe("Product page header, 3840×1646"),
        search: creativeSchema.optional().describe("Search results asset, 3840×2560"),
        universal: creativeSchema.optional().describe("Universal asset, 5244×2950, cropped by App Store Connect for both places"),
        remove: z.array(z.enum(PLACEMENT_IDS)).optional().describe("Assets to delete from the project"),
      },
    },
    ({ project: id, remove, ...given }) =>
      guard(async () => {
        const current = await getProject(space, id);
        const creatives = { ...current.creatives };
        for (const placement of PLACEMENT_IDS) if (given[placement]) creatives[placement] = given[placement];
        for (const placement of remove ?? []) delete creatives[placement];
        const updated = await updateProject(space, id, { creatives });
        const shots = await listShots(space, id);
        const lines = PLACEMENT_IDS.filter((placement) => updated.creatives[placement]).map((placement) => {
          const creative = updated.creatives[placement]!;
          const layout = creative.layout ?? "fan";
          const extra = (creative.screenshots?.length ?? 0) - CREATIVE_CAPACITY[layout];
          return `- ${placement}: ${PLACEMENTS[placement].label}, ${layout} layout${extra > 0 ? ` (it shows ${CREATIVE_CAPACITY[layout]} screenshots, so the last ${extra} will be left out)` : ""}`;
        });
        const note = await missingNote(space, updated, shots);
        return text(lines.length ? `The project now has these assets:\n${lines.join("\n")}\nCall render to see them.${note}` : "The project has no header or search results assets now.");
      }),
  );

  server.registerTool(
    "render",
    {
      title: "Render screenshots",
      description:
        "Renders the slides, and the header and search results assets if the project has any, to PNGs at exact App Store sizes. Returns images to review plus download links. Pass `slides` or `creatives` to re-render only those while iterating.",
      inputSchema: {
        project,
        slides: z.array(slideNumber).optional().describe("Slide numbers to render; all when omitted"),
        creatives: z
          .array(z.enum(PLACEMENT_IDS))
          .optional()
          .describe("Header and search results assets to render. Left out, all of them are rendered along with the slides; given alone, the slides are left as they are; [] skips the assets."),
        targets: z.array(z.enum(TARGET_IDS)).optional().describe("Sizes for this render only; defaults to the project's export sizes. While iterating, one size per device is enough, such as [\"iphone-6.9\"]"),
        locales: z.array(localeSchema).optional().describe("Defaults to every project locale"),
      },
    },
    ({ project: id, slides, creatives, targets, locales }) =>
      guard(async () => {
        const result = await renderProject(space, id, { targets, locales, creatives, slides: slides?.map((n) => n - 1) });
        const count = result.files.length + result.creatives.length;
        const lines = [`Rendered ${count} PNG${count === 1 ? "" : "s"}.`];
        const sets = new Map<string, typeof result.files>();
        for (const file of result.files) sets.set(`${file.target} ${file.locale}`, [...(sets.get(`${file.target} ${file.locale}`) ?? []), file]);
        for (const [first, ...rest] of [...sets.values()].map((set) => set.sort((a, b) => a.slide - b.slide))) {
          const size = TARGETS[first!.target];
          const source = sourceOf(first!.target);
          const copy = source === first!.target ? "" : `, the ${source} picture scaled`;
          lines.push("", `${first!.target} (${size.width}×${size.height}, for "${size.slot}"${copy}), ${first!.locale}:`);
          // A scaled size shows nothing its source does not, so its files are named by their folder.
          if (copy && sets.has(`${source} ${first!.locale}`)) lines.push(`  ${rest.length ? `${rest.length + 1} files` : "1 file"} under ${base}/files/${id}/out/${path.dirname(first!.path)}/`);
          else for (const file of [first!, ...rest]) lines.push(`  ${String(file.slide + 1).padStart(2, "0")}  ${base}/files/${id}/out/${file.path}`);
        }
        if (result.creatives.length) {
          lines.push("", "Header and search results assets (the dashed frame in the previews marks the safe area and is not in the PNG):");
          for (const file of result.creatives) lines.push(`  ${file.placement} (${file.width}×${file.height}), ${file.locale}  ${base}/files/${id}/out/${file.path}`);
        }
        lines.push("", `Studio: ${base}/#/${id}`, `ZIP of everything: ${base}/api/projects/${id}/export.zip (or \`appshots pull ${id}\`)`);
        if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));

        const content: CallToolResult["content"] = [{ type: "text", text: lines.join("\n") }];
        // One sheet per shape is enough to judge the design; other locales differ only in copy.
        const shown = result.sheets.filter((sheet) => sheet.locale === result.sheets[0]!.locale).slice(0, 4);
        for (const sheet of shown) {
          const data = await readFile(path.join(outDir(space, id), sheet.path));
          content.push({ type: "image", data: data.toString("base64"), mimeType: "image/jpeg" });
        }
        for (const file of result.creatives.filter((creative) => creative.locale === result.creatives[0]!.locale)) {
          content.push({ type: "image", data: await creativePreview(path.join(outDir(space, id), file.path), file.placement), mimeType: "image/jpeg" });
        }
        return { content };
      }),
  );

  return server;
}
