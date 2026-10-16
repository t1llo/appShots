import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fail } from "../fail.mjs";

/**
 * @typedef {string | Record<string, string>} Text One text, or one per language, as the project's own texts are.
 * @typedef {{ slide: number, field?: "headline" | "eyebrow" | "sub" }} SlideText A text of one of the project's
 *   slides, counted from 1; its headline unless `field` says otherwise.
 * @typedef {{ goto: string } | { click: string } | { type: [string, string] } | { scroll: number } | { hover: string } | { wait: number }} WebStep
 * @typedef {"manual" | { wait: number } | { uitest: string, scheme?: string } | { command: string[] } | { web: WebStep[] }} Drive
 *
 * @typedef {object} Scene
 * @property {string} id
 * @property {false | Text | SlideText} caption
 * @property {"top" | "bottom"} captionPosition
 * @property {{ args?: string[], url?: string, appearance?: "light" | "dark" }} [launch]
 * @property {Drive} [drive] How the app gets through the moment. Left out until the plan's author says.
 * @property {{ seconds: number, settle: number }} record The longest a recording runs, and the time the app gets
 *   before it starts.
 * @property {[number, number] | "auto" | null} trim The part of the recording that is used; null for all of it.
 * @property {number} speed
 * @property {number} hold Seconds the last frame stays.
 * @property {boolean} touches
 * @property {number} estimate Seconds the recording is taken to run before there is one.
 *
 * @typedef {object} Plan What `appshots.video.json` says, with every default filled in.
 * @property {1} version
 * @property {string} name The file name of the previews.
 * @property {string} project
 * @property {{ platform: "ios" | "mac" | "web", bundleId?: string, url?: string }} app
 * @property {string[]} displays
 * @property {"portrait" | "landscape"} orientation
 * @property {string[]} [locales] The first is the primary. Left out, the project's, which resolvePlan fills in.
 * @property {"per-locale" | "primary"} footage
 * @property {"store"} style
 * @property {"panel" | "shadow" | "band"} captionStyle
 * @property {"plate" | "fill"} fit
 * @property {false | { seconds: number, headline?: Text | SlideText, logo: boolean }} intro
 * @property {false | { seconds: number, lines: Array<Text | SlideText>, logo: boolean, disclosure: string[] }} outro
 * @property {{ type: "fade" | "dissolve" | "none", seconds: number }} transition
 * @property {{ file: string, volume: number, start: number, fadeOut: number }} [music]
 * @property {Record<string, string>} [narration]
 * @property {Scene[]} scenes
 * @property {{ scene: string, at?: number } | { time: number }} [poster]
 * @property {number} target
 * @property {string} file Where the plan was read from.
 * @property {string} root The folder it is in, which holds appshots-video/.
 */

/** The plan's file name, in the folder the commands run in unless --plan names another. */
export const PLAN_FILE = "appshots.video.json";
/** The work folder next to the plan: recordings, layers, segments and the previews. */
export const WORK_FOLDER = "appshots-video";
/** Frames a second of every preview. Every length is a whole number of them. */
export const FPS = 30;

/**
 * The displays a preview is made for and the kind of app that shows on each. A web app's pages can be drawn at
 * any of them. Their sizes are in specs.mjs.
 */
export const PREVIEW_DISPLAYS = { iphone: "ios", "iphone-5.5": "ios", "iphone-4.7": "ios", ipad: "ios", "ipad-9.7": "ios", mac: "mac" };

/** Apple takes previews of 15 to 30 seconds. The storyboard warns a little inside that, the compose fails outside. */
export const LENGTH = { min: 15, max: 30, low: 15.5, high: 29.5 };

const DEFAULTS = { record: 12, settle: 1.5, estimate: 6, intro: 1.5, outro: 2, transition: 0.4, volume: 0.8, fadeOut: 1.5, target: 26 };
const ID = /^[a-z0-9-]{1,32}$/;
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const LOCALE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
const FIELDS = ["headline", "eyebrow", "sub"];
const DISCLOSURES = ["iap", "subscription", "login"];

/** @param {number} seconds */
export const frames = (seconds) => Math.round(seconds * FPS) / FPS;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks a plan as it was read and fills in what it leaves out. Every problem names the place in the JSON it is
 * at, so that it can be found in a file someone wrote by hand.
 * @param {unknown} raw
 * @returns {{ plan: Omit<Plan, "file" | "root"> | null, problems: string[], warnings: string[] }}
 */
export function validatePlan(raw) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  const say = (at, message) => problems.push(`${at}: ${message}`);

  /** The fields of an object, or null after saying what is wrong with it. Fields it has no place for are problems. */
  const object = (value, at, what, known) => {
    if (!isObject(value)) {
      say(at, "should be an object");
      return null;
    }
    for (const key of Object.keys(value)) if (!known.includes(key)) say(join(at, key), `is not a field of ${what}`);
    return value;
  };
  const number = (value, at, min, max) => {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) return void say(at, "should be a number");
    if (value < min || value > max) return void say(at, `should be from ${min} to ${max}, not ${value}`);
    return value;
  };
  const oneOf = (value, at, options) => {
    if (value === undefined) return undefined;
    if (!options.includes(value)) return void say(at, `should be ${list(options)}, not ${JSON.stringify(value)}`);
    return value;
  };
  const string = (value, at, pattern, shape) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim() === "") return void say(at, "should be a text");
    if (pattern && !pattern.test(value)) return void say(at, `${JSON.stringify(value)} is not ${shape}`);
    return value;
  };
  const boolean = (value, at) => {
    if (value === undefined || typeof value === "boolean") return value;
    say(at, "should be true or false");
  };
  /** @returns {Text | SlideText | undefined} */
  const text = (value, at) => {
    if (typeof value === "string") return value.trim() === "" ? void say(at, "is empty") : value;
    if (isObject(value) && "slide" in value) {
      object(value, at, "a slide's text", ["slide", "field"]);
      if (!Number.isInteger(value.slide) || value.slide < 1) say(join(at, "slide"), "should be a slide's number, counted from 1");
      oneOf(value.field, join(at, "field"), FIELDS);
      return value;
    }
    if (isObject(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) return void say(at, "has no text in any language");
      for (const [code, each] of entries) {
        if (!LOCALE.test(code)) say(join(at, code), "is not a language code, such as en or de-DE");
        else if (typeof each !== "string" || each.trim() === "") say(join(at, code), "should be a text");
      }
      return value;
    }
    say(at, 'should be a text, a text per language such as {"en": "…", "de": "…"}, or a slide\'s text such as {"slide": 2}');
  };

  const plan = object(raw, "plan", "a plan", ["version", "name", "project", "app", "displays", "orientation", "locales", "footage", "style", "captionStyle", "fit", "intro", "outro", "transition", "music", "narration", "scenes", "poster", "target"]);
  if (!plan) return { plan: null, problems, warnings };

  if (plan.version !== 1) {
    if (typeof plan.version === "number" && plan.version > 1) say("version", `this plan is version ${plan.version}, and this appshots reads version 1. 'appshots update' brings the newest`);
    else say("version", "should be 1");
  }
  const name = string(plan.name, "name", ID, "a name of lowercase letters, digits and - (32 at most)") ?? "preview";
  const project = string(plan.project, "project", PROJECT, "a project id");
  if (plan.project === undefined) say("project", "is missing: the id of the appShots project the captions come from");

  /** @type {Plan["app"]} */
  let app = { platform: "ios" };
  // Which displays and drivers fit is only said of an app whose kind is known.
  let known = false;
  const appFields = object(plan.app, "app", "app", ["platform", "bundleId", "url"]);
  if (appFields) {
    const platform = oneOf(appFields.platform, "app.platform", ["ios", "mac", "web"]);
    if (appFields.platform === undefined) say("app.platform", "is missing: ios, mac or web");
    app = { platform: platform ?? "ios" };
    known = platform !== undefined;
    const bundleId = string(appFields.bundleId, "app.bundleId", /^[A-Za-z0-9.-]+$/, "a bundle id, such as com.example.notes");
    if (bundleId) app.bundleId = bundleId;
    const url = string(appFields.url, "app.url", /^https?:\/\/\S+$/, "an address that starts with http:// or https://");
    if (url) app.url = url;
  }

  /** @type {string[]} */
  const displays = [];
  if (!Array.isArray(plan.displays) || plan.displays.length === 0) say("displays", `should list one or more of ${list(Object.keys(PREVIEW_DISPLAYS))}`);
  else {
    for (const [at, key] of plan.displays.entries()) {
      if (!Object.hasOwn(PREVIEW_DISPLAYS, key)) say(`displays[${at}]`, `should be ${list(Object.keys(PREVIEW_DISPLAYS))}, not ${JSON.stringify(key)}`);
      else if (displays.includes(key)) say(`displays[${at}]`, `${key} is there twice`);
      else if (known && app.platform !== "web" && PREVIEW_DISPLAYS[key] !== app.platform) say(`displays[${at}]`, `${key} is not a display of ${app.platform === "mac" ? "a Mac app" : "an iPhone or iPad app"}`);
      else displays.push(key);
    }
  }
  const orientation = oneOf(plan.orientation, "orientation", ["portrait", "landscape"]) ?? "portrait";

  /** @type {string[] | undefined} */
  let locales;
  if (plan.locales !== undefined) {
    if (!Array.isArray(plan.locales) || plan.locales.length === 0 || plan.locales.length > 40) say("locales", "should list one to 40 language codes, the primary one first");
    else {
      locales = [];
      for (const [at, code] of plan.locales.entries()) {
        if (typeof code !== "string" || !LOCALE.test(code)) say(`locales[${at}]`, `${JSON.stringify(code)} is not a language code, such as en or de-DE`);
        else if (locales.some((other) => other.toLowerCase() === code.toLowerCase())) say(`locales[${at}]`, `${code} is there twice`);
        else locales.push(code);
      }
    }
  }
  const footage = oneOf(plan.footage, "footage", ["per-locale", "primary"]) ?? "per-locale";
  const style = oneOf(plan.style, "style", ["store"]) ?? "store";
  const captionStyle = oneOf(plan.captionStyle, "captionStyle", ["panel", "shadow", "band"]) ?? "panel";
  if (captionStyle === "band") warnings.push('captionStyle "band" draws a band the full width of the video, and Apple has turned previews down for framing around the screen recording. "panel" or "shadow" is safer.');
  const fit = oneOf(plan.fit, "fit", ["plate", "fill"]) ?? "plate";

  /** @type {Plan["intro"]} */
  let intro = false;
  if (plan.intro !== undefined && plan.intro !== false) {
    const fields = object(plan.intro, "intro", "the intro", ["seconds", "headline", "logo"]);
    if (fields) {
      intro = { seconds: frames(number(fields.seconds, "intro.seconds", 0.5, 3) ?? DEFAULTS.intro), logo: boolean(fields.logo, "intro.logo") ?? true };
      if (fields.headline !== undefined) intro.headline = text(fields.headline, "intro.headline");
    }
  }
  /** @type {Plan["outro"]} */
  let outro = false;
  if (plan.outro !== undefined && plan.outro !== false) {
    const fields = object(plan.outro, "outro", "the outro", ["seconds", "lines", "logo", "disclosure"]);
    if (fields) {
      outro = { seconds: frames(number(fields.seconds, "outro.seconds", 0.5, 4) ?? DEFAULTS.outro), lines: [], logo: boolean(fields.logo, "outro.logo") ?? true, disclosure: [] };
      if (fields.lines !== undefined) {
        if (!Array.isArray(fields.lines) || fields.lines.length > 3) say("outro.lines", "should list up to 3 texts");
        else outro.lines = fields.lines.map((line, at) => text(line, `outro.lines[${at}]`));
      }
      if (fields.disclosure !== undefined) {
        if (!Array.isArray(fields.disclosure)) say("outro.disclosure", `should list what the app has of ${list(DISCLOSURES)}`);
        else for (const [at, kind] of fields.disclosure.entries()) if (oneOf(kind, `outro.disclosure[${at}]`, DISCLOSURES) && !outro.disclosure.includes(kind)) outro.disclosure.push(kind);
      }
    }
  }

  /** @type {Plan["transition"]} */
  let transition = { type: "fade", seconds: DEFAULTS.transition };
  if (plan.transition !== undefined) {
    const fields = object(plan.transition, "transition", "the transition", ["type", "seconds"]);
    if (fields) {
      const type = oneOf(fields.type, "transition.type", ["fade", "dissolve", "none"]) ?? "fade";
      const seconds = number(fields.seconds, "transition.seconds", 0.1, 1) ?? DEFAULTS.transition;
      transition = { type, seconds: type === "none" ? 0 : frames(seconds) };
    }
  }

  /** @type {Plan["music"]} */
  let music;
  if (plan.music !== undefined) {
    const fields = object(plan.music, "music", "the music", ["file", "volume", "start", "fadeOut"]);
    if (fields) {
      const file = string(fields.file, "music.file");
      if (fields.file === undefined) say("music.file", "is missing: the audio file, licensed for the App Store, next to the plan or with its path");
      music = { file: file ?? "", volume: number(fields.volume, "music.volume", 0, 1) ?? DEFAULTS.volume, start: number(fields.start, "music.start", 0, 3600) ?? 0, fadeOut: number(fields.fadeOut, "music.fadeOut", 0, 5) ?? DEFAULTS.fadeOut };
    }
  }
  /** @type {Record<string, string> | undefined} */
  let narration;
  if (plan.narration !== undefined) {
    if (!isObject(plan.narration)) say("narration", "should be an audio file per language");
    else {
      narration = /** @type {Record<string, string>} */ (plan.narration);
      warnings.push("narration is read, and left out of the previews until a later version of appshots.");
    }
  }

  /** @type {Scene[]} */
  const scenes = [];
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0 || plan.scenes.length > 8) say("scenes", "should list one to 8 scenes, the moments of the app the preview shows");
  else for (const [at, value] of plan.scenes.entries()) {
    const scene = readScene(value, `scenes[${at}]`, known ? app.platform : null, { object, number, oneOf, string, boolean, text, say });
    if (!scene) continue;
    if (scenes.some((other) => other.id === scene.id)) say(`scenes[${at}].id`, `${scene.id} is there twice`);
    scenes.push(scene);
  }

  /** @type {Plan["poster"]} */
  let poster;
  if (plan.poster !== undefined) {
    if (isObject(plan.poster) && "time" in plan.poster) {
      const fields = object(plan.poster, "poster", "the poster", ["time"]);
      if (fields) poster = { time: number(fields.time, "poster.time", 0, LENGTH.max) ?? 0 };
    } else {
      const fields = object(plan.poster, "poster", "the poster", ["scene", "at"]);
      if (fields) {
        const scene = string(fields.scene, "poster.scene");
        if (scene === undefined) say("poster.scene", "is missing: the id of the scene the poster frame is taken from, or {\"time\": <seconds>} instead");
        else if (Array.isArray(plan.scenes) && !plan.scenes.some((each) => isObject(each) && each.id === scene)) say("poster.scene", `there is no scene ${scene}`);
        poster = { scene: scene ?? "" };
        const atSeconds = number(fields.at, "poster.at", 0, LENGTH.max);
        if (atSeconds !== undefined) poster.at = atSeconds;
      }
    }
  }
  const target = number(plan.target, "target", LENGTH.min, LENGTH.max) ?? DEFAULTS.target;

  if (problems.length > 0) return { plan: null, problems, warnings };
  return {
    plan: { version: 1, name, project: /** @type {string} */ (project), app, displays, orientation, ...(locales ? { locales } : {}), footage, style, captionStyle, fit, intro, outro, transition, ...(music ? { music } : {}), ...(narration ? { narration } : {}), scenes, ...(poster ? { poster } : {}), target },
    problems,
    warnings,
  };
}

/**
 * One scene of a plan, with its defaults, or null when it is no object at all.
 * @param {unknown} value
 * @param {string} at
 * @param {string | null} platform Null when the plan does not say it right.
 * @param {any} check The checks of validatePlan, which collect what is wrong.
 * @returns {Scene | null}
 */
function readScene(value, at, platform, { object, number, oneOf, string, boolean, text, say }) {
  const fields = object(value, at, "a scene", ["id", "caption", "captionPosition", "launch", "drive", "record", "trim", "speed", "hold", "touches"]);
  if (!fields) return null;
  const id = string(fields.id, `${at}.id`, ID, "an id of lowercase letters, digits and - (32 at most)");
  if (fields.id === undefined) say(`${at}.id`, "is missing: a short name such as inbox, which the recordings are named by");
  /** @type {Scene} */
  const scene = {
    id: id ?? "",
    caption: fields.caption === undefined || fields.caption === false ? false : (text(fields.caption, `${at}.caption`) ?? false),
    captionPosition: oneOf(fields.captionPosition, `${at}.captionPosition`, ["top", "bottom"]) ?? "top",
    record: { seconds: DEFAULTS.record, settle: DEFAULTS.settle },
    trim: null,
    speed: number(fields.speed, `${at}.speed`, 1, 2) ?? 1,
    hold: number(fields.hold, `${at}.hold`, 0, 2) ?? 0,
    touches: boolean(fields.touches, `${at}.touches`) ?? true,
    estimate: DEFAULTS.estimate,
  };

  if (fields.launch !== undefined) {
    const launch = object(fields.launch, `${at}.launch`, "a scene's launch", ["args", "url", "appearance"]);
    if (launch) {
      scene.launch = {};
      if (launch.args !== undefined) {
        if (!Array.isArray(launch.args) || launch.args.some((arg) => typeof arg !== "string")) say(`${at}.launch.args`, 'should list the launch arguments as texts, such as ["-AppshotsDemo", "inbox"]');
        else scene.launch.args = launch.args;
      }
      const url = string(launch.url, `${at}.launch.url`, /^[a-zA-Z][a-zA-Z0-9+.-]*:\S*$/, "an address or a deep link, such as notes://inbox");
      if (url) scene.launch.url = url;
      const appearance = oneOf(launch.appearance, `${at}.launch.appearance`, ["light", "dark"]);
      if (appearance) scene.launch.appearance = appearance;
    }
  }

  let wait;
  if (fields.drive === "manual") scene.drive = "manual";
  else if (fields.drive !== undefined) {
    const where = `${at}.drive`;
    const kind = isObject(fields.drive) ? Object.keys(fields.drive).find((key) => ["wait", "uitest", "command", "web"].includes(key)) : undefined;
    if (!kind) say(where, 'should be "manual", {"wait": <seconds>}, {"uitest": "<target>/<class>/<test>"}, {"command": [<program>, <arguments>…]} or {"web": [<steps>]}');
    else if (kind === "wait") {
      const drive = object(fields.drive, where, "a wait", ["wait"]);
      wait = number(drive?.wait, `${where}.wait`, 0.5, 60);
      if (wait !== undefined) scene.drive = { wait };
    } else if (kind === "uitest") {
      const drive = object(fields.drive, where, "a UI test", ["uitest", "scheme"]);
      const test = string(drive?.uitest, `${where}.uitest`, /^[^/\s]+(\/[^/\s]+){1,2}$/, "a test, such as NotesUITests/PreviewTests/testInbox");
      if (platform === "web") say(`${where}.uitest`, "a web app's scenes are driven with web steps, not an Xcode UI test");
      const scheme = string(drive?.scheme, `${where}.scheme`);
      if (test) scene.drive = scheme ? { uitest: test, scheme } : { uitest: test };
    } else if (kind === "command") {
      const drive = object(fields.drive, where, "a command", ["command"]);
      if (!Array.isArray(drive?.command) || drive.command.length === 0 || drive.command.some((arg) => typeof arg !== "string" || arg === "")) say(`${where}.command`, 'should list the program and its arguments, such as ["maestro", "test", "flows/inbox.yaml"]');
      else scene.drive = { command: drive.command };
    } else {
      const drive = object(fields.drive, where, "web steps", ["web"]);
      if (platform && platform !== "web") say(`${where}.web`, `web steps drive a web app's pages, and this is ${platform === "mac" ? "a Mac app" : "an iPhone or iPad app"}`);
      if (!Array.isArray(drive?.web) || drive.web.length === 0) say(`${where}.web`, 'should list the steps, such as [{"click": "#new"}, {"type": ["#title", "Groceries"]}, {"wait": 1}]');
      else {
        const steps = drive.web.map((step, index) => webStep(step, `${where}.web[${index}]`, { number, string, say }));
        if (steps.every(Boolean)) scene.drive = { web: steps };
      }
    }
  }

  let seconds;
  if (fields.record !== undefined) {
    const record = object(fields.record, `${at}.record`, "a scene's recording", ["seconds", "settle"]);
    seconds = number(record?.seconds, `${at}.record.seconds`, 1, 60);
    scene.record = { seconds: seconds ?? DEFAULTS.record, settle: number(record?.settle, `${at}.record.settle`, 0, 30) ?? DEFAULTS.settle };
  }
  if (fields.trim === "auto") scene.trim = "auto";
  else if (fields.trim !== undefined) {
    const [start, end] = Array.isArray(fields.trim) ? fields.trim : [];
    if (!Array.isArray(fields.trim) || fields.trim.length !== 2 || [start, end].some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) say(`${at}.trim`, 'should be "auto", or [<start>, <end>] in seconds into the recording');
    else if (end <= start) say(`${at}.trim`, "the end comes before the start");
    else scene.trim = [start, end];
  }

  // Until there is a recording, a scene lasts as long as its cut, or what it is given to record, or what the app
  // is given to play, at most the recording's limit.
  const length = Array.isArray(scene.trim) ? scene.trim[1] - scene.trim[0] : (seconds ?? (wait !== undefined ? Math.min(wait, scene.record.seconds) : DEFAULTS.estimate));
  scene.estimate = frames(length);
  return scene;
}

/**
 * @param {unknown} step
 * @param {string} at
 * @param {any} check
 * @returns {WebStep | undefined}
 */
function webStep(step, at, { number, string, say }) {
  const keys = isObject(step) ? Object.keys(step) : [];
  if (keys.length !== 1 || !["goto", "click", "type", "scroll", "hover", "wait"].includes(keys[0])) {
    say(at, 'should be one step: {"goto": <path>}, {"click": <selector>}, {"type": [<selector>, <text>]}, {"scroll": <pixels>}, {"hover": <selector>} or {"wait": <seconds>}');
    return undefined;
  }
  const [key] = keys;
  const value = step[key];
  if (key === "type") {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || typeof value[1] !== "string") return void say(`${at}.type`, "should be [<selector>, <text>]");
    return { type: [value[0], value[1]] };
  }
  if (key === "scroll") return number(value, `${at}.scroll`, -100000, 100000) === undefined ? undefined : { scroll: value };
  if (key === "wait") return number(value, `${at}.wait`, 0, 30) === undefined ? undefined : { wait: value };
  return string(value, `${at}.${key}`) === undefined ? undefined : /** @type {WebStep} */ ({ [key]: value });
}

/** @param {string} at @param {string} key */
const join = (at, key) => (at === "plan" ? key : /^[A-Za-z_$][\w$]*$/.test(key) ? `${at}.${key}` : `${at}[${JSON.stringify(key)}]`);

/** @param {readonly unknown[]} options */
const list = (options) => {
  const words = options.map((option) => JSON.stringify(option));
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : words[0];
};

/**
 * Reads and checks a plan. It fails with every problem in it, each with its place in the file.
 * @param {string} file
 * @returns {Plan}
 */
export function readPlan(file) {
  const where = path.resolve(file);
  let text;
  try {
    text = readFileSync(where, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fail(`There is no ${path.basename(where)} in ${path.dirname(where)}. 'appshots video init <project>' writes one from the project's slides, and --plan <file> names one elsewhere.`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`${path.basename(where)} is not valid JSON: ${error.message}`);
  }
  const { plan, problems, warnings } = validatePlan(raw);
  if (!plan) fail(`${path.basename(where)} needs ${problems.length === 1 ? "one change" : `${problems.length} changes`}:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  for (const warning of warnings) console.error(`appshots: ${warning}`);
  return { ...plan, file: where, root: path.dirname(where) };
}

/**
 * The plan's languages made the project's: left out, they are the project's; given, each must be one the project
 * has, and is written the way the project writes it.
 * @template {Pick<Plan, "locales">} P
 * @param {P} plan
 * @param {{ id: string, locales: string[] }} project
 * @returns {P & { locales: string[] }}
 */
export function resolvePlan(plan, project) {
  if (!plan.locales) return { ...plan, locales: [...project.locales] };
  const locales = plan.locales.map((code, at) => {
    const exact = project.locales.find((each) => each.toLowerCase() === code.toLowerCase());
    if (exact) return exact;
    const close = project.locales.filter((each) => each.toLowerCase().split("-")[0] === code.toLowerCase().split("-")[0]);
    fail(`locales[${at}]: project ${project.id} has no language ${code}${close.length > 0 ? `; it has ${close.join(", ")}, so write that` : `. Its languages are ${project.locales.join(", ")}; add ${code} to it first, in the Studio under Languages`}.`);
  });
  return { ...plan, locales };
}

/**
 * A short hash of what the plan says, which a recording keeps to tell what it was made for. Where the plan is
 * does not count.
 * @param {Omit<Plan, "file" | "root"> & Partial<Pick<Plan, "file" | "root">>} plan
 */
export function planHash(plan) {
  const { file: _file, root: _root, ...rest } = plan;
  return createHash("sha256").update(canonical(rest)).digest("hex").slice(0, 8);
}

/** JSON with every object's keys in order, so that the same plan always hashes the same. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/**
 * @typedef {object} Sidecar What a recording says about itself, beside it in raw/.
 * @property {number} wall Seconds it ran by the clock.
 * @property {[number, number] | null} [trim] The cut "auto" came to.
 */

/**
 * How long a scene lasts in the preview: its cut of the recording, sped up, plus the last frame held. Before
 * there is a recording, its estimate stands in for the cut. A whole number of frames.
 * @param {Pick<Plan, "scenes">} _plan
 * @param {Scene} scene
 * @param {Sidecar | null} [sidecar]
 */
export function sceneSeconds(_plan, scene, sidecar) {
  let length = scene.estimate;
  if (sidecar && Number.isFinite(sidecar.wall)) {
    const [start, end] = Array.isArray(scene.trim) ? scene.trim : Array.isArray(sidecar.trim) ? sidecar.trim : [0, sidecar.wall];
    const stop = Math.min(end, sidecar.wall);
    length = Math.max(0, stop - Math.min(start, stop));
  }
  return frames(length / scene.speed + scene.hold);
}

/**
 * Where each join of the preview starts, and how long the whole runs: segments overlap by the transition, so the
 * k-th join starts at the first k segments' length less k transitions.
 * @param {number[]} durations Seconds of each segment, in order: intro, scenes, outro.
 * @param {Plan["transition"] | number} transition
 * @returns {{ offsets: number[], total: number }}
 */
export function joinOffsets(durations, transition) {
  const overlap = typeof transition === "number" ? transition : transition.type === "none" ? 0 : transition.seconds;
  /** @type {number[]} */
  const offsets = [];
  let sum = 0;
  for (const [k, seconds] of durations.entries()) {
    sum += seconds;
    if (k < durations.length - 1) offsets.push(frames(sum - (k + 1) * overlap));
  }
  return { offsets, total: frames(sum - Math.max(0, durations.length - 1) * overlap) };
}

/**
 * The id of a scene's caption in the layers the server draws.
 * @param {Scene | string} scene
 */
export const captionLayerId = (scene) => `caption-${typeof scene === "string" ? scene : scene.id}`;

/**
 * @typedef {object} Segment
 * @property {"intro" | "scene" | "outro"} kind
 * @property {string} id
 * @property {number} seconds
 * @property {number} start Where it starts in the preview.
 * @property {boolean} [recorded] For a scene: whether its length is the recording's rather than an estimate.
 */

/**
 * The preview from start to end: intro, scenes and outro, with the time each starts.
 * @param {Plan} plan
 * @param {(scene: Scene) => Sidecar | null} [recording] The recording of a scene, when there is one.
 * @returns {{ segments: Segment[], total: number }}
 */
export function timeline(plan, recording = () => null) {
  /** @type {Omit<Segment, "start">[]} */
  const parts = [];
  if (plan.intro) parts.push({ kind: "intro", id: "intro", seconds: plan.intro.seconds });
  for (const scene of plan.scenes) {
    const sidecar = recording(scene);
    parts.push({ kind: "scene", id: scene.id, seconds: sceneSeconds(plan, scene, sidecar), recorded: Boolean(sidecar) });
  }
  if (plan.outro) parts.push({ kind: "outro", id: "outro", seconds: plan.outro.seconds });
  const { offsets, total } = joinOffsets(parts.map((part) => part.seconds), plan.transition);
  return { segments: parts.map((part, at) => ({ ...part, start: at === 0 ? 0 : offsets[at - 1] })), total };
}

/**
 * The moment of the preview its poster frame is taken at: app UI with its caption, never the intro card. By
 * default the first scene, a second after its caption has faded in.
 * @param {Plan} plan
 * @param {{ segments: Segment[] }} line The plan's timeline.
 */
export function posterTime(plan, { segments }) {
  if (plan.poster && "time" in plan.poster) return frames(plan.poster.time);
  const id = plan.poster && "scene" in plan.poster ? plan.poster.scene : plan.scenes[0].id;
  const scene = segments.find((segment) => segment.kind === "scene" && segment.id === id) ?? segments.find((segment) => segment.kind === "scene");
  if (!scene) return 0;
  // The caption fades in over 0.35 s from 0.1 s after the transition into the scene.
  const after = plan.poster && "at" in plan.poster && plan.poster.at !== undefined ? plan.poster.at : plan.transition.seconds + 0.45 + 1;
  return frames(scene.start + Math.min(after, Math.max(0, scene.seconds - 1 / FPS)));
}

/**
 * What is wrong with the length of a preview, for a compose to fail with, or null when Apple takes it.
 * @param {number} total
 */
export function lengthProblem(total) {
  // Rounded up, so that cutting what it says is always enough.
  const tenths = (seconds) => (Math.ceil(seconds * 10 - 1e-9) / 10).toFixed(1);
  if (total > LENGTH.max) return `The preview runs ${total.toFixed(1)} s, and the App Store takes 30 s at most: cut ${tenths(total - LENGTH.max)} s, with a shorter trim, a higher speed or one scene less.`;
  if (total < LENGTH.min) return `The preview runs ${total.toFixed(1)} s, and the App Store takes 15 s at least: add ${tenths(LENGTH.min - total)} s, with a longer recording or another scene.`;
  return null;
}

/**
 * The orientation of a display's preview. A Mac's is always landscape.
 * @param {Pick<Plan, "orientation">} plan
 * @param {string} display
 */
export const orientationOf = (plan, display) => (display === "mac" ? "landscape" : plan.orientation);

/**
 * The work folders of a plan.
 * @param {Pick<Plan, "root">} plan
 */
export function workFolders(plan) {
  const work = path.join(plan.root, WORK_FOLDER);
  return { work, raw: path.join(work, "raw"), segments: path.join(work, "work"), layers: path.join(work, "layers"), out: path.join(work, "out"), remotion: path.join(work, "remotion") };
}

/**
 * The comma-separated list a flag holds, or null when it is not given.
 * @param {Record<string, string | true>} flags
 * @param {string} name
 * @param {string} example
 */
function listOf(flags, name, example) {
  if (flags[name] === undefined) return null;
  if (typeof flags[name] !== "string") fail(`--${name} needs a value, such as --${name} ${example}.`);
  return flags[name].split(",").map((part) => part.trim()).filter(Boolean);
}

/**
 * The plan's languages --lang picks, in the plan's order; all of them without it.
 * @param {Plan & { locales: string[] }} plan
 * @param {Record<string, string | true>} flags
 */
export function selectedLocales(plan, flags) {
  const asked = listOf(flags, "lang", plan.locales.slice(0, 2).join(","));
  if (!asked) return plan.locales;
  for (const code of asked) if (!plan.locales.some((each) => each.toLowerCase() === code.toLowerCase())) fail(`--lang ${code}: the plan's languages are ${plan.locales.join(", ")}.`);
  return plan.locales.filter((code) => asked.some((each) => each.toLowerCase() === code.toLowerCase()));
}

/**
 * The plan's displays --display picks, in the plan's order; all of them without it.
 * @param {Plan} plan
 * @param {Record<string, string | true>} flags
 */
export function selectedDisplays(plan, flags) {
  const asked = listOf(flags, "display", plan.displays.join(","));
  if (!asked) return plan.displays;
  for (const key of asked) if (!plan.displays.includes(key)) fail(`--display ${key}: the plan's displays are ${plan.displays.join(", ")}.`);
  return plan.displays.filter((key) => asked.includes(key));
}

/**
 * The plan's scenes --scene picks, in the plan's order; all of them without it.
 * @param {Plan} plan
 * @param {Record<string, string | true>} flags
 */
export function selectedScenes(plan, flags) {
  const asked = listOf(flags, "scene", plan.scenes[0].id);
  if (!asked) return plan.scenes;
  for (const id of asked) if (!plan.scenes.some((scene) => scene.id === id)) fail(`--scene ${id}: the plan's scenes are ${plan.scenes.map((scene) => scene.id).join(", ")}.`);
  return plan.scenes.filter((scene) => asked.includes(scene.id));
}
