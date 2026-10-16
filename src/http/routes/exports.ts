import express, { type Response, type Router } from "express";
import { rendersLeft } from "../../accounts.ts";
import { renderProject, resolveLocales } from "../../render.ts";
import { takeExport } from "../../services/exports.ts";
import { getProject, type Space } from "../../store.ts";
import { writeZip } from "../../zip.ts";
import { clientGone } from "../abort.ts";
import { identityOf, notCrossSite, refuseCrossSite, spaceOf } from "../auth.ts";
import type { Log } from "../errors.ts";
import { inBackground, renderBody } from "./renders.ts";

/**
 * Sends the rendered files as they are now, with the archive's length, so a client can tell a whole download from
 * one cut short. A failure part of the way breaks the connection off rather than end the archive as if it were whole.
 */
async function sendExport(res: Response, space: Space, id: string, signal: AbortSignal): Promise<void> {
  const taken = await takeExport(space, id);
  try {
    res.type("zip").set({ "Content-Disposition": `attachment; filename="${id}-screenshots.zip"`, "Content-Length": String(taken.size) });
    await writeZip(res, taken.entries, { signal });
    res.end();
  } finally {
    await taken.release();
  }
}

/** The finished set as one ZIP. */
export function exportRoutes(log: Log): Router {
  const api = express.Router();

  api.get("/projects/:id/export.zip", async (req, res) => {
    const space = spaceOf(res);
    const { id } = req.params;
    const signal = clientGone(res);
    await getProject(space, id);
    if (req.query.render === "1") {
      // A render spends one of the account's renders and replaces what was rendered before. A link on another site
      // must not set that off with the browser's session; POST /exports is the way for a page.
      if (identityOf(res).session && !notCrossSite(req)) return refuseCrossSite(res);
      await renderProject(space, id, {}, { signal });
    }
    await sendExport(res, space, id, signal);
  });

  // Renders and sends the ZIP once the render is done, or with `background` answers at once with the run and where
  // to fetch the ZIP when it has finished.
  api.post("/projects/:id/exports", async (req, res) => {
    const space = spaceOf(res);
    const { id } = req.params;
    const { background, ...request } = renderBody.parse(req.body ?? {});
    const project = await getProject(space, id);
    resolveLocales(project, request.locales);
    if (background) {
      const job = await inBackground(log, space, project, request);
      return void res.status(202).json({ job, download: `/api/projects/${id}/export.zip`, rendersLeft: rendersLeft(space.id) });
    }
    const signal = clientGone(res);
    await renderProject(space, id, request, { signal });
    await sendExport(res, space, id, signal);
  });

  return api;
}
