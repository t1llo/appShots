import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { deflateSync } from "node:zlib";
import { cliHome, PIXEL } from "./helpers.mjs";

const home = await cliHome("capture-plan-frames");
after(() => home.remove());
process.env.DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";

const { host, setRunner } = await import("../../cli/src/proc.mjs");
const { blankScreen } = await import("../../cli/src/capture/blank.mjs");
const { captureSettled } = await import("../../cli/src/capture/sim.mjs");
host.platform = "darwin";

/**
 * A PNG as simctl writes one, its rows stored with each of the five filters in turn so that undoing them is tested.
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => [number, number, number]} paint
 */
function png(width, height, paint) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  let above = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x++) row.set([...paint(x, y), 255], x * 4);
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = above[i];
      const corner = i >= 4 ? above[i - 4] : 0;
      const guess = left + up - corner;
      const paeth = Math.abs(guess - left) <= Math.abs(guess - up) && Math.abs(guess - left) <= Math.abs(guess - corner) ? left : Math.abs(guess - up) <= Math.abs(guess - corner) ? up : corner;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter];
      raw[y * (stride + 1) + 1 + i] = (row[i] - predicted) & 255;
    }
    above = row;
  }
  const chunk = (kind, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(kind, "latin1"), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A status bar and a home indicator on a screen of one colour, as an app shows before its first frame. */
const launching = (x, y) => (y < 30 || (y > 780 && x > 150 && x < 250) ? [0, 0, 0] : [250, 250, 250]);
/** The same with a list on it. */
const drawn = (x, y) => (y > 200 && y < 220 && x > 20 && x < 300 ? [60, 60, 60] : launching(x, y));
const BLANK = png(400, 800, launching);
const DRAWN = png(400, 800, drawn);

test("a screen of one colour below the status bar is blank, and one with anything on it is not", () => {
  assert.equal(blankScreen(BLANK), true);
  assert.equal(blankScreen(DRAWN), false);
  // A dark launch screen as well, its colour a little uneven.
  assert.equal(blankScreen(png(400, 800, (x, y) => (y < 30 ? [255, 255, 255] : [x % 2, 0, 1]))), true);
  // Too small to be a screen, or no PNG at all: not said either way.
  assert.equal(blankScreen(PIXEL), null);
  assert.equal(blankScreen(Buffer.from("not a picture")), null);
});

test("a launch screen that stays the same is waited out, and the screen taken once the app has drawn it", async (t) => {
  const frames = [BLANK, BLANK, BLANK, DRAWN, DRAWN];
  let shots = 0;
  const before = setRunner(async (command, args) => {
    if (args[1] === "io") writeFileSync(args[4], frames[Math.min(shots++, frames.length - 1)]);
    return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
  });
  t.after(() => setRunner(before));
  t.mock.method(console, "log", () => {});
  const file = path.join(home.home, "home.png");
  await captureSettled({ name: "Bench", udid: "11111111-0000-0000-0000-000000000001" }, file, null);
  assert.equal(shots, 5);
  assert.deepEqual(readFileSync(file), DRAWN);
});
