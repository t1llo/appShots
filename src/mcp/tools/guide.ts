import { z } from "zod";
import type { RegisterTools } from "../context.ts";
import { designGuide, TOPIC_IDS } from "../guide/index.ts";
import { guard, text } from "../result.ts";

export const registerGuideTools: RegisterTools = (server, tools) => {
  server.registerTool(
    "get_design_guide",
    {
      title: "Design guide",
      description:
        "How to use this server: the workflow, how screenshots get uploaded, what differs for a Mac app, every layout, background, font, device option and badge, the rules for header and search results assets, and banners and mockups for outside the store. Read this before building a set.",
      inputSchema: {
        // The tool took no input before it took a topic and ignored whatever came, so nothing sent here is refused.
        topic: z
          .string()
          .optional()
          .catch(undefined)
          .describe(`One part of the guide, to look something up again later: ${TOPIC_IDS.join(", ")}. Left out, the whole guide, which is what to read first`),
      },
      annotations: { readOnlyHint: true },
    },
    ({ topic }) => guard(tools, "get_design_guide", async () => text(designGuide(tools.base, tools.space, topic))),
  );
};
