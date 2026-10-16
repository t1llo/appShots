import express, { type Router } from "express";
import { z } from "zod";
import { rendersLeft } from "../../accounts.ts";
import { cancelRender, getRender, listRenders, type RenderJob, type RenderRequest, renderProject, resolveLocales, startRender } from "../../render.ts";
import { localeSchema, type Project } from "../../schema.ts";
import { PLACEMENT_IDS, TARGET_IDS } from "../../sizes.ts";
import { checkRender } from "../../services/check.ts";
import { getProject, InputError, listOutputs, NotFoundError, type Space } from "../../store.ts";
import { clientGone } from "../abort.ts";
import type { Log } from "../errors.ts";
import { spaceOf } from "../auth.ts";
import { creativeOutputs } from "./projects.ts";

export const renderBody = z.object({
  targets: z.array(z.enum(TARGET_IDS)).optional(),
  locales: z.array(localeSchema).optional(),
  slides: z.array(z.number().int().min(0)).optional(),
  creatives: z.array(z.enum(PLACEMENT_IDS)).optional(),
  /** Answer at once with the run instead of waiting for it. */
  background: z.boolean().optional(),
});

/**
 * Queues a render nobody waits for. What it fails with is for whoever asks after it; only the server's own trouble
 * goes to the log. Answers with the run as it was accepted, once it has read the screenshots: one deleted after the
 * answer is missing from the run, not from its plan.
 */
export async function inBackground(log: Log, space: Space, project: Project, request: RenderRequest): Promise<RenderJob> {
  const { job, finished, read } = startRender(space, project.id, request, project.name);
  finished.catch((error: unknown) => {
    if (!(error instanceof InputError || error instanceof NotFoundError)) log.error(error);
  });
  const accepted = { ...job };
  await read;
  return accepted;
}

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
      return void res.status(202).json({ job: await inBackground(log, space, project, request), rendersLeft: rendersLeft(space.id) });
    }
    // A client that stops waiting cancels the render, and gets the render back.
    const result = await renderProject(space, id, request, { signal: clientGone(res) });
    res.json({ ...result, outputs: await listOutputs(space, id), creativeOutputs: await creativeOutputs(space, id), rendersLeft: rendersLeft(space.id) });
  });

  // What a render with the same body would do, without drawing anything or using a render. `background` is taken and
  // ignored, so a client can send the body it is about to render with.
  api.post("/projects/:id/check", async (req, res) => {
    const { background: _, ...request } = renderBody.parse(req.body ?? {});
    res.json(await checkRender(spaceOf(res), req.params.id, request));
  });

  // The account's renders: the ones waiting or under way, and the finished ones of the last hour, eight at most.
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
