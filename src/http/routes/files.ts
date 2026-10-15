import path from "node:path";
import express, { type Response, type Router } from "express";
import { getProject, imagesDir, outDir, safeJoin, shotsDir } from "../../store.ts";
import { spaceOf } from "../auth.ts";

/**
 * Sends a file from inside `dir`. The folder goes in as the root, so only the part below it is checked for hidden
 * names: a data directory such as ~/.appshots must not hide every file in it.
 */
function sendFrom(res: Response, dir: string, relative: string): void {
  res.sendFile(path.relative(dir, safeJoin(dir, relative)), { root: dir });
}

/** A project's uploaded and rendered files, under /files. */
export function fileRoutes(): Router {
  const files = express.Router();
  files.get("/:id/shots/:file", async (req, res) => {
    await getProject(spaceOf(res), req.params.id);
    sendFrom(res.set("Cache-Control", "private, max-age=31536000, immutable"), shotsDir(spaceOf(res), req.params.id), req.params.file);
  });
  files.get("/:id/images/:file", async (req, res) => {
    await getProject(spaceOf(res), req.params.id);
    sendFrom(res.set("Cache-Control", "private, max-age=31536000, immutable"), imagesDir(spaceOf(res), req.params.id), req.params.file);
  });
  files.get("/:id/out/*file", async (req, res) => {
    await getProject(spaceOf(res), req.params.id);
    const relative = (req.params.file as unknown as string[]).join("/");
    sendFrom(res.set("Cache-Control", "private, no-cache"), outDir(spaceOf(res), req.params.id), relative);
  });
  return files;
}
