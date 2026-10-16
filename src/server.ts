import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { accountsSaved } from "./accounts.ts";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { webDir } from "./http/routes/site.ts";
import { grantsSaved } from "./oauth/store.ts";
import { closeBrowser, prewarm } from "./render.ts";
import { drain } from "./services/lifecycle.ts";
import { sweepProjects } from "./storage/migrate.ts";

// What `npm start` and the container run: build the app, listen, and stop cleanly on a signal.

const app = await createApp();

// Before the first request, so no write is under way while the files writes left behind are cleared.
await sweepProjects(config.dataDir).catch((error: unknown) => console.warn(`Could not look the projects over: ${error instanceof Error ? error.message : String(error)}`));

const server = http.createServer(app);
// A port that cannot be had ends the start with a reason and a non-zero exit, so a supervisor or a script sees it.
server.once("error", (error: NodeJS.ErrnoException) => {
  const reason =
    error.code === "EADDRINUSE"
      ? `port ${config.port} is in use. Stop what listens there, or set PORT to another port.`
      : error.code === "EACCES"
        ? `this user may not listen on port ${config.port}. Set PORT to a port above 1023.`
        : error.message;
  console.error(`appShots could not start: ${reason}`);
  process.exit(1);
});
server.listen({ port: config.port, host: config.host }, () => {
  console.log(`appShots listening on http://localhost:${config.port} (data in ${config.dataDir})`);
  if (!existsSync(path.join(webDir, "index.html"))) console.warn("The web pages have not been built yet: run `npm run build`. The API and the MCP endpoint work without them.");
  if (config.auth) console.log(`Sign-in is by Google; the admin is ${config.adminEmail}.`);
  else console.warn("Sign-in is off (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ADMIN_EMAIL are not set): the UI, API and MCP endpoint are open to anyone who can reach this port.");
  prewarm();
});

/**
 * Stops within the ten seconds a container is given before it is killed. No connection or render is taken any more,
 * and what is under way gets most of that time to finish: a render still going then is cancelled, keeps nothing and
 * uses no render, and a download still going is cut off. The accounts and grants are on disk before the process ends.
 */
async function shutDown(): Promise<void> {
  const closed = new Promise((resolve) => server.close(resolve));
  // drain() lets renders and video layers finish for this long, then gives what still goes two seconds to stop.
  await Promise.race([Promise.all([closed, drain(5500)]), sleep(7500)]);
  server.closeAllConnections();
  await Promise.all([accountsSaved(), grantsSaved()]);
  await closeBrowser();
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // A second signal, such as Ctrl-C pressed again, does not wait.
    if (stopping) process.exit(1);
    stopping = true;
    console.log("Stopping: finishing what is under way.");
    void shutDown()
      .catch((error: unknown) => console.error("Could not stop cleanly:", error))
      .finally(() => process.exit(0));
  });
}
