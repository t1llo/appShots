import express, { type Router } from "express";
import { z } from "zod";
import { localeSchema } from "../../schema.ts";
import { DEVICE_KINDS, isDeviceKind } from "../../sizes.ts";
import { deleteImage, deleteShot, getProject, InputError, moveShot, saveImage, saveShot } from "../../store.ts";
import { spaceOf } from "../auth.ts";
import { LIMITS } from "../limits.ts";

/** Uploading screenshots and images, which arrive as raw bytes. */
export function uploadRoutes(): Router {
  const api = express.Router();
  api.put("/projects/:id/shots/:name", express.raw({ type: () => true, limit: LIMITS.shot }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new InputError("Send the image file as the request body.");
    const device = isDeviceKind(req.query.device) ? req.query.device : undefined;
    const locale = req.query.locale == null || req.query.locale === "" ? undefined : localeSchema.parse(req.query.locale);
    res.status(201).json(await saveShot(spaceOf(res), req.params.id, req.params.name, req.body, device, locale));
  });
  api.put("/projects/:id/images/:name", express.raw({ type: () => true, limit: LIMITS.image }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new InputError("Send the image file as the request body.");
    res.status(201).json(await saveImage(spaceOf(res), req.params.id, req.params.name, req.body));
  });
  return api;
}

/** Moving and deleting screenshots and images. */
export function assetRoutes(): Router {
  const api = express.Router();
  api.patch("/projects/:id/shots/:file", async (req, res) => {
    const to = z
      .object({ device: z.enum(DEVICE_KINDS).optional(), locale: localeSchema.nullable().optional() })
      .refine((body) => body.device !== undefined || body.locale !== undefined, "Send device, locale or both.")
      .parse(req.body);
    res.json(await moveShot(spaceOf(res), req.params.id, req.params.file, to));
  });
  api.delete("/projects/:id/shots/:file", async (req, res) => {
    await getProject(spaceOf(res), req.params.id);
    await deleteShot(spaceOf(res), req.params.id, req.params.file);
    res.status(204).end();
  });
  api.delete("/projects/:id/images/:file", async (req, res) => {
    await getProject(spaceOf(res), req.params.id);
    await deleteImage(spaceOf(res), req.params.id, req.params.file);
    res.status(204).end();
  });
  return api;
}
