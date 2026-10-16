import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { localesSchema, targetsSchema, themeSchema } from "../../schema.ts";
import * as service from "../../services/projects.ts";
import { listImages, listShots } from "../../store.ts";
import { projectInput as project, type RegisterTools } from "../context.ts";
import { uploadHelp } from "../guide/index.ts";
import { guard, json, noted, notes, text } from "../result.ts";

export const registerProjectTools: RegisterTools = (server, tools) => {
  const { base, space, ctx } = tools;

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "Lists the screenshot projects of this account. One whose stored file cannot be read says so under `damaged`: restore_project brings back an earlier revision of it.",
      annotations: { readOnlyHint: true },
    },
    () => guard(tools, "list_projects", async () => json(await service.list(space))),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Creates a project (one per app) and returns its id plus how to upload raw screenshots into it.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("App or project name"),
        locales: localesSchema.optional().describe('Locales to render, default ["en"]'),
        theme: themeSchema.optional().describe("Styling shared by every slide"),
      },
    },
    (input) =>
      guard(tools, "create_project", async () => {
        const created = await service.create(ctx, input);
        return text(`Created project "${created.id}".\n\n${uploadHelp(base, created.id)}\n\nStudio: ${base}/#/${created.id}`);
      }),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Returns a project's theme, slides, header and search results assets, banners, the raw screenshots, and the logos and other images uploaded so far.",
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    (input) => guard(tools, "get_project", async () => json(await service.overview(space, input.project, base))),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update project",
      description: "Changes a project's name, locales, theme or export sizes. The theme is replaced as a whole.",
      inputSchema: {
        project,
        name: z.string().min(1).max(80).optional(),
        locales: localesSchema.optional(),
        theme: themeSchema.optional(),
        targets: targetsSchema.optional().describe("Sizes every render and the ZIP hold from now on. [] goes back to the standard sizes of the devices the project has screenshots of"),
      },
    },
    ({ project: id, ...patch }) =>
      guard(tools, "update_project", async () => {
        const { project: updated, warnings } = await service.update(ctx, id, patch);
        // Read once the change is saved: a new first language files the screenshots anew.
        const [shots, images] = await Promise.all([listShots(space, id, updated.locales), listImages(space, id)]);
        const result: CallToolResult = json(service.describe(updated, shots, images, base));
        for (const warning of warnings) result.content.push({ type: "text", text: noted(warning) });
        return result;
      }),
  );

  server.registerTool(
    "list_revisions",
    {
      title: "List revisions",
      description:
        "Lists the versions of a project that are kept, newest first: every change to its name, theme, slides and assets is one, the last 50 of them. Each says when it was saved and by what (studio, api or mcp). Screenshots and images are not part of it.",
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    (input) => guard(tools, "list_revisions", async () => json(await service.revisions(space, input.project))),
  );

  server.registerTool(
    "restore_project",
    {
      title: "Restore project",
      description:
        "Brings back an earlier revision from list_revisions, as a new revision, so a restore can be undone the same way. For when a change made things worse or wiped out the user's own edits, and for a project whose stored file is damaged.",
      inputSchema: {
        project,
        revision: z.number().int().min(0).describe("The revision to bring back, from list_revisions"),
      },
    },
    ({ project: id, revision }) =>
      guard(tools, "restore_project", async () => {
        const { stored, warnings } = await service.restore(ctx, id, revision);
        return text(`Restored revision ${revision} of "${id}". It is revision ${stored.revision} now; call get_project to see it and render to draw it.${notes(warnings)}`);
      }),
  );
};
