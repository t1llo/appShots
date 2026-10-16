import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cliHome, PIXEL, png } from "./helpers.mjs";

const home = await cliHome("capture-plan-frames");
after(() => home.remove());
process.env.DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";

const { host, setRunner } = await import("../../cli/src/proc.mjs");
const { blankScreen } = await import("../../cli/src/capture/blank.mjs");
const { captureSettled } = await import("../../cli/src/capture/sim.mjs");
host.platform = "darwin";

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

/**
 * Lets simctl write these frames in turn, the last one again and again, each one `step` milliseconds later than the
 * one before as far as the capture's clock goes, so that seconds of waiting pass at once.
 * @param {import("node:test").TestContext} t
 * @param {Buffer[]} frames
 * @param {number} [step]
 */
function simulate(t, frames, step = 0) {
  const now = Date.now.bind(Date);
  let ahead = 0;
  const seen = { shots: 0 };
  t.mock.method(Date, "now", () => now() + ahead);
  const before = setRunner(async (command, args) => {
    if (args[1] === "io") {
      writeFileSync(args[4], frames[Math.min(seen.shots++, frames.length - 1)]);
      ahead += step;
    }
    return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
  });
  t.after(() => setRunner(before));
  t.mock.method(console, "log", () => {});
  return seen;
}

const SIM = { name: "Bench", udid: "11111111-0000-0000-0000-000000000001" };

test("a launch screen that stays the same is waited out, and the screen taken once the app has drawn it", async (t) => {
  const seen = simulate(t, [BLANK, BLANK, BLANK, DRAWN, DRAWN]);
  const file = path.join(home.home, "home.png");
  assert.equal(await captureSettled(SIM, file, null), false);
  assert.equal(seen.shots, 5);
  assert.deepEqual(readFileSync(file), DRAWN);
});

test("a screen drawn after a long launch screen is compared with the next frame before it is taken", async (t) => {
  // Half way through the fade from the launch screen, a moment before the screen is up.
  const fading = png(400, 800, (x, y) => (y > 200 && y < 220 && x > 20 && x < 300 ? [150, 150, 150] : launching(x, y)));
  const seen = simulate(t, [BLANK, BLANK, BLANK, fading, DRAWN, DRAWN], 1500);
  const file = path.join(home.home, "late.png");
  assert.equal(await captureSettled(SIM, file, null), false);
  assert.equal(seen.shots, 6);
  assert.deepEqual(readFileSync(file), DRAWN);
});

test("a screen still blank after fifteen seconds is taken as it is, and said to be", async (t) => {
  const seen = simulate(t, [BLANK], 4000);
  const file = path.join(home.home, "blank.png");
  assert.equal(await captureSettled(SIM, file, null), true);
  assert.equal(seen.shots, 4);
});

test("a screenshot simctl fails once is taken again, and one it fails twice is not", async (t) => {
  t.mock.method(console, "log", () => {});
  let failures = 1;
  const calls = [];
  const before = setRunner(async (command, args) => {
    calls.push(args[1]);
    if (args[1] !== "io") return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    if (failures-- > 0) return { status: 1, signal: null, stdout: "", stderr: "Detected file type from extension: PNG\nNote: No display specified, using the default.", timedOut: false };
    writeFileSync(args[4], DRAWN);
    return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
  });
  t.after(() => setRunner(before));
  const file = path.join(home.home, "retry.png");
  assert.equal(await captureSettled(SIM, file, 0), false);
  assert.deepEqual(calls, ["io", "io"]);
  assert.deepEqual(readFileSync(file), DRAWN);

  failures = 2;
  await assert.rejects(captureSettled(SIM, file, 0), /Could not capture Bench:\nDetected file type/);
});
