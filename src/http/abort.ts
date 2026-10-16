import type { Response } from "express";

/**
 * A signal that aborts when the client goes away before its answer is complete, so the work done for it stops: a
 * render it waited for is cancelled and uses no render, and an archive is read no further.
 */
export function clientGone(res: Response): AbortSignal {
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}
