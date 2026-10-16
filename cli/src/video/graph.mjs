// The ffmpeg command lines of a preview, as argument lists: one segment per scene and per card (stage 1), then
// the join with its transitions, the audio and the encode to Apple's specification (stage 2). Pure: nothing
// here reads a file or runs a program, so every line can be tested as text.
//
// The graphs keep to what made ffmpeg finish every time in the research runs: no split, no -shortest, every
// looped picture with its own -t, and the length of each output set exactly with -t.

import { FPS, MAX_TOUCHES, RETAG, escapeExpr, footageChain, frameTime, limit, num } from "./normalise.mjs";

/**
 * Layers arrive as RGB PNGs. Left to itself, ffmpeg would turn them into YUV with BT.601's matrix, and the plate
 * and the captions would come out a shade off in a file tagged BT.709.
 */
const TO_YUV = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p";
const TO_YUVA = "scale=out_color_matrix=bt709:out_range=tv,format=yuva420p";

/** Seconds a caption, or a card's logo or text, takes to fade in. */
export const FADE = 0.35;

/** Seconds a touch ring stays on the screen. */
export const RING = 0.35;

/** What every segment and the preview end with: tagged BT.709 again, after the layers, in 4:2:0. */
const FINISH = `${RETAG},format=yuv420p`;

/**
 * A picture as a stream of `frames` frames, 30 a second.
 * @param {string} file
 * @param {number} frames
 */
export const stillInput = (file, frames) => ["-loop", "1", "-framerate", String(FPS), "-t", limit(frames), "-i", file];

/**
 * Black at the canvas size, for a card or a plate the layers did not bring.
 * @param {[number, number]} size
 * @param {number} frames
 */
export const blankInput = ([width, height], frames) => ["-f", "lavfi", "-t", limit(frames), "-i", `color=c=black:s=${width}x${height}:r=${FPS}`];

/**
 * A transparent layer that fades in at `at` seconds.
 * @param {string} input
 * @param {number} at
 * @param {string} label
 */
const fadingLayer = (input, at, label) => `[${input}]format=rgba,fade=t=in:st=${num(at)}:d=${FADE}:alpha=1,${TO_YUVA}[${label}]`;

/**
 * The overlay that shows the touch ring at each touch for a moment. One ring input serves every touch: its place
 * follows the clock through nested ifs, and `enable` shows it only around the touches, which needs no split.
 * @param {Array<{ t: number, x: number, y: number }>} touches Seconds into the segment and pixels of the canvas.
 */
export function touchOverlay(touches) {
  const points = [...touches].sort((a, b) => a.t - b.t).slice(0, MAX_TOUCHES);
  const follow = (/** @type {"x" | "y"} */ axis) =>
    points.reduceRight((rest, point, at) => (at === points.length - 1 ? num(point[axis]) : `if(lt(t,${num(points[at + 1].t)}),${num(point[axis])},${rest})`), "");
  const enable = points.map((point) => `between(t,${num(point.t)},${num(point.t + RING)})`).join("+");
  return `overlay=x=${escapeExpr(`${follow("x")}-w/2`)}:y=${escapeExpr(`${follow("y")}-h/2`)}:enable=${escapeExpr(enable)}:eval=frame`;
}

/**
 * The encode of a segment: near lossless, since stage 2 encodes it once more.
 * @param {{ encoder: string, draft?: boolean }} options
 */
export function segmentCodec({ encoder, draft = false }) {
  const video =
    encoder === "libx264" ? ["-c:v", "libx264", "-preset", draft ? "ultrafast" : "medium", "-crf", draft ? "18" : "12"] : ["-c:v", "h264_videotoolbox", "-b:v", draft ? "20M" : "40M"];
  return [...video, "-pix_fmt", "yuv420p", "-r", String(FPS), "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-an"];
}

/**
 * The encode of the preview, to Apple's specification: H.264 High at level 4.0, constant 30 frames a second and
 * about 11 Mbps, BT.709, AAC stereo at 48 kHz, the index at the front. A draft is quick and small instead, and
 * says so in its metadata.
 * @param {{ encoder: string, draft?: boolean }} options
 */
export function finalCodec({ encoder, draft = false }) {
  const common = ["-profile:v", "high", "-level:v", "4.0", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS)];
  const video = draft
    ? encoder === "libx264"
      ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", ...common]
      : ["-c:v", "h264_videotoolbox", "-b:v", "4M", ...common]
    : encoder === "libx264"
      ? ["-c:v", "libx264", "-preset", "slow", ...common, "-b:v", "11M", "-minrate", "11M", "-maxrate", "11M", "-bufsize", "22M", "-x264-params", "nal-hrd=cbr:force-cfr=1"]
      : ["-c:v", "h264_videotoolbox", ...common, "-b:v", "11M", "-maxrate", "11M", "-bufsize", "22M"];
  return [
    ...video,
    ...["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"],
    ...["-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", "-disposition:a:0", "default"],
    ...["-movflags", "+faststart", "-map_metadata", "-1"],
    ...(draft ? ["-metadata", "comment=appshots draft"] : []),
  ];
}

/**
 * Stage 1 for a scene: the recording normalised and placed on the canvas, the caption fading in over it, the
 * touch rings, cut to `frames` frames. The output file goes after these arguments.
 * @param {object} job
 * @param {string} job.footage The recording.
 * @param {import("./normalise.mjs").Sidecar} job.sidecar
 * @param {import("./normalise.mjs").Window} job.window
 * @param {"clock" | "cclock" | null} job.turn
 * @param {[number, number]} job.size The canvas.
 * @param {import("./normalise.mjs").Placement} job.place
 * @param {number} job.frames The segment's length.
 * @param {string | null} [job.plate] The background a window on a plate lies on; black without one.
 * @param {string | null} [job.caption] The caption layer.
 * @param {number} [job.captionAt] Seconds into the segment the caption starts to fade in.
 * @param {string | null} [job.ring] The touch ring layer.
 * @param {Array<{ t: number, x: number, y: number }>} [job.touches]
 * @param {string[]} job.codec
 */
export function sceneArgs({ footage, sidecar, window, turn, size, place, frames, plate = null, caption = null, captionAt = 0, ring = null, touches = [], codec }) {
  const inputs = ["-i", footage];
  const graph = [];
  let count = 1;
  const add = (/** @type {string[]} */ args) => {
    inputs.push(...args);
    return count++;
  };
  graph.push(`[0:v]${footageChain({ sidecar, window, turn, size, place, seconds: frames / FPS })}[footage]`);
  let base = "footage";
  if (place.kind === "plate") {
    const at = add(plate ? stillInput(plate, frames) : blankInput(size, frames));
    graph.push(`[${at}:v]${TO_YUV}[plate]`, `[plate][footage]overlay=x=${place.x}:y=${place.y}[placed]`);
    base = "placed";
  }
  if (caption) {
    const at = add(stillInput(caption, frames));
    graph.push(fadingLayer(`${at}:v`, captionAt, "caption"), `[${base}][caption]overlay=0:0[captioned]`);
    base = "captioned";
  }
  if (ring && touches.length > 0) {
    const at = add(stillInput(ring, frames));
    graph.push(`[${at}:v]format=rgba,${TO_YUVA}[ring]`, `[${base}][ring]${touchOverlay(touches)}[touched]`);
    base = "touched";
  }
  graph.push(`[${base}]${FINISH}[v]`);
  return [...inputs, "-filter_complex", graph.join(";"), "-map", "[v]", ...codec, "-t", limit(frames)];
}

/**
 * Stage 1 for the intro or the outro card: the plate, the logo fading in, then the text.
 * @param {object} job
 * @param {[number, number]} job.size
 * @param {number} job.frames
 * @param {string | null} job.plate
 * @param {string | null} job.logo
 * @param {string | null} job.text
 * @param {number} [job.at] Seconds into the card the logo starts to fade in; the text follows a fade later.
 * @param {string[]} job.codec
 */
export function cardArgs({ size, frames, plate, logo, text, at = 0, codec }) {
  const inputs = plate ? stillInput(plate, frames) : blankInput(size, frames);
  const graph = [`[0:v]${TO_YUV}[card]`];
  let base = "card";
  let count = 1;
  for (const [file, label, start] of /** @type {Array<[string | null, string, number]>} */ ([[logo, "logo", at], [text, "text", at + FADE]])) {
    if (!file) continue;
    inputs.push(...stillInput(file, frames));
    graph.push(fadingLayer(`${count++}:v`, start, label), `[${base}][${label}]overlay=0:0[with${label}]`);
    base = `with${label}`;
  }
  graph.push(`[${base}]${FINISH}[v]`);
  return [...inputs, "-filter_complex", graph.join(";"), "-map", "[v]", ...codec, "-t", limit(frames)];
}

/**
 * Where each join starts, in frames of the preview, and how long the preview is. The k-th join starts where the
 * segments before it end, less the k transitions that overlap them.
 * @param {number[]} lengths The segments' lengths in frames.
 * @param {number} overlap The transition's length in frames.
 */
export function joinPoints(lengths, overlap) {
  /** @type {number[]} */
  const offsets = [];
  let end = 0;
  lengths.forEach((frames, at) => {
    end += frames;
    if (at < lengths.length - 1) offsets.push(end - (at + 1) * overlap);
  });
  return { offsets, total: end - (lengths.length - 1) * overlap };
}

/**
 * Stage 2: the segments joined with their transitions, the audio, and the encode of the preview, cut to its
 * exact length.
 * @param {object} job
 * @param {string[]} job.segments The segments' files, in order.
 * @param {number[]} job.lengths Their lengths in frames.
 * @param {{ type: string, frames: number }} job.transition "fade", "dissolve" or "none", and its length.
 * @param {{ input: string[], chain: (input: number) => string }} job.audio
 * @param {string[]} job.codec
 */
export function joinArgs({ segments, lengths, transition, audio, codec }) {
  const overlap = transition.type === "none" ? 0 : transition.frames;
  const { offsets, total } = joinPoints(lengths, overlap);
  const inputs = segments.flatMap((file) => ["-i", file]);
  // Each segment on the same clock and rate, which both the transitions and concat insist on.
  const graph = segments.map((_, at) => `[${at}:v]settb=AVTB,fps=${FPS},format=yuv420p,setsar=1[s${at}]`);
  let joined = "s0";
  if (segments.length > 1 && overlap === 0) {
    graph.push(`${segments.map((_, at) => `[s${at}]`).join("")}concat=n=${segments.length}:v=1:a=0[joined]`);
    joined = "joined";
  } else {
    offsets.forEach((offset, at) => {
      graph.push(`[${joined}][s${at + 1}]xfade=transition=${transition.type}:duration=${frameTime(overlap)}:offset=${frameTime(offset)}[x${at + 1}]`);
      joined = `x${at + 1}`;
    });
  }
  graph.push(`[${joined}]${FINISH}[v]`, audio.chain(segments.length));
  return [...inputs, ...audio.input, "-filter_complex", graph.join(";"), "-map", "[v]", "-map", "[a]", ...codec, "-t", limit(total)];
}

/**
 * The last pass over a preview made elsewhere, by Remotion: the same encode as stage 2, cut to the same length.
 * A file a frame short is filled with its last frame, so the length is never less than the plan's.
 * @param {object} job
 * @param {string} job.file
 * @param {number} job.frames
 * @param {{ input: string[], chain: (input: number) => string }} job.audio
 * @param {string[]} job.codec
 */
export function passArgs({ file, frames, audio, codec }) {
  const graph = [`[0:v]settb=AVTB,fps=${FPS},tpad=stop_mode=clone:stop_duration=1,setsar=1,${FINISH}[v]`, audio.chain(1)];
  return ["-i", file, ...audio.input, "-filter_complex", graph.join(";"), "-map", "[v]", "-map", "[a]", ...codec, "-t", limit(frames)];
}
