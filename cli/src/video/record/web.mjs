import { rmSync } from "node:fs";
import { WEB_SCREENS, findBrowser, withBrowser } from "../../capture/web.mjs";
import { fail } from "../../fail.mjs";
import { pause } from "../../util.mjs";
import { checkStop, footageDisplay } from "./session.mjs";
import { start } from "./spawn.mjs";

/**
 * Recording a web app in Chromium, without a window. By default the page's time is the recorder's: a clock put
 * into the page before its own scripts stands in for Date, performance.now, timers and animation frames, and
 * moves on by one frame, 1/30 of a second, between two screenshots. However long a screenshot takes, the movie
 * plays at the page's own pace, every frame is there and nothing depends on how busy the Mac is. --realtime is
 * for a page that clock cannot reach, such as one playing a video or drawing with WebGL: Chromium's screencast,
 * taken as it comes.
 */

const FPS = 30;
const FRAME = 1000 / FPS;

/** Frames after a step before the next one, so that what it set off is seen. */
const PACE = 12;

/** Frames before the first step and after the last one. */
const LEAD = 15;

/**
 * The screens a web app is recorded at, in CSS pixels: the iPhone's is the 6.1-inch one, whose movie the compose
 * scales to the store's size without losing anything.
 */
/** @typedef {{ width: number, height: number, scale: number, mobile: boolean, agent: { userAgent: string, platform: string } | null }} Viewport */

/** @type {Record<"iphone" | "ipad" | "mac", Viewport>} */
export const WEB_VIEWPORTS = {
  iphone: { width: 393, height: 852, scale: 3, mobile: true, agent: WEB_SCREENS.iphone.agent },
  ipad: { width: 1032, height: 1376, scale: 2, mobile: true, agent: WEB_SCREENS.ipad.agent },
  mac: { width: 1920, height: 1080, scale: 1, mobile: false, agent: null },
};

/**
 * The clock a page runs on while it is recorded, as the source of a script that runs before the page's own.
 * `window.__appshotsStep(ms)` moves it on: it runs the timers that come due in order, sets every animation to
 * where it is by then, runs the animation frames, and settles once Chromium has drawn the result.
 * @param {number} epoch What Date says when the page starts.
 */
export function clockScript(epoch) {
  return `(() => {
  if (window.__appshotsStep) return;
  const epoch = ${Math.round(epoch)};
  let now = 0;
  const RealDate = Date;
  const realFrame = window.requestAnimationFrame.bind(window);
  const realTimeout = window.setTimeout.bind(window);
  // A function rather than a class: Date() without new is still called for the time as a string.
  function VirtualDate(...args) {
    if (!new.target) return new RealDate(epoch + now).toString();
    return Reflect.construct(RealDate, args.length === 0 ? [epoch + now] : args, new.target);
  }
  Object.setPrototypeOf(VirtualDate, RealDate);
  VirtualDate.prototype = RealDate.prototype;
  RealDate.prototype.constructor = VirtualDate;
  VirtualDate.now = () => epoch + now;
  window.Date = VirtualDate;
  performance.now = () => now;
  let next = 1;
  const timers = new Map();
  let frames = new Map();
  const later = (fn, ms, args, repeat) => {
    const id = next++;
    const delay = Math.max(repeat ? 1 : 0, Number(ms) || 0);
    timers.set(id, { at: now + delay, fn, args, delay, repeat });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => later(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => later(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => void timers.delete(id);
  window.requestAnimationFrame = (fn) => {
    const id = next++;
    frames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => void frames.delete(id);
  const report = (error) => realTimeout(() => { throw error; });
  const born = new WeakMap();
  window.__appshotsStep = (ms) => {
    const until = now + ms;
    for (let guard = 0; guard < 100000; guard++) {
      let due = null;
      for (const [id, timer] of timers) if (timer.at <= until && (!due || timer.at < due[1].at)) due = [id, timer];
      if (!due) break;
      const [id, timer] = due;
      now = Math.max(now, timer.at);
      if (timer.repeat) timer.at += timer.delay;
      else timers.delete(id);
      try {
        if (typeof timer.fn === "function") timer.fn(...timer.args);
      } catch (error) {
        report(error);
      }
    }
    now = until;
    for (const animation of document.getAnimations()) {
      if (!born.has(animation)) born.set(animation, now - (Number(animation.currentTime) || 0) / (animation.playbackRate || 1));
      animation.pause();
      animation.currentTime = (now - born.get(animation)) * (animation.playbackRate || 1);
    }
    const due = frames;
    frames = new Map();
    for (const fn of due.values()) {
      try {
        fn(now);
      } catch (error) {
        report(error);
      }
    }
    return new Promise((resolve) => {
      const done = () => resolve(now);
      realTimeout(done, 250);
      realFrame(() => realFrame(done));
    });
  };
})();`;
}

/**
 * ffmpeg turning the PNGs of a recording into a movie as they come: even sides, as H.264 needs them, BT.709
 * as the compose expects, and 4:4:4 so that text keeps its edges until the compose scales it.
 * @param {string} file
 * @param {{ ffmpeg: string }} tools
 */
export function startEncoder(file, tools) {
  rmSync(file, { force: true });
  const running = start(
    tools.ffmpeg,
    // prettier-ignore
    ["-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      // The tags go on the frames: output options alone leave the primaries and transfer unset.
      "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0,scale=out_color_matrix=bt709:out_range=tv,format=yuv444p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-movflags", "+faststart", "-y", file],
    { stdin: true },
  );
  let frames = 0;
  const said = () => (running.said() ? `\n${running.said().split("\n").slice(-10).join("\n")}` : "");
  return {
    frames: () => frames,
    /** @param {Buffer} png */
    write: async (png) => {
      const input = /** @type {import("node:stream").Writable} */ (running.stdin);
      if (!running.alive()) fail(`ffmpeg stopped while the page was recorded.${said()}`);
      frames++;
      if (!input.write(png)) await Promise.race([new Promise((resolve) => input.once("drain", resolve)), running.exited]);
    },
    finish: async () => {
      running.stdin?.end();
      const exit = await running.exited;
      if (exit.status !== 0) fail(`ffmpeg could not make a movie of the page${exit.error ? `: ${exit.error.message}` : "."}${said()}`);
    },
    abandon: async () => {
      running.kill("SIGKILL");
      await running.exited;
      rmSync(file, { force: true });
    },
  };
}

/**
 * Where a scene's page is: the scene's address, or a step's, against the app's. {locale} in it becomes the
 * language, for an app that keeps its languages apart by address.
 * @param {string} address
 * @param {string} base
 * @param {string} locale
 */
export function pageAddress(address, base, locale) {
  try {
    return new URL(address.replaceAll("{locale}", locale), base.replaceAll("{locale}", locale)).href;
  } catch {
    return fail(`"${address}" is not an address a page can be opened at, against ${base}.`);
  }
}

/**
 * A web app's footage, recorded from its pages in Chromium.
 * @param {string} display
 * @param {any} plan
 * @param {Record<string, string | true | undefined>} flags
 * @param {{ ffmpeg: string, encoders?: Set<string> }} tools
 * @returns {Promise<import("./index.mjs").Source>}
 */
export async function webSource(display, plan, flags, tools) {
  const viewport = WEB_VIEWPORTS[/** @type {keyof typeof WEB_VIEWPORTS} */ (footageDisplay(display))];
  if (!viewport) fail(`A web app is recorded for the iphone, ipad and mac displays, and the plan asks for ${display}.`);
  const base = typeof flags.web === "string" ? (/^[a-z]+:\/\//i.test(flags.web) ? flags.web : `http://${flags.web}`) : plan.app?.url;
  if (!base) fail(`A web app is recorded from its address: put "url" into the plan's "app", or give it with --web <address>.`);
  const browser = findBrowser();
  if (!browser) fail("A web app is recorded with Chrome, Chromium, Edge or Brave, and none of them is installed. Install Google Chrome, or point APPSHOTS_BROWSER at a Chromium browser's program.");
  if (tools.encoders && !tools.encoders.has("libx264")) fail("Recording a web page needs ffmpeg with libx264, which this ffmpeg lacks. Homebrew's ffmpeg has it: brew install ffmpeg");
  const realtime = Boolean(flags.realtime);
  /** @type {Talk | null} */
  let talk = null;
  let version = "";
  return {
    kind: "web",
    label: `${browser.name} at ${viewport.width}×${viewport.height}`,
    model: browser.name,
    get os() {
      return version;
    },
    extension: ".mp4",
    padded: false,
    scale: () => viewport.scale,
    around: (work) =>
      withBrowser(browser, undefined, async ({ send, listen }) => {
        /** @type {Map<string, (message: any) => void>} */
        const pages = new Map();
        listen((message) => message.sessionId && pages.get(message.sessionId)?.(message));
        version = (await send("Browser.getVersion")).product?.split("/")[1] ?? "";
        talk = { send, pages };
        try {
          return await work();
        } finally {
          talk = null;
        }
      }),
    open: async () => {},
    take: (job) => recordPage(/** @type {Talk} */ (talk), { ...job, viewport, base, realtime, tools }),
  };
}

/**
 * @typedef {object} Talk
 * @property {(method: string, params?: object, sessionId?: string) => Promise<any>} send
 * @property {Map<string, (message: any) => void>} pages What each page's session reports goes to its listener.
 */

/**
 * Opens a scene's page in a tab of its own, runs its steps and records it.
 * @param {Talk} talk
 * @param {import("./index.mjs").WebJob & { viewport: Viewport, base: string, realtime: boolean, tools: { ffmpeg: string } }} job
 * @returns {Promise<import("./session.mjs").Take>}
 */
async function recordPage(talk, { scene, locale, file, seconds, settle, signal, viewport, base, realtime, tools }) {
  const { targetId } = await talk.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await talk.send("Target.attachToTarget", { targetId, flatten: true });
  const page = (/** @type {string} */ method, /** @type {object} */ params = {}) => talk.send(method, params, sessionId);
  /** @type {Set<(message: any) => void>} */
  const listeners = new Set();
  talk.pages.set(sessionId, (message) => {
    for (const listener of listeners) listener(message);
  });
  /** @type {ReturnType<typeof startEncoder> | null} */
  let encoder = null;
  try {
    await page("Page.enable");
    await page("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: viewport.mobile, screenWidth: viewport.width, screenHeight: viewport.height });
    if (viewport.mobile) await page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const { userAgent } = await talk.send("Browser.getVersion");
    await page("Emulation.setUserAgentOverride", { ...(viewport.agent ?? { userAgent: userAgent.replace("HeadlessChrome", "Chrome") }), acceptLanguage: locale });
    await page("Emulation.setLocaleOverride", { locale: locale.replaceAll("-", "_") }).catch(() => {});
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scene.launch?.appearance ?? "light" }] });
    // A page without the focus draws no caret and may not take typing.
    await page("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    if (!realtime) await page("Page.addScriptToEvaluateOnNewDocument", { source: clockScript(Date.now()) });
    // An alert would hold the page up for good.
    listeners.add(({ method }) => method === "Page.javascriptDialogOpening" && page("Page.handleJavaScriptDialog", { accept: true }).catch(() => {}));

    /**
     * Opens an address and waits until the page has loaded with its fonts.
     * @param {string} url
     */
    const navigate = async (url) => {
      /** @type {(value?: unknown) => void} */
      let loaded = () => {};
      const load = new Promise((resolve) => (loaded = resolve));
      const listener = (/** @type {any} */ message) => message.method === "Page.loadEventFired" && loaded();
      listeners.add(listener);
      try {
        let answer;
        // A dev server that was started a moment ago may not be listening yet.
        for (const deadline = Date.now() + 10000; ; await pause(500)) {
          answer = await page("Page.navigate", { url });
          if (answer.errorText !== "net::ERR_CONNECTION_REFUSED" || Date.now() > deadline) break;
        }
        if (answer.errorText === "net::ERR_CONNECTION_REFUSED") fail(`Nothing answers at ${url}. Is the app's dev server running, and is that its address?`);
        if (answer.errorText) fail(`Could not open ${url}: ${answer.errorText}`);
        // One within the page, such as a new #hash, loads nothing.
        if (answer.loaderId) {
          let timer;
          const late = await Promise.race([load.then(() => false), new Promise((resolve) => (timer = setTimeout(() => resolve(true), 30000)))]);
          clearTimeout(timer);
          if (late) fail(`${url} did not finish loading within 30 seconds.`);
        }
        await evaluate("document.fonts.ready.then(() => 0)");
      } finally {
        listeners.delete(listener);
      }
    };

    /**
     * Runs JavaScript in the page and returns its value. A page that is between two documents is waited for.
     * @param {string} expression
     */
    const evaluate = async (expression) => {
      for (const deadline = Date.now() + 15000; ; await pause(100)) {
        try {
          const { result, exceptionDetails } = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
          if (exceptionDetails) fail(`The page of ${scene.id} failed: ${(exceptionDetails.exception?.description ?? exceptionDetails.text).split("\n")[0]}`);
          return result.value;
        } catch (error) {
          if (!/context was destroyed|Cannot find context|navigat|Inspected target/i.test(String(/** @type {Error} */ (error).message)) || Date.now() > deadline) throw error;
        }
      }
    };

    const limit = Math.round(seconds * FPS);
    /** @type {import("./touches.mjs").Touch[]} */
    const touches = [];
    /** @type {{ frames: () => number, time: () => number, tick: (count: number) => Promise<void>, finish: () => Promise<void> }} */
    let clock;

    await navigate(pageAddress(scene.launch?.url ?? "", base, locale));
    encoder = startEncoder(file, tools);
    const into = encoder;
    if (realtime) {
      await pause(settle * 1000);
      clock = await screencast(page, listeners, into, viewport, limit, signal);
    } else {
      // The page settles on its own clock, which nothing records.
      const step = () => evaluate(`window.__appshotsStep ? window.__appshotsStep(${FRAME}) : 0`);
      for (let frame = 0; frame < Math.round(settle * FPS); frame++) {
        checkStop(signal);
        await step();
      }
      clock = {
        frames: () => into.frames(),
        time: () => into.frames() * FRAME,
        tick: async (count) => {
          for (let frame = 0; frame < count && into.frames() < limit; frame++) {
            checkStop(signal);
            await step();
            // Still every pixel, only packed less tightly, which takes a third of the time.
            const { data } = await page("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
            await into.write(Buffer.from(data, "base64"));
          }
        },
        finish: async () => {},
      };
    }

    const full = () => clock.frames() >= limit;
    const drive = scene.drive;
    if (drive && typeof drive === "object" && "web" in drive) {
      await clock.tick(LEAD);
      for (const [index, step] of drive.web.entries()) {
        if (full()) break;
        await webStep(step, index, { scene, locale, base, page, evaluate, navigate, clock, touches });
      }
      await clock.tick(LEAD);
    } else {
      const wait = drive && typeof drive === "object" && "wait" in drive ? drive.wait : seconds;
      await clock.tick(Math.round(wait * FPS));
    }
    await clock.finish();
    checkStop(signal);
    await into.finish();
    encoder = null;
    return { file, wall: into.frames() / FPS, driverOffset: 0, driverStart: 0, touches };
  } catch (error) {
    await encoder?.abandon();
    rmSync(file, { force: true });
    throw error;
  } finally {
    talk.pages.delete(sessionId);
    await talk.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/**
 * @typedef {object} StepContext
 * @property {any} scene
 * @property {string} locale
 * @property {string} base
 * @property {(method: string, params?: object) => Promise<any>} page
 * @property {(expression: string) => Promise<any>} evaluate
 * @property {(url: string) => Promise<void>} navigate
 * @property {{ frames: () => number, time: () => number, tick: (count: number) => Promise<void> }} clock
 * @property {import("./touches.mjs").Touch[]} touches
 */

/**
 * The middle of the first element a selector matches, brought into view, in CSS pixels; waited for while the
 * page goes on, for five seconds of its time at most.
 * @param {string} selector
 * @param {string} where What a failure names.
 * @param {StepContext} context
 */
async function pointOf(selector, where, { evaluate, clock }) {
  const find = `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`;
  for (let tries = 0; tries < 5 * FPS; tries += 3) {
    const point = await evaluate(find);
    if (point) return /** @type {{ x: number, y: number }} */ (point);
    await clock.tick(3);
  }
  return fail(`${where}: nothing on the page matches "${selector}".`);
}

/**
 * Runs one of a scene's web steps. Clicks are kept as touches, as a person's finger would be.
 * @param {any} step
 * @param {number} index
 * @param {StepContext} context
 */
async function webStep(step, index, context) {
  const { scene, locale, base, page, evaluate, navigate, clock, touches } = context;
  const where = `Web step ${index + 1} of ${scene.id}`;
  if ("wait" in step) return clock.tick(Math.round(Number(step.wait) * FPS));
  if ("goto" in step) {
    await navigate(pageAddress(String(step.goto), base, locale));
    return clock.tick(PACE);
  }
  if ("click" in step || "hover" in step) {
    const { x, y } = await pointOf(String(step.click ?? step.hover), where, context);
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    if ("click" in step) {
      touches.push({ ms: clock.time(), x, y });
      await page("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await page("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    }
    return clock.tick(PACE);
  }
  if ("type" in step) {
    const [selector, text] = /** @type {[string, string]} */ (step.type);
    const { x, y } = await pointOf(selector, where, context);
    touches.push({ ms: clock.time(), x, y });
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
    // About fifteen letters a second, as a person types.
    for (const letter of String(text)) {
      await page("Input.insertText", { text: letter });
      await clock.tick(2);
    }
    return clock.tick(PACE);
  }
  if ("scroll" in step) {
    const distance = Number(step.scroll);
    const frames = Math.min(45, Math.max(9, Math.round((Math.abs(distance) / 1200) * FPS)));
    // Eased in and out, as a flick ends; whatever scrolls under the middle of the page takes it.
    let done = 0;
    for (let frame = 1; frame <= frames; frame++) {
      const along = 0.5 - Math.cos((Math.PI * frame) / frames) / 2;
      const by = Math.round(distance * along) - done;
      done += by;
      await evaluate(`(() => {
        let element = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        while (element && element !== document.body && !(element.scrollHeight > element.clientHeight && /(auto|scroll)/.test(getComputedStyle(element).overflowY))) element = element.parentElement;
        (element && element !== document.body ? element : document.scrollingElement).scrollBy({ top: ${by}, behavior: "instant" });
      })()`);
      await clock.tick(1);
    }
    return clock.tick(PACE);
  }
  return fail(`${where} is none of goto, click, type, scroll, hover and wait.`);
}

/**
 * Records a page as Chromium draws it, for --realtime: its screencast, each frame repeated until the next one
 * comes, as it sends a frame only when something changed. Time is the clock's.
 * @param {(method: string, params?: object) => Promise<any>} page
 * @param {Set<(message: any) => void>} listeners
 * @param {ReturnType<typeof startEncoder>} encoder
 * @param {Viewport} viewport
 * @param {number} limit Frames at most.
 * @param {AbortSignal} signal
 */
async function screencast(page, listeners, encoder, viewport, limit, signal) {
  /** @type {Buffer | null} */
  let last = null;
  let began = 0;
  let writing = Promise.resolve();
  /** Writes the last frame for every slot up to now. */
  const fill = () => {
    if (!last || !began) return;
    const frame = last;
    const due = Math.min(limit, Math.floor(((Date.now() - began) / 1000) * FPS));
    writing = writing.then(async () => {
      while (encoder.frames() < due) await encoder.write(frame);
    });
  };
  listeners.add(({ method, params }) => {
    if (method !== "Page.screencastFrame") return;
    page("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
    fill();
    last = Buffer.from(params.data, "base64");
    began ||= Date.now();
  });
  await page("Page.startScreencast", { format: "png", maxWidth: viewport.width * viewport.scale, maxHeight: viewport.height * viewport.scale, everyNthFrame: 1 });
  for (const deadline = Date.now() + 5000; !began; await pause(20)) if (Date.now() > deadline) fail("Chromium sent no picture of the page within 5 seconds.");
  return {
    frames: () => encoder.frames(),
    time: () => Date.now() - began,
    tick: async (/** @type {number} */ count) => {
      for (const end = Date.now() + count * FRAME; Date.now() < end && encoder.frames() < limit; await pause(FRAME)) {
        checkStop(signal);
        fill();
      }
      await writing;
    },
    finish: async () => {
      fill();
      await writing;
      await page("Page.stopScreencast").catch(() => {});
    },
  };
}
