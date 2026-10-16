import express, { type Router } from "express";
import sharp from "sharp";
import { renderSettings } from "../config.ts";
import { spaceOf } from "../http/auth.ts";
import { openWindow } from "../render/capture.ts";
import { opaquePng } from "../render/encode.ts";
import { local } from "../render/engine.ts";
import { Cancelled } from "../render/output.ts";
import { NotFoundError, type Space } from "../store.ts";
import { type Artboard, type Draft, type LayerReport, layerPage } from "./cards.ts";

/** One language's page of layers to draw: where it is on this server, what it is called in an error, its artboards. */
export interface Capture {
  space: Space;
  /** Such as /render/<project>/video?job=…&locale=de */
  path: string;
  where: string;
  artboards: Artboard[];
  signal: AbortSignal;
}

/**
 * What draws the pages of a set. The browser does on the server; the tests hand in one of their own, so the service
 * around it can be tried without Chromium.
 */
export interface PageCapturer {
  /** One PNG per artboard, in their order, and what the page reported of each. */
  capture(capture: Capture): Promise<{ pictures: Buffer[]; report: LayerReport }>;
}

/**
 * The browser's way: one transparent window per page, the size of its largest artboard. Each artboard is shown on
 * its own at the top left and captured there, which keeps every capture inside the window whatever the number of
 * layers. The plate is the one picture without an alpha channel.
 */
export const browserCapturer: PageCapturer = {
  async capture({ space, path, where, artboards, signal }) {
    const width = Math.max(...artboards.map((board) => board.width));
    const height = Math.max(...artboards.map((board) => board.height));
    const window = await openWindow(space, { width, height }, { transparent: true });
    try {
      await window.load(`http://${local}${path}`, where);
      const report = JSON.parse(await window.page.evaluate(() => document.body.dataset.layers ?? "{}")) as LayerReport;
      const pictures: Buffer[] = [];
      for (const board of artboards) {
        if (signal.aborted) throw new Cancelled();
        await window.page.evaluate((id) => {
          for (const section of document.querySelectorAll<HTMLElement>("section[data-layer]")) section.hidden = section.dataset.layer !== id;
        }, board.id);
        const picture = await window.shoot({ width: board.width, height: board.height });
        pictures.push(board.opaque ? await opaquePng(picture) : await sharp(picture).png({ compressionLevel: renderSettings.pngLevel }).toBuffer());
      }
      return { pictures, report };
    } finally {
      await window.close();
    }
  },
};

/**
 * The page the browser draws a language's layers from, under /render. It exists only while its run does: what it
 * draws was looked up when the layers were asked for.
 */
export function videoRenderRoutes(draftFor: (space: Space, job: string) => Draft | undefined): Router {
  const pages = express.Router();
  pages.get("/:id/video", (req, res) => {
    const space = spaceOf(res);
    const locale = typeof req.query.locale === "string" ? req.query.locale : "";
    const draft = draftFor(space, typeof req.query.job === "string" ? req.query.job : "");
    if (!draft || draft.projectId !== req.params.id || !draft.locales.includes(locale)) throw new NotFoundError("No such page of video layers. One is there only while its layers are drawn.");
    res.set("Cache-Control", "no-store").type("html").send(layerPage(draft, locale, `Video layers · ${locale}`));
  });
  return pages;
}
