import type { NextFunction, Request, Response } from "express";
import { mainSpace, renewedSession, safeEqual, SESSION_TTL, sessionHolder, spaceById, spaceOfUser, type User, userByToken } from "../accounts.ts";
import { config } from "../config.ts";
import type { Space } from "../store.ts";

export const SESSION_COOKIE = "appshots_session";
export const OAUTH_COOKIE = "appshots_oauth";

export interface Identity {
  space: Space;
  /** Who is signed in. Absent only while sign-in is off. */
  user?: User;
  /** Signed in through the browser rather than with a bearer token. Account settings require it. */
  session: boolean;
}

export function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function identify(req: Request): Identity | null {
  // With sign-in off, whoever reaches the port works in the server's own space.
  if (!config.auth) return { space: mainSpace, session: true };
  if (safeEqual(req.get("x-appshots-internal") ?? "", config.internalSecret)) {
    const space = spaceById(req.get("x-appshots-space"));
    return space && { space, session: false };
  }
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const user = userByToken(header.slice(7).trim());
    return user && { space: spaceOfUser(user), user, session: false };
  }
  const holder = sessionHolder(cookie(req, SESSION_COOKIE));
  return holder && { space: spaceOfUser(holder), user: holder, session: true };
}

/** Browsers attach Origin to cross-site writes, and a session cookie must not be usable from another site. */
export function sameOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.get("host") || (config.publicUrl !== "" && host === new URL(config.publicUrl).host);
  } catch {
    return false;
  }
}

const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);
export const refuseCrossSite = (res: Response) => void res.status(403).set("Cache-Control", "no-store").json({ error: "Cross-site request refused" });

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const identity = identify(req);
  if (identity) {
    if (identity.session && !READ_ONLY.has(req.method) && !sameOrigin(req)) return refuseCrossSite(res);
    res.locals.identity = identity;
    return next();
  }
  // Only a browser navigation prefers HTML; curl and fetch send */* and should get the 401.
  const wantsPage = req.method === "GET" && !req.path.startsWith("/api/") && !req.path.startsWith("/mcp") && req.accepts(["json", "html"]) === "html";
  if (wantsPage) return res.redirect("/");
  // Refused before the routes that mark their answers private, so it says so itself.
  res.status(401).set({ "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" }).json({ error: "Unauthorized: send Authorization: Bearer <token>" });
}

export const identityOf = (res: Response) => res.locals.identity as Identity;
export const spaceOf = (res: Response) => identityOf(res).space;

export function setSession(req: Request, res: Response, value: string): void {
  res.cookie(SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: SESSION_TTL, path: "/" });
}

/**
 * A session lasts 30 days from the last visit: a cookie more than a day old is swapped for a fresh one. This runs
 * on /api only, whose answers are private to one account and which the Studio calls on every visit. A public answer,
 * such as a font or the icons, may be kept by a CDN and handed to the next visitor with the Set-Cookie in it.
 */
export function renewSession(req: Request, res: Response, next: NextFunction): void {
  if (config.auth && req.method === "GET" && identityOf(res).session) {
    const fresh = renewedSession(cookie(req, SESSION_COOKIE));
    if (fresh) setSession(req, res, fresh);
  }
  next();
}

/** A leaked API token must not be able to mint more tokens or manage other people. */
export const requireSession = (_req: Request, res: Response, next: NextFunction) =>
  identityOf(res).session ? next() : void res.status(403).json({ error: "This needs a browser sign-in, not an API token." });
