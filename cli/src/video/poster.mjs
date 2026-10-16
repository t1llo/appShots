import { renameSync, rmSync } from "node:fs";
import { fail } from "../fail.mjs";
import { run } from "../proc.mjs";
import { checkProbe, readCheckRecord, writeCheckRecord } from "./check.mjs";
import { toolEnv } from "./ffmpeg.mjs";
import { durationOf, probe } from "./probe.mjs";
import { frameAt, timecode } from "./timecode.mjs";

const FPS = 30;
/** How long a caption takes to come in after its scene starts: 0.1 s after the transition, then a 0.35 s fade. */
const CAPTION_IN = 0.1 + 0.35;
/** How long the poster waits after that, so the caption is there in full and the app has settled. */
const AFTER_CAPTION = 1;

/**
 * Where a preview's poster is kept: <name>.poster.png beside <name>.mp4.
 * @param {string} file
 */
export const posterFileOf = (file) => `${file.replace(/\.(mp4|mov|m4v)$/i, "")}.poster.png`;

/**
 * @typedef {object} PlacedScene An app scene as it sits in the cut preview.
 * @property {string} id
 * @property {number} start Seconds into the preview where the scene begins, its incoming transition included.
 * @property {number} seconds How long it is.
 * @property {boolean} [caption] Whether it has a caption, which the default poster waits for.
 */

/**
 * The time of a preview's poster frame, on a frame. By default it is the first scene, a second after its caption
 * has come in: app UI with its caption, never the intro card. The plan can name a scene and a time into it, or a
 * time into the preview; a time chosen with 'video poster --at' wins over both.
 * @param {object} cut
 * @param {PlacedScene[]} cut.scenes The app scenes in order, without the intro and outro.
 * @param {number} cut.total The preview's length.
 * @param {number} [cut.transition] Seconds of the transition into a scene, 0 for a cut.
 * @param {{ scene: string, at?: number } | { time: number }} [cut.poster] The plan's choice.
 * @param {number} [cut.chosen] A time chosen with 'video poster --at'.
 * @returns {number}
 */
export function posterTime({ scenes, total, transition = 0, poster, chosen }) {
  const last = Math.max(0, (frameAt(total, FPS) - 1) / FPS);
  /** @param {number} seconds */
  const onFrame = (seconds) => Math.min(last, frameAt(Math.max(0, seconds), FPS) / FPS);
  if (chosen !== undefined) return onFrame(chosen);
  if (poster && "time" in poster) return onFrame(poster.time);
  const scene = poster && "scene" in poster ? scenes.find((each) => each.id === poster.scene) : scenes[0];
  if (!scene) {
    if (poster && "scene" in poster) fail(`poster.scene is "${poster.scene}", and the plan has no scene of that id. Its scenes are ${scenes.map((each) => each.id).join(", ")}.`);
    return 0;
  }
  const settled = (scene.caption ? transition + CAPTION_IN : transition) + AFTER_CAPTION;
  const into = poster && "scene" in poster && poster.at !== undefined ? poster.at : settled;
  // A time past the scene's end stays on its last frame, so the poster shows that scene and no other.
  const end = scene.start + scene.seconds - 1 / FPS;
  return onFrame(Math.min(scene.start + Math.max(0, into), end));
}

/**
 * Writes the frame at a time of a video as a PNG. The frame is the one nearest the time, as App Store Connect
 * counts it from the timecode: ffmpeg is asked for the first frame at or after the middle of the frame before it.
 * @param {string} file
 * @param {number} seconds
 * @param {string} out
 * @param {import("./ffmpeg.mjs").Tools} tools
 */
export async function posterFrame(file, seconds, out, tools) {
  const frame = frameAt(seconds, FPS);
  const from = frame === 0 ? 0 : (frame - 0.5) / FPS;
  const temporary = `${out}.${process.pid}.png`;
  const args = ["-nostdin", "-hide_banner", "-v", "error", "-y", "-i", file, "-ss", from.toFixed(6), "-map", "0:v:0", "-frames:v", "1", "-update", "1", temporary];
  const result = await run(tools.ffmpeg, args, { env: toolEnv(tools), timeout: 120000 });
  if (result.status !== 0) {
    rmSync(temporary, { force: true });
    const said = (result.stderr || result.error?.message || "").trim().split("\n").pop();
    fail(`ffmpeg did not take the frame at ${seconds.toFixed(2)} s of ${file}${said ? `: ${said}` : ""}.`);
  }
  try {
    renameSync(temporary, out);
  } catch {
    // ffmpeg finds no frame after the end of the video, writes nothing and still ends well.
    fail(`${file} has no frame at ${seconds.toFixed(2)} s.`);
  }
  return { file: out, seconds: frame / FPS, timecode: timecode(frame / FPS, FPS) };
}

/**
 * 'appshots video poster --at <s>': exports a preview's poster at another time and keeps that time in its check
 * record, where 'video push' reads it. A preview without a record is checked first, so the record has one.
 * @param {string} file
 * @param {number} seconds
 * @param {import("./ffmpeg.mjs").Tools} tools
 */
export async function choosePoster(file, seconds, tools) {
  if (!Number.isFinite(seconds) || seconds < 0) fail(`--at takes the seconds into the preview, such as --at 4.5.`);
  const probed = await probe(file, tools, { count: false });
  const length = durationOf(probed) ?? 0;
  if (seconds >= length) fail(`${file} is ${length.toFixed(2)} s long, so it has no frame at ${seconds} s.`);
  const poster = await posterFrame(file, seconds, posterFileOf(file), tools);
  const record = readCheckRecord(file);
  let kept;
  if (record) {
    const { version, file: name, bytes, checkedAt, ...rest } = record;
    kept = rest;
  } else {
    const counted = await probe(file, tools);
    const { display, errors, warnings } = checkProbe(counted, null, { file });
    kept = { display, draft: false, errors, warnings, probe: counted };
  }
  writeCheckRecord(file, { ...kept, poster: { seconds: poster.seconds, timecode: poster.timecode, chosen: true } });
  return poster;
}
