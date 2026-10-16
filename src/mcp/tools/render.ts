import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import sharp from "sharp";
import { z } from "zod";
import { rendersLeft } from "../../accounts.ts";
import { fitSummary } from "../../domain/lint.ts";
import {
  cancelRender,
  getRender,
  listingSet,
  listRenders,
  type RenderedSheet,
  type RenderJob,
  type RenderResult,
  renderProject,
  renderResult,
  resolveLocales,
  startRender,
  storeListing,
} from "../../render.ts";
import { localeSchema } from "../../schema.ts";
import { type RenderCheck, checkRender } from "../../services/check.ts";
import { DEVICE_KINDS, DEVICE_LABELS, type DeviceKind, PLACEMENT_IDS, PLACEMENTS, type PlacementId, sourceOf, TARGET_IDS, TARGETS } from "../../sizes.ts";
import { getProject, InputError, NotFoundError, outDir } from "../../store.ts";
import { projectInput as project, type RegisterTools, slideNumber, type ToolContext } from "../context.ts";
import { guard, json, text } from "../result.ts";

/** How many contact sheets a render answers with. Each is a large image in the model's context. */
const SHEETS_SHOWN = 4;

/**
 * The contact sheets to show, of the first language only: the other languages differ in their copy alone. One per
 * device comes first, so a Mac set is never crowded out by the sizes of another device; the rest follow while
 * there is room.
 */
export function pickSheets(sheets: RenderedSheet[], cap = SHEETS_SHOWN): { shown: RenderedSheet[]; left: RenderedSheet[] } {
  const first = sheets.filter((sheet) => sheet.locale === sheets[0]?.locale);
  const leading = DEVICE_KINDS.map((kind) => first.find((sheet) => TARGETS[sheet.target].device === kind)).filter((sheet) => sheet != null);
  const ordered = [...leading, ...first.filter((sheet) => !leading.includes(sheet))];
  return { shown: ordered.slice(0, cap), left: ordered.slice(cap) };
}

/**
 * A small JPEG of a rendered asset. A store asset has its safe area drawn in, so the model can check what a narrow
 * crop keeps; a banner is shown whole and has none.
 */
async function creativePreview(file: string, placement: PlacementId): Promise<string> {
  const { width, height, safe, kind } = PLACEMENTS[placement];
  const scale = 1400 / width;
  const [w, h] = [1400, Math.round(height * scale)];
  const frame = (colour: string, extra: string) =>
    `<rect x="${safe.x * scale}" y="${safe.y * scale}" width="${safe.width * scale}" height="${safe.height * scale}" fill="none" stroke="${colour}" stroke-width="3" ${extra}/>`;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${frame("#FFFFFF", 'stroke-opacity=".7"')}${frame("#FF2D78", 'stroke-dasharray="12 8"')}</svg>`;
  const data = await sharp(file)
    .resize(w, h)
    .composite(kind === "store" ? [{ input: Buffer.from(overlay) }] : [])
    .jpeg({ quality: 80 })
    .toBuffer();
  return data.toString("base64");
}

/** A check of a render as the tool answers it: whether it would start, what it would draw, what it would warn about. */
export function describeCheck(check: RenderCheck): string {
  const lines: string[] = [];
  if (check.ok) lines.push("A render of this would start.");
  else lines.push("A render of this would be refused:", ...check.refused.map((reason) => `- ${reason}`));
  if (check.plan) {
    const { plan } = check;
    const runs = (indexes: number[]) => indexes.map((index) => index + 1).join(", ");
    const slides = Object.entries(plan.slides).map(([device, indexes]) => `${DEVICE_LABELS[device as DeviceKind]} slides ${runs(indexes)}`);
    const creatives = plan.creatives.length ? [plan.creatives.join(", ")] : [];
    lines.push(`It would draw ${[...slides, ...creatives].join("; ")} in ${plan.locales.join(", ")}, at the sizes ${plan.targets.join(", ")}.`);
  }
  if (check.warnings.length) lines.push("", "It would warn:", ...check.warnings.map((warning) => `- ${warning}`));
  lines.push("", `Checking used no render.${check.rendersLeft == null ? "" : ` Renders left on this account: ${check.rendersLeft}.`}`);
  return lines.join("\n");
}

/** How a render answers: with the pictures to check, with the store preview in their place, or in words alone. */
interface AnswerOptions {
  previews?: boolean;
  preview?: "store";
}

/** What a finished render wrote: links to every file, warnings, and pictures of it to check. */
async function renderAnswer(tools: ToolContext, id: string, result: RenderResult, { previews, preview }: AnswerOptions = {}): Promise<CallToolResult> {
  const { base, space } = tools;
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
  for (const kind of ["store", "banner"] as const) {
    const drawn = result.creatives.filter((file) => PLACEMENTS[file.placement].kind === kind);
    if (drawn.length === 0) continue;
    lines.push("", kind === "store" ? "Header and search results assets (the dashed frame in the previews marks the safe area and is not in the PNG):" : "Banners:");
    for (const file of drawn) lines.push(`  ${file.placement} (${file.width}×${file.height}), ${file.locale}  ${base}/files/${id}/out/${file.path}`);
  }
  lines.push("", `Studio: ${base}/#/${id}`, `ZIP of everything: ${base}/api/projects/${id}/export.zip (or \`appshots pull ${id}\`)`, `Into App Store Connect, from the user's Mac with their own API key: \`appshots store push ${id} --app <bundle id> --dry-run\``);
  const left = rendersLeft(space.id);
  if (left != null) lines.push("", left === 0 ? "That was this account's last render. The person who runs the server can give it more." : `Renders left on this account: ${left}.`);
  if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  // Without pictures, the words have to say what the pictures would have shown.
  const shown = previews !== false;
  if (!shown) {
    const summary = fitSummary(result.fit);
    if (summary.length) lines.push("", ...summary);
    if (result.sheets.length) lines.push("", `Contact sheets: ${result.sheets.map((sheet) => `${base}/files/${id}/out/${sheet.path}`).join(", ")}`);
  }
  const listed = shown && preview === "store" ? listingSet(result.files) : undefined;
  if (shown && preview === "store" && !listed) lines.push("", "No slides were rendered, so there is no store preview: it shows the first three slides of a set.");
  if (listed) lines.push("", `The store preview shows the first three slides of ${listed.target}, ${listed.locale}: a search result and the product page, light and dark. The store's own text and buttons are drawn as plain shapes.`);
  const sheets = pickSheets(listed ? [] : result.sheets);
  if (shown && !listed && sheets.left.length) lines.push("", `Contact sheets not shown here, to keep the answer small: ${sheets.left.map((sheet) => `${base}/files/${id}/out/${sheet.path}`).join(", ")}`);
  if (listed && result.sheets.length) lines.push("", `Contact sheets: ${result.sheets.map((sheet) => `${base}/files/${id}/out/${sheet.path}`).join(", ")}`);

  const content: CallToolResult["content"] = [{ type: "text", text: lines.join("\n") }];
  if (!shown) return { content };
  if (listed) {
    const data = await storeListing(space, await getProject(space, id), listed);
    content.push({ type: "image", data: data.toString("base64"), mimeType: "image/jpeg" });
  }
  // A render of the project since may have replaced or removed a picture: what is there is shown, what is gone left out.
  for (const sheet of sheets.shown) {
    const data = await readFile(path.join(outDir(space, id), sheet.path)).catch(() => null);
    if (data) content.push({ type: "image", data: data.toString("base64"), mimeType: "image/jpeg" });
  }
  for (const file of result.creatives.filter((creative) => creative.locale === result.creatives[0]!.locale)) {
    const preview = await creativePreview(path.join(outDir(space, id), file.path), file.placement).catch(() => null);
    if (preview) content.push({ type: "image", data: preview, mimeType: "image/jpeg" });
  }
  return { content };
}

/** Where a render that has not finished stands, in a sentence. */
function standing(job: RenderJob): string {
  const named = `The render ${job.id} of "${job.name}" (${job.project})`;
  switch (job.state) {
    case "queued":
      return `${named} waits for its turn. Ask again in a few seconds.`;
    case "running":
      return `${named} is drawing: ${job.done} of ${job.total} pictures. Ask again in a few seconds.`;
    case "failed":
      return `${named} failed: ${job.error ?? "it stopped with an error on the server."}`;
    case "cancelled":
      return `${named} was cancelled. It kept nothing, and used no render.`;
    default:
      return `${named} is done.`;
  }
}

export const registerRenderTools: RegisterTools = (server, tools) => {
  const { space } = tools;

  // What render and its check both take, so that a call can be checked and then made as it is. Render also takes how
  // it answers, which a check strips and has no use for.
  const request = {
    project,
    slides: z.array(slideNumber).optional().describe("Slide numbers to render; all when omitted"),
    creatives: z
      .array(z.enum(PLACEMENT_IDS))
      .optional()
      .describe("Header and search results assets and banners to render. Left out, all of them are rendered along with the slides; given alone, the slides are left as they are; [] skips them."),
    targets: z.array(z.enum(TARGET_IDS)).optional().describe("Sizes for this render only; defaults to the project's export sizes. While iterating, one size per device is enough, such as [\"iphone-6.9\"]"),
    locales: z.array(localeSchema).optional().describe("Defaults to every project locale"),
  };
  // How a finished render answers, by render itself or by get_render once one in the background is done.
  const answer = {
    previews: z
      .boolean()
      .optional()
      .describe("false answers with no images: the links, the warnings, and how small each language's copy was set. For a render of many languages, or to check copy after an edit. Default true"),
    preview: z
      .enum(["store"])
      .optional()
      .describe("store shows, in place of the contact sheets, the first three slides as the App Store shows them: in a search result and on the product page, light and dark"),
  };

  server.registerTool(
    "check_project",
    {
      title: "Check before rendering",
      description:
        "Says what `render` would do with the same arguments, without drawing anything or using a render: whether it would be refused and why, what it would draw, and what it would warn about, such as a screenshot or image name nothing is uploaded under. Call it before every render and fix what it names.",
      inputSchema: request,
      annotations: { readOnlyHint: true },
    },
    ({ project: id, slides, creatives, targets, locales }) =>
      guard(tools, "check_project", async () => text(describeCheck(await checkRender(space, id, { targets, locales, creatives, slides: slides?.map((n) => n - 1) })))),
  );

  server.registerTool(
    "render",
    {
      title: "Render screenshots",
      description:
        "Renders the slides to PNGs at exact App Store sizes, and the header and search results assets and the banners if the project has any. Returns images to review plus download links, and warnings where the copy had to shrink, runs long, or breaks the store's rules. Pass `slides` or `creatives` to re-render only those while iterating.",
      inputSchema: {
        ...request,
        ...answer,
        background: z
          .boolean()
          .optional()
          .describe("Answer at once with the render's job rather than wait for its pictures, such as for a large set or a client that gives up on long calls. get_render follows it, and answers with the pictures once it is done"),
      },
    },
    ({ project: id, slides, creatives, targets, locales, previews, preview, background }, extra) =>
      guard(tools, "render", async () => {
        const request = { targets, locales, creatives, slides: slides?.map((n) => n - 1) };
        if (background) {
          const stored = await getProject(space, id);
          resolveLocales(stored, locales);
          const { job, finished, read } = startRender(space, id, request, stored.name);
          // What it fails with is for get_render to say; only the server's own trouble goes to the log.
          finished.catch((error: unknown) => {
            if (!(error instanceof InputError || error instanceof NotFoundError)) tools.log.error(error);
          });
          // Answered once the run has read the screenshots, so one deleted after the answer is missing from the run,
          // not from its plan.
          await read;
          const left = rendersLeft(space.id);
          return text(
            [
              `Started the render ${job.id} of "${job.name}". It waits for its turn, then draws.`,
              `Follow it with get_render and {"job": "${job.id}"}: once it is done, that answers with the pictures and the links. cancel_render stops it.`,
              ...(left == null ? [] : [`Renders left on this account: ${left}.`]),
            ].join("\n"),
          );
        }
        // A client that gives up on the call cancels the render, and the account gets the render back.
        return renderAnswer(tools, id, await renderProject(space, id, request, { signal: extra.signal }), { previews, preview });
      }),
  );

  server.registerTool(
    "get_render",
    {
      title: "Follow a render",
      description:
        "How a render started with `background` is getting on: waiting, drawing and how far, or ended and why. Once it is done, answers as render does, with the pictures to check and the links. Without `job`, lists the account's renders: those waiting or under way, and those that ended in the last hour, the newest eight at most.",
      inputSchema: {
        job: z.string().optional().describe("The job id render answered with"),
        ...answer,
      },
      annotations: { readOnlyHint: true },
    },
    ({ job, previews, preview }) =>
      guard(tools, "get_render", async () => {
        if (job === undefined) return json(listRenders(space));
        const found = getRender(space, job);
        const result = found.state === "done" ? renderResult(space, job) : undefined;
        return result ? renderAnswer(tools, found.project, result, { previews, preview }) : text(standing(found));
      }),
  );

  server.registerTool(
    "cancel_render",
    {
      title: "Cancel a render",
      description: "Stops a render that waits or draws. It keeps nothing it drew, the pictures from before stay as they were, and it uses no render.",
      inputSchema: {
        job: z.string().describe("The job id render answered with"),
      },
    },
    ({ job }) =>
      guard(tools, "cancel_render", async () => {
        const found = getRender(space, job);
        if (found.state !== "queued" && found.state !== "running") return text(`The render ${job} has ended already: ${found.state}.`);
        cancelRender(space, job);
        return text(`Cancelled the render ${job} of "${found.name}". One that was drawing stops after the picture under way.`);
      }),
  );
};
