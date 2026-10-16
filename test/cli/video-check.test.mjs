import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cliHome, quietly, scriptedRunner } from "./helpers.mjs";
import { FIXTURES } from "./video-check-recipes.mjs";

// The check, run on probes stored from real encodes (fixtures/video/probe/), and the parts around it that need
// no ffmpeg: Apple's sizes, timecodes, the poster time, the contact sheet's layout, and the commands' ffmpeg
// calls, answered by a scripted runner.
const home = await cliHome("video-check");
after(() => home.remove());

const { setRunner } = await import("../../cli/src/proc.mjs");
const { checkCut, checkFileOf, checkFiles, checkProbe, formatCheck, previewsIn, readCheckRecord, RULE_LABELS, writeCheckRecord } = await import("../../cli/src/video/check.mjs");
const { durationOf, playedSize, probe, PROBE_ENTRIES, rateOf, topBoxes } = await import("../../cli/src/video/probe.mjs");
const { CURRENT_DISPLAYS, displayForSize, PREVIEW_FORMAT, PREVIEW_SPECS, previewSize } = await import("../../cli/src/video/specs.mjs");
const { frameAt, timecode, timecodeSeconds } = await import("../../cli/src/video/timecode.mjs");
const { choosePoster, posterFileOf, posterFrame, posterTime } = await import("../../cli/src/video/poster.mjs");
const { contactSheet, sheetLayout } = await import("../../cli/src/video/sheet.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
const { MODELS } = await import("../../src/domain/devices.ts");

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures", "video", "probe");
/** @param {string} name */
function stored(name) {
  const fixture = FIXTURES[name];
  const probed = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${fixture.same ?? name}.json`), "utf8"));
  fixture.edit?.(probed);
  return probed;
}
/** @param {Array<{ rule: string }>} rules */
const ids = (rules) => rules.map((rule) => rule.rule).sort();

for (const [name, fixture] of Object.entries(FIXTURES)) {
  const breaks = [...fixture.errors, ...fixture.warnings];
  test(`the check on ${name}: ${breaks.length > 0 ? breaks.join(", ") : "every rule passes"}`, () => {
    const verdict = checkProbe(stored(name), fixture.display ?? null, { draft: fixture.draft, file: fixture.file });
    assert.deepEqual(ids(verdict.errors), [...fixture.errors].sort());
    assert.deepEqual(ids(verdict.warnings), [...fixture.warnings].sort());
    for (const rule of [...verdict.errors, ...verdict.warnings, ...verdict.passed]) assert.ok(Object.hasOwn(RULE_LABELS, rule.rule), `${rule.rule} has a label`);
  });
}

test("a file is judged for the display its size says, or for the one it is said to be for", () => {
  assert.equal(checkProbe(stored("good"), null).display, "iphone");
  assert.equal(checkProbe(stored("good-mac"), null).display, "mac");
  assert.equal(checkProbe(stored("good-ipad-landscape"), null).display, "ipad");
  assert.equal(checkProbe(stored("odd-size"), null).display, null);
  assert.equal(checkProbe(stored("good"), "ipad").display, "ipad");
  assert.throws(() => checkProbe(stored("good"), "watch"), (error) => error instanceof Failure && /No app preview display "watch"/.test(error.message));
});

test("each finding has what was measured and what Apple takes", () => {
  const verdict = checkProbe(stored("fps-25"), null);
  assert.deepEqual(verdict.errors.find((rule) => rule.rule === "frame-rate"), { rule: "frame-rate", value: "25/1", expected: "30/1, constant" });
  assert.deepEqual(verdict.errors.find((rule) => rule.rule === "frames"), { rule: "frames", value: 400, expected: "480 ± 1 for 16.00 s at 30 fps" });
  const long = checkProbe(stored("too-long"), null).errors[0];
  assert.deepEqual(long, { rule: "duration", value: "31.00 s", expected: "15 to 30 s" });
  assert.equal(checkProbe(stored("level-4.2"), null).errors[0].value, "4.2");
  assert.equal(checkProbe(stored("600mb"), null).errors[0].value, "629.1 MB");
});

test("silent AAC, at about 2 kbps, is not judged by its bitrate; music is", () => {
  const silent = checkProbe(stored("good"), null);
  assert.ok(Number(stored("good").streams[1].bit_rate) < 4000);
  assert.ok(![...silent.passed, ...silent.warnings].some((rule) => rule.rule === "audio-bitrate"));
  const music = checkProbe(stored("good-music"), null);
  assert.ok(music.passed.some((rule) => rule.rule === "audio-bitrate"));
});

test("a draft is an error, and its bitrate is not judged", () => {
  const draft = checkProbe(stored("draft"), null, { draft: true });
  assert.deepEqual(ids(draft.errors), ["draft"]);
  assert.ok(![...draft.passed, ...draft.warnings].some((rule) => rule.rule === "bitrate"));
});

test("a probe without the boxes or the counted frames leaves those rules out instead of failing them", () => {
  const probed = stored("good");
  delete probed.boxes;
  delete probed.streams[0].nb_read_frames;
  const verdict = checkProbe(probed, null);
  assert.deepEqual(verdict.errors, []);
  assert.ok(!verdict.passed.some((rule) => rule.rule === "faststart" || rule.rule === "frames"));
});

test("a recording stored sideways is measured the way it plays", () => {
  const probed = stored("good");
  Object.assign(probed.streams[0], { width: 1920, height: 886, side_data_list: [{ rotation: -90 }] });
  assert.deepEqual(playedSize(probed.streams[0]), [886, 1920]);
  assert.deepEqual(checkProbe(probed, null).errors, []);
  probed.streams[0].side_data_list = [];
  probed.streams[0].tags = { rotate: "270" };
  assert.deepEqual(playedSize(probed.streams[0]), [886, 1920]);
});

test("the report has a line per rule, errors and warnings with what is expected", () => {
  const probed = stored("fps-25");
  const lines = formatCheck("out/en/iphone/preview.mp4", checkProbe(probed, null), probed);
  assert.equal(lines[0], "out/en/iphone/preview.mp4: iphone, 886x1920, 16.00 s");
  assert.ok(lines.some((line) => /^ {2}error {4}frame rate\s+25\/1; expected 30\/1, constant$/.test(line)));
  assert.ok(lines.some((line) => /^ {2}OK {7}codec\s+h264$/.test(line)));
  assert.match(lines.at(-1) ?? "", /^2 errors, 0 warnings: App Store Connect does not take this file as it is\.$/);
  assert.equal(formatCheck("a.mp4", checkProbe(stored("good"), null)).at(-1), "Every rule passes.");
  assert.match(formatCheck("a.mp4", checkProbe(stored("index-last"), null)).at(-1) ?? "", /^1 warning, no errors/);
});

test("the cut's own warnings: long cards, a late app, the band style, squeezed or borrowed captions, too many previews", () => {
  assert.deepEqual(checkCut({ intro: 1.5, outro: 2, firstApp: 1.1, captionStyle: "panel", previews: 3 }), []);
  const layers = {
    layers: [
      { id: "caption-inbox", locale: "de", kind: "caption", fit: 0.64, fallback: false },
      { id: "caption-share", locale: "de", kind: "caption", fit: 1, fallback: true },
      { id: "caption-inbox", locale: "en", kind: "caption", fit: 0.5, fallback: false },
      { id: "plate", locale: null, kind: "plate" },
    ],
    warnings: [{ locale: "de", layer: "caption-search", kind: "lines", detail: "three lines" }],
  };
  const warnings = checkCut({ intro: 2.5, outro: 2, firstApp: 2.4, captionStyle: "band", layers, locale: "de", previews: 4 });
  assert.deepEqual(ids(warnings), ["caption-fallback", "caption-fit", "caption-fit", "caption-style", "cards", "first-app-frame", "previews"]);
  assert.deepEqual(warnings.filter((rule) => rule.rule === "caption-fit").map((rule) => rule.value), ["caption-inbox: shrunk to 64 %", "caption-search: three lines"]);
  assert.equal(warnings.find((rule) => rule.rule === "caption-fallback")?.value, "caption-share: another language's text");
});

test("the previews in a folder are counted for the three-a-display warning", () => {
  const folder = path.join(home.home, "out", "en", "iphone");
  mkdirSync(folder, { recursive: true });
  for (const name of ["preview.mp4", "preview.poster.png", "preview.check.json", "tour.mp4"]) writeFileSync(path.join(folder, name), "");
  assert.equal(previewsIn(folder), 2);
  assert.equal(previewsIn(path.join(home.home, "nowhere")), 0);
});

test("Apple's preview sizes, one table for every display", () => {
  assert.deepEqual(previewSize("iphone"), [886, 1920]);
  assert.deepEqual(previewSize("iphone", "landscape"), [1920, 886]);
  assert.deepEqual(previewSize("ipad"), [1200, 1600]);
  assert.deepEqual(previewSize("mac", "portrait"), [1920, 1080]);
  assert.deepEqual(previewSize("iphone-5.5"), [1080, 1920]);
  assert.deepEqual(previewSize("iphone-4.7", "landscape"), [1334, 750]);
  assert.deepEqual(previewSize("ipad-9.7"), [900, 1200]);
  assert.throws(() => previewSize("tv"), Failure);
  assert.deepEqual(CURRENT_DISPLAYS, ["iphone", "ipad", "mac"]);
  for (const [key, spec] of Object.entries(PREVIEW_SPECS)) {
    for (const size of [spec.portrait, spec.landscape]) if (size) assert.equal(displayForSize(...size) === key || (key === "iphone-5.5" && size[0] === 1920), true, `${key} ${size}`);
    // Every preview is recorded on a device the server knows.
    assert.ok(Object.hasOwn(MODELS, spec.record), `${spec.record} is a device`);
  }
  // 1920x1080 is the Mac's and the 5.5-inch iPhone's landscape size; it is taken to be the Mac's.
  assert.equal(displayForSize(1920, 1080), "mac");
  assert.equal(displayForSize(1080, 1920), "iphone-5.5");
  assert.equal(displayForSize(1320, 2868), null);
});

test("level 4.0 holds at every preview size at 30 frames a second", () => {
  for (const spec of Object.values(PREVIEW_SPECS)) {
    for (const size of [spec.portrait, spec.landscape]) {
      if (!size) continue;
      const blocks = Math.ceil(size[0] / 16) * Math.ceil(size[1] / 16);
      assert.ok(blocks <= 8192 && blocks * PREVIEW_FORMAT.fps <= 245760, `${size} is ${blocks} macroblocks`);
    }
  }
});

test("a timecode is the frame nearest the time, at 30 frames a second", () => {
  assert.equal(timecode(5.5), "00:00:05:15");
  assert.equal(timecode(0), "00:00:00:00");
  assert.equal(timecode(5.51), "00:00:05:15");
  assert.equal(timecode(5.52), "00:00:05:16");
  assert.equal(timecode(1 / 30), "00:00:00:01");
  assert.equal(timecode(29.99), "00:00:30:00");
  assert.equal(timecode(3725.5), "01:02:05:15");
  assert.equal(timecode(2.5, 25), "00:00:02:13");
  assert.equal(frameAt(-1), 0);
  assert.equal(timecodeSeconds("00:00:05:15"), 5.5);
  assert.equal(timecodeSeconds("00:00:05:30"), null);
  assert.equal(timecodeSeconds("5.5"), null);
});

test("the poster is the first scene a second after its caption is in, unless the plan or --at says otherwise", () => {
  const scenes = [
    { id: "inbox", start: 1.1, seconds: 6, caption: true },
    { id: "search", start: 6.7, seconds: 5, caption: false },
  ];
  // 1.1 + 0.4 transition + 0.45 caption + 1 = 2.95 s, on frame 89.
  assert.equal(posterTime({ scenes, total: 20, transition: 0.4 }), 89 / 30);
  assert.equal(posterTime({ scenes: [{ ...scenes[0], caption: false }], total: 20, transition: 0.4 }), 75 / 30);
  assert.equal(posterTime({ scenes, total: 20, transition: 0.4, poster: { scene: "search", at: 2 } }), 8.7);
  assert.equal(posterTime({ scenes, total: 20, transition: 0.4, poster: { scene: "search" } }), 243 / 30);
  assert.equal(posterTime({ scenes, total: 20, poster: { time: 12.345 } }), 370 / 30);
  assert.equal(posterTime({ scenes, total: 20, poster: { time: 12 }, chosen: 4.5 }), 4.5);
  // Past its scene, it stays on the scene's last frame; past the end, on the preview's.
  assert.equal(posterTime({ scenes, total: 20, poster: { scene: "inbox", at: 30 } }), 212 / 30);
  assert.equal(posterTime({ scenes, total: 20, chosen: 25 }), 599 / 30);
  assert.throws(() => posterTime({ scenes, total: 20, poster: { scene: "share" } }), (error) => error instanceof Failure && /no scene of that id\. Its scenes are inbox, search/.test(error.message));
  assert.equal(posterTime({ scenes: [], total: 20 }), 0);
});

test("the contact sheet's layout: cells of one size, a block of rows per video, the rows wrapped", () => {
  const portrait = sheetLayout([{ size: [886, 1920], seconds: 16 }], 1);
  assert.deepEqual(portrait.cell, [166, 360]);
  assert.equal(portrait.columns, 10);
  assert.deepEqual(portrait.files, [{ frames: 16, rows: 2, height: 2 * 360 + 3 * 4 }]);
  assert.equal(portrait.width, 10 * 166 + 11 * 4);
  const mixed = sheetLayout([{ size: [1920, 1080], seconds: 20.02 }, { size: [1320, 2868], seconds: 7.5 }], 2);
  assert.deepEqual(mixed.cell, [360, 360]);
  assert.equal(mixed.columns, 5);
  assert.deepEqual(mixed.files.map((file) => [file.frames, file.rows]), [[11, 3], [4, 1]]);
  assert.equal(mixed.height, mixed.files[0].height + mixed.files[1].height);
});

test("the top-level boxes of an MP4 are read in order, and anything else has none", () => {
  const box = (type, body = 0) => {
    const head = Buffer.alloc(8 + body);
    head.writeUInt32BE(8 + body, 0);
    head.write(type, 4, "latin1");
    return head;
  };
  const late = path.join(home.home, "late.mp4");
  writeFileSync(late, Buffer.concat([box("ftyp", 12), box("mdat", 100), box("moov", 20)]));
  assert.deepEqual(topBoxes(late), ["ftyp", "mdat", "moov"]);
  const text = path.join(home.home, "notes.txt");
  writeFileSync(text, "not a movie at all, only words");
  assert.deepEqual(topBoxes(text), []);
});

test("small helpers read ffprobe's numbers as ffprobe writes them", () => {
  assert.equal(rateOf("30000/1001")?.toFixed(3), "29.970");
  assert.equal(rateOf("0/0"), null);
  assert.equal(rateOf(undefined), null);
  assert.equal(durationOf({ streams: [{ codec_type: "video", duration: "3.5" }], format: {} }), 3.5);
  assert.ok(PROBE_ENTRIES.includes("nb_read_frames") && PROBE_ENTRIES.includes("stream_disposition=default"));
});

// ffprobe and ffmpeg answered by a script: what the commands ask of them, and what they make of the answers.
const answers = { probe: stored("good"), status: 0 };
/** @type {string[][]} */
const runs = [];
const script = scriptedRunner((command, args) => {
  runs.push([command, ...args]);
  if (answers.status !== 0) return { status: answers.status, stderr: "Invalid data found when processing input\n" };
  if (args.includes("-version")) return { stdout: "ffmpeg version 9.0.2\n" };
  if (path.basename(command) === "ffprobe") return { stdout: JSON.stringify(answers.probe) };
  if (args.includes("-encoders") || args.includes("-filters")) return { stdout: "" };
  // ffmpeg writes its output, the last argument.
  writeFileSync(/** @type {string} */ (args.at(-1)), "png");
  return {};
});
const before = setRunner(script.runner);
after(() => setRunner(before));
const TOOLS = { ffmpeg: "ffmpeg", ffprobe: "ffprobe", version: "9.0.2", encoders: new Set(["png"]), filters: new Set(), h264: null, from: /** @type {const} */ ("PATH") };

const movie = path.join(home.home, "preview.mp4");
writeFileSync(movie, Buffer.alloc(2048));

test("the probe counts the frames, adds the file's boxes, and names a file ffprobe cannot read", async () => {
  runs.length = 0;
  answers.status = 0;
  // ffprobe says nothing of boxes; this file has none, being no MP4.
  answers.probe = { ...stored("good"), boxes: undefined };
  const probed = await probe(movie, TOOLS);
  assert.deepEqual(runs[0], ["ffprobe", "-v", "error", "-count_frames", "-show_entries", PROBE_ENTRIES, "-of", "json", movie]);
  assert.equal(probed.streams[0].codec_name, "h264");
  assert.equal(probed.boxes, undefined);
  await probe(movie, TOOLS, { count: false });
  assert.ok(!runs[1].includes("-count_frames"));
  answers.status = 1;
  await assert.rejects(probe(movie, TOOLS), (error) => error instanceof Failure && error.message.includes(`ffprobe cannot read ${movie}: Invalid data found when processing input`));
  await assert.rejects(probe(path.join(home.home, "missing.mp4"), TOOLS), (error) => error instanceof Failure && /There is no video at/.test(error.message));
  answers.status = 0;
});

test("the poster frame is asked for at the middle of the frame before it, so ffmpeg gives the nearest", async () => {
  runs.length = 0;
  const out = path.join(home.home, "poster.png");
  const poster = await posterFrame(movie, 5.5, out, TOOLS);
  const args = runs[0];
  assert.equal(args[args.indexOf("-ss") + 1], (164.5 / 30).toFixed(6));
  assert.ok(args.indexOf("-ss") > args.indexOf("-i"), "the seek comes after the input, so it is exact");
  assert.deepEqual(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2), ["-frames:v", "1"]);
  assert.deepEqual(poster, { file: out, seconds: 5.5, timecode: "00:00:05:15" });
  assert.equal(readFileSync(out, "utf8"), "png");
  await posterFrame(movie, 0, out, TOOLS);
  assert.equal(runs[1][runs[1].indexOf("-ss") + 1], "0.000000");
});

test("a poster chosen with --at goes into the check record beside the preview, for the upload", async () => {
  answers.probe = stored("good");
  const poster = await choosePoster(movie, 4.5, TOOLS);
  assert.equal(poster.file, posterFileOf(movie));
  assert.equal(posterFileOf("out/en/iphone/preview.mp4"), "out/en/iphone/preview.poster.png");
  const record = readCheckRecord(movie);
  assert.deepEqual(record?.poster, { seconds: 4.5, timecode: "00:00:04:15", chosen: true });
  assert.equal(record?.display, "iphone");
  await assert.rejects(choosePoster(movie, 16, TOOLS), (error) => error instanceof Failure && /has no frame at 16 s/.test(error.message));
  await assert.rejects(choosePoster(movie, -1, TOOLS), (error) => error instanceof Failure && /--at takes the seconds/.test(error.message));
});

test("a check record is read only for the file it was written for", () => {
  const file = path.join(home.home, "tour.mp4");
  writeFileSync(file, Buffer.alloc(100));
  assert.equal(checkFileOf(file), path.join(home.home, "tour.check.json"));
  assert.equal(readCheckRecord(file), null);
  const verdict = checkProbe(stored("good"), null);
  writeCheckRecord(file, { display: "iphone", draft: true, errors: verdict.errors, warnings: verdict.warnings, probe: stored("good") });
  assert.equal(readCheckRecord(file)?.draft, true);
  assert.equal(readCheckRecord(file)?.bytes, 100);
  writeFileSync(file, Buffer.alloc(101));
  assert.equal(readCheckRecord(file), null);
});

test("the contact sheet is one ffmpeg run: a tile per video, stacked, and no split", async () => {
  runs.length = 0;
  answers.probe = stored("good");
  const other = path.join(home.home, "second.mp4");
  writeFileSync(other, Buffer.alloc(10));
  const out = path.join(home.home, "sheet.png");
  const sheet = await contactSheet([movie, other], out, { every: 2 }, TOOLS);
  const run = runs.find((args) => args.includes("-filter_complex")) ?? [];
  const graph = run[run.indexOf("-filter_complex") + 1];
  assert.match(graph, /^\[0:v\]fps=1\/2,scale=166:360:force_original_aspect_ratio=decrease,pad=166:360:/);
  assert.match(graph, /tile=10x1:padding=4:margin=4:color=0x2b2b2b\[block0\]/);
  assert.match(graph, /\[block0\]\[block1\]vstack=inputs=2\[sheet\]$/);
  assert.ok(!/\bsplit\b/.test(graph));
  assert.deepEqual(sheet.blocks.map((block) => [block.frames, block.rows]), [[8, 1], [8, 1]]);
  assert.equal(readFileSync(out, "utf8"), "png");
  await contactSheet([movie], out, { every: 1 }, TOOLS);
  assert.match(runs.at(-1)?.[runs.at(-1).indexOf("-filter_complex") + 1] ?? "", /tile=10x2:padding=4:margin=4:color=0x2b2b2b\[sheet\]$/);
  await assert.rejects(contactSheet([movie], out, { every: 0 }, TOOLS), (error) => error instanceof Failure && /--every takes the seconds/.test(error.message));
});

test("appshots video check prints a block a file, ends with 1 on an error, and gives JSON with --json", async () => {
  const bin = path.join(home.home, "bin");
  mkdirSync(bin, { recursive: true });
  for (const name of ["ffmpeg", "ffprobe"]) writeFileSync(path.join(bin, name), "#!/bin/sh\n", { mode: 0o755 });
  process.env.APPSHOTS_FFMPEG = path.join(bin, "ffmpeg");
  try {
    const before = process.exitCode;
    answers.probe = stored("fps-25");
    const printed = await quietly(() => checkFiles([movie]));
    assert.match(printed, /^.*preview\.mp4: iphone, 886x1920, 16\.00 s\n/);
    assert.match(printed, /error {4}frame rate/);
    assert.equal(process.exitCode, 1);
    process.exitCode = before;
    answers.probe = stored("good");
    const json = JSON.parse(await quietly(() => checkFiles([movie], { json: true })));
    assert.equal(json.files[0].file, movie);
    assert.equal(json.files[0].display, "iphone");
    assert.deepEqual(json.files[0].errors, []);
    // The poster chosen above is in the record beside the file, and is passed on.
    assert.equal(json.files[0].poster.timecode, "00:00:04:15");
    assert.equal(process.exitCode, before);
    await assert.rejects(checkFiles([movie], { display: "tv" }), (error) => error instanceof Failure && /--display takes one of iphone, ipad, mac/.test(error.message));
    await assert.rejects(checkFiles([]), (error) => error instanceof Failure && /Name the video to check/.test(error.message));
  } finally {
    delete process.env.APPSHOTS_FFMPEG;
    delete process.env.APPSHOTS_FFPROBE;
  }
});
