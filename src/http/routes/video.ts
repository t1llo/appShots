import path from "node:path";
import express, { type Router } from "express";
import { rendersLeft } from "../../accounts.ts";
import { getProject, InputError, NotFoundError, safeJoin } from "../../store.ts";
import { videoRenderRoutes } from "../../video/pages.ts";
import { videoLayersBody } from "../../video/request.ts";
import { videoService } from "../../video/service.ts";
import { SET_ID, setDir, setEntries } from "../../video/store.ts";
import { writeZip } from "../../zip.ts";
import { spaceOf } from "../auth.ts";
import type { Log } from "../errors.ts";

const told = (error: unknown) => error instanceof InputError || error instanceof NotFoundError;

/**
 * The layers of an app preview, under /api: drawing a set, reading it, and following or cancelling its run, which
 * GET and DELETE /api/renders/:job answer as they do a render's. Mounted before the render routes, which answer
 * every other job.
 */
export function videoRoutes(log: Log): Router {
  const api = express.Router();

  api.post("/projects/:id/video-layers", async (req, res) => {
    const space = spaceOf(res);
    const { background, ...body } = videoLayersBody.parse(req.body ?? {});
    const started = await videoService.start(space, req.params.id, body);
    if ("done" in started) return void res.json({ ...started.done, rendersLeft: rendersLeft(space.id) });
    const { job, finished, leave } = started;
    if (background) {
      finished.catch((error: unknown) => {
        if (!told(error)) log.error(error);
      });
      return void res.status(202).json({ job, set: job.set, rendersLeft: rendersLeft(space.id) });
    }
    // A caller that goes away before the layers are drawn leaves its run, which stops when nobody else waits for it.
    res.on("close", () => {
      if (!res.writableFinished) leave();
    });
    res.json({ ...(await finished), rendersLeft: rendersLeft(space.id) });
  });

  api.get("/projects/:id/video-layers/:set", async (req, res) => {
    res.json(await videoService.getSet(spaceOf(res), req.params.id, req.params.set));
  });

  api.get("/projects/:id/video-layers/:set/layers.zip", async (req, res) => {
    const space = spaceOf(res);
    const { charged: _, ...manifest } = await videoService.getSet(space, req.params.id, req.params.set);
    const entries = await setEntries(space, req.params.id, manifest);
    res.type("zip").set("Content-Disposition", `attachment; filename="${req.params.id}-video-layers-${manifest.set}.zip"`);
    await writeZip(res, entries);
    res.end();
  });

  api.get("/renders/:job", (req, res, next) => {
    const job = videoService.getJob(spaceOf(res), req.params.job);
    if (!job) return next();
    res.json(job);
  });
  api.delete("/renders/:job", (req, res, next) => {
    const job = videoService.cancel(spaceOf(res), req.params.job);
    if (!job) return next();
    res.json(job);
  });

  return api;
}

/**
 * One layer of a set, under /files. A set's id is a hash of what it draws, so a file under it never changes and
 * may be kept for good, by the browser only: it belongs to one account.
 */
export function videoFileRoutes(): Router {
  const files = express.Router();
  files.get("/:id/video/:set/*file", async (req, res) => {
    const space = spaceOf(res);
    await getProject(space, req.params.id);
    const relative = (req.params.file as unknown as string[]).join("/");
    if (!SET_ID.test(req.params.set) || !relative.endsWith(".png")) throw new NotFoundError("Not found");
    const dir = setDir(space, req.params.id, req.params.set);
    const file = path.relative(dir, safeJoin(dir, relative));
    res.set("Cache-Control", "private, max-age=31536000, immutable").sendFile(file, { root: dir });
  });
  return files;
}

/** The pages the browser draws layers from, under /render. Mounted before the slide pages, whose /:id/:index would take them. */
export const videoPageRoutes = (): Router => videoRenderRoutes(videoService.draftFor);
