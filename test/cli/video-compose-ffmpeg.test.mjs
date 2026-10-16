// The compose with a real ffmpeg, on footage and layers that ffmpeg generates: a VFR recording tagged Display P3
// for each display, PNG layers like the server's, and a sine for music. Each preview is then read back with ffprobe
// against Apple's specification. Run with VIDEO_TESTS=1; it takes a few minutes.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { cliHome, quietly } from "./helpers.mjs";
import { useDoubles } from "./video-compose-doubles.mjs";

const VIDEO = process.env.VIDEO_TESTS === "1";
const videoTier = { skip: VIDEO ? false : "runs ffmpeg; run with VIDEO_TESTS=1" };

useDoubles();
const doubles = await import("./video-compose-doubles.mjs");
const { compose, setParts } = await import("../../cli/src/video/compose.mjs");
// The plan goes through the real reader once it is in the tree, so the plan here must be one it takes.
const planModule = existsSync(new URL("../../cli/src/video/plan.mjs", import.meta.url)) ? await import(new URL("../../cli/src/video/plan.mjs", import.meta.url).href) : doubles;

const SECONDS = 6;
const GAP = 0.6;
const WALL = SECONDS + GAP;
const PLATE = [0x33, 0x44, 0x55];
const WINDOW = [0xcc, 0x66, 0x22];

/** @type {{ remove(): Promise<void> } | undefined} */
let home;
/** @type {string} */
let dir;
/** @type {string} */
let ffmpeg;
/** @type {string} */
let ffprobe;

/** @param {string[]} args */
const run = (args) => execFileSync(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args]);

/**
 * A screen recording as the recorder leaves one: VFR, with a still stretch where nothing was drawn, tagged Display
 * P3 the way simulators tag theirs. A colour gives a still window; without one it is ffmpeg's moving test card.
 * @param {string} file
 * @param {[number, number]} size
 * @param {number[]} [color]
 */
function footage(file, [width, height], color) {
  const source = color ? `color=c=0x${color.map((value) => value.toString(16).padStart(2, "0")).join("")}:size=${width}x${height}:rate=30:duration=${SECONDS}` : `testsrc2=size=${width}x${height}:rate=30:duration=${SECONDS}`;
  run([
    ...["-f", "lavfi", "-i", source, "-vf", `format=rgb24,setpts='PTS+gte(T,2)*${GAP}/TB',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`],
    ...["-fps_mode", "passthrough", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20"],
    ...["-color_primaries", "smpte432", "-color_trc", "iec61966-2-1", "-colorspace", "bt709", file],
  ]);
}

/**
 * A transparent PNG with an opaque rectangle, as the server draws a caption or a card's text.
 * @param {string} file
 * @param {[number, number]} size
 * @param {[number, number, number, number]} box
 * @param {number} red
 */
function panel(file, [width, height], [x, y, w, h], red) {
  run(["-f", "lavfi", "-i", `color=c=white:size=${width}x${height}:d=1,format=rgba,geq=r='${red}':g='240':b='230':a='if(between(X,${x},${x + w - 1})*between(Y,${y},${y + h - 1}),235,0)'`, "-frames:v", "1", file]);
}

/**
 * The layers of a display, written where fetchLayers puts them, and its manifest.
 * @param {string} root
 * @param {string} display
 * @param {string[]} locales
 * @param {any[]} scenes
 */
function drawLayers(root, display, locales, scenes) {
  const size = /** @type {[number, number]} */ (/** @type {any} */ (doubles.PREVIEW_SPECS)[display][display === "mac" ? "landscape" : "portrait"]);
  const [width, height] = size;
  const set = `${display}00000000000000`.slice(0, 16);
  const folder = path.join(root, "layers", set);
  mkdirSync(folder, { recursive: true });
  const color = PLATE.map((value) => value.toString(16).padStart(2, "0")).join("");
  run(["-f", "lavfi", "-i", `color=c=0x${color}:size=${width}x${height}:d=1`, "-frames:v", "1", path.join(folder, "plate.png")]);
  run(["-f", "lavfi", "-i", "color=c=white:size=96x96:d=1,format=rgba,geq=r='255':g='255':b='255':a='if(lt(abs(hypot(X-48,Y-48)-38),7),210,0)'", "-frames:v", "1", path.join(folder, "touch.png")]);
  panel(path.join(folder, "intro-logo.png"), size, [Math.round(width / 2) - 90, Math.round(height / 2) - 200, 180, 180], 250);
  /** @type {any[]} */
  const layers = [
    { id: "plate", locale: null, kind: "plate" },
    { id: "touch", locale: null, kind: "touch" },
    { id: "intro-logo", locale: null, kind: "intro-logo" },
  ];
  const band = Math.round(height * 0.11);
  locales.forEach((locale, at) => {
    mkdirSync(path.join(folder, locale), { recursive: true });
    const red = 200 + at * 40;
    for (const scene of scenes.filter((item) => item.caption)) {
      const box = /** @type {[number, number, number, number]} */ ([64, 40, width - 128, band]);
      panel(path.join(folder, locale, `caption-${scene.id}.png`), size, box, red);
      layers.push({ id: `caption-${scene.id}`, locale, kind: "caption", box });
    }
    for (const kind of ["intro-text", "outro-text"]) {
      panel(path.join(folder, locale, `${kind}.png`), size, [64, Math.round(height / 2), width - 128, band], red);
      layers.push({ id: kind, locale, kind });
    }
  });
  return { set, charged: false, size, warnings: [], layers };
}

/**
 * Records every scene of a display: in the first language, and the others reuse it.
 * @param {string} root
 * @param {string} display
 * @param {string[]} locales
 * @param {any[]} scenes
 */
function record(root, display, locales, scenes) {
  const mac = display === "mac";
  /** @type {[number, number]} */
  const size = mac ? [2880, 1800] : display === "ipad" ? [2064, 2752] : [1320, 2868];
  const scale = mac ? 2 : 3;
  locales.forEach((locale, at) => {
    const folder = path.join(root, "raw", display, locale);
    mkdirSync(folder, { recursive: true });
    for (const scene of scenes) {
      // Touches in pixels of the recording, a second in and halfway through.
      const touches = [
        [1.2, Math.round(size[0] * 0.3), Math.round(size[1] * 0.6)],
        [3.4, Math.round(size[0] * 0.7), Math.round(size[1] * 0.4)],
      ];
      const sidecar = {
        version: 1,
        ...{ scene: scene.id, locale, display, source: mac ? "mac" : "sim", model: mac ? "Mac" : "Test device", os: "27.0" },
        ...{ size, scale, orientation: mac ? "landscape" : "portrait", wall: WALL, driverOffset: 0.2, touches, trim: null },
        ...{ reuse: at === 0 ? null : locales[0], planHash: "00000000", recordedAt: "2026-10-15T21:00:00Z" },
      };
      if (at === 0) footage(path.join(folder, `${scene.id}.mov`), size, mac ? WINDOW : undefined);
      writeFileSync(path.join(folder, `${scene.id}.json`), JSON.stringify(sidecar, null, 2));
    }
  });
}

/**
 * A project folder with a plan, its recordings and its layers, and the layers handed to compose as fetchLayers
 * would hand them.
 * @param {object} plan
 */
function project(plan) {
  const base = path.join(dir, `project-${Math.random().toString(36).slice(2, 8)}`);
  const root = path.join(base, "appshots-video");
  mkdirSync(root, { recursive: true });
  const full = /** @type {any} */ ({ version: 1, project: "p_example", ...plan });
  const file = path.join(base, "appshots.video.json");
  writeFileSync(file, JSON.stringify(full, null, 2));
  /** @type {Record<string, any>} */
  const manifests = {};
  for (const display of full.displays) {
    record(root, display, full.locales, full.scenes);
    manifests[display] = drawLayers(root, display, full.locales, full.scenes);
  }
  setParts({ fetchLayers: async (/** @type {any} */ _plan, /** @type {{ display: string }} */ { display }) => manifests[display] });
  return { base, root, plan: planModule.readPlan(file), flags: /** @type {Record<string, string | true>} */ ({ plan: file }) };
}

/**
 * The top-level boxes of an MP4, in order.
 * @param {string} file
 */
function boxes(file) {
  const bytes = readFileSync(file);
  const names = [];
  for (let at = 0; at + 8 <= bytes.length; ) {
    let size = bytes.readUInt32BE(at);
    names.push(bytes.toString("latin1", at + 4, at + 8));
    if (size === 1) size = Number(bytes.readBigUInt64BE(at + 8));
    if (size < 8) break;
    at += size;
  }
  return names;
}

/** @param {string} file */
function pngSize(file) {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/**
 * The colour of a pixel of a preview's frame, as a player shows it.
 * @param {string} file
 * @param {number} frame
 * @param {number} x
 * @param {number} y
 */
function pixel(file, frame, x, y) {
  const out = execFileSync(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${frame}),crop=2:2:${x - (x % 2)}:${y - (y % 2)},scale=in_color_matrix=bt709:in_range=tv,format=rgb24`, "-frames:v", "1", "-f", "rawvideo", "-"]);
  return [...out.subarray(0, 3)];
}

/**
 * Reads a preview back and holds it to Apple's specification for previews of `size` and `seconds`.
 * @param {{ file: string, seconds: number, check: { errors: unknown[] } }} result
 * @param {[number, number]} size
 */
function assertPreview(result, size) {
  const { file, seconds } = result;
  const entries = "format=duration,bit_rate:stream=codec_type,codec_name,profile,level,pix_fmt,width,height,sample_aspect_ratio,r_frame_rate,avg_frame_rate,nb_read_frames,channels,sample_rate,color_primaries,color_transfer,color_space";
  const probed = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-count_frames", "-show_entries", entries, "-of", "json", file], { encoding: "utf8" }));
  const video = probed.streams.find((/** @type {any} */ stream) => stream.codec_type === "video");
  const audio = probed.streams.find((/** @type {any} */ stream) => stream.codec_type === "audio");
  const shown = path.basename(path.dirname(path.dirname(file))) + "/" + path.basename(path.dirname(file));
  assert.equal(probed.streams.length, 2, shown);
  assert.deepEqual([video.codec_name, video.profile, video.level, video.pix_fmt], ["h264", "High", 40, "yuv420p"], shown);
  assert.deepEqual([video.width, video.height], size, shown);
  assert.equal(video.sample_aspect_ratio ?? "1:1", "1:1", shown);
  assert.deepEqual([video.r_frame_rate, video.avg_frame_rate], ["30/1", "30/1"], shown);
  assert.equal(Number(video.nb_read_frames), Math.round(seconds * 30), shown);
  assert.deepEqual([video.color_primaries, video.color_transfer, video.color_space], ["bt709", "bt709", "bt709"], shown);
  assert.deepEqual([audio.codec_name, audio.channels, audio.sample_rate], ["aac", 2, "48000"], shown);
  assert.ok(Math.abs(Number(probed.format.duration) - seconds) <= 1 / 30 + 1e-6, `${shown}: ${probed.format.duration} s, not ${seconds} s`);
  const rate = Number(probed.format.bit_rate) / 1e6;
  assert.ok(rate >= 8 && rate <= 14, `${shown}: ${rate.toFixed(1)} Mbps`);
  const order = boxes(file);
  assert.ok(order.indexOf("moov") >= 0 && order.indexOf("moov") < order.indexOf("mdat"), `${shown}: ${order.join(" ")}`);
  assert.deepEqual(result.check.errors, [], shown);
  const poster = file.replace(/\.mp4$/, ".poster.png");
  assert.deepEqual(pngSize(poster), size, shown);
  const record = JSON.parse(readFileSync(file.replace(/\.mp4$/, ".check.json"), "utf8"));
  assert.deepEqual(record.errors, [], shown);
  assert.equal(record.bytes, statSync(file).size, shown);
}

const scenes = [
  { id: "inbox", caption: { slide: 2 }, trim: [0.5, 5.5], hold: 0.5 },
  { id: "search", caption: "Find anything", speed: 1.5 },
  { id: "share", caption: "Send it", touches: false },
];

before(async () => {
  if (!VIDEO) return;
  home = await cliHome("video-compose-ffmpeg");
  const tools = await doubles.findFfmpeg();
  ffmpeg = tools.ffmpeg;
  ffprobe = tools.ffprobe;
  dir = await mkdtemp(path.join(tmpdir(), "appshots-video-ffmpeg-"));
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  await home?.remove();
});

test("an iPhone preview, composed five times over, comes out to Apple's specification each time", videoTier, async () => {
  const p = project({ app: { platform: "ios" }, displays: ["iphone"], locales: ["en"], intro: { seconds: 1.5 }, outro: { seconds: 2 }, transition: { type: "fade", seconds: 0.4 }, scenes });
  for (let round = 1; round <= 5; round++) {
    rmSync(path.join(p.root, "work"), { recursive: true, force: true });
    rmSync(path.join(p.root, "out"), { recursive: true, force: true });
    /** @type {any[]} */
    let results = [];
    const started = Date.now();
    await quietly(async () => {
      results = await compose(p.plan, p.flags);
    });
    assert.equal(results.length, 1);
    // 1.5 + (5 + 0.5) + 6.6 / 1.5 + 6.6 + 2, less four transitions of 0.4.
    assert.equal(results[0].seconds, 18.4);
    assertPreview(results[0], [886, 1920]);
    console.log(`round ${round}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
});

test("an iPad preview in two languages, the second on the first's footage, and a compose again that makes nothing", videoTier, async () => {
  const p = project({ app: { platform: "ios" }, displays: ["ipad"], locales: ["en", "de"], footage: "primary", transition: { type: "dissolve", seconds: 0.5 }, scenes, poster: { scene: "search", at: 1 } });
  /** @type {any[]} */
  let results = [];
  await quietly(async () => {
    results = await compose(p.plan, p.flags);
  });
  assert.deepEqual(
    results.map((result) => result.locale),
    ["en", "de"],
  );
  // No intro or outro text in the plan: the layers have them, so the cards are there with the plan's defaults.
  for (const result of results) assertPreview(result, [1200, 1600]);
  // "search" comes in at 45 + 165 − 2 × 15 frames, and the poster is a second into it.
  const record = JSON.parse(readFileSync(results[0].file.replace(/\.mp4$/, ".check.json"), "utf8"));
  assert.deepEqual(record.poster, { seconds: 7, timecode: "00:00:07:00" });
  // The captions differ by language, so the frames under them do too.
  const [english, german] = results.map((result) => pixel(result.file, 120, 600, 80));
  assert.notDeepEqual(english, german);

  const again = await quietly(async () => {
    results = await compose(p.plan, p.flags);
  });
  assert.equal((again.match(/is unchanged/g) ?? []).length, 2, again);
  assert.equal((again.match(/segments unchanged/g) ?? []).length, 2, again);
});

test("a Mac window lies on the plate, with music, in the colours it was recorded in", videoTier, async () => {
  const p = project({ app: { platform: "mac" }, displays: ["mac"], locales: ["en"], fit: "plate", music: { file: "theme.m4a", volume: 0.6, fadeOut: 1.5 }, scenes });
  run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=7", "-ac", "2", "-c:a", "aac", path.join(p.base, "theme.m4a")]);
  /** @type {any[]} */
  let results = [];
  await quietly(async () => {
    results = await compose(p.plan, p.flags);
  });
  assertPreview(results[0], [1920, 1080]);
  const { file } = results[0];
  // Two seconds into the first scene: the plate in the corner, the window in the middle, each its own colour.
  const frame = 45 - 12 + 60;
  const near = (/** @type {number[]} */ seen, /** @type {number[]} */ wanted) => seen.every((value, at) => Math.abs(value - wanted[at]) <= 6);
  const corner = pixel(file, frame, 8, 1070);
  const middle = pixel(file, frame, 960, 700);
  assert.ok(near(corner, PLATE), `the plate is ${corner}`);
  assert.ok(near(middle, WINDOW), `the window is ${middle}`);
  // The music plays through the preview, looped past its own seven seconds, and has faded out at the end.
  assert.ok(loudness(file, 9, 1) > -30, "music in the middle");
  assert.ok(loudness(file, results[0].seconds - 0.1, 0.1) < loudness(file, 9, 1) - 20, "faded out at the end");
});

/**
 * The mean volume of a stretch of a preview's sound, in dB.
 * @param {string} file
 * @param {number} from
 * @param {number} seconds
 */
function loudness(file, from, seconds) {
  const { stderr } = spawnSync(ffmpeg, ["-nostdin", "-hide_banner", "-ss", String(from), "-t", String(seconds), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const match = /mean_volume: (-?[\d.]+|-inf) dB/.exec(stderr);
  assert.ok(match, stderr);
  return match[1] === "-inf" ? -Infinity : Number(match[1]);
}
