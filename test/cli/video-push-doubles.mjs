// Small stand-ins for the inspection modules that push.mjs imports (check.mjs, specs.mjs and timecode.mjs), for
// as long as those files are not in the tree. useDoubles() serves this file in place of any of them that is
// missing; one that is there is used as it is, so the push tests run against the real check once it is merged.
//
// They follow the signatures the parts share, and do no more than the push tests need.

import { registerHooks } from "node:module";

let hooked = false;

/**
 * Serves this file for a module of cli/src/video/ that is not there. Call it before push.mjs is imported.
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
  iphone: { portrait: [886, 1920], landscape: [1920, 886], record: "iphone-6.9", group: "the large Dynamic Island group" },
  ipad: { portrait: [1200, 1600], landscape: [1600, 1200], record: "ipad-13", group: "the 13-inch iPad group" },
  mac: { portrait: null, landscape: [1920, 1080], record: "mac", group: "the Mac group" },
  "iphone-5.5": { portrait: [1080, 1920], landscape: [1920, 1080], record: "iphone-6.9", group: "the 5.5-inch group" },
  "iphone-4.7": { portrait: [750, 1334], landscape: [1334, 750], record: "iphone-6.9", group: "the 4.7-inch group" },
  "ipad-9.7": { portrait: [900, 1200], landscape: [1200, 900], record: "ipad-13", group: "the 9.7-inch group" },
};

/**
 * @param {number} width
 * @param {number} height
 */
export function displayForSize(width, height) {
  for (const [key, spec] of Object.entries(PREVIEW_SPECS)) {
    if ([spec.portrait, spec.landscape].some((size) => size && size[0] === width && size[1] === height)) return key;
  }
  return null;
}

// --- cli/src/video/timecode.mjs

/**
 * @param {number} seconds
 * @param {number} [fps]
 */
export function timecode(seconds, fps = 30) {
  const frames = Math.max(0, Math.round(seconds * fps));
  const whole = Math.floor(frames / fps);
  const two = (/** @type {number} */ value) => String(value).padStart(2, "0");
  return `${two(Math.floor(whole / 3600))}:${two(Math.floor(whole / 60) % 60)}:${two(whole % 60)}:${two(frames % fps)}`;
}

// --- cli/src/video/check.mjs

/**
 * The rules the push tests lean on: the size of the display, the codec, 15 to 30 seconds, an audio track, and
 * no draft.
 * @param {any} probe
 * @param {string | null | undefined} display
 * @param {{ draft?: boolean, file?: string }} [options]
 */
export function checkProbe(probe, display, { draft = false } = {}) {
  /** @type {{ display: string | null, errors: Array<{ rule: string, value: string | number, expected: string }>, warnings: any[], passed: any[] }} */
  const verdict = { display: display ?? null, errors: [], warnings: [], passed: [] };
  /**
   * @param {string} rule
   * @param {boolean} ok
   * @param {string | number} value
   * @param {string} expected
   */
  const judge = (rule, ok, value, expected) => (ok ? verdict.passed : verdict.errors).push({ rule, value, expected });
  const video = probe.streams.find((/** @type {any} */ stream) => stream.codec_type === "video");
  const audio = probe.streams.find((/** @type {any} */ stream) => stream.codec_type === "audio");
  judge("codec", video?.codec_name === "h264", video?.codec_name ?? "none", "h264");
  const sized = display ?? displayForSize(video?.width, video?.height);
  const spec = sized ? PREVIEW_SPECS[/** @type {keyof typeof PREVIEW_SPECS} */ (sized)] : null;
  judge("size", Boolean(spec && [spec.portrait, spec.landscape].some((size) => size && size[0] === video?.width && size[1] === video?.height)), `${video?.width}x${video?.height}`, "a preview size");
  const seconds = Number(probe.format.duration);
  judge("duration", seconds >= 15 && seconds <= 30, `${seconds.toFixed(2)} s`, "15 to 30 s");
  judge("audio", audio !== undefined, audio ? "1 track" : "none", "a stereo AAC track, silent if need be");
  if (draft) judge("draft", false, "draft", "a final encode: compose without --draft");
  return verdict;
}
