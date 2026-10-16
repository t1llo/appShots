import type { Page } from "playwright";
import { config } from "../config.ts";
import { type PageFit, readFit } from "../domain/lint.ts";
import { InputError, NotFoundError, type Space } from "../store.ts";
import { getBrowser } from "./engine.ts";

export interface Size {
  width: number;
  height: number;
}

/**
 * What a page could not draw, in the words of its readiness mark: "<kind>:<detail>", such as "screenshot:home missing",
 * several joined by "; ".
 */
function described(reason: string): string {
  const problems = reason.split("; ").filter(Boolean);
  return problems.length > 1 ? problems.map(described).join(" Also, ") : describedOne(problems[0] ?? "");
}

function describedOne(reason: string): string {
  const [kind = "", ...rest] = reason.split(":");
  const detail = rest.join(":").trim();
  const [name, problem] = detail.split(/\s+/);
  if (kind === "screenshot" && name) {
    return problem === "undecodable"
      ? `the screenshot "${name}" could not be read as a picture. Upload it again, then render once more.`
      : `the screenshot "${name}" is not there any more. It was deleted or replaced while the render waited: upload it again, then render once more.`;
  }
  if (kind === "font" && detail) {
    return `the font "${detail}" did not load, and the copy would have been set in another. Render once more; if it fails again, pick another font.`;
  }
  return `the page could not be drawn (${reason || "no reason given"}).`;
}

/** A page that said it cannot be drawn. The run fails with this, and costs nothing. */
export class PageError extends InputError {}

/** A page the server could not make. Its own message is for the log, not for whoever asked. */
export class PageStatusError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * A browser window that reaches this server as the account, for one run: it moves from page to page and changes
 * size between passes, which costs far less than a window of its own for each. `transparent` leaves out the white
 * a page is otherwise drawn on.
 */
export async function openWindow(space: Space, size: Size, options: { transparent?: boolean } = {}) {
  const instance = await getBrowser();
  const context = await instance.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    extraHTTPHeaders: { "x-appshots-internal": config.internalSecret, "x-appshots-space": space.id },
  });
  try {
    const page: Page = await context.newPage();
    // The browser's own screenshot call, which can trade the PNG's size for speed: it is decoded and encoded again here anyway.
    const cdp = await context.newCDPSession(page);
    if (options.transparent) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    let current = size;

    return {
      page,
      async resize(next: Size): Promise<void> {
        if (next.width === current.width && next.height === current.height) return;
        await page.setViewportSize({ width: next.width, height: next.height });
        current = next;
      },

      /**
       * Opens a page and waits until it says it is drawn. `where` names it in an error, such as "Slide 2". Returns
       * how the copy of a slide or a creative came out, and nothing for a page that does not say.
       */
      async load(url: string, where: string): Promise<PageFit | undefined> {
        const response = await page.goto(url, { waitUntil: "load" });
        if (response && !response.ok()) {
          const body = await response.json().catch(() => null);
          const message = typeof body?.error === "string" ? `${where}: ${body.error}` : `${where}: the page answered ${response.status()}.`;
          if (response.status() === 404) throw new NotFoundError(message);
          if (response.status() < 500) throw new InputError(message);
          throw new PageStatusError(response.status(), message);
        }
        await page.waitForFunction(() => document.body?.dataset.ready === "1" || document.body?.dataset.ready === "error", undefined, { timeout: 20_000 });
        const state = await page.evaluate(async () => {
          // As a screenshot by Playwright would, and the slide's own wait does not cover every face.
          await document.fonts.ready;
          // A page that waits for its images without saying when one fails still shows it as broken.
          const broken = [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute("src") ?? "");
          return { ready: document.body.dataset.ready, error: document.body.dataset.error ?? "", broken, fit: document.body.dataset.fit };
        });
        if (state.ready === "error") throw new PageError(`${where}: ${described(state.error)}`);
        const shot = state.broken.map((src) => /\/shots\/([^/?]+)/.exec(src)?.[1]).find(Boolean);
        if (shot) throw new PageError(`${where}: ${described(`screenshot:${decodeURIComponent(shot).split(".")[0]} missing`)}`);
        return readFit(state.fit);
      },

      /** The part of the page inside `clip`, drawn at `scale`, as a PNG. */
      async shoot(clip: Size & { x?: number; y?: number }, scale = 1): Promise<Buffer> {
        const { data } = await cdp.send("Page.captureScreenshot", {
          format: "png",
          clip: { x: clip.x ?? 0, y: clip.y ?? 0, width: clip.width, height: clip.height, scale },
          captureBeyondViewport: false,
          optimizeForSpeed: true,
        });
        return Buffer.from(data, "base64");
      },

      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export type Window = Awaited<ReturnType<typeof openWindow>>;
