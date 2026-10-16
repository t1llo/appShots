import { fail } from "../fail.mjs";

/**
 * The sizes App Store Connect takes an app preview at, per display, as Apple's specification gives them. A mirror
 * of src/domain/previews.ts, which the CLI cannot import; a test keeps the two equal.
 *
 * `record` is the device of the server's registry whose screen the footage is recorded on: the older iPhone and
 * iPad sizes are cut from the same footage as the current ones. `group` names the placement group of App Store
 * Connect's asset library a file is meant for. The upload matches the group from Apple's reference data when it
 * runs, so this only explains a dry run. The Mac takes landscape previews only.
 *
 * The current displays come first: the 5.5-inch iPhone's landscape size is also the Mac's, and a file of that
 * size is taken to be the Mac's.
 * @type {Record<string, { portrait: [number, number] | null, landscape: [number, number], record: string, group: string }>}
 */
export const PREVIEW_SPECS = {
  iphone: { portrait: [886, 1920], landscape: [1920, 886], record: "iphone-6.9", group: "the large Dynamic Island group" },
  ipad: { portrait: [1200, 1600], landscape: [1600, 1200], record: "ipad-13", group: "the 13-inch iPad group" },
  mac: { portrait: null, landscape: [1920, 1080], record: "mac", group: "the Mac group" },
  "iphone-5.5": { portrait: [1080, 1920], landscape: [1920, 1080], record: "iphone-6.9", group: "the 5.5-inch group" },
  "iphone-4.7": { portrait: [750, 1334], landscape: [1334, 750], record: "iphone-6.9", group: "the 4.7-inch group" },
  "ipad-9.7": { portrait: [900, 1200], landscape: [1200, 900], record: "ipad-13", group: "the 9.7-inch group" },
};

/** The displays a plan makes previews for unless it names the older ones. One iPhone file covers every current iPhone. */
export const CURRENT_DISPLAYS = ["iphone", "ipad", "mac"];

/**
 * What every preview has in common, whatever its display: H.264 up to High profile at level 4.0, 30 frames a
 * second, 15 to 30 seconds, at most 500 MB, and a stereo AAC track. The video bitrate Apple asks for is 10 to 12
 * Mbps; the check warns only outside 8 to 14, as a constant-bitrate encode of a still screen undershoots.
 */
export const PREVIEW_FORMAT = {
  fps: 30,
  seconds: [15, 30],
  maxBytes: 524288000,
  level: 40,
  profiles: ["High", "Main", "Baseline", "Constrained Baseline"],
  bitrate: [8e6, 14e6],
  audio: { channels: 2, rates: [44100, 48000], bitrate: 256000 },
};

/**
 * The display a picture of this size is a preview for, or null when no display takes that size.
 * @param {number} width
 * @param {number} height
 * @returns {string | null}
 */
export function displayForSize(width, height) {
  for (const [key, spec] of Object.entries(PREVIEW_SPECS)) {
    if ([spec.portrait, spec.landscape].some((size) => size && size[0] === width && size[1] === height)) return key;
  }
  return null;
}

/**
 * The size of a display's previews in an orientation. The Mac's are landscape whatever is asked.
 * @param {string} display
 * @param {"portrait" | "landscape"} [orientation]
 * @returns {[number, number]}
 */
export function previewSize(display, orientation = "portrait") {
  const spec = PREVIEW_SPECS[display];
  if (!spec) fail(`No app preview display "${display}". The displays are ${Object.keys(PREVIEW_SPECS).join(", ")}.`);
  return orientation === "landscape" || !spec.portrait ? spec.landscape : spec.portrait;
}
