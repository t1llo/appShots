import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { cliHome, quietly } from "./helpers.mjs";
import { FIXTURES, recipeArgs } from "./video-check-recipes.mjs";

// The ffmpeg tier: real files made with ffmpeg from test patterns, then probed, checked, cut into posters and
// laid out on contact sheets by the CLI's own code. It needs ffmpeg and takes a minute or two, so it runs
// only with VIDEO_TESTS=1, like RENDER_TESTS for Chromium.
const VIDEO = process.env.VIDEO_TESTS === "1";
const tier = { skip: VIDEO ? false : "makes videos with ffmpeg; run with VIDEO_TESTS=1" };

const home = await cliHome("video-encodes");
after(() => home.remove());

const { findFfmpeg } = await import("../../cli/src/video/ffmpeg.mjs");
const { checkFiles, checkProbe, readCheckRecord } = await import("../../cli/src/video/check.mjs");
const { probe } = await import("../../cli/src/video/probe.mjs");
const { choosePoster, posterFrame } = await import("../../cli/src/video/poster.mjs");
const { contactSheet, sheetLayout } = await import("../../cli/src/video/sheet.mjs");
const { pool } = await import("../../cli/src/util.mjs");

const run = promisify(execFile);
/** @type {import("../../cli/src/video/ffmpeg.mjs").Tools} */
let tools;
/** @type {Map<string, string>} The file each recipe made. */
const made = new Map();

/** @param {string} name */
const fileOf = (name) => path.join(home.home, `${name}.mp4`);
/** @param {string[]} args */
const ffmpeg = (args) => run(tools.ffmpeg, ["-nostdin", "-hide_banner", "-v", "error", "-y", ...args], { maxBuffer: 1 << 24 });
/** @param {string} file */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

before(async () => {
  if (!VIDEO) return;
  tools = await findFfmpeg({ ask: false });
  const recipes = Object.entries(FIXTURES).filter(([, fixture]) => fixture.recipe);
  await pool(recipes, 4, async ([name, fixture]) => {
    await run(tools.ffmpeg, recipeArgs(/** @type {any} */ (fixture.recipe), fileOf(name)), { maxBuffer: 1 << 24 });
    made.set(name, fileOf(name));
  });
});

for (const [name, fixture] of Object.entries(FIXTURES)) {
  const breaks = [...fixture.errors, ...fixture.warnings];
  test(`a real ${name} file: ${breaks.length > 0 ? breaks.join(", ") : "every rule passes"}`, tier, async () => {
    const probed = await probe(/** @type {string} */ (made.get(fixture.same ?? name)), tools);
    fixture.edit?.(probed);
    const verdict = checkProbe(probed, fixture.display ?? null, { draft: fixture.draft, file: fixture.file });
    assert.deepEqual(verdict.errors.map((rule) => rule.rule).sort(), [...fixture.errors].sort(), JSON.stringify(verdict.errors));
    assert.deepEqual(verdict.warnings.map((rule) => rule.rule).sort(), [...fixture.warnings].sort(), JSON.stringify(verdict.warnings));
  });
}

test("the poster is the frame App Store Connect's timecode names", tier, async () => {
  const file = fileOf("good");
  for (const [seconds, frame] of [[5.5, 165], [5.51, 165], [5.52, 166], [0, 0], [15.95, 479]]) {
    const out = path.join(home.home, `poster-${seconds}.png`);
    const poster = await posterFrame(file, seconds, out, tools);
    assert.deepEqual(pngSize(out), [886, 1920]);
    const counted = path.join(home.home, `frame-${frame}.png`);
    await ffmpeg(["-i", file, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-update", "1", counted]);
    assert.ok(readFileSync(out).equals(readFileSync(counted)), `${seconds} s is frame ${frame} (${poster.timecode})`);
  }
});

test("a poster chosen with --at is kept beside the preview", tier, async () => {
  const file = fileOf("good-mac");
  const poster = await choosePoster(file, 7.25, tools);
  assert.deepEqual(pngSize(poster.file), [1920, 1080]);
  assert.deepEqual(readCheckRecord(file)?.poster, { seconds: 218 / 30, timecode: "00:00:07:08", chosen: true });
  assert.equal(readCheckRecord(file)?.display, "mac");
});

test("a contact sheet of raw recordings is the size its layout says", tier, async () => {
  // A simulator recording (variable frame rate, Display P3), a 13-inch iPad one and a Mac window.
  const sources = [
    ["sim", "testsrc2=size=1320x2868:rate=60", ["-vf", "select='not(between(mod(n\\,60)\\,20\\,49))',setparams=color_primaries=smpte432", "-fps_mode", "vfr", "-t", "3.4"]],
    ["ipad", "testsrc2=size=2064x2752:rate=30", ["-t", "2.5"]],
    ["window", "testsrc2=size=2880x1800:rate=30", ["-t", "4"]],
  ];
  const files = [];
  for (const [name, source, args] of sources) {
    const file = path.join(home.home, `raw-${name}.mov`);
    await ffmpeg(["-f", "lavfi", "-i", /** @type {string} */ (source), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", .../** @type {string[]} */ (args), file]);
    files.push(file);
  }
  const out = path.join(home.home, "raw-sheet.png");
  const sheet = await contactSheet(files, out, { every: 1 }, tools);
  assert.deepEqual(pngSize(out), [sheet.width, sheet.height]);
  assert.deepEqual(sheet.blocks.map((block) => block.frames), [4, 3, 4]);
  const preview = path.join(home.home, "preview-sheet.png");
  const single = await contactSheet([fileOf("good")], preview, { every: 0.5 }, tools);
  const layout = sheetLayout([{ size: [886, 1920], seconds: 16 }], 0.5);
  assert.deepEqual(pngSize(preview), [layout.width, layout.height]);
  assert.equal(single.blocks[0].frames, 32);
});

test("appshots video check on real files: one block each, and 1 for an error", tier, async () => {
  const before = process.exitCode;
  const printed = await quietly(() => checkFiles([fileOf("good"), fileOf("mono")]));
  assert.equal(process.exitCode, 1);
  process.exitCode = before;
  const blocks = printed.trim().split("\n\n");
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /good\.mp4: iphone, 886x1920, 16\.00 s\n/);
  assert.match(blocks[0], /Every rule passes\.$/);
  assert.match(blocks[1], /error {4}audio channels\s+1; expected 2/);
});
