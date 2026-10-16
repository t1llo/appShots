// Small stand-ins for the video modules that compose.mjs imports from the plan, recording, layers, inspection
// and Remotion parts of the CLI, for as long as those files are not in the tree. useDoubles() serves this file
// in place of any of them that is missing; one that is there is used as it is.
//
// They follow the signatures the parts share, and do no more than the compose tests need.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";

let hooked = false;

/**
 * Serves this file for a module of cli/src/video/ that is not there. Call it before compose.mjs is imported.
 */
export function useDoubles() {
  if (hooked) return;
  hooked = true;
  const self = import.meta.url;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (/** @type {any} */ (error)?.code !== "ERR_MODULE_NOT_FOUND" || !context.parentURL?.includes("/cli/src/video/")) throw error;
        return { url: self, shortCircuit: true };
      }
    },
  });
}

// --- cli/src/video/specs.mjs

export const PREVIEW_SPECS = {
  iphone: { portrait: [886, 1920], landscape: [1920, 886], record: "iphone-6.9" },
  "iphone-5.5": { portrait: [1080, 1920], landscape: [1920, 1080], record: "iphone-6.9" },
  "iphone-4.7": { portrait: [750, 1334], landscape: [1334, 750], record: "iphone-6.9" },
  ipad: { portrait: [1200, 1600], landscape: [1600, 1200], record: "ipad-13" },
  "ipad-9.7": { portrait: [900, 1200], landscape: [1200, 900], record: "ipad-13" },
  mac: { portrait: null, landscape: [1920, 1080], record: "mac" },
};

/** @param {number} width @param {number} height */
export function displayForSize(width, height) {
  for (const [key, spec] of Object.entries(PREVIEW_SPECS)) for (const size of [spec.portrait, spec.landscape]) if (size && size[0] === width && size[1] === height) return key;
  return null;
}

/** @param {number} seconds */
export function timecode(seconds, fps = 30) {
  const frames = Math.round(seconds * fps);
  const pad = (/** @type {number} */ value) => String(value).padStart(2, "0");
  return `${pad(Math.floor(frames / (fps * 3600)))}:${pad(Math.floor(frames / (fps * 60)) % 60)}:${pad(Math.floor(frames / fps) % 60)}:${pad(frames % fps)}`;
}

// --- cli/src/video/ffmpeg.mjs

/** @param {string} name */
function locate(name) {
  const env = process.env[`APPSHOTS_${name.toUpperCase()}`];
  if (env) return env;
  for (const dir of [...(process.env.PATH ?? "").split(":"), "/opt/homebrew/bin", "/usr/local/bin"]) if (dir && existsSync(path.join(dir, name))) return path.join(dir, name);
  return null;
}

/** A real ffmpeg, when there is one. */
export function hasFfmpeg() {
  return Boolean(locate("ffmpeg") && locate("ffprobe"));
}

export async function findFfmpeg() {
  const ffmpeg = locate("ffmpeg");
  const ffprobe = locate("ffprobe");
  if (!ffmpeg || !ffprobe) throw new Error("No ffmpeg on this Mac.");
  const text = (/** @type {string[]} */ args) => execFileSync(ffmpeg, ["-hide_banner", ...args], { encoding: "utf8" });
  const version = /ffmpeg version (\S+)/.exec(text(["-version"]))?.[1] ?? "unknown";
  const names = (/** @type {string} */ list) => new Set([...list.matchAll(/^ [A-Z.]{6} (\S+)/gm)].map((match) => match[1]));
  return { ffmpeg, ffprobe, version, encoders: names(text(["-encoders"])), filters: new Set([...text(["-filters"]).matchAll(/^ [A-Z.|]{2,3} (\S+)/gm)].map((match) => match[1])) };
}

// --- cli/src/video/probe.mjs, check.mjs, poster.mjs, sheet.mjs

/** @param {string} file @param {{ ffprobe: string }} tools */
export async function probe(file, tools) {
  const entries =
    "format=duration,size,bit_rate:stream=codec_type,codec_name,profile,level,pix_fmt,width,height,sample_aspect_ratio,r_frame_rate,avg_frame_rate,field_order,nb_read_frames,channels,sample_rate,color_primaries,color_transfer,color_space:stream_disposition=default";
  return JSON.parse(execFileSync(tools.ffprobe, ["-v", "error", "-count_frames", "-show_entries", entries, "-of", "json", file], { encoding: "utf8" }));
}

/**
 * The main rules of Apple's specification, enough to tell a good preview from a broken one.
 * @param {any} probed
 * @param {string} display
 * @param {{ draft?: boolean }} [options]
 */
export function checkProbe(probed, display, { draft = false } = {}) {
  /** @type {Array<{ rule: string, value: unknown, expected: unknown }>} */
  const errors = [];
  /** @type {Array<{ rule: string, value: unknown, expected: unknown }>} */
  const warnings = [];
  const error = (/** @type {string} */ rule, /** @type {unknown} */ value, /** @type {unknown} */ expected) => errors.push({ rule, value, expected });
  const streams = probed.streams ?? [];
  const videos = streams.filter((/** @type {any} */ stream) => stream.codec_type === "video");
  const audio = streams.find((/** @type {any} */ stream) => stream.codec_type === "audio");
  const duration = Number(probed.format?.duration);
  if (videos.length !== 1) error("video streams", videos.length, 1);
  const video = videos[0] ?? {};
  if (video.codec_name !== "h264") error("codec", video.codec_name, "h264");
  if (!["High", "Main", "Baseline", "Constrained Baseline"].includes(video.profile)) error("profile", video.profile, "High");
  if (!(video.level <= 40)) error("level", video.level, "40 or less");
  if (video.pix_fmt !== "yuv420p") error("pixel format", video.pix_fmt, "yuv420p");
  const spec = /** @type {any} */ (PREVIEW_SPECS)[display];
  const sizes = [spec?.portrait, spec?.landscape].filter(Boolean).map((size) => size.join("x"));
  if (!sizes.includes(`${video.width}x${video.height}`)) error("size", `${video.width}x${video.height}`, sizes.join(" or "));
  if (video.sample_aspect_ratio && !["1:1", "N/A", "0:1"].includes(video.sample_aspect_ratio)) error("sample aspect ratio", video.sample_aspect_ratio, "1:1");
  if (video.r_frame_rate !== "30/1") error("frame rate", video.r_frame_rate, "30/1");
  if (video.avg_frame_rate !== "30/1") error("average frame rate", video.avg_frame_rate, "30/1");
  if (Math.abs(Number(video.nb_read_frames) - Math.round(duration * 30)) > 1) error("frames", video.nb_read_frames, Math.round(duration * 30));
  if (!audio) error("audio", "none", "AAC stereo");
  else {
    if (audio.codec_name !== "aac") error("audio codec", audio.codec_name, "aac");
    if (audio.channels !== 2) error("audio channels", audio.channels, 2);
    if (!["44100", "48000"].includes(String(audio.sample_rate))) error("audio sample rate", audio.sample_rate, "48000");
  }
  if (!(duration >= 15 && duration <= 30)) error("duration", duration, "15 to 30 s");
  if (Number(probed.format?.size) > 524288000) error("file size", probed.format.size, "500 MB at most");
  if (draft) error("draft", "a draft", "a full encode");
  const rate = Number(probed.format?.bit_rate) / 1e6;
  if (!draft && !(rate >= 8 && rate <= 14)) warnings.push({ rule: "bitrate", value: `${rate.toFixed(1)} Mbps`, expected: "8 to 14 Mbps" });
  if (video.color_primaries !== "bt709" || video.color_transfer !== "bt709" || video.color_space !== "bt709") warnings.push({ rule: "colour tags", value: video.color_primaries, expected: "bt709" });
  return { errors, warnings };
}

/**
 * The warnings of how a preview is cut, which the file alone does not show.
 * @param {{ intro?: number, outro?: number, firstApp?: number, captionStyle?: string, layers?: any, locale?: string, previews?: number }} [cut]
 */
export function checkCut({ intro = 0, outro = 0, firstApp, captionStyle, layers, locale, previews } = {}) {
  /** @type {Array<{ rule: string, value: unknown, expected: string }>} */
  const warnings = [];
  if (intro + outro > 4) warnings.push({ rule: "cards", value: `${(intro + outro).toFixed(2)} s`, expected: "4 s or less for the intro and outro together" });
  if (firstApp !== undefined && firstApp > 2) warnings.push({ rule: "first-app-frame", value: `${firstApp.toFixed(2)} s`, expected: "the app within the first 2 s" });
  if (captionStyle === "band") warnings.push({ rule: "caption-style", value: "band", expected: "panel or shadow" });
  for (const layer of layers?.layers ?? []) {
    if (layer.kind !== "caption" || (locale !== undefined && layer.locale !== locale)) continue;
    if (typeof layer.fit === "number" && layer.fit < 0.7) warnings.push({ rule: "caption-fit", value: `${layer.id}: shrunk to ${Math.round(layer.fit * 100)} %`, expected: "70 % of the size or more" });
    if (layer.fallback) warnings.push({ rule: "caption-fallback", value: `${layer.id}: another language's text`, expected: `a caption in ${locale}` });
  }
  if (previews !== undefined && previews > 3) warnings.push({ rule: "previews", value: previews, expected: "at most 3 previews for one display and language" });
  return warnings;
}

/** @param {string} folder */
export function previewsIn(folder) {
  return existsSync(folder) ? readdirSync(folder).filter((name) => /\.(mp4|mov|m4v)$/i.test(name)).length : 0;
}

/** @param {string} file */
export const checkFileOf = (file) => `${file.replace(/\.(mp4|mov|m4v)$/i, "")}.check.json`;

/**
 * The record beside a preview, or null when there is none or it is of another file of that name.
 * @param {string} file
 */
export function readCheckRecord(file) {
  try {
    const record = JSON.parse(readFileSync(checkFileOf(file), "utf8"));
    return record?.version === 1 && record.bytes === statSync(file).size ? record : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} file
 * @param {Record<string, unknown>} record
 */
export function writeCheckRecord(file, record) {
  const whole = { version: 1, file: path.basename(file), bytes: statSync(file).size, ...record, checkedAt: new Date().toISOString() };
  writeFileSync(checkFileOf(file), `${JSON.stringify(whole, null, 2)}\n`);
  return whole;
}

/** @param {string} file @param {number} seconds @param {string} out @param {{ ffmpeg: string }} tools */
export async function posterFrame(file, seconds, out, tools) {
  execFileSync(tools.ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", file, "-ss", seconds.toFixed(3), "-frames:v", "1", out]);
}

export async function contactSheet() {
  throw new Error("The compose tests make no contact sheet.");
}

// --- cli/src/video/plan.mjs

/** @param {string} file */
export function readPlan(file) {
  const plan = JSON.parse(readFileSync(file, "utf8"));
  return { name: "preview", orientation: "portrait", transition: { type: "fade", seconds: 0.4 }, ...plan };
}

/** @param {unknown} plan */
export function planHash(plan) {
  return JSON.stringify(plan).length.toString(16).padStart(8, "0");
}

/**
 * @param {number[]} durations
 * @param {{ type?: string, seconds?: number }} [transition]
 */
export function joinOffsets(durations, transition = {}) {
  const overlap = transition.type === "none" ? 0 : (transition.seconds ?? 0.4);
  /** @type {number[]} */
  const offsets = [];
  let end = 0;
  durations.forEach((seconds, at) => {
    end += seconds;
    if (at < durations.length - 1) offsets.push(end - (at + 1) * overlap);
  });
  return { offsets, total: end - (durations.length - 1) * overlap };
}

/** @param {{ id: string } | string} scene */
export const captionLayerId = (scene) => `caption-${typeof scene === "string" ? scene : scene.id}`;

// --- cli/src/video/record/index.mjs

export async function recordScenes() {
  throw new Error("The compose tests record nothing.");
}

/**
 * The display a display's footage is recorded under: the older iPhone and iPad sizes use the current one's.
 * @param {string} display
 */
export const footageDisplay = (display) => (display.startsWith("iphone") ? "iphone" : display.startsWith("ipad") ? "ipad" : display);

/**
 * A scene's sidecar with `file`, its movie, from raw/<footage display>/<locale>/; a language that reuses another's
 * footage gets that one's under its own language. Null without a sidecar or a movie.
 * @param {string} root
 * @param {string} display
 * @param {string} locale
 * @param {string} scene
 */
export function readSidecar(root, display, locale, scene) {
  const read = (/** @type {string} */ language) => {
    const folder = path.join(root, "raw", footageDisplay(display), language);
    const file = path.join(folder, `${scene}.json`);
    if (!existsSync(file)) return null;
    const sidecar = JSON.parse(readFileSync(file, "utf8"));
    if (sidecar.reuse) return sidecar;
    const movie = (existsSync(folder) ? readdirSync(folder) : []).find((name) => name.startsWith(`${scene}.`) && !name.endsWith(".json"));
    return movie ? { ...sidecar, file: path.join(folder, movie) } : null;
  };
  const own = read(locale);
  if (!own?.reuse) return own;
  const used = read(own.reuse);
  return used && !used.reuse ? { ...used, locale, reuse: own.reuse } : null;
}

// --- cli/src/video/layers.mjs

export async function fetchLayers() {
  throw new Error("The compose tests hand compose its layers through setParts.");
}

// --- cli/src/video/remotion.mjs

export async function scaffoldRemotion() {
  throw new Error("The compose tests scaffold no Remotion project.");
}

export async function composeRemotion() {
  throw new Error("The compose tests hand compose a Remotion render through setParts.");
}
