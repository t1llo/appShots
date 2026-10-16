import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Failure, fail } from "../fail.mjs";
import { host } from "../proc.mjs";
import { shotDevice, shotLanguage, shotTarget } from "../shot.mjs";
import { pause, until } from "../util.mjs";

// The browsers a web page is said to come from. Safari on an iPhone names the phone; Safari on an iPad says it is
// a Mac, and a page tells the two apart by the touch screen.
const IPHONE_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

/**
 * The screens a web page is drawn at: the points and the scale of the device whose store size comes out of it.
 * `bar` is what the status bar takes at the top, `home` what the home indicator takes at the bottom, and
 * `pill` how wide that indicator is. `agent` is the browser the page is told it is in, with its platform.
 */
export const WEB_SCREENS = {
  iphone: { label: "an iPhone", width: 440, height: 956, scale: 3, bar: 62, home: 34, pill: 152, touch: true, agent: { userAgent: IPHONE_AGENT, platform: "iPhone" } },
  duo: { label: "an iPhone Duo", width: 669, height: 951, scale: 3, bar: 39, home: 0, pill: 0, touch: true, agent: { userAgent: IPHONE_AGENT, platform: "iPhone" } },
  ipad: { label: "an iPad", width: 1032, height: 1376, scale: 2, bar: 24, home: 20, pill: 320, touch: true, agent: { userAgent: IPAD_AGENT, platform: "MacIntel" } },
  mac: { label: "a Mac", width: 1440, height: 900, scale: 2, bar: 0, home: 0, pill: 0, touch: false, agent: null },
};

/**
 * A Chromium browser that can draw a page without a window: Chrome, Chromium, Edge or Brave as installed, or
 * the Chromium that Playwright keeps for a project. Null when there is none.
 */
export function findBrowser() {
  const given = process.env.APPSHOTS_BROWSER;
  if (given) return existsSync(given) ? { name: path.basename(given), file: given } : null;
  if (host.platform === "darwin") {
    for (const root of ["/Applications", path.join(homedir(), "Applications")]) {
      for (const name of ["Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser", "Google Chrome Canary"]) {
        const file = path.join(root, `${name}.app`, "Contents", "MacOS", name);
        if (existsSync(file)) return { name, file };
      }
    }
  } else if (host.platform === "win32") {
    for (const root of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
      for (const [name, program] of [["Google Chrome", "Google/Chrome/Application/chrome.exe"], ["Microsoft Edge", "Microsoft/Edge/Application/msedge.exe"], ["Brave Browser", "BraveSoftware/Brave-Browser/Application/brave.exe"]]) {
        const file = path.join(root, program);
        if (existsSync(file)) return { name, file };
      }
    }
  } else {
    const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]) {
      const file = dirs.map((dir) => path.join(dir, name)).find(existsSync);
      if (file) return { name, file };
    }
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(homedir(), host.platform === "darwin" ? "Library/Caches" : ".cache", "ms-playwright");
  const number = (entry) => Number(entry.split("-").pop());
  const list = (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  // The newest first, and the whole browser before the one that is only its engine.
  const kept = list(cache)
    .filter((entry) => /^chromium(_headless_shell)?-\d+$/.test(entry))
    .sort((a, b) => a.includes("_") - b.includes("_") || number(b) - number(a));
  for (const entry of kept) {
    for (const folder of list(path.join(cache, entry))) {
      for (const binary of ["Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "Chromium.app/Contents/MacOS/Chromium", "chrome", "chrome-headless-shell", "headless_shell"]) {
        const file = path.join(cache, entry, folder, binary);
        if (existsSync(file) && statSync(file).isFile()) return { name: "Playwright's Chromium", file };
      }
    }
  }
  return null;
}

/**
 * Starts the browser without a window and hands `work` a way to talk to it: `send` for a command of the
 * DevTools protocol, `listen` for what the browser reports by itself. The talking goes over the two pipes that
 * --remote-debugging-pipe opens, each message JSON ended by a zero byte, so no port is opened and nothing has
 * to be installed. The browser gets a profile of its own, apart from the user's, and is gone when `work` is done.
 * @template T
 * @param {{ name: string, file: string }} browser
 * @param {string | undefined} profile
 * @param {(talk: { send: (method: string, params?: object, sessionId?: string) => Promise<any>, listen: (listener: (message: any) => void) => void }) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withBrowser(browser, profile, work) {
  const dir = profile ? path.resolve(profile) : mkdtempSync(path.join(tmpdir(), "appshots-web-"));
  mkdirSync(dir, { recursive: true });
  const options = [
    "--headless",
    "--remote-debugging-pipe",
    `--user-data-dir=${dir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    // Without these two a fresh profile asks for the login keychain.
    "--password-store=basic",
    "--use-mock-keychain",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-color-profile=srgb",
    "about:blank",
  ];
  const child = spawn(browser.file, options, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const [, , errors, input, output] = child.stdio;
  let said = "";
  errors.on("data", (data) => (said = `${said}${data}`.slice(-2000)));
  input.on("error", () => {});

  const waiting = new Map();
  const listeners = new Set();
  let gone = null;
  const leave = (reason) => {
    gone ??= reason;
    for (const { reject, timer } of waiting.values()) {
      clearTimeout(timer);
      reject(new Error(gone));
    }
    waiting.clear();
  };
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve(leave(`Could not start ${browser.name}: ${error.message}`)));
    child.once("exit", () => resolve(leave(`${browser.name} quit before it was done.${said.trim() ? `\n${said.trim().split("\n").slice(-5).join("\n")}` : ""}`)));
  });

  const parts = [];
  output.on("data", (chunk) => {
    let from = 0;
    for (let end = chunk.indexOf(0); end !== -1; end = chunk.indexOf(0, from)) {
      parts.push(chunk.subarray(from, end));
      from = end + 1;
      let message;
      try {
        message = JSON.parse(Buffer.concat(parts.splice(0)).toString("utf8"));
      } catch {
        // Half a message is no answer to anything, and the next one starts after the zero byte.
        continue;
      }
      const asked = waiting.get(message.id);
      if (asked) {
        waiting.delete(message.id);
        clearTimeout(asked.timer);
        if (message.error) asked.reject(new Error(`${asked.method}: ${message.error.message}`));
        else asked.resolve(message.result);
      } else if (message.method) {
        for (const listener of listeners) listener(message);
      }
    }
    if (from < chunk.length) parts.push(chunk.subarray(from));
  });

  let count = 0;
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (gone) return reject(new Error(gone));
      const id = ++count;
      const timer = setTimeout(() => waiting.delete(id) && reject(new Error(`${browser.name} did not answer ${method}.`)), 60000);
      waiting.set(id, { resolve, reject, timer, method });
      input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });

  try {
    return await work({ send, listen: (listener) => listeners.add(listener) });
  } finally {
    send("Browser.close").catch(() => {});
    // A timer that is still running would keep this command from ending.
    let patience;
    await Promise.race([exited, new Promise((resolve) => (patience = setTimeout(resolve, 4000)))]);
    clearTimeout(patience);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (!profile) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * Runs in a blank page of the browser: sets the picture of a web page between the bands a phone keeps free of
 * it, for the status bar at the top and the home indicator at the bottom, and draws that indicator. A band
 * takes the colour of the page's edge next to it, so a coloured header runs up into it, or `paper` where that
 * edge is a picture.
 * @param {{ data: string, top: number, bottom: number, paper: { top: string, bottom: string }, pill: { width: number, height: number, gap: number } | null }} options
 */
async function withDeviceBars({ data, top, bottom, paper, pill }) {
  const picture = new Image();
  picture.src = `data:image/png;base64,${data}`;
  await picture.decode();
  const canvas = document.createElement("canvas");
  canvas.width = picture.width;
  canvas.height = top + picture.height + bottom;
  const pen = canvas.getContext("2d", { willReadFrequently: true });
  pen.drawImage(picture, 0, top);
  const band = (from, height, row, fallback) => {
    if (!height) return;
    const edge = pen.getImageData(0, row, picture.width, 1).data;
    let even = true;
    for (let at = 4; at < edge.length && even; at += 4) for (let c = 0; c < 3; c++) if (Math.abs(edge[at + c] - edge[c]) > 6) even = false;
    pen.fillStyle = even ? `rgb(${edge[0]} ${edge[1]} ${edge[2]})` : fallback;
    pen.fillRect(0, from, picture.width, height);
  };
  band(0, top, top, paper.top);
  band(top + picture.height, bottom, top + picture.height - 1, paper.bottom);
  if (pill) {
    const left = Math.round((canvas.width - pill.width) / 2);
    const from = canvas.height - pill.gap - pill.height;
    // Dark on a light page and light on a dark one, as the phone draws it.
    const under = pen.getImageData(left, from, pill.width, pill.height).data;
    let light = 0;
    for (let at = 0; at < under.length; at += 4) light += 0.299 * under[at] + 0.587 * under[at + 1] + 0.114 * under[at + 2];
    pen.fillStyle = light / (under.length / 4) > 140 ? "#000" : "#fff";
    pen.beginPath();
    pen.roundRect(left, from, pill.width, pill.height, pill.height / 2);
    pen.fill();
  }
  return canvas.toDataURL("image/png").split(",")[1];
}

/**
 * JavaScript given on the command line: the code itself, or @file for a file that holds it.
 * @param {unknown} value
 * @param {string} flag
 */
function scriptOf(value, flag) {
  if (value === undefined) return null;
  if (typeof value !== "string") fail(`${flag} needs JavaScript, or @file for a file that holds it.`);
  if (!value.startsWith("@")) return value;
  if (!existsSync(value.slice(1))) fail(`No such file: ${value.slice(1)}`);
  return readFileSync(value.slice(1), "utf8");
}

/**
 * The address --web was given: a URL, a host and port without its http://, or an HTML file on this computer.
 * @param {unknown} value
 */
function webAddress(value) {
  if (typeof value !== "string") fail("--web needs the address of the page, as in: --web http://localhost:5173/stats");
  if (/^(https?|file):\/\//i.test(value)) return value;
  if (existsSync(value)) return pathToFileURL(path.resolve(value)).href;
  return `http://${value}`;
}

/**
 * Draws one page of a web app at the size of a device and saves it as a raw screenshot of that device. On a
 * phone or tablet the page is laid out between the status bar and the home indicator, as an installed web app
 * is: the status bar's place stays free in the picture and the home indicator is drawn. A page that asks for
 * the whole screen (viewport-fit=cover) gets it, with the safe area it then has to keep to.
 * @param {Record<string, string | true>} flags
 */
export async function captureWeb(flags) {
  const address = webAddress(flags.web);
  const kind = shotDevice(flags) ?? "iphone";
  const screen = WEB_SCREENS[kind];
  if (flags.dark && flags.light) fail("Use --dark or --light, not both.");
  const language = shotLanguage(flags);
  const wait = flags.wait === undefined ? 1 : typeof flags.wait === "string" ? Number(flags.wait) : NaN;
  if (!(wait >= 0 && wait <= 600)) fail("--wait needs a number of seconds, as in: --wait 3");
  const given = flags.viewport === undefined ? null : /^(\d{3,4})x(\d{3,4})$/.exec(String(flags.viewport));
  if (flags.viewport !== undefined && !given) fail("--viewport needs a size in points, as in: --viewport 1280x800");
  const width = given ? Number(given[1]) : screen.width;
  const height = given ? Number(given[2]) : screen.height;
  const init = scriptOf(flags.init, "--init");
  const steps = scriptOf(flags.eval, "--eval");
  if (flags.profile !== undefined && typeof flags.profile !== "string") fail("--profile needs a folder, as in: --profile .appshots-browser");
  if (flags["user-agent"] !== undefined && typeof flags["user-agent"] !== "string") fail("--user-agent needs the text the browser is to send, in quotes.");
  const browser = findBrowser();
  if (!browser) {
    fail(
      process.env.APPSHOTS_BROWSER
        ? `APPSHOTS_BROWSER points at ${process.env.APPSHOTS_BROWSER}, which does not exist.`
        : "--web draws the page with Chrome, Chromium, Edge or Brave, and none of them is installed. Install Google Chrome, or point APPSHOTS_BROWSER at a Chromium browser's program.",
    );
  }

  let shot;
  try {
    shot = await withBrowser(browser, /** @type {string | undefined} */ (flags.profile), async ({ send, listen }) => {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const page = (method, params) => send(method, params, sessionId);
      const evaluate = async (expression, what) => {
        const { result, exceptionDetails } = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (exceptionDetails) throw new Error(`${what} failed in the page: ${(exceptionDetails.exception?.description ?? exceptionDetails.text).split("\n")[0]}`);
        return result.value;
      };

      await page("Page.enable");
      await page("Network.enable");
      await page("Page.setLifecycleEventsEnabled", { enabled: true });
      const frame = (await page("Page.getFrameTree")).frameTree.frame.id;
      // What each document of the page has reached so far. A redirect or a click may bring a new one.
      const reached = new Map();
      let current = null;
      let status = 0;
      // Navigations that have started in the page, and ones that stayed within its document.
      let leaving = 0;
      let staying = 0;
      listen(({ sessionId: from, method, params }) => {
        if (from !== sessionId) return;
        if (method === "Page.lifecycleEvent" && params.frameId === frame) {
          if (params.name === "init") current = params.loaderId;
          if (!reached.has(params.loaderId)) reached.set(params.loaderId, new Set());
          reached.get(params.loaderId).add(params.name);
        } else if ((method === "Page.frameRequestedNavigation" || method === "Page.frameStartedLoading") && params.frameId === frame) {
          leaving++;
        } else if (method === "Page.navigatedWithinDocument" && params.frameId === frame) {
          staying++;
        } else if (method === "Network.responseReceived" && params.type === "Document" && params.frameId === frame) {
          status = params.response.status;
        } else if (method === "Page.javascriptDialogOpening") {
          // An alert would hold the page up for good.
          page("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        }
      });
      const at = (step) => reached.get(current)?.has(step) ?? false;
      const loaded = async () => {
        if (!(await until(() => at("load"), 30000))) throw new Error(`${address} did not finish loading within 30 seconds.`);
        // Data the page fetches once it runs. A page that never stops fetching is taken as it is.
        await until(() => at("networkIdle"), 5000);
      };
      // After something that may bring a new document: it shows itself within a moment, and is then waited for,
      // so that what comes next happens on the new page and not on the one it replaces.
      const settled = async (before, left, stayed) => {
        await until(() => current !== before || leaving !== left, 300);
        if (current === before && leaving !== left) await until(() => current !== before || staying !== stayed, 10000);
        await loaded();
      };

      const { userAgent } = await send("Browser.getVersion");
      const agent = screen.agent ?? { userAgent: userAgent.replace("HeadlessChrome", "Chrome") };
      await page("Emulation.setUserAgentOverride", { ...agent, ...(typeof flags["user-agent"] === "string" ? { userAgent: flags["user-agent"] } : {}), ...(language ? { acceptLanguage: language } : {}) });
      if (language) await page("Emulation.setLocaleOverride", { locale: language.replaceAll("-", "_") }).catch(() => {});
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: flags.dark ? "dark" : "light" }] });
      if (screen.touch) await page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const resize = (inset) => page("Emulation.setDeviceMetricsOverride", { width, height: height - inset, deviceScaleFactor: screen.scale, mobile: screen.touch, screenWidth: width, screenHeight: height });
      await resize(screen.bar + screen.home);
      if (init) await page("Page.addScriptToEvaluateOnNewDocument", { source: init });

      // A dev server that was started a moment ago may not be listening yet.
      let answer;
      for (const deadline = Date.now() + 10000; ; await pause(500)) {
        answer = await page("Page.navigate", { url: address });
        if (answer.errorText !== "net::ERR_CONNECTION_REFUSED" || Date.now() > deadline) break;
      }
      if (answer.errorText === "net::ERR_CONNECTION_REFUSED") throw new Error(`Nothing answers at ${address}. Is the app's dev server running, and is that its address?`);
      if (answer.errorText) throw new Error(`Could not open ${address}: ${answer.errorText}`);
      await until(() => reached.has(answer.loaderId), 5000);
      await loaded();

      // A page that asks for the whole screen keeps clear of the bars by itself, as on a phone.
      let band = screen.bar * screen.scale;
      let foot = screen.home * screen.scale;
      if (band && /viewport-fit\s*=\s*cover/i.test(await evaluate(`document.querySelector('meta[name="viewport" i]')?.content ?? ""`, "Reading the page"))) {
        const whole = await page("Emulation.setSafeAreaInsetsOverride", { insets: { top: screen.bar, topMax: screen.bar, bottom: screen.home, bottomMax: screen.home } }).then(() => true, () => false);
        if (whole) {
          await resize(0);
          band = foot = 0;
          // Once more from the start, so that what the page measures as it loads is what it ends up with.
          const before = current;
          await page("Page.reload");
          if (!(await until(() => current !== before, 30000))) throw new Error(`${address} did not load again within 30 seconds.`);
          await loaded();
        }
      }

      await evaluate("document.fonts.ready.then(() => 0)", "Loading the fonts");
      if (steps) {
        const before = current;
        const left = leaving;
        const stayed = staying;
        // A click that leaves the page takes the script's own answer with it, which is no failure.
        await evaluate(`(async () => {\n${steps}\n})()`, "--eval").catch((error) => {
          if (!/context was destroyed|navigated|Cannot find context/i.test(error.message)) throw error;
        });
        await settled(before, left, stayed);
      }
      await pause(wait * 1000);

      const paper = await evaluate(
        `(() => {
          const theme = [...document.querySelectorAll('meta[name="theme-color"]')].find((meta) => !meta.media || matchMedia(meta.media).matches)?.content;
          const solid = (colour) => colour && colour !== "transparent" && !/, 0\\)$/.test(colour);
          const ground = [document.body, document.documentElement].map((element) => element && getComputedStyle(element).backgroundColor).find(solid) || "#fff";
          return { top: theme || ground, bottom: ground };
        })()`,
        "Reading the page",
      );
      let { data } = await page("Page.captureScreenshot", { format: "png" });
      const pill = screen.pill ? { width: screen.pill * screen.scale, height: 5 * screen.scale, gap: 8 * screen.scale } : null;
      if (band || pill) {
        const easel = (await send("Target.createTarget", { url: "about:blank" })).targetId;
        const session = (await send("Target.attachToTarget", { targetId: easel, flatten: true })).sessionId;
        const drawn = await send("Runtime.evaluate", { expression: `(${withDeviceBars})(${JSON.stringify({ data, top: band, bottom: foot, paper, pill })})`, awaitPromise: true, returnByValue: true }, session);
        await send("Target.closeTarget", { targetId: easel }).catch(() => {});
        if (drawn.exceptionDetails) throw new Error(`Could not make room for the status bar: ${drawn.exceptionDetails.exception?.description ?? drawn.exceptionDetails.text}`);
        data = drawn.result.value;
      }
      return { png: Buffer.from(data, "base64"), status, room: band > 0 };
    });
  } catch (error) {
    if (error instanceof Failure) throw error;
    fail(error.message);
  }

  const { name, file } = shotTarget(flags);
  writeFileSync(file, shot.png);
  console.log(`Captured ${address} as ${screen.label} shows it (${width * screen.scale}x${height * screen.scale}) -> ${file}`);
  if (shot.status >= 400) console.log(`  ! The address answered ${shot.status}, so this may be an error page. Open the picture and look.`);
  if (screen.bar) console.log(`  ${shot.room ? "The top is left free for the status bar" : "The page asks for the whole screen and runs under the status bar"}. "device": {"statusBar": "overlay"} in the theme draws one.`);
  return { name, file, device: kind };
}
