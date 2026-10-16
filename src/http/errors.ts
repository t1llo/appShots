import { randomBytes } from "node:crypto";
import { STATUS_CODES } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AuthError } from "../accounts.ts";
import { ConflictError, InputError, NotFoundError, TooLargeError, UnavailableError } from "../store.ts";
import { tooLarge } from "./limits.ts";

/** Where the server reports what went wrong on its side. */
export type Log = Pick<Console, "log" | "warn" | "error">;

export function notFound(_req: Request, res: Response): void {
  res.status(404).set("Cache-Control", "no-store").json({ error: "Not found" });
}

/** An error from Express or a body parser, which says whether its message is meant for the caller. */
interface HttpError extends Error {
  status: number;
  expose?: boolean;
  limit?: number;
}

const isHttpError = (error: unknown): error is HttpError =>
  error instanceof Error && typeof (error as HttpError).status === "number" && (error as HttpError).status >= 400 && (error as HttpError).status < 500;

/**
 * What the caller may be told about an error: a status and one sentence. Null for anything unexpected, whose message
 * can hold a path on the server or a library's words; that goes to the log only. The HTTP API and the MCP tools
 * both answer with this, so a failure reads the same through either.
 */
export function publicError(error: unknown): { status: number; message: string } | null {
  if (error instanceof z.ZodError) return { status: 400, message: z.prettifyError(error) };
  if (error instanceof TooLargeError) return { status: 413, message: error.message };
  if (error instanceof UnavailableError) return { status: 503, message: error.message };
  if (error instanceof InputError) return { status: 400, message: error.message };
  if (error instanceof NotFoundError) return { status: 404, message: error.message };
  if (error instanceof AuthError) return { status: 401, message: error.message };
  if (error instanceof ConflictError) return { status: 409, message: error.message };
  if (isHttpError(error)) {
    const { status } = error;
    // A file that is not there comes back from the file sender with the server's path in its message.
    const message = status === 413 && typeof error.limit === "number" ? tooLarge(error.limit) : status === 404 ? "Not found" : error.expose ? error.message : STATUS_CODES[status];
    return { status, message: message ?? "Error" };
  }
  return null;
}

/** Logs an unexpected error under a short reference, which the caller is given to quote. */
export function reportError(log: Log, error: unknown, where: string): string {
  const ref = randomBytes(4).toString("hex");
  log.error(`Error ${ref} in ${where}:`, error);
  return ref;
}

/** One sentence under `error` for the caller; the details of anything unexpected go to the log only. */
export function errorHandler(log: Log) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) {
      // Part of the answer is out already, such as the first files of a ZIP. Ending it as usual would pass a cut-off
      // download for a whole one, so the connection is broken off, which every client reports as a failed download.
      // A client that went away first is no error of the server's.
      if (!res.destroyed && res.socket && !res.socket.destroyed) reportError(log, error, `${req.method} ${req.path}`);
      return void res.destroy();
    }
    // A route that was about to send a file has set how long to keep it, and maybe a download name. The error
    // answer takes the file's place, and must be neither kept nor saved.
    res.set("Cache-Control", "no-store").removeHeader("Content-Disposition");
    const known = publicError(error);
    if (known?.status === 503) res.set("Retry-After", "30");
    if (known) return void res.status(known.status).json({ error: known.message });
    const ref = reportError(log, error, `${req.method} ${req.path}`);
    res.status(500).json({ error: "Internal error", ref });
  };
}
