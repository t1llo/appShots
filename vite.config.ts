import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Where `npm run dev` serves the API while `npm run dev:web` serves the gallery with hot reload. */
const server = process.env.APPSHOTS_SERVER ?? "http://localhost:3000";
const web = path.resolve(import.meta.dirname, "web");

/** /login, /signup and /reset are one page, as they are on the real server. */
const authPages: Plugin = {
  name: "appshots-auth-pages",
  configureServer(vite) {
    vite.middlewares.use((req, _res, next) => {
      const match = /^\/(login|signup|reset)(\?.*)?$/.exec(req.url ?? "");
      if (match) req.url = `/auth.html${match[2] ?? ""}`;
      next();
    });
  },
};

export default defineConfig({
  root: web,
  plugins: [react(), authPages],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { index: path.join(web, "index.html"), auth: path.join(web, "auth.html") } },
  },
  server: {
    proxy: Object.fromEntries(["^/api/", "^/auth/", "^/logout", "^/render/", "^/files/", "^/fonts/", "^/mcp", "^/cli/"].map((route) => [route, server])),
  },
});
