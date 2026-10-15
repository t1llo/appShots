import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.ts";

/** Headers every answer carries. Slide previews are framed by the Studio only. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
}

/** The address this server is reached at: PUBLIC_URL, or what the request says. */
export const baseUrl = (req: Request) => config.publicUrl || `${req.protocol}://${req.get("host")}`;

/** The visitor's address: what the reverse proxy reports, or what CLIENT_IP_HEADER carries when a CDN stands in front of it. */
export function visitorAddress(req: Request): string | undefined {
  const claimed = config.clientIpHeader ? req.get(config.clientIpHeader)?.trim() : undefined;
  return claimed && isIP(claimed) ? claimed : req.ip;
}

/** Everything under /api belongs to one account. A CDN in front keeps a .zip by default and would hand one person's export to the next caller. */
export function privateCache(_req: Request, res: Response, next: NextFunction): void {
  res.set("Cache-Control", "private, no-cache");
  next();
}
