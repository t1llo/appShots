import { z } from "zod";
import { InputError } from "../../domain/errors.ts";
import { mockupName } from "../../mockup.ts";
import { type Mockup, mockupSheet, renderMockup } from "../../render.ts";
import { localeSchema, mockupsSchema, slugSchema } from "../../schema.ts";
import { NothingToDraw, prepare } from "../../services/mockups.ts";
import { projectInput as project, type RegisterTools } from "../context.ts";
import { mockupDeviceInput } from "../inputs.ts";
import { uploadHelp } from "../guide/index.ts";
import { guard } from "../result.ts";

export const registerMockupTools: RegisterTools = (server, tools) => {
  const { base, space } = tools;

  server.registerTool(
    "render_mockups",
    {
      title: "Render device mockups",
      description:
        "Draws the project's raw screenshots inside their devices with nothing behind them: one transparent PNG per screenshot, for a website, a README or a press kit. Needs no slides and uses no render. Not for App Store Connect, which takes no transparency. Returns a preview and download links.",
      inputSchema: {
        project,
        screenshots: z.array(slugSchema).optional().describe("Screenshot names to draw; every screenshot when omitted"),
        locale: localeSchema.optional().describe("The language whose screenshots are drawn. Defaults to the project's first"),
        device: mockupDeviceInput(
          "How every mockup is drawn: {frame, style, color, shadow, rotate, perspective, statusBar, statusBarTime, statusBarColor}, as in design guide topic device. Saved with the project and laid over what was set before, so a call can change one field; {} goes back to the defaults. Left out, the saved one is used",
        ),
        width: mockupsSchema.shape.width.unwrap().nullable().optional().describe("Width of each PNG in pixels, saved with the project. null goes back to showing the screenshot pixel for pixel"),
      },
    },
    ({ project: id, screenshots, locale, device, width }) =>
      guard(tools, "render_mockups", async () => {
        const { project: current, language, wanted } = await prepare(tools.ctx, id, { screenshots, locale, device, width }).catch((error: unknown) => {
          throw error instanceof NothingToDraw ? new InputError(`${error.message}\n\n${uploadHelp(base, id)}`) : error;
        });

        const drawn: Mockup[] = [];
        const lines = [`Drew ${wanted.length} mockup${wanted.length === 1 ? "" : "s"}, each a PNG with nothing behind the device.`, ""];
        const pad = Math.max(...wanted.map((shot) => mockupName(shot).length));
        for (const shot of wanted) {
          const mockup = await renderMockup(space, current, shot);
          drawn.push(mockup);
          lines.push(`  ${mockupName(shot).padEnd(pad)}  ${mockup.width}×${mockup.height}  ${base}/api/projects/${id}/mockups/${encodeURIComponent(shot.file)}`);
        }
        const query = language === current.locales[0] ? "" : `?locale=${encodeURIComponent(language)}`;
        lines.push(
          "",
          `ZIP of them all: ${base}/api/projects/${id}/mockups.zip${query} (or \`appshots mockups ${id}${query ? ` --lang ${language}` : ""}\`, which unpacks it into ./mockups/${id}/)`,
          `Studio: ${base}/#/${id}/mockups`,
          "",
          "The preview below shows them on grey. The PNGs themselves are transparent around the device.",
        );
        // Eight are enough to judge the look; the rest differ only in the screenshot.
        const sheet = await mockupSheet(drawn.slice(0, 8));
        return { content: [{ type: "text", text: lines.join("\n") }, { type: "image", data: sheet.toString("base64"), mimeType: "image/jpeg" }] };
      }),
  );
};
