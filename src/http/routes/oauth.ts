import { createHash, randomBytes } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { allow, AuthError, endSessions, logInWithGoogle, safeEqual, seal, sessionHolder, signupMode, unseal, userSession } from "../../accounts.ts";
import { config } from "../../config.ts";
import type { Log } from "../errors.ts";
import { cookie, OAUTH_COOKIE, refuseCrossSite, sameOrigin, SESSION_COOKIE, setSession } from "../auth.ts";
import { baseUrl, visitorAddress } from "../security.ts";

const googleRedirect = (req: Request) => `${baseUrl(req)}/auth/google/callback`;

/** Signing in with Google, under /auth. */
export function oauthRoutes(log: Log): Router {
  const auth = express.Router();

  // What the public pages ask to know what to show: how sign-in works here, and whether this browser is signed in already.
  auth.get("/config", (req, res) => {
    const holder = config.auth ? sessionHolder(cookie(req, SESSION_COOKIE)) : null;
    res.set("Cache-Control", "no-store").json({ signIn: config.auth, signup: signupMode(), account: holder ? { name: holder.name } : null });
  });

  auth.get("/google", (req, res) => {
    if (!config.auth) return res.redirect("/");
    if (!allow(`google:${visitorAddress(req)}`, 30, 15 * 60_000)) return res.redirect("/?error=too_many");
    const pending = {
      state: randomBytes(16).toString("base64url"),
      nonce: randomBytes(16).toString("base64url"),
      verifier: randomBytes(32).toString("base64url"),
    };
    res.cookie(OAUTH_COOKIE, seal("oauth", pending, 600_000), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 600_000, path: "/auth/google" });
    const url = new URL(config.google.authUrl);
    url.search = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: googleRedirect(req),
      response_type: "code",
      scope: "openid email profile",
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    res.redirect(url.toString());
  });

  auth.get("/google/callback", async (req, res) => {
    const pending = unseal<{ state: string; nonce: string; verifier: string }>("oauth", cookie(req, OAUTH_COOKIE));
    res.clearCookie(OAUTH_COOKIE, { path: "/auth/google" });
    const fail = (code: string) => res.redirect(`/?error=${code}`);
    const { code, state, error } = req.query;
    if (typeof error === "string") return fail("google_cancelled");
    if (!config.auth || !pending || typeof state !== "string" || !safeEqual(state, pending.state) || typeof code !== "string") return fail("google_state");
    try {
      const response = await fetch(config.google.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: googleRedirect(req),
          grant_type: "authorization_code",
          code_verifier: pending.verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const tokens = (await response.json()) as { id_token?: unknown };
      if (!response.ok || typeof tokens.id_token !== "string") throw new Error(`Google token exchange failed with status ${response.status}`);
      // The ID token arrives straight from Google's token endpoint over TLS, which OpenID Connect accepts in place of checking its signature.
      const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
      const issuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
      const fresh = typeof claims.exp === "number" && claims.exp * 1000 > Date.now();
      if (!issuer || claims.aud !== config.google.clientId || claims.nonce !== pending.nonce || !fresh || typeof claims.sub !== "string") {
        throw new Error("Google returned an ID token that does not belong to this sign-in");
      }
      if (claims.email_verified !== true || typeof claims.email !== "string") return fail("google_unverified");
      const user = await logInWithGoogle({ sub: claims.sub, email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined });
      setSession(req, res, userSession(user));
      res.redirect("/");
    } catch (failure) {
      if (failure instanceof AuthError) return fail(failure.code);
      log.error(failure);
      fail("google_failed");
    }
  });

  return auth;
}

/** Signs out: this browser loses its cookie, and every other browser signed in to the account loses its session. */
export async function logout(req: Request, res: Response): Promise<void> {
  if (!sameOrigin(req)) return refuseCrossSite(res);
  const holder = config.auth ? sessionHolder(cookie(req, SESSION_COOKIE)) : null;
  if (holder) await endSessions(holder);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.redirect("/");
}
