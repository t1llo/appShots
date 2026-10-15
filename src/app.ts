import express, { type Express } from "express";
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
import { logout, oauthRoutes } from "./http/routes/oauth.ts";
import { projectRoutes } from "./http/routes/projects.ts";
import { publicRoutes } from "./http/routes/public.ts";
import { renderPageRoutes } from "./http/routes/render-pages.ts";
import { renderRoutes } from "./http/routes/renders.ts";
import { siteRoutes } from "./http/routes/site.ts";
import { privateCache, securityHeaders } from "./http/security.ts";

export interface AppDeps {
  /** Where the server reports what went wrong on its side. The console unless a test listens in. */
  log?: Log;
}

/**
 * The whole server as an Express app that does not listen yet. The order below is the order a request goes
 * through: what anybody may fetch first, then the sign-in check, then everything that belongs to an account.
 */
export async function createApp(deps: AppDeps = {}): Promise<Express> {
  const log = deps.log ?? console;
  const app = express();
  app.disable("x-powered-by");
  // The reverse proxy in front terminates TLS; trusting that one hop makes req.protocol, req.ip and secure cookies correct.
  app.set("trust proxy", 1);

  app.use(securityHeaders);
  app.use(renewSession);

  // Public: the health check, the skill, the CLI and the installer, fonts and icons, the pages and signing in.
  app.use(await publicRoutes());
  siteRoutes(app);
  app.use("/auth", oauthRoutes(log));
  app.post("/logout", logout);

  app.use(requireAuth);

  app.use(mcpRoutes());

  const api = express.Router();
  api.use(privateCache);
  api.use(express.json({ limit: LIMITS.json }));
  api.use(projectRoutes());
  api.use(uploadRoutes());
  api.use(assetRoutes());
  api.use(renderRoutes(log));
  api.use(exportRoutes());
  api.use(mockupRoutes());
  api.use("/account", accountRoutes());
  api.use("/admin", adminRoutes());
  app.use("/api", api);

  app.use("/files", fileRoutes());
  app.use("/render", renderPageRoutes());

  app.use(notFound);
  app.use(errorHandler(log));
  return app;
}
