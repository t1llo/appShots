import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { isAdmin, rendersLeft } from "../../accounts.ts";
import { config } from "../../config.ts";
import { CREATIVE_CAPACITY } from "../../creative.ts";
import { BACKGROUNDS, BADGE_TONES, BADGE_TYPES, BADGES_SHOWN, CARD_ICONS, CARD_LOOKS, CREATIVE_LAYOUTS, EMPHASIS, FEATURE_LAYOUTS, REVIEWS_SHOWN, DEVICE_COLOR_IDS, DEVICE_STYLES, FEATURE_STYLES, LAYOUT_SPREAD, STATUS_BARS, POINT_STYLES, ICON_ROW_SIZE_IDS, ICON_ROW_STYLES, ICON_ROW_TONES, FONT_IDS, FONTS, ICON_GROUPS, ICON_IDS, LAYOUT_SHOTS, LAYOUTS, LOGO_SHAPES, LOGO_SIZE_IDS } from "../../design.ts";
import { deviceCatalog } from "../../domain/devices.ts";
import { type Actor, type Ctx, type Warning, warningTexts } from "../../services/context.ts";
import * as service from "../../services/projects.ts";
import type { Detail } from "../../services/projects.ts";
import { updateSlide } from "../../services/slides.ts";
import { DEVICE_KINDS, DEVICE_LABELS, PLACEMENTS, TARGETS } from "../../sizes.ts";
import { ConflictError, InputError, usageOf } from "../../store.ts";
import { identityOf, spaceOf } from "../auth.ts";

// The projects themselves are read and changed by the services in src/services/, which the MCP tools call too.
export { creativeOutputs } from "../../services/projects.ts";

/**
 * The revision is the ETag, for the If-Match of the next change. Not kept by anything: an upload changes the
 * screenshots without a new revision, so a cached copy would be answered 304 while out of date.
 */
function sendDetail(res: Response, detail: Detail) {
  res.set({ ETag: `"${detail.revision}"`, "Cache-Control": "private, no-store" }).json(detail);
}

/** The revision a change was made on, from If-Match: "5", W/"5" or 5. None, or "*", takes whatever is current. */
function ifMatch(req: Request): number | undefined {
  const header = req.get("if-match")?.trim();
  if (!header || header === "*") return undefined;
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header);
  if (!match) throw new InputError('If-Match takes the revision the change was made on, as the ETag of the project gave it, such as "5".');
  return Number(match[1]);
}

/**
 * Who saves, for the history. The Studio says so in a header; a Studio page loaded before it did is still told by
 * the browser saying where the request comes from, which the CLI and scripts do not.
 */
const actorOf = (req: Request): Actor => (req.get("x-appshots-client")?.trim().toLowerCase() === "studio" || req.get("sec-fetch-site") ? "studio" : "api");

/** The service context of a request: its account, who makes the change, and the revision it was made on. */
const contextOf = (req: Request, res: Response): Ctx => ({ space: spaceOf(res), actor: actorOf(req), ifRevision: ifMatch(req) });

/**
 * Makes a change and answers with the project. One made on a revision that is no longer current is answered 409,
 * with the project as it is now, so the caller can make it again on that.
 */
async function change<T extends { warnings?: Warning[] } | undefined>(req: Request<{ id: string }>, res: Response, work: (ctx: Ctx) => Promise<T>, extra: (result: T) => object = () => ({})) {
  const ctx = contextOf(req, res);
  let result: T;
  try {
    result = await work(ctx);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    const current = await service.detail(ctx.space, req.params.id);
    return void res.status(409).set({ ETag: `"${current.revision}"`, "Cache-Control": "private, no-store" }).json({ error: error.message, revision: error.revision, project: current });
  }
  const detail = await service.detail(ctx.space, req.params.id);
  const all = [...(detail.warnings ?? []), ...warningTexts(result?.warnings ?? [])];
  sendDetail(res, { ...(all.length ? { ...detail, warnings: all } : detail), ...extra(result) });
}

/** What the Studio needs to know about this server, and the projects themselves. */
export function projectRoutes(): Router {
  const api = express.Router();

  api.get("/meta", (_req, res) => {
    const { user, space } = identityOf(res);
    res.json({
      targets: TARGETS,
      devices: DEVICE_KINDS.map((id) => ({ id, label: DEVICE_LABELS[id] })),
      layouts: LAYOUTS,
      layoutShots: LAYOUT_SHOTS,
      placements: PLACEMENTS,
      creativeLayouts: Object.fromEntries(Object.entries(CREATIVE_LAYOUTS).map(([id, note]) => [id, { note, screenshots: CREATIVE_CAPACITY[id as keyof typeof CREATIVE_LAYOUTS] }])),
      fonts: FONT_IDS,
      fontList: Object.entries(FONTS).map(([id, font]) => ({ id, family: font.family, group: font.group, note: font.note, weight: font.weight })),
      backgrounds: ["auto", ...Object.keys(BACKGROUNDS)],
      deviceColors: DEVICE_COLOR_IDS,
      deviceStyles: DEVICE_STYLES,
      statusBars: STATUS_BARS,
      layoutSpread: LAYOUT_SPREAD,
      badgeTypes: BADGE_TYPES,
      badgeTones: BADGE_TONES,
      featureStyles: FEATURE_STYLES,
      pointStyles: POINT_STYLES,
      featureLayouts: FEATURE_LAYOUTS,
      cardLooks: CARD_LOOKS,
      cardIcons: CARD_ICONS,
      emphasis: EMPHASIS,
      badgesShown: BADGES_SHOWN,
      reviewsShown: REVIEWS_SHOWN,
      logoShapes: LOGO_SHAPES,
      logoSizes: LOGO_SIZE_IDS,
      iconRowStyles: ICON_ROW_STYLES,
      iconRowTones: ICON_ROW_TONES,
      iconRowSizes: ICON_ROW_SIZE_IDS,
      icons: ICON_IDS,
      iconGroups: ICON_GROUPS,
      /** Every device model by device, with its display sizes and the export sizes drawn for it. */
      deviceCatalog: deviceCatalog(),
      authEnabled: config.auth,
      /** Null only while sign-in is off. */
      account: user ? { email: user.email, name: user.name, admin: isAdmin(user) } : null,
      /** How many renders the account has left. Null where they are not counted: for the admin, and while sign-in is off. */
      rendersLeft: rendersLeft(space.id),
    });
  });

  // A project whose project.json cannot be read is listed too, with `damaged`, so it can be restored or deleted.
  api.get("/projects", async (_req, res) => {
    res.json(await service.list(spaceOf(res)));
  });
  /** How much the caller keeps here: what the settings page shows. */
  api.get("/usage", async (_req, res) => {
    res.json(await usageOf(spaceOf(res)));
  });
  api.post("/projects", async (req, res) => {
    res.status(201).json(await service.create(contextOf(req, res), req.body));
  });
  api.get("/projects/:id", async (req, res) => {
    sendDetail(res, await service.detail(spaceOf(res), req.params.id));
  });
  api.put("/projects/:id", async (req, res) => {
    await change(req, res, (ctx) => service.update(ctx, req.params.id, req.body));
  });
  /**
   * Changes one slide, as the MCP tool update_slide does: `changes` merged over it, `remove` cleared. `:index` counts
   * from 0, and `of` picks a device's own set. Answers like GET, with the slide changed under `slide`.
   */
  api.patch("/projects/:id/slides/:index", async (req, res) => {
    const index = z.coerce.number().int().min(0).max(9).parse(req.params.index);
    const body = z.object({ changes: z.record(z.string(), z.unknown()).optional(), remove: z.array(z.string()).optional(), of: z.enum(DEVICE_KINDS).optional() }).parse(req.body ?? {});
    await change(
      req,
      res,
      (ctx) => updateSlide(ctx, req.params.id, { index, of: body.of }, body),
      (result) => ({ slide: result.slide }),
    );
  });
  /** The versions kept of a project, newest first: every change is one, the last 50 of them. */
  api.get("/projects/:id/revisions", async (req, res) => {
    res.json(await service.revisions(spaceOf(res), req.params.id));
  });
  /** Makes an earlier version current again, as a new revision. Works on a damaged project too. */
  api.post("/projects/:id/restore", async (req, res) => {
    const { revision } = z.object({ revision: z.number().int().min(0) }).parse(req.body);
    // The names the restored version uses without having them are the MCP tool's to mention.
    await change(req, res, async (ctx) => void (await service.restore(ctx, req.params.id, revision)));
  });
  api.delete("/projects/:id", async (req, res) => {
    await service.remove(spaceOf(res), req.params.id);
    res.status(204).end();
  });

  return api;
}
