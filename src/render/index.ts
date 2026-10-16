// The renderer: slide pages of this server drawn by a headless Chromium into the PNGs App Store Connect takes.
//
//   plan.ts       what a render draws, worked out and checked before it waits its turn
//   scheduler.ts  who draws when: renders and mockups in lanes of their own, every account in turn
//   jobs.ts       the runs: credits, waiting, cancelling, and putting a finished run in place
//   output.ts     what a run draws, into a staging folder of its own
//   capture.ts    one browser window per run, a page at a time
//   encode.ts     the PNGs and contact sheets, made while the browser draws the next page
//   ../storage/outputs.ts  how a finished run's pictures are put in place
//   mockup.ts     a screenshot in its device on a transparent background
//   listing.ts    the first slides of a set as a search result and a product page show them
//   analysis.ts   what is read off a screenshot to draw around it
//   engine.ts     the browser itself, and the one scheduler that hands it out

import { closeBrowser, type EngineHealth, engineHealth, scheduler } from "./engine.ts";
import { cancelAll, closeRenders, liveRenders } from "./jobs.ts";
import type { Lane, QueueStats } from "./scheduler.ts";

export { type Renderer, useRenderer, type Window } from "./capture.ts";
export { closeBrowser, prewarm } from "./engine.ts";
export type { RenderedCreative, RenderedFile, RenderedSheet, RenderJob, RenderResult, RenderState } from "./jobs.ts";
export { cancelRender, cancelRenders, frozenFor, getRender, listRenders, renderProject, renderResult, startRender } from "./jobs.ts";
export { listingSet, storeListing } from "./listing.ts";
export type { Mockup } from "./mockup.ts";
export { mockupSheet, renderMockup } from "./mockup.ts";
export type { RenderRequest } from "./plan.ts";
export { defaultTargets, resolveLocales } from "./plan.ts";

/**
 * Lets what is queued and running finish, for up to `timeoutMs`, and takes no more work meanwhile. Runs still going
 * then are cancelled: they keep nothing and use no render. Resolves true when everything finished in time.
 */
export async function drain(timeoutMs: number): Promise<boolean> {
  closeRenders();
  const finished = await scheduler.drain(timeoutMs);
  if (!finished) await cancelAll(2000);
  return finished;
}

export interface RenderHealth extends EngineHealth {
  queue: Record<Lane, QueueStats>;
  /** Renders asked for that have not ended, the ones still being read included. */
  renders: number;
}

/** How the renderer is doing, for a health page. */
export function renderHealth(): RenderHealth {
  return { ...engineHealth(), queue: scheduler.queueStats(), renders: liveRenders() };
}
