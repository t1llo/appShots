import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "./config.ts";
import { BACKGROUNDS, BADGE_TYPES, DEVICE_COLOR_IDS, FONT_IDS, FONTS, ICON_IDS, LAYOUTS } from "./design.ts";
import { createMcpServer } from "./mcp.ts";
import { closeBrowser, defaultTargets, renderProject } from "./render.ts";
import { localeSchema, slideSchema, themeSchema } from "./schema.ts";
import { isTargetId, TARGET_IDS, TARGETS } from "./sizes.ts";
import {
  createProject,
  deleteProject,
  deleteShot,
  getProject,
  InputError,
  listOutputs,
  listProjects,
  listShots,
  NotFoundError,
  outDir,
  safeJoin,
  saveShot,
  shotsDir,
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

const SESSION_COOKIE = "shots_session";
const sessionValue = () => createHmac("sha256", config.token).update("shots-session").digest("hex");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function isAuthed(req: Request): boolean {
  if (!config.token) return true;
  if (req.get("x-shots-internal") === config.internalSecret) return true;
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ") && safeEqual(header.slice(7).trim(), config.token)) return true;
  const session = cookie(req, SESSION_COOKIE);
  return session !== undefined && safeEqual(session, sessionValue());
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthed(req)) return next();
  // Only a browser navigation prefers HTML; curl and fetch send */* and should get the 401.
  const wantsPage = req.method === "GET" && !req.path.startsWith("/api/") && !req.path.startsWith("/mcp") && req.accepts(["json", "html"]) === "html";
  if (wantsPage) return res.redirect("/login");
  res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Unauthorized: send Authorization: Bearer <SHOTS_TOKEN>" });
}

// ---------------------------------------------------------------- app

const app = express();
app.disable("x-powered-by");
// The reverse proxy in front terminates TLS; trusting it makes req.protocol and secure cookies correct.
app.set("trust proxy", true);

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

app.get("/login", (req, res) => {
  if (isAuthed(req)) return res.redirect("/");
  res.sendFile(path.join(publicDir, "login.html"));
});
app.post("/login", express.urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!config.token || !safeEqual(token, config.token)) {
    // Slow down guessing of the shared token.
    await new Promise((resolve) => setTimeout(resolve, 800));
    return res.redirect("/login?error=1");
  }
  res.cookie(SESSION_COOKIE, sessionValue(), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 180 * 24 * 3600 * 1000, path: "/" });
  res.redirect("/");
});
app.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.redirect("/login");
});

app.use(requireAuth);

// ---------------------------------------------------------------- MCP

app.post("/mcp", express.json({ limit: "2mb" }), async (req, res) => {
  // Stateless: every request gets a fresh server, so the service scales and restarts without session bookkeeping.
  const server = createMcpServer(baseUrl(req));
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
});
const renderBody = z.object({
  targets: z.array(z.enum(TARGET_IDS)).optional(),
  locales: z.array(localeSchema).optional(),
  slides: z.array(z.number().int().min(0)).optional(),
});

async function projectDetail(id: string) {
  const [project, shots, outputs] = await Promise.all([getProject(id), listShots(id), listOutputs(id)]);
  return { project, shots, outputs, defaultTargets: defaultTargets(shots) };
}

api.get("/meta", (_req, res) => {
  res.json({
    targets: TARGETS,
    layouts: LAYOUTS,
    fonts: FONT_IDS,
    backgrounds: ["auto", ...Object.keys(BACKGROUNDS)],
    deviceColors: DEVICE_COLOR_IDS,
    badgeTypes: BADGE_TYPES,
    icons: ICON_IDS,
    authEnabled: Boolean(config.token),
  });
});

api.get("/projects", async (_req, res) => {
  const projects = await listProjects();
  res.json(projects.map((p) => ({ id: p.id, name: p.name, slides: p.slides.length, locales: p.locales, updatedAt: p.updatedAt })));
});
api.post("/projects", async (req, res) => {
  const body = projectPatch.extend({ name: z.string().min(1).max(80) }).parse(req.body);
  res.status(201).json(await createProject(body));
});
api.get("/projects/:id", async (req, res) => {
  res.json(await projectDetail(req.params.id));
});
api.put("/projects/:id", async (req, res) => {
  await updateProject(req.params.id, projectPatch.parse(req.body));
  res.json(await projectDetail(req.params.id));
});
api.delete("/projects/:id", async (req, res) => {
  await deleteProject(req.params.id);
  res.status(204).end();
});

api.put("/projects/:id/shots/:name", express.raw({ type: () => true, limit: "40mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new InputError("Send the image file as the request body.");
  const device = req.query.device === "iphone" || req.query.device === "ipad" ? req.query.device : undefined;
  res.status(201).json(await saveShot(req.params.id, req.params.name, req.body, device));
});
api.delete("/projects/:id/shots/:file", async (req, res) => {
  await getProject(req.params.id);
  await deleteShot(req.params.id, req.params.file);
  res.status(204).end();
});

api.post("/projects/:id/render", async (req, res) => {
  const result = await renderProject(req.params.id, renderBody.parse(req.body ?? {}));
  res.json({ ...result, outputs: await listOutputs(req.params.id) });
});

api.get("/projects/:id/export.zip", async (req, res) => {
  const { id } = req.params;
  await getProject(id);
  if (req.query.render === "1") await renderProject(id);
  const outputs = await listOutputs(id);
  if (outputs.length === 0) throw new InputError("Nothing has been rendered yet. Render the project first, or add ?render=1.");
  const entries = outputs.flatMap((set) =>
    set.files.map((file) => ({ name: `${set.locale}/${set.target}/${file}`, file: path.join(outDir(id), set.locale, set.target, file) })),
  );
  res.type("zip").set("Content-Disposition", `attachment; filename="${id}-screenshots.zip"`);
  await writeZip(res, entries);
  res.end();
});

app.use("/api", api);

// ---------------------------------------------------------------- files and slide pages

app.get("/files/:id/shots/:file", async (req, res) => {
  await getProject(req.params.id);
  res.set("Cache-Control", "private, max-age=31536000, immutable").sendFile(safeJoin(shotsDir(req.params.id), req.params.file));
});
app.get("/files/:id/out/*file", async (req, res) => {
  await getProject(req.params.id);
  const relative = (req.params.file as unknown as string[]).join("/");
  res.set("Cache-Control", "private, no-cache").sendFile(safeJoin(outDir(req.params.id), relative));
});

app.get("/render/:id/:index", async (req, res) => {
  const project = await getProject(req.params.id);
  const shots = await listShots(project.id);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= project.slides.length) throw new NotFoundError(`Slide ${req.params.index} does not exist`);
  const wanted = String(req.query.target ?? "");
  const target = isTargetId(wanted) ? wanted : defaultTargets(shots)[0]!;
  const locale = localeSchema.safeParse(req.query.locale).data ?? project.locales[0]!;
  res.set("Cache-Control", "no-store").type("html").send(await slideHtml({ project, shots, index, target, locale }));
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
  const status = (error as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return void res.status(status).json({ error: status === 413 ? "File too large (limit 40 MB)" : (error as Error).message });
  }
  console.error(error);
  res.status(500).json({ error: "Internal error" });
});

const server = app.listen(config.port, () => {
  console.log(`shots listening on http://localhost:${config.port} (data in ${config.dataDir})`);
  if (!config.token) console.warn("SHOTS_TOKEN is not set: the UI, API and MCP endpoint are open to anyone who can reach this port.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void closeBrowser().finally(() => process.exit(0));
  });
}
