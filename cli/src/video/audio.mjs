// The sound of a preview. Apple's processing expects an audio track, and previews play muted at first, so every
// preview carries a stereo track: silence, or the user's own licensed music, cut to the preview's length and
// faded at both ends. appShots ships no music and records no app audio.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fail } from "../fail.mjs";
import { limit, num } from "./normalise.mjs";

/** The format of the track Apple takes: 48 kHz stereo. */
const STEREO = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

/** Seconds the music takes to come up at the start. */
export const FADE_IN = 0.3;

/**
 * @typedef {object} Music The plan's music, resolved.
 * @property {string} file An absolute path.
 * @property {number} volume 0 to 1.
 * @property {number} start Seconds into the file the preview's music starts.
 * @property {number} fadeOut Seconds it fades out over at the end.
 *
 * @typedef {object} Audio How a command line gets its sound: the input it adds, and the filter that turns input
 * number `input` into the stream [a].
 * @property {string[]} input
 * @property {(input: number) => string} chain
 */

/**
 * The plan's music with its defaults, the file found next to the plan. Null for a silent preview.
 * @param {{ music?: { file: string, volume?: number, start?: number, fadeOut?: number } }} plan
 * @param {string} base The plan's folder.
 * @returns {Music | null}
 */
export function musicOf(plan, base) {
  const music = plan.music;
  if (!music) return null;
  if (typeof music.file !== "string" || music.file === "") fail("music.file in the plan needs the path of an audio file, such as music/theme.m4a.");
  const file = path.resolve(base, music.file);
  if (!existsSync(file) || !statSync(file).isFile()) fail(`The music file ${music.file} is not there (looked at ${file}). Put the file there, or take "music" out of the plan for a silent preview.`);
  const volume = music.volume ?? 0.8;
  const start = music.start ?? 0;
  const fadeOut = music.fadeOut ?? 1.5;
  if (!(volume >= 0 && volume <= 1)) fail(`music.volume is ${volume}; it goes from 0 to 1.`);
  if (!(start >= 0)) fail(`music.start is ${start}; it is seconds into the file, 0 or more.`);
  if (!(fadeOut >= 0 && fadeOut <= 10)) fail(`music.fadeOut is ${fadeOut}; it is seconds, from 0 to 10.`);
  return { file, volume, start, fadeOut };
}

/**
 * The audio of a preview `frames` frames long: silence, or the music looped or cut to that length.
 *
 * The music is brought to -16 LUFS first and faded last: loudness normalisation follows the level as it goes, and
 * after the fades it would bring a fading end back up.
 * @param {Music | null} music
 * @param {number} frames
 * @returns {Audio}
 */
export function previewAudio(music, frames) {
  const seconds = limit(frames);
  if (!music) return { input: ["-f", "lavfi", "-t", seconds, "-i", "anullsrc=r=48000:cl=stereo"], chain: (input) => `[${input}:a]${STEREO}[a]` };
  const length = frames / 30;
  const fadeOut = Math.min(music.fadeOut, length / 2);
  const chain = [
    `atrim=start=${num(music.start)}:duration=${seconds}`,
    "asetpts=PTS-STARTPTS",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    "aresample=48000",
    `volume=${num(music.volume)}`,
    `afade=t=in:st=0:d=${FADE_IN}`,
    ...(fadeOut > 0 ? [`afade=t=out:st=${num(length - fadeOut)}:d=${num(fadeOut)}`] : []),
    STEREO,
  ];
  return {
    // Looped as often as it takes; -t still bounds the input, which keeps ffmpeg from waiting on a stream without end.
    input: ["-stream_loop", "-1", "-t", (Math.floor((music.start + length) * 1e6) / 1e6 + 1).toFixed(6), "-i", music.file],
    chain: (input) => `[${input}:a:0]${chain.join(",")}[a]`,
  };
}

/**
 * The audio a file already has, padded with silence and cut to `frames` frames: for the last pass over a preview
 * made by Remotion, which mixed the music itself.
 * @param {number} frames
 * @returns {Audio}
 */
export function keptAudio(frames) {
  const seconds = limit(frames);
  return { input: [], chain: () => `[0:a:0]aresample=48000,${STEREO},apad=whole_dur=${seconds},atrim=duration=${seconds}[a]` };
}
