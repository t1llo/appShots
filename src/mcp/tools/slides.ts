import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { setSlides, updateSlide } from "../../services/slides.ts";
import { DEVICE_LABELS } from "../../sizes.ts";
import { deviceKind, projectInput as project, type RegisterTools, slideNumber } from "../context.ts";
import { slideChangesInput, slideInput, themeInput } from "../inputs.ts";
import { guard, json, noted, notes, text } from "../result.ts";

export const registerSlideTools: RegisterTools = (server, tools) => {
  const { ctx } = tools;

  server.registerTool(
    "set_slides",
    {
      title: "Set slides",
      description:
        "Replaces a whole slide set, in store order, and optionally the theme. Without `device` it is the project's shared set, which every device draws that has none of its own. With `device` it is that device's own set, composed for its canvas; an empty list there takes the device's own set away again. Nothing is rendered until you call render.",
      inputSchema: {
        project,
        // Loose, so that a field slides do not have reaches the tool and can be named in the answer.
        slides: z.array(slideInput.loose()).max(10),
        device: deviceKind.optional().describe("The device this set is for: it then draws these slides in place of the shared ones. Left out, the shared set is replaced"),
        theme: themeInput.optional().describe("Replaces the project theme when given"),
      },
    },
    ({ project: id, slides, device, theme }) =>
      guard(tools, "set_slides", async () => {
        const { ownSets, warnings } = await setSlides(ctx, id, { slides, device, theme });
        const count = `${slides.length} slide${slides.length === 1 ? "" : "s"}`;
        if (device) {
          const label = DEVICE_LABELS[device];
          if (slides.length === 0) return text(`The ${label} has no slide set of its own any more and shows the shared one.`);
          return text(`Saved ${count} for the ${label} alone. Call render to see them.${notes(warnings)}`);
        }
        const note = ownSets.length
          ? ` ${ownSets.map((kind) => DEVICE_LABELS[kind]).join(" and ")} ${ownSets.length === 1 ? "has a set of its own and does" : "have sets of their own and do"} not show these.`
          : "";
        return text(`Saved ${count}.${note} Call render to see them.${notes(warnings)}`);
      }),
  );

  server.registerTool(
    "update_slide",
    {
      title: "Update slide",
      description:
        "Changes one slide. Fields in `changes` are merged over the slide (nested `device` included); list field names in `remove` to clear them. `of` picks a device's own slide set; left out, the shared set is changed.",
      inputSchema: {
        project,
        slide: slideNumber,
        of: deviceKind.optional().describe("Change the slide in this device's own set (see A set for each device). Left out, the shared set"),
        changes: slideChangesInput,
        remove: z.array(z.string()).optional().describe("Slide fields to clear, e.g. [\"subheadline\", \"badges\"]"),
      },
    },
    ({ project: id, slide, of, changes, remove }) =>
      guard(tools, "update_slide", async () => {
        const updated = await updateSlide(ctx, id, { index: slide - 1, of }, { changes, remove });
        const result: CallToolResult = json({ slide, ...(of ? { of } : {}), ...updated.slide });
        for (const warning of updated.warnings) result.content.push({ type: "text", text: noted(warning) });
        return result;
      }),
  );
};
