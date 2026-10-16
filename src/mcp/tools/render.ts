import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import sharp from "sharp";
import { z } from "zod";
import { rendersLeft } from "../../accounts.ts";
import { fitSummary } from "../../domain/lint.ts";
import { listingSet, type RenderedSheet, renderProject, storeListing } from "../../render.ts";
import { localeSchema } from "../../schema.ts";
import { DEVICE_KINDS, PLACEMENT_IDS, PLACEMENTS, type PlacementId, sourceOf, TARGET_IDS, TARGETS } from "../../sizes.ts";
import { getProject, outDir } from "../../store.ts";
import { projectInput as project, type RegisterTools, slideNumber } from "../context.ts";
import { guard } from "../result.ts";

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

export const registerRenderTools: RegisterTools = (server, tools) => {
  const { base, space } = tools;

  server.registerTool(
    "render",
    {
      title: "Render screenshots",
      description:
        "Renders the slides to PNGs at exact App Store sizes, and the header and search results assets and the banners if the project has any. Returns images to review plus download links, and warnings where the copy had to shrink, runs long, or breaks the store's rules. Pass `slides` or `creatives` to re-render only those while iterating.",
      inputSchema: {
        project,
        slides: z.array(slideNumber).optional().describe("Slide numbers to render; all when omitted"),
        creatives: z
          .array(z.enum(PLACEMENT_IDS))
          .optional()
          .describe("Header and search results assets and banners to render. Left out, all of them are rendered along with the slides; given alone, the slides are left as they are; [] skips them."),
        targets: z.array(z.enum(TARGET_IDS)).optional().describe("Sizes for this render only; defaults to the project's export sizes. While iterating, one size per device is enough, such as [\"iphone-6.9\"]"),
        locales: z.array(localeSchema).optional().describe("Defaults to every project locale"),
        previews: z
          .boolean()
          .optional()
          .describe("false answers with no images: the links, the warnings, and how small each language's copy was set. For a render of many languages, or to check copy after an edit. Default true"),
        preview: z
          .enum(["store"])
          .optional()
          .describe("store shows, in place of the contact sheets, the first three slides as the App Store shows them: in a search result and on the product page, light and dark"),
      },
    },
    ({ project: id, slides, creatives, targets, locales, previews, preview }) =>
      guard(tools, "render", async () => {
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
          lines.push("", ...fitSummary(result.fit));
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
        for (const sheet of sheets.shown) {
          const data = await readFile(path.join(outDir(space, id), sheet.path));
          content.push({ type: "image", data: data.toString("base64"), mimeType: "image/jpeg" });
        }
        for (const file of result.creatives.filter((creative) => creative.locale === result.creatives[0]!.locale)) {
          content.push({ type: "image", data: await creativePreview(path.join(outDir(space, id), file.path), file.placement), mimeType: "image/jpeg" });
        }
        return { content };
      }),
  );
};
