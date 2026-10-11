import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  allow,
  AuthError,
  changePassword,
  confirmDelete,
  createInvite,
  createReset,
  createToken,
  deleteUser,
  describeToken,
  inviteValid,
  listInvites,
  listUsers,
  logIn,
  logInWithGoogle,
  ownerSession,
  ownerSpace,
  resetPassword,
  resetValid,
  revokeInvite,
  revokeToken,
  safeEqual,
  seal,
  SESSION_TTL,
  sessionHolder,
  setSignupMode,
  signUp,
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
import { BACKGROUNDS, BADGE_TYPES, CREATIVE_LAYOUTS, DEVICE_COLOR_IDS, FONT_IDS, FONTS, ICON_IDS, LAYOUTS } from "./design.ts";
import { createMcpServer } from "./mcp.ts";
import { closeBrowser, defaultTargets, renderProject } from "./render.ts";
import { creativesSchema, localeSchema, slideSchema, themeSchema } from "./schema.ts";
import { isPlacementId, isTargetId, PLACEMENT_IDS, PLACEMENTS, TARGET_IDS, TARGETS } from "./sizes.ts";
import {
  countProjects,
  createProject,
  deleteProject,
  deleteShot,
  getProject,
  InputError,
  listCreativeOutputs,
  listOutputs,
  listProjects,
  listShots,
  NotFoundError,
  outDir,
  safeJoin,
  saveShot,
  shotsDir,
  type Space,
  updateProject,
} from "./store.ts";
import { slideHtml } from "./template.ts";
import { writeZip } from "./zip.ts";

const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.join(root, "public");

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
const googleEnabled = Boolean(config.token && config.google.clientId && config.google.clientSecret);

interface Identity {
  space: Space;
  /** Set for accounts. The owner, who signs in with APPSHOTS_TOKEN, has none. */
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
  // Without APPSHOTS_TOKEN there is no sign-in at all: whoever reaches the port is the owner.
  if (!config.token) return { space: ownerSpace, session: true };
  if (safeEqual(req.get("x-appshots-internal") ?? "", config.internalSecret)) {
    const space = spaceById(req.get("x-appshots-space"));
    return space && { space, session: false };
  }
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (safeEqual(token, config.token)) return { space: ownerSpace, session: false };
    const user = userByToken(token);
    return user && { space: spaceOfUser(user), user, session: false };
  }
  const holder = sessionHolder(cookie(req, SESSION_COOKIE));
  if (holder === "owner") return { space: ownerSpace, session: true };
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
  if (wantsPage) return res.redirect("/login");
  res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Unauthorized: send Authorization: Bearer <token>" });
}

const identityOf = (res: Response) => res.locals.identity as Identity;
const spaceOf = (res: Response) => identityOf(res).space;

function setSession(req: Request, res: Response, value: string): void {
  res.cookie(SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: SESSION_TTL, path: "/" });
}

const tooMany = () => Object.assign(new Error("Too many attempts. Try again in a few minutes."), { status: 429 });

// ---------------------------------------------------------------- app

const app = express();
app.disable("x-powered-by");
// The reverse proxy in front terminates TLS; trusting that one hop makes req.protocol, req.ip and secure cookies correct.
app.set("trust proxy", 1);

app.use((_req, res, next) => {
  // Invite and reset codes travel in URLs, so they must not leak through Referer. Slide previews are framed by the gallery only.
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
});

const baseUrl = (req: Request) => config.publicUrl || `${req.protocol}://${req.get("host")}`;

app.get("/healthz", (_req, res) => {
  res.type("text").send("ok");
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

// ---------------------------------------------------------------- signing in

// The sign-in pages are the only part of the UI that works without a session.
app.get("/app.css", (_req, res) => void res.sendFile(path.join(publicDir, "app.css")));
app.get("/auth.js", (_req, res) => void res.sendFile(path.join(publicDir, "auth.js")));
app.get(["/login", "/signup"], (req, res) => {
  if (identify(req)) return res.redirect("/");
  res.sendFile(path.join(publicDir, "auth.html"));
});
app.get("/reset", (_req, res) => void res.sendFile(path.join(publicDir, "auth.html")));

const auth = express.Router();
auth.use(express.json({ limit: "8kb" }));
auth.use((req, res, next) => (READ_ONLY.has(req.method) || sameOrigin(req) ? next() : refuseCrossSite(res)));

auth.get("/config", (req, res) => {
  res.json({
    accounts: Boolean(config.token),
    google: googleEnabled,
    signup: signupMode(),
    invite: inviteValid(req.query.invite),
    reset: resetValid(req.query.reset),
  });
});

auth.post("/login", async (req, res) => {
  const { email, password, token } = (req.body ?? {}) as Record<string, unknown>;
  if (!allow(`login:${req.ip}`, 20, 15 * 60_000)) throw tooMany();
  if (typeof token === "string" && token) {
    if (!config.token || !safeEqual(token.trim(), config.token)) {
      // Slow down guessing of the owner's token.
      await new Promise((resolve) => setTimeout(resolve, 800));
      throw new AuthError("That server token is not correct.");
    }
    setSession(req, res, ownerSession());
    return void res.json({ ok: true });
  }
  if (typeof email === "string" && !allow(`login:${email.trim().toLowerCase()}`, 10, 15 * 60_000)) throw tooMany();
  setSession(req, res, userSession(await logIn(email, password)));
  res.json({ ok: true });
});

auth.post("/signup", async (req, res) => {
  if (!allow(`signup:${req.ip}`, 10, 3600_000)) throw tooMany();
  setSession(req, res, userSession(await signUp(req.body ?? {})));
  res.status(201).json({ ok: true });
});

auth.post("/reset", async (req, res) => {
  if (!allow(`reset:${req.ip}`, 20, 3600_000)) throw tooMany();
  setSession(req, res, userSession(await resetPassword(req.body?.code, req.body?.password)));
  res.json({ ok: true });
});

const googleRedirect = (req: Request) => `${baseUrl(req)}/auth/google/callback`;

auth.get("/google", (req, res) => {
  if (!googleEnabled) return res.redirect("/login?error=google_off");
  const pending = {
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    invite: typeof req.query.invite === "string" ? req.query.invite.slice(0, 100) : undefined,
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
  const pending = unseal<{ state: string; nonce: string; verifier: string; invite?: string }>("oauth", cookie(req, OAUTH_COOKIE));
  res.clearCookie(OAUTH_COOKIE, { path: "/auth/google" });
  const fail = (code: string) => res.redirect(`/login?error=${code}`);
  const { code, state, error } = req.query;
  if (typeof error === "string") return fail("google_cancelled");
  if (!googleEnabled || !pending || typeof state !== "string" || !safeEqual(state, pending.state) || typeof code !== "string") return fail("google_state");
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
    const user = await logInWithGoogle({ sub: claims.sub, email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined }, pending.invite);
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
  res.redirect("/login");
});

app.use(requireAuth);

// The CLI is one dependency-free file, so people without access to the repository can fetch it here.
app.get("/cli/appshots.mjs", (_req, res) => {
  res.set("Content-Disposition", 'attachment; filename="appshots.mjs"').sendFile(path.join(root, "cli", "appshots.mjs"));
});

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
  theme: themeSchema.optional(),
  slides: z.array(slideSchema).max(10).optional(),
  creatives: creativesSchema.optional(),
});
const renderBody = z.object({
  targets: z.array(z.enum(TARGET_IDS)).optional(),
  locales: z.array(localeSchema).optional(),
  slides: z.array(z.number().int().min(0)).optional(),
  creatives: z.array(z.enum(PLACEMENT_IDS)).optional(),
});

/** Renders of assets the project no longer defines stay on disk until the next full render, but are not offered. */
async function creativeOutputs(space: Space, id: string) {
  const [project, outputs] = await Promise.all([getProject(space, id), listCreativeOutputs(space, id)]);
  return outputs.filter((output) => project.creatives[output.placement]);
}

async function projectDetail(space: Space, id: string) {
  const [project, shots, outputs, creatives] = await Promise.all([getProject(space, id), listShots(space, id), listOutputs(space, id), creativeOutputs(space, id)]);
  return { project, shots, outputs, creativeOutputs: creatives, defaultTargets: defaultTargets(shots) };
}

api.get("/meta", (_req, res) => {
  const { user } = identityOf(res);
  res.json({
    targets: TARGETS,
    layouts: LAYOUTS,
    placements: PLACEMENTS,
    creativeLayouts: Object.fromEntries(Object.entries(CREATIVE_LAYOUTS).map(([id, note]) => [id, { note, screenshots: CREATIVE_CAPACITY[id as keyof typeof CREATIVE_LAYOUTS] }])),
    fonts: FONT_IDS,
    backgrounds: ["auto", ...Object.keys(BACKGROUNDS)],
    deviceColors: DEVICE_COLOR_IDS,
    badgeTypes: BADGE_TYPES,
    icons: ICON_IDS,
    authEnabled: Boolean(config.token),
    /** Null for the owner, who is configured through APPSHOTS_TOKEN rather than an account. */
    account: user ? { email: user.email, name: user.name, password: Boolean(user.password), google: Boolean(user.googleSub) } : null,
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
  const device = req.query.device === "iphone" || req.query.device === "ipad" ? req.query.device : undefined;
  res.status(201).json(await saveShot(spaceOf(res), req.params.id, req.params.name, req.body, device));
});
api.delete("/projects/:id/shots/:file", async (req, res) => {
  await getProject(spaceOf(res), req.params.id);
  await deleteShot(spaceOf(res), req.params.id, req.params.file);
  res.status(204).end();
});

api.post("/projects/:id/render", async (req, res) => {
  const result = await renderProject(spaceOf(res), req.params.id, renderBody.parse(req.body ?? {}));
  res.json({ ...result, outputs: await listOutputs(spaceOf(res), req.params.id), creativeOutputs: await creativeOutputs(spaceOf(res), req.params.id) });
});

api.get("/projects/:id/export.zip", async (req, res) => {
  const space = spaceOf(res);
  const { id } = req.params;
  await getProject(space, id);
  if (req.query.render === "1") await renderProject(space, id);
  const [outputs, creatives] = await Promise.all([listOutputs(space, id), creativeOutputs(space, id)]);
  if (outputs.length === 0 && creatives.length === 0) throw new InputError("Nothing has been rendered yet. Render the project first, or add ?render=1.");
  const entries = [
    ...outputs.flatMap((set) => set.files.map((file) => ({ name: `${set.locale}/${set.target}/${file}`, file: path.join(outDir(space, id), set.locale, set.target, file) }))),
    ...creatives.map((output) => ({ name: output.path.split(path.sep).join("/"), file: path.join(outDir(space, id), output.path) })),
  ];
  res.type("zip").set("Content-Disposition", `attachment; filename="${id}-screenshots.zip"`);
  await writeZip(res, entries);
  res.end();
});

// ---------------------------------------------------------------- account and people

// A leaked API token must not be able to mint more tokens, change the password or manage other people.
const requireSession = (_req: Request, res: Response, next: NextFunction) =>
  identityOf(res).session ? next() : void res.status(403).json({ error: "This needs a browser sign-in, not an API token." });

const account = express.Router();
account.use(requireSession, (_req, res, next) =>
  identityOf(res).user ? next() : void res.status(400).json({ error: "The owner has no account settings; the owner's token is APPSHOTS_TOKEN." }),
);
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
account.post("/password", async (req, res) => {
  const user = userOf(res);
  await changePassword(user, req.body?.current, req.body?.password);
  // The change ended every session, this one included, so hand the browser a fresh one.
  setSession(req, res, userSession(user));
  res.status(204).end();
});
account.delete("/", async (req, res) => {
  await confirmDelete(userOf(res), req.body?.confirm);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});
api.use("/account", account);

const admin = express.Router();
admin.use(requireSession, (_req, res, next) =>
  !identityOf(res).user && config.token ? next() : void res.status(403).json({ error: "Only the owner of this server can manage people." }),
);

admin.get("/people", async (_req, res) => {
  const users = await Promise.all(
    listUsers().map(async (user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      signIn: user.googleSub ? "Google" : "Password",
      projects: await countProjects(spaceOfUser(user)),
    })),
  );
  res.json({ signup: signupMode(), google: googleEnabled, users, invites: listInvites() });
});
admin.put("/signup", async (req, res) => {
  await setSignupMode(z.enum(["invite", "open"]).parse(req.body?.mode));
  res.status(204).end();
});
admin.post("/invites", async (req, res) => {
  const { code, link } = await createInvite();
  res.status(201).json({ id: link.id, expiresAt: link.expiresAt, url: `${baseUrl(req)}/signup?invite=${code}` });
});
admin.delete("/invites/:id", async (req, res) => {
  await revokeInvite(req.params.id);
  res.status(204).end();
});
admin.post("/users/:id/reset", async (req, res) => {
  res.status(201).json({ url: `${baseUrl(req)}/reset?code=${await createReset(req.params.id)}` });
});
admin.delete("/users/:id", async (req, res) => {
  await deleteUser(req.params.id);
  res.status(204).end();
});
api.use("/admin", admin);

app.use("/api", api);

// ---------------------------------------------------------------- files and slide pages

app.get("/files/:id/shots/:file", async (req, res) => {
  await getProject(spaceOf(res), req.params.id);
  res.set("Cache-Control", "private, max-age=31536000, immutable").sendFile(safeJoin(shotsDir(spaceOf(res), req.params.id), req.params.file));
});
app.get("/files/:id/out/*file", async (req, res) => {
  await getProject(spaceOf(res), req.params.id);
  const relative = (req.params.file as unknown as string[]).join("/");
  res.set("Cache-Control", "private, no-cache").sendFile(safeJoin(outDir(spaceOf(res), req.params.id), relative));
});

app.get("/render/:id/creative/:placement", async (req, res) => {
  const space = spaceOf(res);
  const project = await getProject(space, req.params.id);
  const { placement } = req.params;
  if (!isPlacementId(placement) || !project.creatives[placement]) throw new NotFoundError(`This project has no "${placement}" asset`);
  const shots = await listShots(space, project.id);
  const locale = localeSchema.safeParse(req.query.locale).data ?? project.locales[0]!;
  res.set("Cache-Control", "no-store").type("html").send(await creativeHtml({ space, project, shots, placement, locale, guides: req.query.guides === "1" }));
});

app.get("/render/:id/:index", async (req, res) => {
  const space = spaceOf(res);
  const project = await getProject(space, req.params.id);
  const shots = await listShots(space, project.id);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= project.slides.length) throw new NotFoundError(`Slide ${req.params.index} does not exist`);
  const wanted = String(req.query.target ?? "");
  const target = isTargetId(wanted) ? wanted : defaultTargets(shots)[0]!;
  const locale = localeSchema.safeParse(req.query.locale).data ?? project.locales[0]!;
  res.set("Cache-Control", "no-store").type("html").send(await slideHtml({ space, project, shots, index, target, locale }));
});

app.use(express.static(publicDir, { extensions: ["html"] }));

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
  if (!config.token) console.warn("APPSHOTS_TOKEN is not set: the UI, API and MCP endpoint are open to anyone who can reach this port, and accounts are off.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void closeBrowser().finally(() => process.exit(0));
  });
}
