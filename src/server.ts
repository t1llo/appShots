import { existsSync } from "node:fs";
import path from "node:path";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { webDir } from "./http/routes/site.ts";
import { closeBrowser } from "./render.ts";
import { sweepProjects } from "./storage/migrate.ts";

// What `npm start` and the container run: build the app, listen, and stop cleanly on a signal.

const app = await createApp();

// Before the first request, so no write is under way while the files writes left behind are cleared.
await sweepProjects(config.dataDir).catch((error: unknown) => console.warn(`Could not look the projects over: ${error instanceof Error ? error.message : String(error)}`));

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
