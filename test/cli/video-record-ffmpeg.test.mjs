import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { cliHome, quietly } from "./helpers.mjs";

// The recorder with a real ffmpeg and ffprobe, and a real Chromium for the web: VIDEO_TESTS=1 npm run test:cli.
const enabled = process.env.VIDEO_TESTS === "1";
const home = await cliHome("video-record-ffmpeg");
after(() => home.remove());

const lookIn = [...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean);
const program = (/** @type {string} */ name) => lookIn.map((dir) => path.join(dir, name)).find((file) => existsSync(file)) ?? name;
const tools = { ffmpeg: program("ffmpeg"), ffprobe: program("ffprobe"), version: "", encoders: new Set(["libx264"]), filters: new Set(["freezedetect"]) };

// ffmpeg.mjs and plan.mjs of the video command are stood in for, as in the scripted tests.
const VIDEO = new URL("../../cli/src/video/", import.meta.url);
const DOUBLES = {
  [new URL("ffmpeg.mjs", VIDEO).href]: "export const findFfmpeg = (...args) => globalThis.videoDoubles.findFfmpeg(...args);",
  [new URL("plan.mjs", VIDEO).href]: "export const planHash = (...args) => globalThis.videoDoubles.planHash(...args);\nexport const readPlan = () => { throw new Error('not used'); };",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL) {
      const url = new URL(specifier, context.parentURL).href;
      if (url in DOUBLES) return { url, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url in DOUBLES) return { format: "module", source: DOUBLES[url], shortCircuit: true };
    return next(url, context);
  },
});
/** @type {any} */ (globalThis).videoDoubles = { findFfmpeg: async () => tools, planHash: () => "0badcafe" };

const { autoTrim, inspectMovie } = await import("../../cli/src/video/record/session.mjs");
const { startEncoder } = await import("../../cli/src/video/record/web.mjs");
const { recordScenes } = await import("../../cli/src/video/record/index.mjs");
const { findBrowser } = await import("../../cli/src/capture/web.mjs");

const bench = mkdtempSync(path.join(tmpdir(), "appshots-record-ffmpeg-"));
after(() => rmSync(bench, { recursive: true, force: true }));

/** @param {string[]} args */
const ffmpeg = (args) => execFileSync(tools.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "pipe" });
/**
 * What ffprobe says about a movie's video.
 * @param {string} file
 */
function videoOf(file) {
  const text = execFileSync(tools.ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt,color_space,color_primaries,color_transfer,r_frame_rate,nb_read_frames:format=duration", "-of", "json", file], { encoding: "utf8" });
  const data = JSON.parse(text);
  return { ...data.streams[0], duration: Number(data.format.duration) };
}

test("a movie is read upright as it plays, with its length", { skip: !enabled && "VIDEO_TESTS=1 runs it" }, async () => {
  const plain = path.join(bench, "plain.mp4");
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=330x718:rate=30:duration=1.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", plain]);
  const turned = path.join(bench, "turned.mp4");
  ffmpeg(["-display_rotation", "90", "-i", plain, "-c", "copy", turned]);
  assert.deepEqual(await inspectMovie(plain, tools), { size: [330, 718], duration: 1.5, rotation: 0, streams: 1 });
  const movie = await inspectMovie(turned, tools);
  assert.deepEqual(movie?.size, [718, 330]);
  assert.equal(Math.abs(movie?.rotation ?? 0), 90);
  assert.equal(await inspectMovie(path.join(bench, "missing.mp4"), tools), null);
});

test("trim auto cuts a still start and a still end, keeping a moment of each", { skip: !enabled && "VIDEO_TESTS=1 runs it" }, async () => {
  // One second still, two moving, one and a half still.
  const file = path.join(bench, "still-moving-still.mp4");
  ffmpeg([
    "-f", "lavfi", "-i", "color=c=0x336699:size=320x640:rate=30:duration=1",
    "-f", "lavfi", "-i", "testsrc2=size=320x640:rate=30:duration=2",
    "-f", "lavfi", "-i", "color=c=0x336699:size=320x640:rate=30:duration=1.5",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p", "-c:v", "libx264", file,
  ]);
  const [from, to] = /** @type {[number, number]} */ (await autoTrim(file, { wall: 4.5, padded: false }, tools));
  assert.ok(Math.abs(from - 0.8) <= 0.1, `from ${from}`);
  assert.ok(Math.abs(to - 3.6) <= 0.1, `to ${to}`);

  // A movie that drops still frames is laid out on the clock first: its last frame stands until the wall time.
  const moving = path.join(bench, "moving.mp4");
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x640:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", moving]);
  const padded = await autoTrim(moving, { wall: 5, padded: true }, tools);
  assert.ok(padded && padded[0] === 0 && Math.abs(padded[1] - 2.6) <= 0.1, `padded ${padded}`);
  assert.equal(await autoTrim(moving, { wall: 2, padded: false }, tools), null);
});

test("a web page's frames become a 30 fps movie with even sides, BT.709 and 4:4:4", { skip: !enabled && "VIDEO_TESTS=1 runs it" }, async () => {
  const frames = path.join(bench, "frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  // 1179 wide, as a 393-point iPhone page at 3x is.
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=1179x255:rate=30:duration=0.5", path.join(frames, "%03d.png")]);
  const file = path.join(bench, "page.mp4");
  const encoder = startEncoder(file, tools);
  for (const name of readdirSync(frames).sort()) await encoder.write(readFileSync(path.join(frames, name)));
  await encoder.finish();
  const video = videoOf(file);
  assert.equal(video.width, 1178);
  assert.equal(video.height, 254);
  assert.equal(video.pix_fmt, "yuv444p");
  assert.equal(video.color_space, "bt709");
  assert.equal(video.color_primaries, "bt709");
  assert.equal(video.color_transfer, "bt709");
  assert.equal(video.r_frame_rate, "30/1");
  assert.equal(Number(video.nb_read_frames), 15);
});

test("a web app is recorded frame by frame on the page's own clock, its clicks kept as touches", { skip: (!enabled && "VIDEO_TESTS=1 runs it") || (!findBrowser() && "no Chromium browser is installed") }, async () => {
  // A page that counts with a timer and animates with CSS, and says when its button was clicked.
  const page = `<!doctype html><meta name="viewport" content="width=device-width">
<style>body{margin:0;font:20px sans-serif} #box{width:60px;height:60px;background:#c33;animation:move 1s linear infinite alternate} @keyframes move{to{transform:translateX(200px)}} #go{position:absolute;left:100px;top:400px;width:120px;height:50px}</style>
<div id="box"></div><p id="count">0</p><p id="said"></p><button id="go">Go</button>
<script>let n = 0; setInterval(() => (document.getElementById("count").textContent = ++n), 100);
document.getElementById("go").addEventListener("click", () => (document.getElementById("said").textContent = "clicked at " + performance.now().toFixed(0)));</script>`;
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const project = path.join(bench, "web");
  mkdirSync(project, { recursive: true });
  const plan = {
    version: 1,
    project: "p_example",
    app: { platform: "web", url: `http://127.0.0.1:${port}/` },
    displays: ["iphone"],
    locales: ["en"],
    scenes: [
      { id: "home", drive: { web: [{ click: "#go" }, { wait: 0.3 }] }, record: { settle: 0.2 } },
      { id: "idle", drive: { wait: 1 }, record: { settle: 0 } },
    ],
  };
  writeFileSync(path.join(project, "appshots.video.json"), JSON.stringify(plan));
  /** @type {any[]} */
  let written = [];
  await quietly(async () => (written = await recordScenes(plan, { plan: path.join(project, "appshots.video.json") })));
  assert.equal(written.length, 2);
  const [home, idle] = written;
  assert.equal(home.source, "web");
  assert.deepEqual(home.size, [1178, 2556]);
  assert.equal(home.scale, 3);
  // 15 frames before the click, 12 after it, 9 for the wait and 15 at the end: 51 at 30 a second.
  assert.equal(home.wall, 1.7);
  assert.equal(home.touches.length, 1);
  assert.deepEqual(home.touches[0], [0.5, 480, 1275]);
  assert.equal(idle.wall, 1);
  const video = videoOf(home.file);
  assert.equal(Number(video.nb_read_frames), 51);
  assert.equal(video.r_frame_rate, "30/1");
  assert.deepEqual(readdirSync(path.join(project, "appshots-video", "raw", "iphone", "en")).sort(), ["home.json", "home.mp4", "idle.json", "idle.mp4"]);

  // --realtime takes the page as Chromium draws it, each frame held until the next one.
  await quietly(async () => (written = await recordScenes(plan, { plan: path.join(project, "appshots.video.json"), realtime: true, again: true, scene: "idle" })));
  const realtime = videoOf(written[0].file);
  assert.equal(realtime.r_frame_rate, "30/1");
  assert.ok(Number(realtime.nb_read_frames) >= 25 && Number(realtime.nb_read_frames) <= 36, `${realtime.nb_read_frames} frames`);
});
