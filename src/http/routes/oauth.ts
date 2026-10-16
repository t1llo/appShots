import { createHash, randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { allow, AuthError, endSessions, logInWithGoogle, safeEqual, seal, sessionHolder, signupMode, unseal, userSession } from "../../accounts.ts";
import { config } from "../../config.ts";
import { clientDirectory, type DocumentFetcher, isDocumentId, register } from "../../oauth/clients.ts";
import { OAuthError, PageError } from "../../oauth/errors.ts";
import { type Approval, approvalOf, checkAuthorization, issueCode, RedirectError, revoke, token } from "../../oauth/flow.ts";
import { AUTHORIZATION_SERVER, authorizationServer, originOf, PROTECTED_RESOURCE, protectedResource } from "../../oauth/metadata.ts";
import { sendConsent, sendProblem } from "../../oauth/pages.ts";
import { registeredClient } from "../../oauth/store.ts";
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
      // An app's authorization page sends people here to sign in first, and they go back to it afterwards. Only
      // that page: anywhere else would make this an open redirect. A longer address would not fit the cookie.
      ...(typeof req.query.next === "string" && req.query.next.startsWith("/oauth/authorize?") && req.query.next.length <= 2400 ? { next: req.query.next } : {}),
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
    const pending = unseal<{ state: string; nonce: string; verifier: string; next?: string }>("oauth", cookie(req, OAUTH_COOKIE));
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
      res.redirect(pending.next ?? "/");
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

// ---------------------------------------------------------------- OAuth for MCP clients

/** The paths the authorization server answers on, for the host check in front of them. */
export const AUTHORIZATION_PATHS = ["/oauth", PROTECTED_RESOURCE, AUTHORIZATION_SERVER];

/** The redirect URI with the answer's parameters added to whatever query it has already (RFC 6749, section 4.1.2). */
function answerAt(redirectUri: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
  return `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}${query}`;
}

/**
 * Apps that run in a browser read the documents and call the endpoints from a page of their own. None of these reads
 * a cookie, so any page may. They are never kept either: a cached token answer would hand the token to the next caller.
 */
const openToApps: RequestHandler = (req, res, next) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  });
  if (req.method === "OPTIONS") return void res.status(204).end();
  next();
};

/** A body the way OAuth sends it, form-encoded, or as JSON, which some apps send instead. */
const params = [express.urlencoded({ extended: false, limit: "16kb" }), express.json({ limit: "16kb" })];

/**
 * The server as its own OAuth 2.1 authorization server, so that MCP clients such as claude.ai, Claude Desktop and
 * ChatGPT connect with a sign-in rather than a pasted token: the discovery documents, registration, the authorization
 * page, the token endpoint and revocation. src/oauth has the rules; this is the HTTP around them. Mounted only while
 * sign-in is on: without accounts there is nobody to sign in, and /mcp is open.
 */
export function authorizationRoutes(log: Log, fetchDocument?: DocumentFetcher): Router {
  const routes = express.Router();
  const clients = clientDirectory(fetchDocument);
  const originHere = (req: Request) => originOf(baseUrl(req));

  routes.use([PROTECTED_RESOURCE, AUTHORIZATION_SERVER, "/oauth/register", "/oauth/token", "/oauth/revoke"], openToApps);

  routes.get(PROTECTED_RESOURCE, (req, res) => void res.json(protectedResource(originHere(req), false)));
  routes.get(`${PROTECTED_RESOURCE}/mcp`, (req, res) => void res.json(protectedResource(originHere(req), true)));
  routes.get(AUTHORIZATION_SERVER, (req, res) => void res.json(authorizationServer(originHere(req))));

  routes.post("/oauth/register", express.json({ limit: "64kb" }), async (req, res) => {
    // Registering takes nothing but a request, so each address gets a few at a time.
    if (!allow(`register:${visitorAddress(req)}`, 30, 10 * 60_000)) throw new OAuthError("too_many_requests", "Too many registrations from this address. Try again in a few minutes.", 429);
    res.status(201).json(await register(req.body));
  });

  routes.get("/oauth/authorize", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const here = originHere(req);
    let asked;
    try {
      asked = await checkAuthorization(req.query, here, visitorAddress(req), clients);
    } catch (error) {
      if (error instanceof PageError) return sendProblem(res, 400, error.message);
      if (error instanceof RedirectError) {
        return res.redirect(answerAt(error.redirectUri, { error: error.error, error_description: error.message, state: error.state, iss: here }));
      }
      throw error;
    }
    // Signing in comes after the checks, so that a request no app could have sent sends nobody to Google.
    const user = sessionHolder(cookie(req, SESSION_COOKIE));
    const signIn = `/auth/google?${new URLSearchParams({ next: req.originalUrl })}`;
    if (!user) return res.redirect(signIn);
    const approval: Approval & { userId: string } = { ...approvalOf(asked), userId: user.id };
    sendConsent(res, asked, user, seal("consent", { ...approval }, 10 * 60_000), signIn);
  });

  routes.post("/oauth/authorize", express.urlencoded({ extended: false, limit: "64kb" }), async (req, res) => {
    if (!sameOrigin(req)) return sendProblem(res, 403, "This answer did not come from appShots' own page.");
    const user = sessionHolder(cookie(req, SESSION_COOKIE));
    const approval = unseal<Approval & { userId: string }>("consent", typeof req.body?.request === "string" ? req.body.request : undefined);
    if (!user || !approval || approval.userId !== user.id) return sendProblem(res, 400, "This page ran out, or you signed in with another account since. Start connecting the app again.");
    if (!isDocumentId(approval.clientId) && !registeredClient(approval.clientId)) {
      return sendProblem(res, 400, "The app's registration ran out meanwhile. Remove appShots from the app and add it again.");
    }
    const here = originHere(req);
    const back = (answer: Record<string, string | undefined>) =>
      void res.set("Cache-Control", "no-store").redirect(303, answerAt(approval.redirectUri, { ...answer, state: approval.state, iss: here }));
    if (req.body.decision !== "allow") return back({ error: "access_denied", error_description: "The person did not let the app in." });
    back({ code: await issueCode(approval, user) });
  });

  routes.post("/oauth/token", ...params, async (req, res) => {
    res.set("Pragma", "no-cache").json(await token(req.get("authorization"), req.body ?? {}, originHere(req)));
  });

  routes.post("/oauth/revoke", ...params, async (req, res) => {
    await revoke(req.get("authorization"), req.body ?? {});
    res.status(200).end();
  });

  // Errors in OAuth's own form, which apps read: an error code and a sentence (RFC 6749, section 5.2). A body that
  // cannot be parsed is one too.
  routes.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    const status = error instanceof Error ? (error as { status?: unknown }).status : undefined;
    const unreadable = typeof status === "number" && status >= 400 && status < 500;
    if (res.headersSent || !(error instanceof OAuthError || unreadable)) return next(error);
    const failure = error instanceof OAuthError ? error : new OAuthError("invalid_request", "The request body cannot be read.", status as number);
    if (failure.status >= 500) log.warn(failure.message);
    res.status(failure.status).set("Cache-Control", "no-store");
    if (failure.status === 401 && /^basic /i.test(req.get("authorization") ?? "")) res.set("WWW-Authenticate", 'Basic realm="appShots"');
    res.json({ error: failure.error, error_description: failure.message });
  });

  return routes;
}
