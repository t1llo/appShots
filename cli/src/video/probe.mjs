import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { fail } from "../fail.mjs";
import { run } from "../proc.mjs";
import { toolEnv } from "./ffmpeg.mjs";

/**
 * @typedef {object} Stream What ffprobe says of one stream, as it says it: numbers that are strings stay strings.
 * @property {"video" | "audio" | "subtitle" | "data" | "attachment"} codec_type
 * @property {string} [codec_name]
 * @property {string} [profile]
 * @property {number} [level]
 * @property {string} [pix_fmt]
 * @property {number} [width]
 * @property {number} [height]
 * @property {string} [sample_aspect_ratio]
 * @property {string} [r_frame_rate]
 * @property {string} [avg_frame_rate]
 * @property {string} [field_order]
 * @property {string} [nb_read_frames]
 * @property {number} [channels]
 * @property {string} [sample_rate]
 * @property {string} [color_primaries]
 * @property {string} [color_transfer]
 * @property {string} [color_space]
 * @property {string} [duration]
 * @property {string} [bit_rate]
 * @property {{ default?: number, attached_pic?: number }} [disposition]
 * @property {{ rotate?: string }} [tags]
 * @property {Array<{ rotation?: number }>} [side_data_list]
 *
 * @typedef {object} Probe
 * @property {Stream[]} streams
 * @property {{ duration?: string, size?: string, bit_rate?: string, format_name?: string }} format
 * @property {string[]} [boxes] The top-level boxes of an MP4 or QuickTime file, in the order they are in the file.
 *   Not ffprobe's: it does not say where the index is. Left out for any other kind of file.
 */

/**
 * What the check reads, and nothing more: -count_frames decodes the whole video to count what is really there,
 * which is what Apple counts too, and costs about a second for a preview. Rotation is asked for so that a
 * recording a phone stored sideways is measured the way it plays.
 */
export const PROBE_ENTRIES = [
  "format=duration,size,bit_rate,format_name",
  "stream=codec_type,codec_name,profile,level,pix_fmt,width,height,sample_aspect_ratio,r_frame_rate,avg_frame_rate,field_order,nb_read_frames,channels,sample_rate,color_primaries,color_transfer,color_space,duration,bit_rate",
  "stream_disposition=default,attached_pic",
  "stream_tags=rotate",
  "stream_side_data=rotation",
].join(":");

/**
 * The top-level boxes of an MP4 or QuickTime file, by reading each box's header and stepping over its body. A
 * preview made for streaming has its index ("moov") before the media ("mdat"), so it starts playing before it
 * has loaded. An empty list for a file that is not made of boxes.
 * @param {string} file
 */
export function topBoxes(file) {
  const size = statSync(file).size;
  const head = Buffer.alloc(16);
  const boxes = [];
  const fd = openSync(file, "r");
  try {
    for (let at = 0; at + 8 <= size && boxes.length < 64; ) {
      const read = readSync(fd, head, 0, 16, at);
      if (read < 8) break;
      const type = head.toString("latin1", 4, 8);
      if (!/^[\x20-\x7e]{4}$/.test(type)) return [];
      let length = head.readUInt32BE(0);
      if (length === 1) {
        if (read < 16) break;
        length = Number(head.readBigUInt64BE(8));
      } else if (length === 0) {
        length = size - at;
      }
      if (length < 8) return [];
      boxes.push(type);
      at += length;
    }
  } finally {
    closeSync(fd);
  }
  return ["ftyp", "moov", "mdat", "wide", "free"].includes(boxes[0] ?? "") ? boxes : [];
}

/**
 * Asks ffprobe about a video file: its streams, their codecs, sizes, frame rates and counted frames, and the
 * file's length and size. Fails, naming the file, when it is not there or ffprobe cannot read it.
 * @param {string} file
 * @param {import("./ffmpeg.mjs").Tools} tools
 * @param {{ count?: boolean }} [options] count: false skips counting frames, for a quick look at a recording.
 * @returns {Promise<Probe>}
 */
export async function probe(file, tools, { count = true } = {}) {
  if (!existsSync(file) || !statSync(file).isFile()) fail(`There is no video at ${file}.`);
  const args = ["-v", "error", ...(count ? ["-count_frames"] : []), "-show_entries", PROBE_ENTRIES, "-of", "json", file];
  // Counting decodes every frame, and a long raw recording takes longer than the usual half a minute for that.
  const result = await run(tools.ffprobe, args, { env: toolEnv(tools), timeout: 300000 });
  const said = (result.stderr || result.error?.message || "").trim().split("\n").pop();
  if (result.status !== 0) fail(`ffprobe cannot read ${file}${said ? `: ${said}` : ""}. Is it a video?`);
  /** @type {Probe} */
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    fail(`ffprobe's answer about ${file} is not JSON. Run 'ffprobe ${file}' to see what it says.`);
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const boxes = topBoxes(file);
  return { ...parsed, streams, format: parsed.format ?? {}, ...(boxes.length > 0 ? { boxes } : {}) };
}

/**
 * The video streams of a file, without a cover picture stored as a stream.
 * @param {Probe} probe
 */
export const videoStreams = (probe) => probe.streams.filter((stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic);

/** @param {Probe} probe */
export const audioStreams = (probe) => probe.streams.filter((stream) => stream.codec_type === "audio");

/**
 * A rate ffprobe gives as a fraction, such as "30000/1001", as a number. Null for "0/0" or nothing.
 * @param {string | undefined} rate
 */
export function rateOf(rate) {
  const [top, bottom] = (rate ?? "").split("/").map(Number);
  if (!Number.isFinite(top) || !bottom) return null;
  return top / bottom;
}

/**
 * A number ffprobe gives as a string, or null for "N/A" and nothing.
 * @param {string | number | undefined} value
 */
export function numberOf(value) {
  if (value === undefined || value === "" || value === "N/A") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * How far a video is turned when it plays, in degrees: 0, 90, 180 or 270. A phone often stores a landscape
 * recording as portrait pixels with this beside them.
 * @param {Stream} stream
 */
export function rotationOf(stream) {
  const turned = stream.side_data_list?.find((data) => typeof data.rotation === "number")?.rotation ?? Number(stream.tags?.rotate ?? 0);
  return ((Math.round(turned / 90) * 90) % 360 + 360) % 360;
}

/**
 * The size a video plays at: its pixels, turned as its rotation says.
 * @param {Stream} stream
 * @returns {[number, number]}
 */
export function playedSize(stream) {
  const size = /** @type {[number, number]} */ ([stream.width ?? 0, stream.height ?? 0]);
  return rotationOf(stream) % 180 === 90 ? [size[1], size[0]] : size;
}

/**
 * The length of a file in seconds: the container's, else the longest stream's. Null when nothing says.
 * @param {Probe} probe
 */
export function durationOf(probe) {
  const own = numberOf(probe.format.duration);
  if (own !== null) return own;
  const streams = probe.streams.map((stream) => numberOf(stream.duration)).filter((value) => value !== null);
  return streams.length > 0 ? Math.max(...streams) : null;
}
