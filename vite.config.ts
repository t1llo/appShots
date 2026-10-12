import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Where `npm run dev` serves the API while `npm run dev:web` serves the Studio with hot reload. */
const server = process.env.APPSHOTS_SERVER ?? "http://localhost:3000";
const web = path.resolve(import.meta.dirname, "web");

/** The home page is /home here, as on the real server, which also answers / with it for visitors who are not signed in. */
const homePage: Plugin = {
  name: "appshots-home-page",
  configureServer(vite) {
    vite.middlewares.use((req, _res, next) => {
      const match = /^\/home(\?.*)?$/.exec(req.url ?? "");
      if (match) req.url = `/home.html${match[1] ?? ""}`;
      next();
    });
  },
};

export default defineConfig({
  root: web,
  plugins: [react(), homePage],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { index: path.join(web, "index.html"), home: path.join(web, "home.html"), docs: path.join(web, "docs.html") } },
  },
  server: {
    // The documentation is put together by the server, from docs/ and the built web/dist/docs.html.
    proxy: Object.fromEntries(
      ["^/api/", "^/auth/", "^/logout", "^/render/", "^/files/", "^/fonts/", "^/mcp", "^/cli/", "^/skill\\.md", "^/docs(/|$)", "^/(privacy|terms)(\\.md)?$", "^/(llms|llms-full|robots)\\.txt$", "^/sitemap\\.xml$", "^/og\\.jpg$"].map((route) => [route, server]),
    ),
  },
});
