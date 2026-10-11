import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  allow,
  allowEmail,
  AuthError,
  confirmDelete,
  createToken,
  describeToken,
  hasAccess,
  isAdmin,
  listAllowed,
  listUsers,
  logInWithGoogle,
  mainSpace,
  removePerson,
  rendersLeft,
  rendersOf,
  renewedSession,
  revokeToken,
  safeEqual,
  seal,
  SESSION_TTL,
  sessionHolder,
  setRendersLeft,
  setSignupMode,
  signupMode,
  spaceById,
  spaceOfUser,
  unseal,
  type User,
  userByToken,
  userSession,
} from "./accounts.ts";
import { config } from "./config.ts";
import { CREATIVE_CAPACITY, creativeHtml } from "./creative.ts";
import { BACKGROUNDS, BADGE_TONES, BADGE_TYPES, CREATIVE_LAYOUTS, DEVICE_COLOR_IDS, DEVICE_STYLES, FEATURE_STYLES, LAYOUT_SPREAD, STATUS_BARS, POINT_STYLES, ICON_ROW_SIZE_IDS, ICON_ROW_STYLES, ICON_ROW_TONES, FONT_IDS, FONTS, ICON_GROUPS, ICON_IDS, LAYOUT_SHOTS, LAYOUTS, LOGO_SHAPES, LOGO_SIZE_IDS } from "./design.ts";
import { ICONS } from "./icons.ts";
import { createMcpServer } from "./mcp.ts";
import { mockupHtml, mockupName, mockupShots, mockupStage } from "./mockup.ts";
import { cancelRender, closeBrowser, defaultTargets, frozenFor, getRender, listRenders, renderMockup, renderProject, startRender } from "./render.ts";
import { creativesSchema, localeSchema, type Mockups, mockupsSchema, type Project, slideSchema, targetsSchema, themeSchema } from "./schema.ts";
import { homePage, siteRoutes } from "./site.ts";
import { DEVICE_KINDS, DEVICE_LABELS, isDeviceKind, isPlacementId, isTargetId, orderTargets, PLACEMENT_IDS, PLACEMENTS, sourceOf, TARGET_IDS, type TargetId, TARGETS } from "./sizes.ts";
import {
  creativeDir,
  type CreativeOutput,
  countProjects,
  createProject,
  deleteImage,
  deleteProject,
  deleteShot,
  getProject,
  imagesDir,
  InputError,
  listCreativeOutputs,
  listImages,
  listOutputs,
  listProjects,
  listShots,
  moveShot,
  NotFoundError,
  type OutputSet,
  outDir,
  safeJoin,
  saveImage,
  saveShot,
  shotLocale,
  shotsDir,
  type Space,
  updateProject,
} from "./store.ts";
import { slideHtml } from "./template.ts";
import { writeZip } from "./zip.ts";

const root = path.resolve(import.meta.dirname, "..");
/** The Studio and the home page, built from web/ by `npm run build`. */
const webDir = path.join(root, "web", "dist");

// ---------------------------------------------------------------- fonts

/** One stylesheet for every bundled face; the browser only fetches the files a slide actually uses. */
async function buildFontCss(): Promise<string> {
  const sheets = await Promise.all(
    Object.entries(FONTS).map(async ([id, font]) => {
      const css = await readFile(path.join(root, "node_modules", font.pkg, font.css), "utf8");
      // `block` instead of `swap`: a screenshot must never catch the fallback face mid-swap.
      return css.replaceAll("url(./files/", `url(/fonts/${id}/`).replaceAll("font-display: swap", "font-display: block");
    }),
  );
  return sheets.join("\n");
}

// ---------------------------------------------------------------- auth

const SESSION_COOKIE = "appshots_session";
const OAUTH_COOKIE = "appshots_oauth";

interface Identity {
  space: Space;
  /** Who is signed in. Absent only while sign-in is off. */
  user?: User;
  /** Signed in through the browser rather than with a bearer token. Account settings require it. */
  session: boolean;
}

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function identify(req: Request): Identity | null {
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
function sameOrigin(req: Request): boolean {
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
const refuseCrossSite = (res: Response) => void res.status(403).json({ error: "Cross-site request refused" });

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const identity = identify(req);
  if (identity) {
    if (identity.session && !READ_ONLY.has(req.method) && !sameOrigin(req)) return refuseCrossSite(res);
    res.locals.identity = identity;
    return next();
  }
  // Only a browser navigation prefers HTML; curl and fetch send */* and should get the 401.
  const wantsPage = req.method === "GET" && !req.path.startsWith("/api/") && !req.path.startsWith("/mcp") && req.accepts(["json", "html"]) === "html";
  if (wantsPage) return res.redirect("/");
  res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Unauthorized: send Authorization: Bearer <token>" });
}

const identityOf = (res: Response) => res.locals.identity as Identity;
const spaceOf = (res: Response) => identityOf(res).space;

function setSession(req: Request, res: Response, value: string): void {
  res.cookie(SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: SESSION_TTL, path: "/" });
}

// ---------------------------------------------------------------- app

const app = express();
app.disable("x-powered-by");
// The reverse proxy in front terminates TLS; trusting that one hop makes req.protocol, req.ip and secure cookies correct.
app.set("trust proxy", 1);

app.use((_req, res, next) => {
  // Slide previews are framed by the Studio only.
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
});

const baseUrl = (req: Request) => config.publicUrl || `${req.protocol}://${req.get("host")}`;

// A session lasts 30 days from the last visit: a cookie more than a day old is swapped for a fresh one.
app.use((req, res, next) => {
  if (config.auth && req.method === "GET") {
    const fresh = renewedSession(cookie(req, SESSION_COOKIE));
    if (fresh) setSession(req, res, fresh);
  }
  next();
});

app.get("/healthz", (_req, res) => {
  res.type("text").send("ok");
});

// What a Mac needs to work with this server: the skill that runs the whole flow in a coding agent, the CLI that
// captures and uploads, and the script that installs both and connects the agent (`curl <server>/install.sh | sh`).
// None of them holds a secret, so they are public. The server fills in its own address.
const skill = await readFile(path.join(root, "skill", "SKILL.md"), "utf8");
const installer = await readFile(path.join(root, "cli", "install.sh"), "utf8");
app.get("/skill.md", (req, res) => {
  res.type("text/markdown").set("Cache-Control", "no-cache").send(skill.replaceAll("{{SERVER}}", baseUrl(req)));
});
app.get("/install.sh", (req, res) => {
  const server = baseUrl(req);
  // The address ends up inside a shell script, and without PUBLIC_URL it is whatever Host the request claimed.
  if (!/^https?:\/\/[\w.:[\]-]+(\/[\w./~-]*)?$/.test(server)) return void res.status(400).type("text").send("Set PUBLIC_URL to use the installer.\n");
  res.type("text/plain").set("Cache-Control", "no-cache").send(installer.replaceAll("{{SERVER}}", server));
});
app.get("/cli/appshots.mjs", (_req, res) => {
  res.set("Content-Disposition", 'attachment; filename="appshots.mjs"').sendFile(path.join(root, "cli", "appshots.mjs"));
});

const fontCss = await buildFontCss();
app.get("/fonts/fonts.css", (_req, res) => {
  res.type("css").set("Cache-Control", "public, max-age=86400").send(fontCss);
});
app.get("/fonts/:font/:file", (req, res) => {
  const font = FONTS[req.params.font as keyof typeof FONTS];
  if (!font || !/^[a-z0-9-]+\.woff2?$/.test(req.params.file)) return void res.status(404).end();
  res.set("Cache-Control", "public, max-age=31536000, immutable").sendFile(path.join(root, "node_modules", font.pkg, "files", req.params.file));
});

// Every icon as a symbol, for the Studio's picker: <use href="/icons.svg#rocket">.
const iconSprite = `<svg xmlns="http://www.w3.org/2000/svg">${ICON_IDS.map((id) => `<symbol id="${id}" viewBox="0 0 256 256">${ICONS[id]}</symbol>`).join("")}</svg>`;
app.get("/icons.svg", (_req, res) => {
  res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400").send(iconSprite);
});

// Page analytics, when POSTHOG_KEY is set: the home page and the Studio both load this file, and without a key it
// is empty. The Studio shows people's unreleased apps, so there it counts pages and clicks and never records the screen.
const POSTHOG_LOADER = String.raw`!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="gu mu yu bu ku init Qu Zu Wu Vu Yu el Gu ec zu lc uc cc hc dc vc capture getExtension Ju fu mc calculateEventProperties gc register register_once register_for_session unregister unregister_for_session wc Uu yc getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys onActiveMatchingSurveysChanged renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync kc identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset Sc shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty bc rc createPersonProfile setInternalOrTestUser Cu xu opt_in_capturing opt_out_capturing $u has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing nc debug il Os getPageViewId captureTraceFeedback captureTraceMetric Nu".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;
const analyticsJs = (studio: boolean) =>
  config.posthog
    ? `${POSTHOG_LOADER}\nposthog.init(${JSON.stringify(config.posthog.key)},${JSON.stringify({
        api_host: config.posthog.host,
        defaults: "2026-05-30",
        person_profiles: "identified_only",
        ...(studio ? { disable_session_recording: true } : {}),
      })});\n`
    : "// Analytics are off on this server.\n";
app.get("/analytics.js", (req, res) => {
  res.type("application/javascript").set("Cache-Control", "public, max-age=300").send(analyticsJs(req.query.page === "studio"));
});

// ---------------------------------------------------------------- home page and signing in

// The built scripts and styles carry no data and have content hashes in their names, so they are public and cached for good.
app.use("/assets", express.static(path.join(webDir, "assets"), { immutable: true, maxAge: "1y" }));

function sendPage(res: Response, name: string): void {
  const page = path.join(webDir, name);
  if (!existsSync(page)) return void res.status(503).type("text").send("The web pages have not been built yet. Run: npm run build");
  res.set("Cache-Control", "no-cache").sendFile(page);
}

/** The home page carries its own address, for search engines and shared links, so it is filled in rather than sent as a file. */
function sendHome(req: Request, res: Response): void {
  const page = homePage(baseUrl(req));
  if (page == null) return sendPage(res, "home.html");
  res.set("Cache-Control", "no-cache").type("html").send(page);
}

/** One address, two pages: the Studio for whoever is signed in, the public home page for everybody else. */
app.get("/", (req, res) => (identify(req) ? sendPage(res, "index.html") : sendHome(req, res)));
// The home page under its own address too, so it can be looked at while signed in or with sign-in off.
app.get("/home", sendHome);
// The documentation, the privacy policy and the terms, which anybody can read.
siteRoutes(app, baseUrl);
// Where every "Open Studio" button points: straight in for whoever is signed in, through Google for everybody else.
app.get("/studio", (req, res) => res.redirect(identify(req) ? "/" : "/auth/google"));
// Addresses from before the home page did the signing in.
app.get(["/login", "/signup", "/reset"], (_req, res) => res.redirect("/"));

const auth = express.Router();

// What the public pages ask to know what to show: how sign-in works here, and whether this browser is signed in already.
auth.get("/config", (req, res) => {
  const holder = config.auth ? sessionHolder(cookie(req, SESSION_COOKIE)) : null;
  res.set("Cache-Control", "no-store").json({ signIn: config.auth, signup: signupMode(), account: holder ? { name: holder.name } : null });
});

const googleRedirect = (req: Request) => `${baseUrl(req)}/auth/google/callback`;

auth.get("/google", (req, res) => {
  if (!config.auth) return res.redirect("/");
  if (!allow(`google:${req.ip}`, 30, 15 * 60_000)) return res.redirect("/?error=too_many");
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
    console.error(failure);
    fail("google_failed");
  }
});

app.use("/auth", auth);

app.post("/logout", (req, res) => {
  if (!sameOrigin(req)) return refuseCrossSite(res);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.redirect("/");
});

app.use(requireAuth);

// ---------------------------------------------------------------- MCP

app.post("/mcp", express.json({ limit: "2mb" }), async (req, res) => {
  // Stateless: every request gets a fresh server, so the service scales and restarts without session bookkeeping.
  const server = createMcpServer(baseUrl(req), spaceOf(res));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.all("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
});

// ---------------------------------------------------------------- REST API

const api = express.Router();
api.use(express.json({ limit: "2mb" }));

const projectPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  locales: z.array(localeSchema).min(1).max(40).optional(),
  targets: targetsSchema.nullable().optional(),
  theme: themeSchema.optional(),
  slides: z.array(slideSchema).max(10).optional(),
  creatives: creativesSchema.optional(),
  mockups: mockupsSchema.optional(),
});
const renderBody = z.object({
  targets: z.array(z.enum(TARGET_IDS)).optional(),
  locales: z.array(localeSchema).optional(),
  slides: z.array(z.number().int().min(0)).optional(),
  creatives: z.array(z.enum(PLACEMENT_IDS)).optional(),
  /** Answer at once with the run instead of waiting for it. */
  background: z.boolean().optional(),
});

/** Renders of assets the project no longer defines stay on disk until the next full render, but are not offered. */
async function creativeOutputs(space: Space, id: string) {
  const [project, outputs] = await Promise.all([getProject(space, id), listCreativeOutputs(space, id)]);
  return outputs.filter((output) => project.creatives[output.placement]);
}

async function projectDetail(space: Space, id: string) {
  const [project, shots, images, outputs, creatives] = await Promise.all([getProject(space, id), listShots(space, id), listImages(space, id), listOutputs(space, id), creativeOutputs(space, id)]);
  return { project, shots, images, outputs, creativeOutputs: creatives, defaultTargets: defaultTargets(shots, project.targets) };
}

api.get("/meta", (_req, res) => {
  const { user, space } = identityOf(res);
  res.json({
    targets: TARGETS,
    devices: DEVICE_KINDS.map((id) => ({ id, label: DEVICE_LABELS[id] })),
    layouts: LAYOUTS,
    layoutShots: LAYOUT_SHOTS,
    placements: PLACEMENTS,
    creativeLayouts: Object.fromEntries(Object.entries(CREATIVE_LAYOUTS).map(([id, note]) => [id, { note, screenshots: CREATIVE_CAPACITY[id as keyof typeof CREATIVE_LAYOUTS] }])),
    fonts: FONT_IDS,
    fontList: Object.entries(FONTS).map(([id, font]) => ({ id, family: font.family, group: font.group, note: font.note, weight: font.weight })),
    backgrounds: ["auto", ...Object.keys(BACKGROUNDS)],
    deviceColors: DEVICE_COLOR_IDS,
    deviceStyles: DEVICE_STYLES,
    statusBars: STATUS_BARS,
    layoutSpread: LAYOUT_SPREAD,
    badgeTypes: BADGE_TYPES,
    badgeTones: BADGE_TONES,
    featureStyles: FEATURE_STYLES,
    pointStyles: POINT_STYLES,
    logoShapes: LOGO_SHAPES,
    logoSizes: LOGO_SIZE_IDS,
    iconRowStyles: ICON_ROW_STYLES,
    iconRowTones: ICON_ROW_TONES,
    iconRowSizes: ICON_ROW_SIZE_IDS,
    icons: ICON_IDS,
    iconGroups: ICON_GROUPS,
    authEnabled: config.auth,
    /** Null only while sign-in is off. */
    account: user ? { email: user.email, name: user.name, admin: isAdmin(user) } : null,
    /** How many renders the account has left. Null where they are not counted: for the admin, and while sign-in is off. */
    rendersLeft: rendersLeft(space.id),
  });
});

api.get("/projects", async (_req, res) => {
  const projects = await listProjects(spaceOf(res));
  res.json(projects.map((p) => ({ id: p.id, name: p.name, slides: p.slides.length, locales: p.locales, updatedAt: p.updatedAt })));
});
api.post("/projects", async (req, res) => {
  const body = projectPatch.extend({ name: z.string().min(1).max(80) }).parse(req.body);
  res.status(201).json(await createProject(spaceOf(res), body));
});
api.get("/projects/:id", async (req, res) => {
  res.json(await projectDetail(spaceOf(res), req.params.id));
});
api.put("/projects/:id", async (req, res) => {
  await updateProject(spaceOf(res), req.params.id, projectPatch.parse(req.body));
  res.json(await projectDetail(spaceOf(res), req.params.id));
});
api.delete("/projects/:id", async (req, res) => {
  await deleteProject(spaceOf(res), req.params.id);
  res.status(204).end();
});

api.put("/projects/:id/shots/:name", express.raw({ type: () => true, limit: "40mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new InputError("Send the image file as the request body.");
  const device = isDeviceKind(req.query.device) ? req.query.device : undefined;
  const locale = req.query.locale == null || req.query.locale === "" ? undefined : localeSchema.parse(req.query.locale);
  res.status(201).json(await saveShot(spaceOf(res), req.params.id, req.params.name, req.body, device, locale));
});
api.patch("/projects/:id/shots/:file", async (req, res) => {
  const to = z
    .object({ device: z.enum(DEVICE_KINDS).optional(), locale: localeSchema.nullable().optional() })
    .refine((body) => body.device !== undefined || body.locale !== undefined, "Send device, locale or both.")
    .parse(req.body);
  res.json(await moveShot(spaceOf(res), req.params.id, req.params.file, to));
});
api.delete("/projects/:id/shots/:file", async (req, res) => {
  await getProject(spaceOf(res), req.params.id);
  await deleteShot(spaceOf(res), req.params.id, req.params.file);
  res.status(204).end();
});

api.put("/projects/:id/images/:name", express.raw({ type: () => true, limit: "20mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new InputError("Send the image file as the request body.");
  res.status(201).json(await saveImage(spaceOf(res), req.params.id, req.params.name, req.body));
});
api.delete("/projects/:id/images/:file", async (req, res) => {
  await getProject(spaceOf(res), req.params.id);
  await deleteImage(spaceOf(res), req.params.id, req.params.file);
  res.status(204).end();
});

api.post("/projects/:id/render", async (req, res) => {
  const space = spaceOf(res);
  const { id } = req.params;
  const { background, ...request } = renderBody.parse(req.body ?? {});
  if (background) {
    // A project that does not exist is answered here, not by a run that fails a moment later.
    const { name } = await getProject(space, id);
    const { job, finished } = startRender(space, id, request, name);
    finished.catch((error: unknown) => {
      if (!(error instanceof InputError || error instanceof NotFoundError)) console.error(error);
    });
    return void res.status(202).json({ job, rendersLeft: rendersLeft(space.id) });
  }
  const result = await renderProject(space, id, request);
  res.json({ ...result, outputs: await listOutputs(space, id), creativeOutputs: await creativeOutputs(space, id), rendersLeft: rendersLeft(space.id) });
});

// The account's renders: the ones waiting or under way, and the finished ones of the last hour.
api.get("/renders", (_req, res) => {
  res.json({ jobs: listRenders(spaceOf(res)), rendersLeft: rendersLeft(spaceOf(res).id) });
});
api.get("/renders/:job", (req, res) => {
  res.json(getRender(spaceOf(res), req.params.job));
});
api.delete("/renders/:job", (req, res) => {
  res.json(cancelRender(spaceOf(res), req.params.job));
});

/** The note at the top of the ZIP: which folder goes onto which screenshot slot of App Store Connect. */
function exportNotes(name: string, outputs: OutputSet[], creatives: CreativeOutput[]): string {
  const lines = [
    `${name}: App Store screenshots`,
    "",
    "Where each folder goes in App Store Connect",
    "Open your app, then the version, then Previews and Screenshots. Pick the language at the top right,",
    "open the display named below, and drag all files of that folder onto it. The numbers keep them in order.",
    "A display you leave empty shows the screenshots of a larger one, scaled down by Apple.",
  ];
  for (const locale of [...new Set([...outputs.map((set) => set.locale), ...creatives.map((output) => output.locale)])]) {
    lines.push("", `${locale}/`);
    const sets = outputs.filter((set) => set.locale === locale && isTargetId(set.target));
    const rows = [
      ...orderTargets(sets.map((set) => set.target as TargetId)).map((id) => [`${id}/`, `${TARGETS[id].width} x ${TARGETS[id].height}`, TARGETS[id].slot]),
      ...creatives
        .filter((output) => output.locale === locale)
        .map((output) => {
          const placement = PLACEMENTS[output.placement];
          return [`${creativeDir(output.placement)}/${output.placement}.png`, `${placement.width} x ${placement.height}`, placement.kind === "banner" ? `Banner: ${placement.label}` : `Header and Search Results tab: ${placement.label}`];
        }),
    ];
    const pad = [0, 1].map((column) => Math.max(...rows.map((row) => row[column]!.length)));
    for (const row of rows) lines.push(`  ${row[0]!.padEnd(pad[0]!)}  ${row[1]!.padEnd(pad[1]!)}  ${row[2]}`);
  }
  lines.push("", "Every file is a PNG without transparency at the exact pixel size of its display.", "");
  return lines.join("\n");
}

api.get("/projects/:id/export.zip", async (req, res) => {
  const space = spaceOf(res);
  const { id } = req.params;
  const project = await getProject(space, id);
  if (req.query.render === "1") await renderProject(space, id);
  const [outputs, creatives] = await Promise.all([listOutputs(space, id), creativeOutputs(space, id)]);
  if (outputs.length === 0 && creatives.length === 0) throw new InputError("Nothing has been rendered yet. Render the project first, or add ?render=1.");
  const entries = [
    { name: "README.txt", data: Buffer.from(exportNotes(project.name, outputs, creatives)) },
    ...outputs.flatMap((set) => set.files.map((file) => ({ name: `${set.locale}/${set.target}/${file}`, file: path.join(outDir(space, id), set.locale, set.target, file) }))),
    ...creatives.map((output) => ({ name: output.path.split(path.sep).join("/"), file: path.join(outDir(space, id), output.path) })),
  ];
  res.type("zip").set("Content-Disposition", `attachment; filename="${id}-screenshots.zip"`);
  await writeZip(res, entries);
  res.end();
});

// ---------------------------------------------------------------- mockups

/** The settings a mockup is drawn with: the project's own, with what the request sets laid over them. */
function mockupSettings(project: Project, query: Request["query"]): Mockups {
  if (typeof query.settings === "string") {
    let given: unknown;
    try {
      given = JSON.parse(query.settings);
    } catch {
      throw new InputError("`settings` has to be JSON, such as {\"device\":{\"style\":\"clay\"}}.");
    }
    return mockupsSchema.parse(given);
  }
  if (query.width == null) return project.mockups;
  return mockupsSchema.parse({ ...project.mockups, width: Number(query.width) });
}

/** The language a mockup request asks for: one of the project's, the first when it names none. */
function mockupLocale(project: Project, wanted: unknown): string {
  if (wanted == null || wanted === "") return project.locales[0]!;
  return shotLocale(project, String(wanted)) ?? project.locales[0]!;
}

api.get("/projects/:id/mockups", async (req, res) => {
  const space = spaceOf(res);
  const project = await getProject(space, req.params.id);
  const locale = mockupLocale(project, req.query.locale);
  const settings = mockupSettings(project, req.query);
  const items = mockupShots(project, await listShots(space, project.id), locale).map((shot) => {
    const stage = mockupStage(shot, settings);
    const file = encodeURIComponent(shot.file);
    return {
      file: shot.file,
      name: shot.name,
      device: shot.device,
      ...(shot.locale ? { locale: shot.locale } : {}),
      version: shot.version,
      saveAs: mockupName(shot),
      // The page is larger than the PNG: the PNG is cut down to the device and its shadow.
      stage: { width: stage.width, height: stage.height },
      page: `/render/${project.id}/mockup/${file}`,
      png: `/api/projects/${project.id}/mockups/${file}`,
    };
  });
  res.json({ settings: project.mockups, locale, items });
});

api.get("/projects/:id/mockups.zip", async (req, res) => {
  const space = spaceOf(res);
  const project = await getProject(space, req.params.id);
  const shots = await listShots(space, project.id);
  if (shots.length === 0) throw new InputError("This project has no screenshots yet, so there is nothing to make mockups of.");
  const settings = mockupSettings(project, req.query);
  const one = req.query.locale == null || req.query.locale === "" ? undefined : mockupLocale(project, req.query.locale);
  // One language: its mockups, flat. Every language: the first one's flat, and a folder per other language for the screenshots it has of its own.
  const wanted = one
    ? mockupShots(project, shots, one).map((shot) => ({ shot, name: mockupName(shot) }))
    : [
        ...mockupShots(project, shots).map((shot) => ({ shot, name: mockupName(shot) })),
        ...project.locales.slice(1).flatMap((locale) =>
          mockupShots(project, shots, locale)
            .filter((shot) => shot.locale?.toLowerCase() === locale.toLowerCase())
            .map((shot) => ({ shot, name: `${locale}/${mockupName(shot)}` })),
        ),
      ];
  // Drawn before the first byte goes out, so a failure is still an error and not half a file.
  const entries = [];
  for (const { shot, name } of wanted) entries.push({ name, data: (await renderMockup(space, project, shot, settings)).png });
  res.type("zip").set("Content-Disposition", `attachment; filename="${project.id}-mockups.zip"`);
  await writeZip(res, entries);
  res.end();
});

api.get("/projects/:id/mockups/:file", async (req, res) => {
  const space = spaceOf(res);
  const project = await getProject(space, req.params.id);
  const shot = (await listShots(space, project.id)).find((each) => each.file === req.params.file);
  if (!shot) throw new NotFoundError(`This project has no screenshot file "${req.params.file}"`);
  const mockup = await renderMockup(space, project, shot, mockupSettings(project, req.query));
  res
    .type("png")
    .set("Cache-Control", "private, no-cache")
    .set("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${mockupName(shot)}"`)
    .send(mockup.png);
});

// ---------------------------------------------------------------- account and people

// A leaked API token must not be able to mint more tokens or manage other people.
const requireSession = (_req: Request, res: Response, next: NextFunction) =>
  identityOf(res).session ? next() : void res.status(403).json({ error: "This needs a browser sign-in, not an API token." });

const account = express.Router();
account.use(requireSession, (_req, res, next) => (identityOf(res).user ? next() : void res.status(400).json({ error: "There are no accounts while sign-in is off." })));
const userOf = (res: Response) => identityOf(res).user!;

account.get("/tokens", (_req, res) => {
  res.json(userOf(res).tokens.map(describeToken));
});
account.post("/tokens", async (req, res) => {
  const { token, entry } = await createToken(userOf(res), req.body?.name);
  res.status(201).json({ token, ...describeToken(entry) });
});
account.delete("/tokens/:id", async (req, res) => {
  await revokeToken(userOf(res), req.params.id);
  res.status(204).end();
});
account.delete("/", async (req, res) => {
  await confirmDelete(userOf(res), req.body?.confirm);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});
api.use("/account", account);

const admin = express.Router();
admin.use(requireSession, (_req, res, next) => {
  const { user } = identityOf(res);
  if (user && isAdmin(user)) return next();
  res.status(403).json({ error: "Only the admin of this server can manage people." });
});

/** Everybody the admin should know about: the admin, the accounts, and the addresses on the list that have not signed in yet. */
admin.get("/people", async (_req, res) => {
  const listed = new Set(listAllowed());
  const users = listUsers();
  const accounts = await Promise.all(
    users.map(async (user) => ({
      email: user.email,
      name: user.name,
      admin: isAdmin(user),
      joinedAt: user.createdAt,
      projects: await countProjects(spaceOfUser(user)),
      access: hasAccess(user),
      renders: rendersOf(user),
    })),
  );
  const known = new Set(users.map((user) => user.email));
  const waiting = [config.adminEmail, ...listed].filter((email) => !known.has(email)).map((email) => ({ email, admin: email === config.adminEmail, access: true }));
  res.json({ signup: signupMode(), people: [...accounts, ...waiting].sort((a, b) => Number(b.admin) - Number(a.admin) || a.email.localeCompare(b.email)) });
});
admin.put("/signup", async (req, res) => {
  await setSignupMode(z.enum(["list", "open"]).parse(req.body?.mode));
  res.status(204).end();
});
admin.post("/people", async (req, res) => {
  await allowEmail(req.body?.email);
  res.status(204).end();
});
admin.put("/renders", async (req, res) => {
  const { email, left } = z.object({ email: z.string(), left: z.number().int().min(0).max(100_000) }).parse(req.body);
  await setRendersLeft(email, left);
  res.status(204).end();
});
// The address travels in the body, like everything else here, so it stays out of access logs.
admin.delete("/people", async (req, res) => {
  await removePerson(req.body?.email);
  res.status(204).end();
});
api.use("/admin", admin);

app.use("/api", api);

// ---------------------------------------------------------------- files and slide pages

app.get("/files/:id/shots/:file", async (req, res) => {
  await getProject(spaceOf(res), req.params.id);
  res.set("Cache-Control", "private, max-age=31536000, immutable").sendFile(safeJoin(shotsDir(spaceOf(res), req.params.id), req.params.file));
});
app.get("/files/:id/images/:file", async (req, res) => {
  await getProject(spaceOf(res), req.params.id);
  res.set("Cache-Control", "private, max-age=31536000, immutable").sendFile(safeJoin(imagesDir(spaceOf(res), req.params.id), req.params.file));
});
app.get("/files/:id/out/*file", async (req, res) => {
  await getProject(spaceOf(res), req.params.id);
  const relative = (req.params.file as unknown as string[]).join("/");
  res.set("Cache-Control", "private, no-cache").sendFile(safeJoin(outDir(spaceOf(res), req.params.id), relative));
});

/** What a slide page draws: the project as it is, or, for a page of a running render, as it was when the render was asked for. */
async function drawn(space: Space, req: Request<{ id: string }>) {
  const frozen = frozenFor(space, req.query.job);
  if (frozen?.project.id === req.params.id) return frozen;
  const project = await getProject(space, req.params.id);
  return { project, shots: await listShots(space, project.id) };
}

app.get("/render/:id/creative/:placement", async (req, res) => {
  const space = spaceOf(res);
  const { project, shots } = await drawn(space, req);
  const { placement } = req.params;
  if (!isPlacementId(placement) || !project.creatives[placement]) throw new NotFoundError(`This project has no "${placement}" asset`);
  const locale = localeSchema.safeParse(req.query.locale).data ?? project.locales[0]!;
  res.set("Cache-Control", "no-store").type("html").send(await creativeHtml({ space, project, shots, placement, locale, guides: req.query.guides === "1" }));
});

app.get("/render/:id/mockup/:file", async (req, res) => {
  const space = spaceOf(res);
  const project = await getProject(space, req.params.id);
  const shot = (await listShots(space, project.id)).find((each) => each.file === req.params.file);
  if (!shot) throw new NotFoundError(`This project has no screenshot file "${req.params.file}"`);
  res.set("Cache-Control", "no-store").type("html").send(await mockupHtml(space, project, shot, mockupSettings(project, req.query), req.query.bare === "1"));
});

app.get("/render/:id/:index", async (req, res) => {
  const space = spaceOf(res);
  const { project, shots } = await drawn(space, req);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= project.slides.length) throw new NotFoundError(`Slide ${req.params.index} does not exist`);
  const wanted = String(req.query.target ?? "");
  const target = isTargetId(wanted) ? wanted : sourceOf(defaultTargets(shots, project.targets)[0]!);
  const locale = localeSchema.safeParse(req.query.locale).data ?? project.locales[0]!;
  res.set("Cache-Control", "no-store").type("html").send(await slideHtml({ space, project, shots, index, target, locale }));
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return void res.end();
  if (error instanceof z.ZodError) return void res.status(400).json({ error: z.prettifyError(error) });
  if (error instanceof InputError) return void res.status(400).json({ error: error.message });
  if (error instanceof NotFoundError) return void res.status(404).json({ error: error.message });
  if (error instanceof AuthError) return void res.status(401).json({ error: error.message });
  const status = (error as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return void res.status(status).json({ error: status === 413 ? "File too large (limit 40 MB)" : (error as Error).message });
  }
  console.error(error);
  res.status(500).json({ error: "Internal error" });
});

const server = app.listen(config.port, () => {
  console.log(`appShots listening on http://localhost:${config.port} (data in ${config.dataDir})`);
  if (!existsSync(path.join(webDir, "index.html"))) console.warn("The web pages have not been built yet: run `npm run build`. The API and the MCP endpoint work without them.");
  if (config.auth) console.log(`Sign-in is by Google; the admin is ${config.adminEmail}.`);
  else console.warn("Sign-in is off (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ADMIN_EMAIL are not set): the UI, API and MCP endpoint are open to anyone who can reach this port.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void closeBrowser().finally(() => process.exit(0));
  });
}
