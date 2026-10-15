import express, { type Router } from "express";
import { z } from "zod";
import { rendersLeft } from "../../accounts.ts";
import { cancelRender, getRender, listRenders, renderProject, resolveLocales, startRender } from "../../render.ts";
import { localeSchema } from "../../schema.ts";
import { PLACEMENT_IDS, TARGET_IDS } from "../../sizes.ts";
import { getProject, InputError, listOutputs, NotFoundError } from "../../store.ts";
import type { Log } from "../errors.ts";
import { spaceOf } from "../auth.ts";
import { creativeOutputs } from "./projects.ts";

const renderBody = z.object({
  targets: z.array(z.enum(TARGET_IDS)).optional(),
  locales: z.array(localeSchema).optional(),
  slides: z.array(z.number().int().min(0)).optional(),
  creatives: z.array(z.enum(PLACEMENT_IDS)).optional(),
  /** Answer at once with the run instead of waiting for it. */
  background: z.boolean().optional(),
});

/** Starting renders, and following and cancelling the ones under way. */
export function renderRoutes(log: Log): Router {
  const api = express.Router();

  api.post("/projects/:id/render", async (req, res) => {
    const space = spaceOf(res);
    const { id } = req.params;
    const { background, ...request } = renderBody.parse(req.body ?? {});
    if (background) {
      // A project that does not exist, or a language it does not have, is answered here, not by a run that fails a
      // moment later.
      const project = await getProject(space, id);
      resolveLocales(project, request.locales);
      const { job, finished } = startRender(space, id, request, project.name);
      finished.catch((error: unknown) => {
        if (!(error instanceof InputError || error instanceof NotFoundError)) log.error(error);
      });
      return void res.status(202).json({ job, rendersLeft: rendersLeft(space.id) });
    }
    const result = await renderProject(space, id, request);
    res.json({ ...result, outputs: await listOutputs(space, id), creativeOutputs: await creativeOutputs(space, id), rendersLeft: rendersLeft(space.id) });
  });

  // The account's renders: the ones waiting or under way, and the finished ones of the last hour.
  api.get("/renders", (_req, res) => {
    res.json({ jobs: listRenders(spaceOf(res)), rendersLeft: rendersLeft(spaceOf(res).id) });
  });
  api.get("/renders/:job", (req, res) => {
    res.json(getRender(spaceOf(res), req.params.job));
  });
  api.delete("/renders/:job", (req, res) => {
    res.json(cancelRender(spaceOf(res), req.params.job));
  });

  return api;
}
