// How a recording becomes the picture of one scene: the colour tags put right, the time the recorder left out
// put back, turned, trimmed, sped up, and placed on the canvas of the preview. Everything here is arithmetic and
// filter text; nothing runs.

import { fail } from "../fail.mjs";

/** The frame rate of every segment and of the preview. Apple takes 30 at most, and the check wants exactly 30. */
export const FPS = 30;

/**
 * Seconds as whole frames. Every length is kept in frames, so the joins land on frames and the parts add up to
 * the whole.
 * @param {number} seconds
 */
export const toFrames = (seconds) => Math.round(seconds * FPS);

/**
 * The value for -t that keeps exactly `frames` frames. ffmpeg keeps a frame while its time is under the limit,
 * so the limit is rounded down to the microsecond ffmpeg counts in: rounded up, it could let one frame more in.
 * @param {number} frames
 */
export const limit = (frames) => (Math.floor((frames / FPS) * 1e6) / 1e6).toFixed(6);

/**
 * The time of a frame, for a filter that starts something on it, such as a join. ffmpeg rounds it to the nearest
 * frame, so six places are exact enough.
 * @param {number} frames
 */
export const frameTime = (frames) => (frames / FPS).toFixed(6);

/**
 * A number for a filter: short, and never in the exponent notation that ffmpeg does not read.
 * @param {number} value
 */
export const num = (value) => String(Math.round(value * 1000) / 1000);

/** @param {number} value The nearest even number at or under `value`; H.264 in 4:2:0 needs even sizes. */
export const even = (value) => 2 * Math.floor(value / 2);

/**
 * Commas inside an expression would end the filter in a filter graph, so they are escaped.
 * @param {string} expression
 */
export const escapeExpr = (expression) => expression.replace(/,/g, "\\,");

/** Tags the footage as BT.709 without converting it: the simulator tags sRGB values as Display P3. */
export const RETAG = "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709";

/** At most this many touches are drawn in one scene; more would only clutter it, and lengthen the filter. */
export const MAX_TOUCHES = 12;

/**
 * @typedef {object} Sidecar What the recorder wrote beside a recording (see `record/`); only what is used here.
 * @property {string} [scene]
 * @property {string} [locale]
 * @property {string | null} [reuse] The locale whose recording this one stands for.
 * @property {string} [file] The movie it is about, as readSidecar finds it.
 * @property {string} [source] "sim", "device", "mac", "web" or "import".
 * @property {[number, number]} [size] The recording's pixels.
 * @property {"portrait" | "landscape"} [orientation] The orientation the plan asked for.
 * @property {number} [wall] Seconds the recording really took.
 * @property {boolean} [realtime] A web page recorded in real time instead of frame by frame.
 * @property {Array<[number, number, number]>} [touches] Seconds into the recording and pixels of it.
 * @property {[number, number]} [trim] The trim that "auto" resolved to.
 *
 * @typedef {object} Scene The part of a plan's scene that the picture depends on.
 * @property {string} id
 * @property {[number, number] | "auto"} [trim]
 * @property {number} [speed]
 * @property {number} [hold]
 * @property {boolean} [touches]
 *
 * @typedef {{ start: number, end: number, speed: number }} Window The part of the recording a scene shows.
 * @typedef {{ x: number, y: number, width: number, height: number }} Box
 * @typedef {{ kind: "cover", scale: number, x: number, y: number } | { kind: "plate", width: number, height: number, x: number, y: number }} Placement
 * @typedef {{ t: number, x: number, y: number }} Touch Seconds into the segment and pixels of the canvas.
 */

/**
 * The part of the recording a scene shows, in seconds of the recording: the plan's trim, the one "auto" resolved
 * to, or all of it.
 * @param {Scene} scene
 * @param {Sidecar} sidecar
 * @returns {Window}
 */
export function sceneWindow(scene, sidecar) {
  const wall = sidecar.wall;
  if (!(typeof wall === "number" && wall > 0)) fail(`The recording of scene "${scene.id}" says nothing of how long it is. Record it again: appshots video record --scene ${scene.id} --again`);
  const trim = Array.isArray(scene.trim) ? scene.trim : scene.trim === "auto" && Array.isArray(sidecar.trim) ? sidecar.trim : [0, wall];
  const start = Math.max(0, Math.min(trim[0], wall));
  const end = Math.min(trim[1], wall);
  if (!(end > start)) fail(`Scene "${scene.id}" is trimmed to nothing: ${trim[0]} to ${trim[1]} s of a recording ${num(wall)} s long.`);
  return { start, end, speed: scene.speed ?? 1 };
}

/**
 * A scene's length in frames: its window at its speed, and the hold on its last frame. Taken from the window
 * itself, so that the segment is always as long as the part of the recording it shows.
 * @param {Scene} scene
 * @param {Window} window
 */
export const sceneFrames = (scene, window) => toFrames((window.end - window.start) / window.speed + (scene.hold ?? 0));

/**
 * Whether the recorder left out time that has to be put back. The simulator and screencapture write a frame only
 * when the screen changes, so a still end is missing; a web page stepped frame by frame and an imported file
 * already run at their own length.
 * @param {Sidecar} sidecar
 */
export const keepsWallClock = (sidecar) => sidecar.source !== "import" && !(sidecar.source === "web" && !sidecar.realtime);

/**
 * Which way the buffer has to be turned to stand as the plan wants: the simulator records an app in landscape
 * into a portrait buffer. Never for a Mac window.
 * @param {Sidecar} sidecar
 * @param {"portrait" | "landscape"} orientation
 * @param {boolean} mac
 * @returns {"clock" | "cclock" | null}
 */
export function turnOf(sidecar, orientation, mac) {
  if (mac || !sidecar.size) return null;
  const [width, height] = sidecar.size;
  if (orientation === "landscape" && height > width) return "clock";
  if (orientation === "portrait" && width > height) return "cclock";
  return null;
}

/**
 * How far the captions of one locale reach into the canvas: down from the top, and up from the bottom. A caption
 * the server drew without its box is taken to fill a fifth of the height.
 * @param {Array<{ kind: string, locale: string | null, box?: number[] }>} layers The manifest's layers.
 * @param {string} locale
 * @param {[number, number]} size
 */
export function captionBands(layers, locale, [, height]) {
  let top = 0;
  let bottom = 0;
  for (const layer of layers) {
    if (layer.kind !== "caption" || (layer.locale !== locale && layer.locale !== null)) continue;
    const [, y, , h] = Array.isArray(layer.box) && layer.box.length === 4 ? layer.box : [0, 0, 0, height / 5];
    if (y + h / 2 < height / 2) top = Math.max(top, y + h);
    else bottom = Math.max(bottom, height - y);
  }
  return { top, bottom };
}

/**
 * The box a Mac window is fitted into on the background plate: the canvas less a margin, and less the bands the
 * captions take at the top and the bottom. One box for every scene of a preview, so the window keeps its place.
 * @param {[number, number]} size
 * @param {{ top: number, bottom: number }} bands Pixels the captions reach down from the top and up from the bottom.
 * @returns {Box}
 */
export function plateBox([width, height], { top, bottom }) {
  const margin = Math.round(height * 0.04);
  const y = Math.min(Math.max(margin, top + margin), Math.round(height / 2));
  const end = Math.max(height - Math.max(margin, bottom + margin), Math.round(height / 2));
  return { x: margin, y, width: width - 2 * margin, height: end - y };
}

/**
 * How the footage lands on the canvas. An iPhone or iPad recording, and a Mac window with fit "fill", is scaled
 * until it covers the canvas and cut to it from the middle. A Mac window with fit "plate" is scaled into `box`,
 * kept to its shape, at even sizes, and laid on the plate in the middle of the box.
 * @param {[number, number]} size The canvas.
 * @param {[number, number]} footage The footage's size, after any turn.
 * @param {Box | null} box
 * @returns {Placement}
 */
export function placement([width, height], [fw, fh], box) {
  if (!box) {
    const scale = Math.max(width / fw, height / fh);
    return { kind: "cover", scale, x: Math.floor((fw * scale - width) / 2), y: Math.floor((fh * scale - height) / 2) };
  }
  const scale = Math.min(box.width / fw, box.height / fh);
  const w = even(fw * scale);
  const h = even(fh * scale);
  return { kind: "plate", width: w, height: h, x: box.x + Math.floor((box.width - w) / 2), y: box.y + Math.floor((box.height - h) / 2) };
}

/**
 * The filter chain that turns a recording into the scene's picture, from the recording's frames to frames at
 * the canvas size (or, on a plate, at the window's size), 30 a second, from the scene's first frame on. The last
 * frame is held for `seconds` more, which covers the scene's hold; -t cuts the segment to its length.
 * @param {object} options
 * @param {Sidecar} options.sidecar
 * @param {Window} options.window
 * @param {"clock" | "cclock" | null} options.turn
 * @param {[number, number]} options.size The canvas.
 * @param {Placement} options.place
 * @param {number} options.seconds The segment's length.
 */
export function footageChain({ sidecar, window, turn, size, place, seconds }) {
  const wall = /** @type {number} */ (sidecar.wall);
  const chain = [RETAG, "setpts=PTS-STARTPTS"];
  if (keepsWallClock(sidecar)) chain.push(`fps=${FPS}`, `tpad=stop_mode=clone:stop_duration=${num(wall)}`, `trim=duration=${num(wall)}`);
  if (turn) chain.push(`transpose=${turn}`);
  if (window.start > 0 || window.end < wall) chain.push(`trim=start=${num(window.start)}:end=${num(window.end)}`, "setpts=PTS-STARTPTS");
  if (window.speed !== 1) chain.push(`setpts=PTS/${num(window.speed)}`);
  chain.push(`fps=${FPS}`, `tpad=stop_mode=clone:stop_duration=${num(seconds)}`);
  if (place.kind === "cover") chain.push(`scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${size[0]}:${size[1]}`);
  else chain.push(`scale=${place.width}:${place.height}:flags=lanczos`);
  chain.push("setsar=1");
  return chain.join(",");
}

/**
 * Where the touches of a recording fall in the scene: seconds into the segment and pixels of the canvas, for
 * those inside the scene's window, at most 12.
 * @param {Sidecar} sidecar
 * @param {Window} window
 * @param {"clock" | "cclock" | null} turn
 * @param {Placement} place
 * @param {number} seconds The segment's length.
 * @returns {Touch[]}
 */
export function touchPoints(sidecar, window, turn, place, seconds) {
  const [width, height] = sidecar.size ?? [0, 0];
  /** @type {Touch[]} */
  const points = [];
  for (const [at, x0, y0] of [...(sidecar.touches ?? [])].sort((a, b) => a[0] - b[0])) {
    if (at < window.start || at > window.end) continue;
    const t = (at - window.start) / window.speed;
    if (t >= seconds) continue;
    // A turn of the buffer turns its points with it.
    const [x, y] = turn === "clock" ? [height - y0, x0] : turn === "cclock" ? [y0, width - x0] : [x0, y0];
    if (place.kind === "cover") points.push({ t, x: x * place.scale - place.x, y: y * place.scale - place.y });
    else {
      const [fw, fh] = turn ? [height, width] : [width, height];
      points.push({ t, x: place.x + (x * place.width) / fw, y: place.y + (y * place.height) / fh });
    }
    if (points.length === MAX_TOUCHES) break;
  }
  return points;
}
