import { readFileSync } from "node:fs";

/**
 * Where the scene was touched, as its driver tells it: a line `APPSHOTS_TOUCH <ms> <x> <y>` on stdout or in the
 * file $APPSHOTS_TOUCH_LOG. `ms` counts from the driver's start; a number as large as a clock's reading is taken
 * as one, so a UI test can print the time it has instead of counting. `x y` are points on iOS, the window's
 * points on a Mac and CSS pixels on the web. The compose draws a ring there, as simctl records no touches.
 */
const TOUCH = /APPSHOTS_TOUCH\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/;

/** Milliseconds since 1970 from here on, which no scene lasts. */
const CLOCK = 1e11;

/** @typedef {{ ms: number, x: number, y: number }} Touch */

/**
 * The touch a line reports, or null for any other line.
 * @param {string} line
 * @returns {Touch | null}
 */
export function touchOf(line) {
  const match = TOUCH.exec(line);
  return match ? { ms: Number(match[1]), x: Number(match[2]), y: Number(match[3]) } : null;
}

/**
 * The touches a text reports, one per line.
 * @param {string} text
 */
export const touchesIn = (text) => text.split(/\r?\n/).map(touchOf).filter((touch) => touch !== null);

/**
 * The touches a driver wrote to its log. None when it wrote none, or no log at all.
 * @param {string} file
 */
export function touchLog(file) {
  try {
    return touchesIn(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** @param {number} value */
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Touches as the sidecar keeps them: [seconds from the start of the recording, x, y] in pixels of the recording,
 * in order, each once, and only those within it. A driver may report a touch on stdout and in its log both.
 * @param {Touch[]} touches
 * @param {{ driverStart: number, offset: number, scale: number, wall: number }} timing driverStart: when the
 *   driver started, as Date.now() has it; offset: seconds from the start of the recording to the driver's.
 * @returns {Array<[number, number, number]>}
 */
export function sidecarTouches(touches, { driverStart, offset, scale, wall }) {
  const seen = new Set();
  /** @type {Array<[number, number, number]>} */
  const kept = [];
  for (const { ms, x, y } of touches) {
    const since = ms >= CLOCK ? ms - driverStart : ms;
    const entry = /** @type {[number, number, number]} */ ([round2(since / 1000 + offset), Math.round(x * scale), Math.round(y * scale)]);
    const key = entry.join(" ");
    if (seen.has(key) || entry[0] < 0 || entry[0] > wall) continue;
    seen.add(key);
    kept.push(entry);
  }
  return kept.sort((a, b) => a[0] - b[0]);
}
