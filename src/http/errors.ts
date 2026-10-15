import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AuthError } from "../accounts.ts";
import { InputError, NotFoundError } from "../store.ts";

/** Where the server reports what went wrong on its side. */
export type Log = Pick<Console, "log" | "warn" | "error">;

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

/** One sentence under `error` for the caller; the details of anything unexpected go to the log only. */
export function errorHandler(log: Log) {
  return (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) return void res.end();
    if (error instanceof z.ZodError) return void res.status(400).json({ error: z.prettifyError(error) });
    if (error instanceof InputError) return void res.status(400).json({ error: error.message });
    if (error instanceof NotFoundError) return void res.status(404).json({ error: error.message });
    if (error instanceof AuthError) return void res.status(401).json({ error: error.message });
    const status = (error as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return void res.status(status).json({ error: status === 413 ? "File too large (limit 40 MB)" : (error as Error).message });
    }
    log.error(error);
    res.status(500).json({ error: "Internal error" });
  };
}
