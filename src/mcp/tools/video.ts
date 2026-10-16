import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { rendersLeft } from "../../accounts.ts";
import { slugSchema } from "../../schema.ts";
import type { Space } from "../../store.ts";
import { type VideoLayersBody, videoLayersShape } from "../../video/request.ts";
import { type LayersAnswer, videoService } from "../../video/service.ts";

/** Tool failures go back to the model as readable text so it can correct the call. */
async function guard(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

/** What the model reads of a set: what was drawn, what to look at, where to get it. The manifest itself is the structured content. */
function summary(base: string, id: string, answer: LayersAnswer, left: number | null): string {
  const [width, height] = answer.size;
  const lines = [
    answer.charged
      ? `Drew ${answer.layers.length} layer${answer.layers.length === 1 ? "" : "s"} as set ${answer.set} (${width}×${height}; ${answer.locales.join(", ")}).`
      : `Set ${answer.set} (${width}×${height}; ${answer.locales.join(", ")}) was there already, with ${answer.layers.length} layer${answer.layers.length === 1 ? "" : "s"}. Nothing was charged.`,
  ];
  if (answer.warnings.length) {
    lines.push("", "Warnings:");
    for (const warning of answer.warnings) lines.push(`  ${warning.locale ?? "every language"}, ${warning.layer}: ${warning.detail}`);
  }
  lines.push(
    "",
    `ZIP of the set: ${base}${answer.zip}`,
    `Each layer is under ${base}/files/${id}/video/${answer.set}/. The video itself is recorded and cut on the user's Mac: \`appshots video guide\`.`,
  );
  if (answer.charged && left != null) lines.push("", left === 0 ? "That was this account's last render. The person who runs the server can give it more." : `Renders left on this account: ${left}.`);
  return lines.join("\n");
}

/** The tools for app preview videos. The server draws their layers; the CLI records and cuts the video on the Mac. */
export function registerVideoTools(server: McpServer, { base, space }: { base: string; space: Space }): void {
  server.registerTool(
    "render_video_layers",
    {
      title: "Render app preview layers",
      description:
        "Draws the captions, intro and outro cards and background of an app preview video in the project's style, as transparent PNGs at the video size. The video itself is recorded and cut on the Mac by the appshots CLI (`appshots video guide`).",
      inputSchema: { project: slugSchema.describe("Project id"), ...videoLayersShape },
    },
    ({ project: id, ...body }, extra) =>
      guard(async () => {
        const started = await videoService.start(space, id, body as VideoLayersBody);
        let answer: LayersAnswer;
        if ("done" in started) answer = started.done;
        else {
          // A call the client gives up on stops its run, which then costs nothing.
          if (started.started) extra.signal.addEventListener("abort", () => videoService.cancel(space, started.job.id), { once: true });
          answer = await started.finished;
        }
        const left = rendersLeft(space.id);
        return { content: [{ type: "text", text: summary(base, id, answer, left) }], structuredContent: { ...answer, rendersLeft: left } };
      }),
  );
}
