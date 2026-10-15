import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { config, hostName } from "../config.ts";

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

const publicHost = config.publicUrl ? (hostName(new URL(config.publicUrl).host) ?? "") : "";

/**
 * Whether a name may reach the routes that act on an account. DNS rebinding points a name the attacker owns at this
 * server, so a page from that name can call it as its own origin: only names this server knows to be its own pass.
 * IP literals pass too, since rebinding needs a name, and that keeps a server reached by its LAN address working.
 */
function knownHost(name: string): boolean {
  return name === "localhost" || name.endsWith(".localhost") || isIP(name) !== 0 || name === publicHost || config.allowedHosts.includes(name);
}

/**
 * Refuses requests for a name that is not this server's. While sign-in is off, every request works in the server's
 * own space, so this is what keeps a rebound page out. With sign-in on, the session cookie belongs to the real name
 * and never travels to another one; the check then runs only once ALLOWED_HOSTS lists the names, so a reverse
 * proxy that passes on a Host of its own keeps working.
 */
export function allowedHost(req: Request, res: Response, next: NextFunction): void {
  if (config.auth && config.allowedHosts.length === 0) return next();
  const name = hostName(req.get("host") ?? "");
  if (name && knownHost(name)) return next();
  res.status(403).set("Cache-Control", "no-store").json({ error: "This server does not answer to that host name. Open it at its own address, or add the name to ALLOWED_HOSTS." });
}

/** Everything under /api belongs to one account. A CDN in front keeps a .zip by default and would hand one person's export to the next caller. */
export function privateCache(_req: Request, res: Response, next: NextFunction): void {
  res.set("Cache-Control", "private, no-cache");
  next();
}
