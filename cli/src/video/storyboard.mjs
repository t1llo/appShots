import { existsSync } from "node:fs";
import path from "node:path";
import { LENGTH, posterTime, timeline } from "./plan.mjs";

/** @typedef {import("./plan.mjs").Plan & { locales: string[] }} Plan */
/** @typedef {import("./plan.mjs").Scene} Scene */
/** @typedef {import("./plan.mjs").Sidecar} Sidecar */
/** @typedef {import("./plan.mjs").Text} Text */
/** @typedef {import("./plan.mjs").SlideText} SlideText */

/**
 * The fields of a project the storyboard reads.
 * @typedef {{ id: string, name?: string, locales: string[], slides: Array<Record<string, unknown>> }} Project
 */

/**
 * @typedef {object} Caption
 * @property {string | null} text In the primary language; null when it comes from a slide and the project is not
 *   at hand, or the slide has none.
 * @property {string} from Where it comes from: "plan", or a slide's field such as "slide 2 headline".
 * @property {string[]} missing The languages that have no text of their own and show another's.
 */

/**
 * Seconds of recording one scene takes, launch and settling included. Apple's previews need every language
 * recorded on its own, so this adds up quickly.
 * @param {Scene} scene
 */
const recordingSeconds = (scene) => Math.max(15, scene.record.settle + scene.estimate + 6);

/** The template's own fallback, so a text is told as missing exactly when the server would draw another's. */
function pick(text, locale, primary) {
  if (typeof text === "string") return { text, own: true };
  const own = text[locale] ?? text[locale.split("-")[0]];
  if (own !== undefined) return { text: own, own: true };
  return { text: text[primary] ?? Object.values(text)[0] ?? "", own: false };
}

const FIELD = { headline: "headline", eyebrow: "eyebrow", sub: "subheadline" };

// What App Store review turns captions down for: prices, "free", rankings and dates. A hint, not a rule: it
// knows a few words only.
const UNSAFE = /(?:^|[^\p{L}])(free|gratis|kostenlos|gratuit|sale|discount|cheapest|best|number one|top[- ]rated)(?=$|[^\p{L}])|#\s?1\b|[$€£¥]|\d\s?%|\b(?:19|20)\d\d\b/iu;

/**
 * A caption of the plan in every language: the text the primary language shows, and the languages that show
 * another's.
 * @param {false | Text | SlideText | undefined} value
 * @param {Plan} plan
 * @param {Project | null} project
 * @param {(warning: string) => void} warn
 * @param {string} where Its place in the plan, for a warning.
 * @returns {Caption | null}
 */
function caption(value, plan, project, warn, where) {
  if (value === undefined || value === false) return null;
  const [primary] = plan.locales;
  let text = /** @type {Text | undefined} */ (undefined);
  let from = "plan";
  if (typeof value === "object" && "slide" in value) {
    const field = value.field ?? "headline";
    from = `slide ${value.slide} ${field}`;
    if (!project) return { text: null, from, missing: [] };
    const slide = project.slides[value.slide - 1];
    if (!slide) {
      warn(`${where}: project ${project.id} has ${project.slides.length === 0 ? "no slides" : `slides 1 to ${project.slides.length}`}, so slide ${value.slide} has no text for it.`);
      return { text: null, from, missing: [] };
    }
    text = /** @type {Text | undefined} */ (slide[FIELD[field]]);
    if (text === undefined || text === "") {
      warn(`${where}: slide ${value.slide} has no ${FIELD[field]}.`);
      return { text: null, from, missing: [] };
    }
  } else {
    text = /** @type {Text} */ (value);
  }
  // One text is for every language, and in a set of several it is the primary language's.
  const missing = typeof text === "string" ? plan.locales.slice(1) : plan.locales.filter((locale) => !pick(text, locale, primary).own);
  const shown = new Set(plan.locales.map((locale) => pick(text, locale, primary).text));
  for (const each of shown) {
    const match = UNSAFE.exec(each);
    if (match) warn(`${where}: "${each}" has ${JSON.stringify(match[0].trim())}. Captions carry no prices, "free", rankings or dates: Apple turns previews down for them.`);
  }
  return { text: pick(text, primary, primary).text, from, missing };
}

/**
 * Everything the storyboard shows, as data: what `video plan` prints and what `video plan --json` gives an agent.
 * @param {Plan} plan
 * @param {object} [context]
 * @param {Project | null} [context.project] The project, for the slides' texts; null when it could not be had.
 * @param {(display: string, locale: string, scene: Scene) => Sidecar | null} [context.recording]
 */
export function buildStoryboard(plan, { project = null, recording = () => null } = {}) {
  /** @type {string[]} */
  const warnings = [];
  const warn = (warning) => warnings.push(warning);
  const [primary] = plan.locales;

  const intro = plan.intro ? { seconds: plan.intro.seconds, logo: plan.intro.logo, headline: caption(plan.intro.headline, plan, project, warn, "intro.headline") } : null;
  const outro = plan.outro ? { seconds: plan.outro.seconds, logo: plan.outro.logo, disclosure: plan.outro.disclosure, lines: plan.outro.lines.map((line, at) => caption(line, plan, project, warn, `outro.lines[${at}]`)) } : null;
  const captions = plan.scenes.map((scene, at) => caption(scene.caption, plan, project, warn, `scenes[${at}].caption (${scene.id})`));

  // With footage of the primary language only, the others reuse its recordings.
  const recorded = plan.footage === "primary" ? [primary] : plan.locales;
  let toRecord = 0;
  let recordSeconds = 0;
  const displays = plan.displays.map((display) => {
    for (const locale of recorded) {
      for (const scene of plan.scenes) {
        if (recording(display, locale, scene)) continue;
        toRecord++;
        recordSeconds += recordingSeconds(scene);
      }
    }
    const line = timeline(plan, (scene) => recording(display, primary, scene));
    const scenes = line.segments.filter((segment) => segment.kind === "scene");
    return { display, total: line.total, recorded: scenes.filter((segment) => segment.recorded).length, segments: line.segments, poster: posterTime(plan, line) };
  });

  for (const { display, total } of displays) {
    const which = displays.length > 1 ? `${display}: ` : "";
    if (total > LENGTH.high) warn(`${which}the preview runs ${total.toFixed(1)} s, and the App Store takes 30 s at most: cut ${(total - LENGTH.high).toFixed(1)} s or more.`);
    else if (total < LENGTH.low) warn(`${which}the preview runs ${total.toFixed(1)} s, and the App Store takes 15 s at least: add ${(LENGTH.low - total).toFixed(1)} s or more.`);
    else if (Math.abs(total - plan.target) > 3) warn(`${which}the preview runs ${total.toFixed(1)} s, and the plan aims at ${plan.target} s.`);
  }
  const overlap = plan.transition.seconds;
  const cards = (plan.intro ? plan.intro.seconds : 0) + (plan.outro ? plan.outro.seconds : 0);
  if (cards > 4) warn(`The intro and outro run ${cards.toFixed(1)} s together. Previews autoplay and are judged by their first seconds: keep the cards under 4 s.`);
  if (plan.intro && plan.intro.seconds - overlap > 2) warn(`The app shows only after ${(plan.intro.seconds - overlap).toFixed(1)} s. Show it within the first 2 s.`);
  for (const segment of displays[0].segments) {
    if (segment.kind !== "scene") continue;
    if (segment.seconds <= 2 * overlap) warn(`${segment.id} runs ${segment.seconds.toFixed(1)} s, too short for the ${overlap.toFixed(1)} s transitions into and out of it.`);
    else if (segment.seconds < 2) warn(`${segment.id} runs ${segment.seconds.toFixed(1)} s, too short to follow.`);
  }
  for (const [at, entry] of captions.entries()) {
    if (entry && entry.missing.length > 0) warn(`${plan.scenes[at].id}: the caption has no text in ${entry.missing.join(", ")}, which ${entry.missing.length === 1 ? "shows" : "show"} the ${primary} one.`);
  }
  const undriven = plan.scenes.filter((scene) => scene.drive === undefined).map((scene) => scene.id);
  if (undriven.length > 0) warn(`${undriven.join(", ")} ${undriven.length === 1 ? "has" : "have"} no drive. Say how the app gets through each moment before recording: "manual", {"wait": <seconds>}, {"uitest": …}, {"command": […]} or {"web": […]}.`);
  if (plan.app.platform === "web" && !plan.app.url) warn("app.url is not set, so 'appshots video record' needs --web <address>.");
  if (plan.music && plan.music.file && !existsSync(path.resolve(plan.root, plan.music.file))) warn(`music.file: ${plan.music.file} is not there.`);
  if (plan.footage === "primary" && plan.locales.length > 1) warn(`The app is recorded in ${primary} only, and the other languages show it with their own captions.`);
  if (recordSeconds > 20 * 60) warn(`Recording takes about ${Math.round(recordSeconds / 60)} minutes. Ask the user before recording more than 20; "footage": "primary" records one language only.`);

  return {
    plan: plan.file,
    project: plan.project,
    platform: plan.app.platform,
    displays,
    locales: plan.locales,
    transition: plan.transition,
    target: plan.target,
    intro,
    outro,
    scenes: plan.scenes.map((scene, at) => ({ id: scene.id, caption: captions[at], position: scene.captionPosition, drive: driveLabel(scene.drive) })),
    recording: { needed: toRecord, seconds: Math.round(recordSeconds) },
    warnings,
  };
}

/** @typedef {ReturnType<typeof buildStoryboard>} Storyboard */

/** @param {Scene["drive"]} drive */
function driveLabel(drive) {
  if (drive === undefined) return "no drive yet";
  if (drive === "manual") return "by hand";
  if ("wait" in drive) return `plays ${drive.wait} s`;
  if ("uitest" in drive) return `UI test ${drive.uitest.split("/").at(-1)}`;
  if ("command" in drive) return path.basename(drive.command[0]);
  return `${drive.web.length} web step${drive.web.length === 1 ? "" : "s"}`;
}

/** @param {Caption | null} entry */
const captionLabel = (entry) => (!entry ? "" : entry.text === null ? `(${entry.from})` : entry.text.replace(/\*/g, "").replace(/\s*\n\s*/g, " / "));

/**
 * The storyboard as the person at the Terminal and the agent read it.
 * @param {Storyboard} board
 */
export function storyboardText(board) {
  const [first] = board.displays;
  const [primary] = board.locales;
  const rows = first.segments.map((segment) => {
    if (segment.kind === "intro") return [segment, "intro", [captionLabel(board.intro?.headline ?? null), board.intro?.logo ? "+ logo" : ""].filter(Boolean).join("  ")];
    if (segment.kind === "outro") {
      const lines = (board.outro?.lines ?? []).map(captionLabel).filter(Boolean);
      return [segment, "outro", [...lines, ...(board.outro?.disclosure ?? []).map((kind) => `[${kind}]`), board.outro?.logo ? "+ logo" : ""].filter(Boolean).join("  ")];
    }
    const scene = board.scenes.find((each) => each.id === segment.id);
    const text = captionLabel(scene?.caption ?? null) || "(no caption)";
    return [segment, segment.id, `${text}${scene?.caption && scene.position === "bottom" ? "  (bottom)" : ""}  · ${scene?.drive}`];
  });
  const width = Math.max(7, ...rows.map(([, label]) => label.length));
  const lines = [
    `Storyboard of ${path.basename(board.plan)}: project ${board.project}, a${board.platform === "ios" ? "n iPhone or iPad" : board.platform === "mac" ? " Mac" : " web"} app.`,
    `Languages: ${board.locales.map((locale, at) => (at === 0 ? `${locale} (primary)` : locale)).join(", ")}. Displays: ${board.displays.map((each) => each.display).join(", ")}.`,
    "",
    `  Starts  Seconds  ${"Segment".padEnd(width)}  Caption (${primary})`,
    ...rows.map(([segment, label, text]) => `  ${segment.start.toFixed(1).padStart(6)}  ${segment.seconds.toFixed(1).padStart(7)}  ${label.padEnd(width)}  ${text}`),
    "",
  ];
  const scenes = first.segments.filter((segment) => segment.kind === "scene").length;
  const lengths = board.displays.map(({ display, total, recorded }) => `${board.displays.length > 1 ? `${display} ` : ""}${total.toFixed(1)} s${recorded === scenes ? "" : recorded === 0 ? " (estimated, nothing recorded yet)" : ` (estimated, ${recorded} of ${scenes} scenes recorded)`}`);
  lines.push(`Length: ${lengths.join(", ")}. The aim is ${board.target} s; the App Store takes 15 to 30 s.`);
  lines.push(`Transitions: ${board.transition.type === "none" ? "none, a cut" : `${board.transition.type}, ${board.transition.seconds.toFixed(1)} s`}. Poster frame at ${first.poster.toFixed(1)} s.`);
  const { needed, seconds } = board.recording;
  lines.push(needed === 0 ? "Recording: every recording is there." : `Recording: ${needed} recording${needed === 1 ? "" : "s"} to make, about ${Math.max(1, Math.round(seconds / 60))} minute${Math.round(seconds / 60) > 1 ? "s" : ""}.`);
  if (board.warnings.length > 0) lines.push("", "Warnings:", ...board.warnings.map((warning) => `  - ${warning}`));
  return lines.join("\n");
}
