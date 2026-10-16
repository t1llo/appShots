import path from "node:path";
import express, { type Express } from "express";
import { hiddenAdminProjects } from "./accounts.ts";
import { config } from "./config.ts";
import { renewSession, requireAuth } from "./http/auth.ts";
import { errorHandler, type Log, notFound } from "./http/errors.ts";
import { LIMITS } from "./http/limits.ts";
import { accountRoutes } from "./http/routes/account.ts";
import { adminRoutes } from "./http/routes/admin.ts";
import { assetRoutes, uploadRoutes } from "./http/routes/assets.ts";
import { exportRoutes } from "./http/routes/exports.ts";
import { fileRoutes } from "./http/routes/files.ts";
import { mcpRoutes } from "./http/routes/mcp.ts";
import { mockupRoutes } from "./http/routes/mockups.ts";
import { AUTHORIZATION_PATHS, authorizationRoutes, logout, oauthRoutes } from "./http/routes/oauth.ts";
import { projectRoutes } from "./http/routes/projects.ts";
import { publicRoutes } from "./http/routes/public.ts";
import { renderPageRoutes } from "./http/routes/render-pages.ts";
import { renderRoutes } from "./http/routes/renders.ts";
import { siteRoutes } from "./http/routes/site.ts";
import { videoFileRoutes, videoPageRoutes, videoRoutes } from "./http/routes/video.ts";
import { allowedHost, privateCache, securityHeaders } from "./http/security.ts";
import type { DocumentFetcher } from "./oauth/clients.ts";
import { type Renderer, useRenderer } from "./render.ts";

export interface AppDeps {
  /** Where the server reports what went wrong on its side. The console unless a test listens in. */
  log?: Log;
  /** How an app's OAuth metadata document is fetched: over HTTPS from its address, unless a test stands in for it. */
  fetchClientDocument?: DocumentFetcher;
  /** What draws the pictures: the browser, unless a test stands in for it. */
  renderer?: Renderer;
}

/**
 * The whole server as an Express app that does not listen yet. The order below is the order a request goes
 * through: what anybody may fetch first, then the sign-in check, then everything that belongs to an account.
 */
export async function createApp(deps: AppDeps = {}): Promise<Express> {
  const log = deps.log ?? console;
  if (deps.renderer) useRenderer(deps.renderer);
  const hidden = await hiddenAdminProjects();
  if (hidden) {
    log.warn(
      `The admin's projects from before ADMIN_EMAIL named them are in ${hidden}, where the Studio does not show them. To see them again, move each folder in it into ${path.join(config.dataDir, "projects")}.`,
    );
  }

  const app = express();
  app.disable("x-powered-by");
  // The reverse proxy in front terminates TLS; trusting it makes req.protocol, req.ip and secure cookies correct.
  app.set("trust proxy", config.trustProxy);

  app.use(securityHeaders);

  // Public: the health check, the skill, the CLI and the installer, fonts and icons, the pages and signing in.
  app.use(await publicRoutes());
  siteRoutes(app);
  app.use("/auth", oauthRoutes(log));
  app.post("/logout", logout);
  // MCP clients sign in with OAuth while sign-in is on: the discovery documents and the authorization server.
  if (config.auth) {
    app.use(AUTHORIZATION_PATHS, allowedHost);
    app.use(authorizationRoutes(log, deps.fetchClientDocument));
  }

  // Everything below acts on an account's projects.
  app.use(["/api", "/mcp", "/files", "/render"], allowedHost);
  app.use(requireAuth);

  app.use(mcpRoutes(log));

  const api = express.Router();
  api.use(privateCache);
  api.use(renewSession);
  api.use(uploadRoutes());
  api.use(express.json({ limit: LIMITS.json }));
  api.use(projectRoutes());
  api.use(assetRoutes());
  api.use(videoRoutes(log));
  api.use(renderRoutes(log));
  api.use(exportRoutes(log));
  api.use(mockupRoutes());
  api.use("/account", accountRoutes());
  api.use("/admin", adminRoutes());
  app.use("/api", api);

  app.use("/files", fileRoutes());
  app.use("/files", videoFileRoutes());
  app.use("/render", videoPageRoutes());
  app.use("/render", renderPageRoutes());

  app.use(notFound);
  app.use(errorHandler(log));
  return app;
}
