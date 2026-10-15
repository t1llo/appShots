import express, { type Request, type Router } from "express";
import { creativeHtml } from "../../creative.ts";
import { mockupHtml } from "../../mockup.ts";
import { defaultTargets, frozenFor } from "../../render.ts";
import { localeSchema, slidesFor } from "../../schema.ts";
import { isPlacementId, isTargetId, sourceOf, TARGETS } from "../../sizes.ts";
import { getProject, listShots, NotFoundError, type Space } from "../../store.ts";
import { slideHtml } from "../../template.ts";
import { spaceOf } from "../auth.ts";
import { mockupSettings } from "./mockups.ts";

/** What a slide page draws: the project as it is, or, for a page of a running render, as it was when the render was asked for. */
async function drawn(space: Space, req: Request<{ id: string }>) {
  const frozen = frozenFor(space, req.query.job);
  if (frozen?.project.id === req.params.id) return frozen;
  const project = await getProject(space, req.params.id);
  return { project, shots: await listShots(space, project.id) };
}

/** The pages the renderer draws and the Studio previews, under /render. */
export function renderPageRoutes(): Router {
  const pages = express.Router();

  pages.get("/:id/creative/:placement", async (req, res) => {
    const space = spaceOf(res);
    const { project, shots } = await drawn(space, req);
    const { placement } = req.params;
    if (!isPlacementId(placement) || !project.creatives[placement]) throw new NotFoundError(`This project has no "${placement}" asset`);
    const locale = localeSchema.safeParse(req.query.locale).data ?? project.locales[0]!;
    res.set("Cache-Control", "no-store").type("html").send(await creativeHtml({ space, project, shots, placement, locale, guides: req.query.guides === "1" }));
  });

  pages.get("/:id/mockup/:file", async (req, res) => {
    const space = spaceOf(res);
    const project = await getProject(space, req.params.id);
    const shot = (await listShots(space, project.id)).find((each) => each.file === req.params.file);
    if (!shot) throw new NotFoundError(`This project has no screenshot file "${req.params.file}"`);
    res.set("Cache-Control", "no-store").type("html").send(await mockupHtml(space, project, shot, mockupSettings(project, req.query), req.query.bare === "1"));
  });

  pages.get("/:id/:index", async (req, res) => {
    const space = spaceOf(res);
    const { project, shots } = await drawn(space, req);
    const index = Number(req.params.index);
    const wanted = String(req.query.target ?? "");
    const target = isTargetId(wanted) ? wanted : sourceOf(defaultTargets(shots, project.targets)[0]!);
    if (!Number.isInteger(index) || index < 0 || index >= slidesFor(project, TARGETS[target].device).length) throw new NotFoundError(`Slide ${req.params.index} does not exist`);
    const locale = localeSchema.safeParse(req.query.locale).data ?? project.locales[0]!;
    res.set("Cache-Control", "no-store").type("html").send(await slideHtml({ space, project, shots, index, target, locale }));
  });

  return pages;
}
