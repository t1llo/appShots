import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import sharp from "sharp";
import { CREATIVE_CAPACITY } from "./creative.ts";
import { BACKGROUNDS, BADGE_TYPES, CREATIVE_LAYOUTS, DEVICE_COLOR_IDS, FONTS, ICON_IDS, LAYOUTS } from "./design.ts";
import { defaultTargets, renderProject } from "./render.ts";
import { creativeSchema, localeSchema, type Project, slideSchema, slugSchema, themeSchema } from "./schema.ts";
import { PLACEMENT_IDS, PLACEMENTS, type PlacementId, TARGET_IDS, TARGETS } from "./sizes.ts";
import { createProject, getProject, listProjects, listShots, outDir, type Shot, type Space, updateProject } from "./store.ts";

function uploadHelp(base: string, id: string): string {
  return [
    "This server cannot see the user's devices, so raw screenshots are captured on their Mac and uploaded:",
    `- With the bundled CLI: \`appshots capture --name home --project ${id}\` grabs the booted simulator; add \`--device\` for a connected iPhone or iPad. \`appshots upload ${id} path/to/*.png\` sends existing files.`,
    `- With curl: \`curl -fsS -X PUT -H "Authorization: Bearer $APPSHOTS_TOKEN" -H "Content-Type: image/png" --data-binary @home.png "${base}/api/projects/${id}/shots/home"\` (the token is the one this MCP connection uses)`,
    "The last path segment is the screenshot name slides refer to. iPhone or iPad is detected from the aspect ratio, and one name can hold both variants.",
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
${Object.entries(TARGETS)
  .map(([id, target]) => `- \`${id}\`: ${target.width}×${target.height} (${target.label})`)
  .join("\n")}
Default is \`iphone-6.9\`, plus \`ipad-13\` once the project has iPad screenshots. Portrait only. Up to 10 slides per set.

## Layouts
${list(LAYOUTS)}

## Backgrounds
Presets: ${Object.entries(BACKGROUNDS)
    .map(([id, def]) => `\`${id}\` (${def.type})`)
    .join(", ")}.
Also \`"auto"\` (a mesh gradient derived from the slide's own screenshot), any hex colour, or a custom object such as \`{"type":"mesh","colors":["#0B1020","#1A2B52","#2A2A5E"],"noise":0.4}\`. In a mesh the first colour is the base and the others are soft blobs over it. Text colour flips between black and white automatically.
The presets are deliberately muted. Keep custom colours the same way unless the user asks for something loud: one hue family, moderate saturation, so the screenshot stays the most colourful thing on the slide.

## Fonts
${Object.entries(FONTS)
  .map(([id, font]) => `- \`${id}\`: ${font.note}`)
  .join("\n")}

## Device
\`frame\`: auto, iphone, ipad or none (bare rounded screenshot). \`color\`: ${DEVICE_COLOR_IDS.join(", ")}. Also \`scale\`, \`rotate\`, \`perspective\` (left/right), \`offsetX\`/\`offsetY\` (percent of the canvas) and \`shadow\` (none/soft/strong).

## Badges
${list(BADGE_TYPES)}
Icons: ${ICON_IDS.join(", ")}. Up to 4 per slide; they shrink to stay on one row. Examples:
- \`{"type":"laurel","title":"10K+","subtitle":"Downloads"}\`
- \`{"type":"laurel","stars":5,"title":"4.9","subtitle":"App Store rating"}\`
- \`{"type":"icon","icon":"shield","title":"Private","subtitle":"No account needed"}\`
Only use figures and awards the app really has: App Review rejects screenshots with invented ratings, download counts or accolades.

## Copy
- Headline: two to five words, one benefit per slide, verb first where it fits. Wrap a word in *asterisks* to tint it with \`accentColor\` (with no accent set, the rest of the headline dims instead). \`\\n\` forces a line break.
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

function describe(project: Project, shots: Shot[], base: string) {
  return {
    id: project.id,
    name: project.name,
    locales: project.locales,
    theme: project.theme,
    slides: project.slides.map((slide, i) => ({ slide: i + 1, ...slide })),
    creativeAssets: project.creatives,
    screenshots: shots.map((shot) => ({ name: shot.name, device: shot.device, size: `${shot.width}×${shot.height}` })),
    defaultTargets: defaultTargets(shots),
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
  const named = [...project.slides.flatMap((slide) => [slide.screenshot, slide.screenshot2]), ...Object.values(project.creatives).flatMap((creative) => creative?.screenshots ?? [])];
  for (const name of named) if (name && !known.has(name)) missing.add(name);
  return [...missing];
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
      description: "Returns a project's theme, slides, header and search results assets, and the raw screenshots uploaded so far.",
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    (input) => guard(async () => json(describe(await getProject(space, input.project), await listShots(space, input.project), base))),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update project",
      description: "Changes a project's name, locales or theme. The theme is replaced as a whole.",
      inputSchema: {
        project,
        name: z.string().min(1).max(80).optional(),
        locales: z.array(localeSchema).min(1).max(40).optional(),
        theme: themeSchema.optional(),
      },
    },
    ({ project: id, ...patch }) => guard(async () => json(describe(await updateProject(space, id, patch), await listShots(space, id), base))),
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
        const missing = unknownScreenshots(updated, await listShots(space, id));
        const note = missing.length ? `\nNot uploaded yet, so these will render as placeholders: ${missing.join(", ")}.` : "";
        return text(`Saved ${slides.length} slide${slides.length === 1 ? "" : "s"}. Call render to see them.${note}`);
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
        return json({ slide, ...slides[slide - 1] });
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
        const missing = unknownScreenshots(updated, shots);
        const note = missing.length ? `\nNot uploaded yet, so these will render as placeholders: ${missing.join(", ")}.` : "";
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
        targets: z.array(z.enum(TARGET_IDS)).optional().describe("Slide sizes; defaults to iphone-6.9 plus ipad-13 when iPad screenshots exist"),
        locales: z.array(localeSchema).optional().describe("Defaults to every project locale"),
      },
    },
    ({ project: id, slides, creatives, targets, locales }) =>
      guard(async () => {
        const result = await renderProject(space, id, { targets, locales, creatives, slides: slides?.map((n) => n - 1) });
        const count = result.files.length + result.creatives.length;
        const lines = [`Rendered ${count} PNG${count === 1 ? "" : "s"}.`];
        for (const sheet of result.sheets) {
          const size = TARGETS[sheet.target];
          lines.push("", `${sheet.target} (${size.width}×${size.height}), ${sheet.locale}:`);
          for (const file of result.files.filter((f) => f.target === sheet.target && f.locale === sheet.locale)) {
            lines.push(`  ${String(file.slide + 1).padStart(2, "0")}  ${base}/files/${id}/out/${file.path}`);
          }
        }
        if (result.creatives.length) {
          lines.push("", "Header and search results assets (the dashed frame in the previews marks the safe area and is not in the PNG):");
          for (const file of result.creatives) lines.push(`  ${file.placement} (${file.width}×${file.height}), ${file.locale}  ${base}/files/${id}/out/${file.path}`);
        }
        lines.push("", `Studio: ${base}/#/${id}`, `ZIP of everything: ${base}/api/projects/${id}/export.zip (or \`appshots pull ${id}\`)`);
        if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));

        const content: CallToolResult["content"] = [{ type: "text", text: lines.join("\n") }];
        // One sheet per size is enough to judge the design; other locales differ only in copy.
        const shown = result.sheets.filter((sheet) => sheet.locale === result.sheets[0]!.locale).slice(0, 3);
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
