import { type Browser, chromium } from "playwright";
import { config, renderSettings } from "../config.ts";
import { createScheduler } from "./scheduler.ts";

/** Where the pages the renderer draws come from. They reach nothing else. */
export const local = `127.0.0.1:${config.port}`;

const ARGS = [
  // Containers get a 64 MB /dev/shm by default, too small for a 2064×2752 page; this makes Chromium use /tmp instead.
  "--disable-dev-shm-usage",
  // The pages only ever need this server, and the browser sends them the account's headers. Every other host name
  // resolves to nothing, an address given as numbers included, and so does every other port of this machine.
  `--host-resolver-rules=MAP ${local} ${local}, MAP * ~NOTFOUND`,
];

/** Who gets the browser when. A mockup is one page, but its picture can be very large: they are drawn one after another. */
export const scheduler = createScheduler({ render: renderSettings.concurrency, mockup: 1 });

let browser: Promise<Browser> | undefined;
let version: string | undefined;
let lastError: { message: string; at: string } | undefined;

export function getBrowser(): Promise<Browser> {
  browser ??= chromium
    // Playwright would close the browser on a signal, under the renders the server lets finish: it closes it itself.
    .launch({ args: ARGS, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false })
    .then((instance) => {
      if (version !== instance.version()) console.log(`The renderer draws with Chromium ${instance.version()}.`);
      version = instance.version();
      instance.on("disconnected", () => {
        browser = undefined;
      });
      return instance;
    })
    .catch((error: unknown) => {
      browser = undefined;
      noteError(error);
      throw error;
    });
  return browser;
}

/** Remembers what last went wrong in the browser, for the health report. */
export function noteError(error: unknown): void {
  lastError = { message: error instanceof Error ? error.message.split("\n")[0]! : String(error), at: new Date().toISOString() };
}

/**
 * Starts the browser before anybody needs it, unless RENDER_PREWARM is off. A machine without one still serves
 * everything else, so this only warns.
 */
export function prewarm(): void {
  if (!renderSettings.prewarm) return;
  getBrowser().catch((error: unknown) => {
    console.warn(`The renderer could not start its browser, so renders will fail until it can: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  });
}

export async function closeBrowser(): Promise<void> {
  const current = browser;
  browser = undefined;
  if (current) await current.then((instance) => instance.close()).catch(() => {});
}

export interface EngineHealth {
  /** The Chromium version once the browser has started. */
  browser: string | null;
  running: boolean;
  lastError: { message: string; at: string } | null;
}

export function engineHealth(): EngineHealth {
  return { browser: version ?? null, running: browser != null, lastError: lastError ?? null };
}
