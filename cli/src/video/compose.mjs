// Cuts the previews together. For each display and language of the plan: one segment per scene and per card
// (stage 1), then the join with its transitions, the audio and the encode to Apple's specification (stage 2), and
// at the end the poster frame and the check. Footage stays on the Mac; the server only drew the layers.
//
// Work files are named by what goes into them, so a scene whose recording, layers and settings did not change is
// not built again, and a preview whose segments did not change is not encoded again.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fail } from "../fail.mjs";
import { pool } from "../util.mjs";
import { keptAudio, musicOf, previewAudio } from "./audio.mjs";
import { checkCut, checkProbe, previewsIn, readCheckRecord, writeCheckRecord } from "./check.mjs";
import { runFfmpeg } from "./encode.mjs";
import { findFfmpeg } from "./ffmpeg.mjs";
import { cardArgs, finalCodec, joinArgs, joinPoints, passArgs, sceneArgs, segmentCodec } from "./graph.mjs";
import { fetchLayers, localLayers } from "./layers.mjs";
import { FPS, captionBands, num, placement, plateBox, sceneFrames, sceneWindow, toFrames, touchPoints, turnOf } from "./normalise.mjs";
import { captionLayerId } from "./plan.mjs";
import { posterFrame, posterTime } from "./poster.mjs";
import { probe } from "./probe.mjs";
import { readSidecar } from "./record/index.mjs";
import { composeRemotion } from "./remotion.mjs";
import { PREVIEW_SPECS } from "./specs.mjs";
import { timecode } from "./timecode.mjs";

/** Changes when a segment made from the same inputs and the same command would come out different. */
const SEGMENT_VERSION = 1;

/** The same for the join and the encode of a preview. */
const PREVIEW_VERSION = 1;

/** Seconds a scene's caption waits after its transition before it fades in. */
const CAPTION_DELAY = 0.1;

/** Apple takes previews of 15 to 30 seconds. */
const SHORTEST = 15;
const LONGEST = 30;

/**
 * What compose takes from the other video modules. A test stands in for them through setParts, as it stands in
 * for programs through setRunner.
 */
const parts = { findFfmpeg, fetchLayers, localLayers, readSidecar, captionLayerId, probe, checkProbe, checkCut, posterFrame, composeRemotion, specs: PREVIEW_SPECS };

/**
 * Puts other parts in place, such as a test's, and returns the ones they replace.
 * @param {Partial<typeof parts>} next
 */
export function setParts(next) {
  const before = { ...parts };
  Object.assign(parts, next);
  return before;
}

/**
 * @typedef {{ ffmpeg: string, ffprobe: string, version: string, encoders: Set<string>, filters: Set<string> }} Tools
 * @typedef {{ id: string, locale: string | null, kind: string, width?: number, height?: number, box?: number[] }} Layer
 * @typedef {{ set: string, size?: [number, number], charged?: boolean, layers: Layer[] }} Manifest
 *
 * @typedef {object} Context What one preview is made from: one display, one language.
 * @property {any} plan The plan as readPlan returns it.
 * @property {string} root The work folder, appshots-video/ next to the plan.
 * @property {string} display
 * @property {string} locale
 * @property {[number, number]} size
 * @property {Manifest} layers The manifest of the display's layer set, its files under layers/<set>/.
 * @property {Tools} tools
 * @property {number} jobs How many segments are built at once.
 * @property {boolean} [draft]
 *
 * @typedef {object} Job A segment to build.
 * @property {"intro" | "scene" | "outro"} kind
 * @property {string} scene The scene's id, or "intro" or "outro".
 * @property {number} frames
 * @property {string} label For the messages.
 * @property {string[]} args ffmpeg's arguments, all but the output file.
 *
 * @typedef {{ scene: string, file: string, seconds: number, frames: number, built: boolean }} Segment
 */

/**
 * The plan's folder, and the work folder next to it.
 * @param {Record<string, string | true>} flags
 */
export function folders(flags) {
  const plan = path.resolve(typeof flags.plan === "string" ? flags.plan : "appshots.video.json");
  const base = path.dirname(plan);
  return { base, root: path.join(base, "appshots-video") };
}

/**
 * How many segments are built at once: --jobs, or half the cores and at most 4. Each ffmpeg uses several cores
 * itself, and a graph is less likely to stall on a Mac that is not out of memory.
 * @param {Record<string, string | true>} flags
 */
export function jobsOf(flags) {
  if (flags.jobs === undefined) return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
  const jobs = Number(flags.jobs);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) fail("--jobs takes how many segments to build at once, from 1 to 16, such as --jobs 2.");
  return jobs;
}

/**
 * The part of `all` that --<name> picks, in the plan's order; all of it without the flag.
 * @param {Record<string, string | true>} flags
 * @param {"lang" | "display"} name
 * @param {string[]} all
 */
function narrow(flags, name, all) {
  const value = flags[name];
  if (value === undefined) return all;
  if (typeof value !== "string") fail(`--${name} needs a value, such as --${name} ${all[0] ?? (name === "lang" ? "en" : "iphone")}.`);
  const picked = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const unknown = picked.filter((part) => !all.includes(part));
  if (unknown.length > 0) fail(`The plan has no ${name === "lang" ? "language" : "display"} ${unknown.join(", ")}; it has ${all.join(", ") || "none"}.`);
  return all.filter((item) => picked.includes(item));
}

/**
 * The H.264 encoder to use: x264 where ffmpeg has it, which keeps the bitrate Apple asks for more exactly than the
 * Mac's own encoder.
 * @param {Tools} tools
 */
function encoderOf(tools) {
  if (tools.encoders?.has("libx264")) return "libx264";
  if (tools.encoders?.has("h264_videotoolbox")) return "h264_videotoolbox";
  return fail(`The ffmpeg at ${tools.ffmpeg} has no H.264 encoder (libx264 or h264_videotoolbox). Install Homebrew's ffmpeg, which has both: brew install ffmpeg`);
}

/**
 * The plan's transition: its kind, and its length in frames.
 * @param {any} plan
 */
function transitionOf(plan) {
  const type = plan.transition?.type ?? "fade";
  if (!["fade", "dissolve", "none"].includes(type)) fail(`transition.type in the plan is "${type}"; it is fade, dissolve or none.`);
  return { type, frames: type === "none" ? 0 : toFrames(plan.transition?.seconds ?? 0.4) };
}

/**
 * The size of a display's previews in the plan's orientation. A Mac's are always landscape.
 * @param {string} display
 * @param {any} plan
 * @returns {[number, number]}
 */
function sizeOf(display, plan) {
  const spec = parts.specs[display];
  if (!spec) fail(`appShots makes no app previews for the display "${display}". It makes them for ${Object.keys(parts.specs).join(", ")}.`);
  const orientation = display === "mac" ? "landscape" : (plan.orientation ?? "portrait");
  const size = spec[orientation];
  if (!Array.isArray(size)) fail(`An app preview for ${display} cannot be ${orientation}.`);
  return /** @type {[number, number]} */ (size);
}

/**
 * A layer of the set for the context's language: its own, or the one every language shares.
 * @param {Context} ctx
 * @param {string} kind
 * @param {string} [id]
 */
function layerOf(ctx, kind, id) {
  const fits = (/** @type {Layer} */ layer) => layer.kind === kind && (id === undefined || layer.id === id);
  return ctx.layers.layers.find((layer) => fits(layer) && layer.locale === ctx.locale) ?? ctx.layers.layers.find((layer) => fits(layer) && layer.locale === null) ?? null;
}

/** A layer set's id, a language code or a layer's id: the names a layer's file is found by. */
const LAYER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/**
 * Where a layer's PNG is, as the set's layers.zip lays it out: <set>/<locale>/<id>.png, or <set>/<id>.png for
 * one that every language shares.
 * @param {Context} ctx
 * @param {Layer} layer
 */
function layerFile(ctx, layer) {
  const folders = [ctx.layers.set, ...(layer.locale ? [layer.locale] : [])];
  // The names become folders and a file, so a manifest that came apart must not reach outside layers/.
  if (![...folders, layer.id].every((name) => typeof name === "string" && LAYER_NAME.test(name)))
    fail(`The layers' manifest names a layer ${JSON.stringify([...folders, layer.id].join("/"))}, which is not a layer's name. Fetch the layers again: appshots video layers --display ${ctx.display}`);
  const file = path.join(ctx.root, "layers", ...folders, `${layer.id}.png`);
  if (!existsSync(file)) fail(`The layer ${layer.id}${layer.locale ? ` for ${layer.locale}` : ""} is not in ${path.dirname(file)}. Fetch the layers again: appshots video layers --display ${ctx.display}`);
  return file;
}

/**
 * The display whose recordings a display is cut from. The older iPhone and iPad sizes have none of their own:
 * they are cut from the current one's, which lie under raw/iphone/ and raw/ipad/.
 * @param {string} display
 */
const footageDisplay = (display) => (display.startsWith("iphone") ? "iphone" : display.startsWith("ipad") ? "ipad" : display);

/**
 * The recording a sidecar belongs to: the movie readSidecar found with it, or else
 * raw/<display>/<locale>/<scene>.<ext>, in the language whose footage it reuses, if any. An imported file keeps
 * the extension it came with.
 * @param {Context} ctx
 * @param {string} scene
 * @param {import("./normalise.mjs").Sidecar} sidecar
 */
function footageOf(ctx, scene, sidecar) {
  if (typeof sidecar.file === "string" && existsSync(sidecar.file)) return sidecar.file;
  const folder = path.join(ctx.root, "raw", footageDisplay(ctx.display), sidecar.reuse || sidecar.locale || ctx.locale);
  const name = (existsSync(folder) ? readdirSync(folder) : []).find((entry) => entry.startsWith(`${scene}.`) && !entry.endsWith(".json") && !entry.slice(scene.length + 1).includes("."));
  if (!name) fail(`The recording of scene "${scene}" is missing from ${folder}, though its sidecar is there. Record it again: appshots video record --scene ${scene} --lang ${ctx.locale} --display ${ctx.display} --again`);
  return path.join(folder, name);
}

/** @param {any} scene */
const hasCaption = (scene) => scene.caption !== undefined && scene.caption !== null && scene.caption !== false;

/**
 * The segments of one preview, as ffmpeg commands, in the order they are joined: the intro card, the scenes, the
 * outro card. Nothing runs; every missing recording or layer is found here, before the first encode.
 *
 * Without captions, for Remotion, which draws its own text: the scenes only, with no caption and no touches.
 * @param {Context} ctx
 * @param {{ captions: boolean }} options
 * @returns {Job[]}
 */
export function planSegments(ctx, { captions }) {
  const { plan, display, locale, size } = ctx;
  const overlap = transitionOf(plan).frames;
  const codec = segmentCodec({ encoder: encoderOf(ctx.tools), draft: ctx.draft });
  const orientation = display === "mac" ? "landscape" : (plan.orientation ?? "portrait");
  const plateLayer = layerOf(ctx, "plate");
  const plate = plateLayer && layerFile(ctx, plateLayer);
  /** @type {Job[]} */
  const jobs = [];
  // A segment that comes in through a transition waits for it to finish before its text appears.
  const lead = () => (jobs.length === 0 ? 0 : overlap / FPS);

  const card = (/** @type {"intro" | "outro"} */ kind) => {
    if (!captions || plan[kind] === false) return;
    const logo = layerOf(ctx, `${kind}-logo`);
    const text = layerOf(ctx, `${kind}-text`);
    // The plan asked the server for a card only if it wants one, so the layers say whether there is one.
    if (!logo && !text) return;
    const frames = toFrames(plan[kind]?.seconds ?? (kind === "intro" ? 1.5 : 2));
    const args = cardArgs({ size, frames, plate, logo: logo && layerFile(ctx, logo), text: text && layerFile(ctx, text), at: lead(), codec });
    jobs.push({ kind, scene: kind, frames, label: `the ${kind} card (${display}, ${locale})`, args });
  };

  card("intro");
  const fit = display === "mac" ? (plan.fit ?? "plate") : "fill";
  const box = fit === "plate" ? plateBox(size, captionBands(ctx.layers.layers, locale, size)) : null;
  const ringLayer = captions ? layerOf(ctx, "touch") : null;
  for (const scene of plan.scenes) {
    const sidecar = parts.readSidecar(ctx.root, display, locale, scene.id);
    if (!sidecar) fail(`Scene "${scene.id}" has no recording for ${locale} on ${display}. Record it: appshots video record --scene ${scene.id} --lang ${locale} --display ${display}`);
    if (!Array.isArray(sidecar.size)) fail(`The sidecar of scene "${scene.id}" (${locale}, ${display}) does not say the recording's size. Record it again: appshots video record --scene ${scene.id} --lang ${locale} --display ${display} --again`);
    const window = sceneWindow(scene, sidecar);
    const frames = sceneFrames(scene, window);
    const turn = turnOf(sidecar, orientation, display === "mac");
    const [width, height] = sidecar.size;
    const place = placement(size, turn ? [height, width] : [width, height], box);
    let caption = null;
    if (captions && hasCaption(scene)) {
      const layer = layerOf(ctx, "caption", parts.captionLayerId(scene));
      if (!layer) fail(`The layers have no caption for scene "${scene.id}" in ${locale}. Draw them again: appshots video layers --display ${display}`);
      caption = layerFile(ctx, layer);
    }
    const touches = ringLayer && scene.touches !== false ? touchPoints(sidecar, window, turn, place, frames / FPS) : [];
    const ring = ringLayer && touches.length > 0 ? layerFile(ctx, ringLayer) : null;
    const args = sceneArgs({ footage: footageOf(ctx, scene.id, sidecar), sidecar, window, turn, size, place, frames, plate, caption, captionAt: lead() + CAPTION_DELAY, ring, touches, codec });
    jobs.push({ kind: "scene", scene: scene.id, frames, label: `scene "${scene.id}" (${display}, ${locale})`, args });
  }
  card("outro");

  if (jobs.length > 1) {
    const short = jobs.find((job) => job.frames <= overlap);
    if (short) fail(`${short.label[0].toUpperCase()}${short.label.slice(1)} is ${num(short.frames / FPS)} s, no longer than the ${num(overlap / FPS)} s transition into the next. Make it longer, or the transition shorter.`);
  }
  return jobs;
}

/**
 * What a file is, for the name of what is made from it: a layer by its content; a recording, which can be
 * large, by its place in the work folder, its size and when it was written; anything else by its text.
 * @param {string} arg
 * @param {string} root
 */
function identity(arg, root) {
  if (!path.isAbsolute(arg) || !existsSync(arg)) return arg;
  if (arg.endsWith(".png")) return `png:${createHash("sha256").update(readFileSync(arg)).digest("hex")}`;
  const stat = statSync(arg);
  return `file:${path.relative(root, arg)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
}

/**
 * The name of what ffmpeg makes from `args`: the first 16 hex characters of a hash of the command, with each input
 * file by what it is rather than where, of ffmpeg's version, and of `version`.
 * @param {number} version
 * @param {Tools} tools
 * @param {string[]} args
 * @param {string} root
 */
function contentKey(version, tools, args, root) {
  const named = args.map((arg, at) => (args[at - 1] === "-i" ? identity(arg, root) : arg));
  return createHash("sha256")
    .update(JSON.stringify({ version, ffmpeg: tools.version, args: named }))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Builds the segments that are not in work/ yet, `ctx.jobs` at a time.
 * @param {Context} ctx
 * @param {Job[]} jobs
 * @returns {Promise<Segment[]>}
 */
async function runSegments(ctx, jobs) {
  const work = path.join(ctx.root, "work");
  mkdirSync(work, { recursive: true });
  const keys = jobs.map((job) => contentKey(SEGMENT_VERSION, ctx.tools, job.args, ctx.root));
  // Two segments made from the same inputs, such as an intro and an outro with the same logo, are one file, built
  // once: two ffmpegs writing it at once would write the same partial file.
  /** @type {Map<string, Job>} */
  const unique = new Map();
  keys.forEach((key, at) => unique.has(key) || unique.set(key, jobs[at]));
  /** @type {Set<string>} */
  const built = new Set();
  await pool([...unique], ctx.jobs ?? jobsOf({}), async ([key, job]) => {
    const file = path.join(work, `${key}.mp4`);
    if (existsSync(file)) return;
    // Written under another name first, so a segment that is there is always whole.
    const partial = path.join(work, `${key}.${process.pid}.partial.mp4`);
    await runFfmpeg(ctx.tools, [...job.args, "-f", "mp4", partial], { label: `stage 1, ${job.label}`, out: partial });
    renameSync(partial, file);
    built.add(key);
  });
  return jobs.map((job, at) => ({ scene: job.scene, file: path.join(work, `${keys[at]}.mp4`), seconds: job.frames / FPS, frames: job.frames, built: built.has(keys[at]) }));
}

/**
 * Stage 1 for one preview: its segments, built where they are not built yet.
 * @param {Context} ctx
 * @param {{ captions: boolean }} options Without captions, for Remotion: the scenes only, without text or touches.
 * @returns {Promise<Segment[]>}
 */
export async function buildSegments(ctx, { captions }) {
  return runSegments(ctx, planSegments(ctx, { captions }));
}

/**
 * When the poster frame is, in seconds of the preview, as poster.mjs picks it from where the scenes sit in the cut:
 * a time chosen with 'video poster --at'; the plan's time, or a moment into its scene that stays within that scene;
 * or a second after the first scene's caption is in, which shows the app and never a card.
 * @param {any} plan
 * @param {Job[]} jobs
 * @param {number} overlap The transition's frames.
 * @param {number} [chosen] The time chosen with 'video poster --at'.
 */
export function posterAt(plan, jobs, overlap, chosen) {
  const { starts, total } = startsOf(jobs, overlap);
  const captioned = new Set((plan.scenes ?? []).filter(hasCaption).map((/** @type {any} */ scene) => scene.id));
  const scenes = jobs.flatMap((job, at) => (job.kind === "scene" ? [{ id: job.scene, start: starts[at] / FPS, seconds: job.frames / FPS, caption: captioned.has(job.scene) }] : []));
  return posterTime({ scenes, total: total / FPS, transition: overlap / FPS, poster: plan.poster, chosen });
}

/**
 * The frame each segment starts on in the preview, and the preview's frames.
 * @param {Job[]} jobs
 * @param {number} overlap The transition's frames.
 */
function startsOf(jobs, overlap) {
  const { offsets, total } = joinPoints(
    jobs.map((job) => job.frames),
    overlap,
  );
  return { starts: [0, ...offsets], total };
}

/**
 * What the check cannot see in the file and the compose knows of its cut: the cards' lengths, when the app first
 * shows, the caption style, the captions the server had to squeeze or borrow, and how many previews the folder
 * holds.
 * @param {Context} ctx
 * @param {Job[]} jobs
 * @param {number} overlap The transition's frames.
 * @param {string} folder
 */
function cutOf(ctx, jobs, overlap, folder) {
  const { starts } = startsOf(jobs, overlap);
  const seconds = (/** @type {string} */ kind) => (jobs.find((job) => job.kind === kind)?.frames ?? 0) / FPS;
  const first = jobs.findIndex((job) => job.kind === "scene");
  return parts.checkCut({
    intro: seconds("intro"),
    outro: seconds("outro"),
    ...(first >= 0 ? { firstApp: starts[first] / FPS } : {}),
    captionStyle: ctx.plan.captionStyle,
    layers: ctx.layers,
    locale: ctx.locale,
    previews: previewsIn(folder),
  });
}

/** Rules whose name says the file is a draft: a draft is meant to be one, so that rule fails no compose. */
const isDraftRule = (/** @type {{ rule: string }} */ rule) => /draft/i.test(rule.rule);

/**
 * Prints what the check found, one line a rule that did not pass.
 * @param {{ errors: Array<{ rule: string, value?: unknown, expected?: unknown }>, warnings: Array<{ rule: string, value?: unknown, expected?: unknown }> }} result
 */
function printCheck(result) {
  const line = (/** @type {string} */ kind, /** @type {{ rule: string, value?: unknown, expected?: unknown }} */ rule) =>
    console.log(`  ${kind}: ${rule.rule}${rule.value !== undefined ? ` is ${String(rule.value)}` : ""}${rule.expected !== undefined ? `, expected ${String(rule.expected)}` : ""}`);
  if (result.errors.length === 0 && result.warnings.length === 0) console.log("  check: OK");
  for (const rule of result.errors) line("error", rule);
  for (const rule of result.warnings) line("warning", rule);
}

/**
 * Stage 2 for one preview, then its poster and its check.
 * @param {{ ctx: Context, jobs: Job[], frames: number }} output
 * @param {{ engine: string, music: import("./audio.mjs").Music | null, name: string, draft: boolean, encoder: string }} options
 */
async function composeOne({ ctx, jobs, frames }, { engine, music, name, draft, encoder }) {
  const { root, display, locale, tools } = ctx;
  const folder = path.join(root, "out", locale, display);
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${name}.mp4`);
  const posterFile = path.join(folder, `${name}.poster.png`);
  const transition = transitionOf(ctx.plan);
  const codec = finalCodec({ encoder, draft });
  const shown = path.relative(process.cwd(), file);
  console.log(`${display}, ${locale}: ${jobs.length} segment${jobs.length === 1 ? "" : "s"}, ${num(frames / FPS)} s${draft ? ", draft" : ""}`);

  let segments;
  let args;
  if (engine === "remotion") {
    segments = await runSegments(ctx, planSegments(ctx, { captions: false }));
    const made = await parts.composeRemotion(ctx, segments);
    const probed = await parts.probe(made, tools);
    const sound = (probed?.streams ?? []).some((/** @type {any} */ stream) => stream.codec_type === "audio");
    args = passArgs({ file: made, frames, audio: sound ? keptAudio(frames) : previewAudio(null, frames), codec });
  } else {
    segments = await runSegments(ctx, jobs);
    args = joinArgs({ segments: segments.map((segment) => segment.file), lengths: segments.map((segment) => segment.frames), transition, audio: previewAudio(music, frames), codec });
  }
  const built = segments.filter((segment) => segment.built).length;
  if (segments.length > built) console.log(`  ${segments.length - built} of ${segments.length} segments unchanged`);

  const key = contentKey(PREVIEW_VERSION, tools, args, root);
  // The record beside the preview that is there; readCheckRecord gives none for a file it was not written for.
  const before = readCheckRecord(file);
  const reused = before?.key === key;
  if (reused) console.log(`  ${shown} is unchanged`);
  else {
    // Written in work/, on the same disk, so that one an interrupted run leaves is never counted among the previews.
    const partial = path.join(root, "work", `${key}.${process.pid}.partial.mp4`);
    await runFfmpeg(tools, [...args, "-f", "mp4", partial], { label: `stage 2, the preview (${display}, ${locale})`, out: partial });
    renameSync(partial, file);
    console.log(`  ${shown}`);
  }

  // A poster chosen with 'video poster --at' stays where it was put, on the last frame if the preview got shorter.
  const chosen = before?.poster?.chosen === true && typeof before.poster.seconds === "number";
  const at = posterAt(ctx.plan, jobs, transition.frames, chosen ? before.poster.seconds : undefined);
  // The plan's poster can change without the video, so a preview that is reused may still need its poster again.
  const posterMoved = !reused || typeof before.poster?.seconds !== "number" || Math.abs(before.poster.seconds - at) >= 0.5 / FPS || !existsSync(posterFile);
  if (posterMoved) {
    await parts.posterFrame(file, at, posterFile, tools);
    console.log(`  poster at ${num(at)} s: ${path.relative(process.cwd(), posterFile)}`);
  }

  let probed;
  let verdict;
  if (reused) {
    probed = before.probe;
    verdict = { errors: before.errors, warnings: before.warnings };
  } else {
    probed = await parts.probe(file, tools);
    verdict = parts.checkProbe(probed, display, { draft, file });
  }
  const cut = cutOf(ctx, jobs, transition.frames, folder);
  const { errors, warnings } = verdict;
  printCheck({ errors, warnings: [...warnings, ...cut] });
  if (!reused || posterMoved || JSON.stringify(before.cut ?? []) !== JSON.stringify(cut)) {
    const poster = { seconds: at, timecode: timecode(at), ...(chosen ? { chosen: true } : {}) };
    writeCheckRecord(file, { key, display, locale, draft, seconds: frames / FPS, poster, errors, warnings, cut, probe: probed });
  }
  return { locale, display, file, seconds: frames / FPS, check: { errors, warnings: [...warnings, ...cut] } };
}

/**
 * The languages a layer set was drawn for.
 * @param {Manifest} manifest
 */
const localesIn = (manifest) => [...new Set(manifest.layers.map((layer) => layer.locale).filter((locale) => typeof locale === "string"))];

/**
 * The layer set of each language of a display. A set that 'video layers' put on this Mac for the plan as it is now
 * is used as it is, so a compose needs no server; the server is asked only for the languages that have none, and
 * a set it has not drawn before costs a render.
 * @param {any} plan
 * @param {string} display
 * @param {string[] | undefined} locales Undefined for every language the server draws.
 * @returns {Promise<Map<string, Manifest>>}
 */
async function layerSets(plan, display, locales) {
  /** @type {Map<string, Manifest>} */
  const sets = new Map();
  for (const locale of locales ?? []) {
    const local = parts.localLayers(plan, display, locale);
    if (local) sets.set(locale, local);
  }
  const missing = locales?.filter((locale) => !sets.has(locale));
  if (missing?.length === 0) return sets;
  console.log(missing ? `${display}: the layers in ${missing.join(", ")} are not on this Mac for the plan as it is now; asking the server for them` : `${display}: asking the server for the layers`);
  const fetched = await parts.fetchLayers(plan, { display, locales: missing });
  if (fetched.charged) console.log(`${display}: drawing them used one render`);
  for (const locale of missing ?? localesIn(fetched)) sets.set(locale, fetched);
  return sets;
}

/**
 * Makes the previews of the plan: for each display and language, out/<locale>/<display>/<name>.mp4 with its
 * poster and check.json. Everything that can stop it (a recording or a layer that is missing, a preview Apple
 * would not take for its length) is found before the first encode.
 * @param {any} plan The plan as readPlan returns it.
 * @param {Record<string, string | true>} flags --plan, --lang, --display, --engine, --draft, --jobs.
 * @returns {Promise<Array<{ locale: string, display: string, file: string, seconds: number, check: { errors: any[], warnings: any[] } }>>}
 */
export async function compose(plan, flags) {
  const { base, root } = folders(flags);
  const engine = flags.engine ?? "ffmpeg";
  if (engine !== "ffmpeg" && engine !== "remotion") fail("--engine takes ffmpeg or remotion, such as --engine remotion.");
  const draft = Boolean(flags.draft);
  const jobs = jobsOf(flags);
  const name = plan.name ?? "preview";
  const displays = narrow(flags, "display", plan.displays ?? []);
  if (displays.length === 0) fail("The plan names no displays. Add some to it, such as \"displays\": [\"iphone\"].");
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) fail("The plan has no scenes to compose.");
  const music = engine === "ffmpeg" ? musicOf(plan, base) : null;
  // ffmpeg.mjs asks before it installs ffmpeg, and only a person at a terminal; Return alone means no.
  const tools = await parts.findFfmpeg({ root });
  const encoder = encoderOf(tools);
  if (music) {
    const probed = await parts.probe(music.file, tools);
    if (!(probed?.streams ?? []).some((/** @type {any} */ stream) => stream.codec_type === "audio")) fail(`The music file ${music.file} has no sound that ffmpeg can read.`);
  }

  /** @type {Array<{ ctx: Context, jobs: Job[], frames: number }>} */
  const outputs = [];
  for (const display of displays) {
    const size = sizeOf(display, plan);
    const asked = Array.isArray(plan.locales) ? narrow(flags, "lang", plan.locales) : undefined;
    const sets = await layerSets(plan, display, asked);
    for (const layers of new Set(sets.values()))
      if (Array.isArray(layers.size) && (layers.size[0] !== size[0] || layers.size[1] !== size[1]))
        fail(`The ${display} layers are ${layers.size.join("×")}, and its previews are ${size.join("×")}. Fetch them again: appshots video layers --display ${display}`);
    for (const locale of asked ?? narrow(flags, "lang", [...sets.keys()])) {
      const layers = /** @type {Manifest} */ (sets.get(locale));
      const ctx = { plan, root, display, locale, size, layers, tools, jobs, draft };
      const planned = planSegments(ctx, { captions: true });
      const { total } = joinPoints(
        planned.map((job) => job.frames),
        transitionOf(plan).frames,
      );
      const seconds = total / FPS;
      if (seconds < SHORTEST || seconds > LONGEST)
        fail(
          `The ${display} preview in ${locale} would be ${num(seconds)} s long, and Apple takes ${SHORTEST} to ${LONGEST} s. ${seconds > LONGEST ? `Cut ${num(seconds - LONGEST)} s` : `Add ${num(SHORTEST - seconds)} s`}: with each scene's trim, speed or hold, or the intro and outro. 'appshots video plan' shows the scenes' lengths.`,
        );
      outputs.push({ ctx, jobs: planned, frames: total });
    }
  }

  const results = [];
  for (const output of outputs) results.push(await composeOne(output, { engine, music, name, draft, encoder }));
  if (draft) console.log("These are drafts: quick to make and good to look at, but 'appshots video push' does not take them. Compose without --draft for the App Store.");
  const failing = results.filter((result) => result.check.errors.some((/** @type {{ rule: string }} */ rule) => !(draft && isDraftRule(rule))));
  if (failing.length > 0)
    fail(`${failing.length} of ${results.length} preview${results.length === 1 ? " does" : "s do"} not pass Apple's specification: ${failing.map((result) => path.relative(process.cwd(), result.file)).join(", ")}. The errors are above, and in each one's .check.json.`);
  return results;
}
