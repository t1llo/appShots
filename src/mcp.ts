import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BACKGROUNDS, BADGE_TYPES, DEVICE_COLOR_IDS, FONTS, ICON_IDS, LAYOUTS } from "./design.ts";
import { defaultTargets, renderProject } from "./render.ts";
import { localeSchema, type Project, slideSchema, slugSchema, themeSchema } from "./schema.ts";
import { TARGET_IDS, TARGETS } from "./sizes.ts";
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
5. The user downloads the PNGs from ${base}/#/<project> or with \`appshots pull <project>\`.

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
- \`{"type":"laurel","icon":"trophy","title":"App of the Day","subtitle":"Featured"}\`
Only use figures and awards the app really has: App Review rejects screenshots with invented ratings, download counts or accolades.

## Copy
- Headline: two to five words, one benefit per slide, verb first where it fits. Wrap a word in *asterisks* to tint it with \`accentColor\` (with no accent set, the rest of the headline dims instead). \`\\n\` forces a line break.
- Subheadline: one short sentence, or leave it out.
- Any text field also accepts \`{"en":"…","de":"…"}\`; list the locales on the project and every one is rendered.
- Slide 1 does the selling: lead with the main benefit, or use the \`hero\` layout with real social proof. Vary layouts across the set so it does not read as one template repeated.`;
}

function describe(project: Project, shots: Shot[], base: string) {
  return {
    id: project.id,
    name: project.name,
    locales: project.locales,
    theme: project.theme,
    slides: project.slides.map((slide, i) => ({ slide: i + 1, ...slide })),
    screenshots: shots.map((shot) => ({ name: shot.name, device: shot.device, size: `${shot.width}×${shot.height}` })),
    defaultTargets: defaultTargets(shots),
    gallery: `${base}/#/${project.id}`,
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
  for (const slide of project.slides) {
    for (const name of [slide.screenshot, slide.screenshot2]) if (name && !known.has(name)) missing.add(name);
  }
  return [...missing];
}

const project = slugSchema.describe("Project id");
const slideNumber = z.number().int().min(1).max(10).describe("Slide number, starting at 1");

/** `space` is the account the request was authenticated as; every tool works inside it. */
export function createMcpServer(base: string, space: Space): McpServer {
  const server = new McpServer(
    { name: "appshots", version: "0.1.0" },
    {
      instructions:
        "Generates App Store screenshots: raw app screenshots placed in device frames with headlines, backgrounds and social-proof badges, exported at exact store sizes. Call get_design_guide first.",
    },
  );

  server.registerTool(
    "get_design_guide",
    {
      title: "Design guide",
      description: "How to use this server: the workflow, how screenshots get uploaded, and every layout, background, font, device option and badge. Read this before building a set.",
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
        return text(`Created project "${created.id}".\n\n${uploadHelp(base, created.id)}\n\nGallery: ${base}/#/${created.id}`);
      }),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Returns a project's theme, slides and the raw screenshots uploaded so far.",
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
    "render",
    {
      title: "Render screenshots",
      description:
        "Renders the slides to PNGs at exact App Store sizes and returns a contact sheet image to review, plus download links. Pass `slides` to re-render only some while iterating.",
      inputSchema: {
        project,
        slides: z.array(slideNumber).optional().describe("Slide numbers to render; all when omitted"),
        targets: z.array(z.enum(TARGET_IDS)).optional().describe("Output sizes; defaults to iphone-6.9 plus ipad-13 when iPad screenshots exist"),
        locales: z.array(localeSchema).optional().describe("Defaults to every project locale"),
      },
    },
    ({ project: id, slides, targets, locales }) =>
      guard(async () => {
        const result = await renderProject(space, id, { targets, locales, slides: slides?.map((n) => n - 1) });
        const lines = [`Rendered ${result.files.length} PNG${result.files.length === 1 ? "" : "s"}.`];
        for (const sheet of result.sheets) {
          const size = TARGETS[sheet.target];
          lines.push("", `${sheet.target} (${size.width}×${size.height}), ${sheet.locale}:`);
          for (const file of result.files.filter((f) => f.target === sheet.target && f.locale === sheet.locale)) {
            lines.push(`  ${String(file.slide + 1).padStart(2, "0")}  ${base}/files/${id}/out/${file.path}`);
          }
        }
        lines.push("", `Gallery: ${base}/#/${id}`, `ZIP of everything: ${base}/api/projects/${id}/export.zip (or \`appshots pull ${id}\`)`);
        if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));

        const content: CallToolResult["content"] = [{ type: "text", text: lines.join("\n") }];
        // One sheet per size is enough to judge the design; other locales differ only in copy.
        const shown = result.sheets.filter((sheet) => sheet.locale === result.sheets[0]!.locale).slice(0, 3);
        for (const sheet of shown) {
          const data = await readFile(path.join(outDir(space, id), sheet.path));
          content.push({ type: "image", data: data.toString("base64"), mimeType: "image/jpeg" });
        }
        return { content };
      }),
  );

  return server;
}
