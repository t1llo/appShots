import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { keptAudio, musicOf, previewAudio } from "../../cli/src/video/audio.mjs";
import { cardArgs, finalCodec, joinArgs, joinPoints, passArgs, sceneArgs, segmentCodec, touchOverlay } from "../../cli/src/video/graph.mjs";
import { captionBands, footageChain, frameTime, limit, placement, plateBox, sceneFrames, sceneWindow, toFrames, touchPoints, turnOf } from "../../cli/src/video/normalise.mjs";

const IPHONE = /** @type {[number, number]} */ ([886, 1920]);
const MAC = /** @type {[number, number]} */ ([1920, 1080]);
const sim = { source: "sim", size: /** @type {[number, number]} */ ([1320, 2868]), wall: 7.84, touches: /** @type {Array<[number, number, number]>} */ ([[1.4, 201, 640], [3.1, 96, 1210]]) };
const codec = segmentCodec({ encoder: "libx264" });

/** The value after each `flag` in a command line. */
const after = (/** @type {string[]} */ args, /** @type {string} */ flag) => args.flatMap((arg, at) => (arg === flag ? [args[at + 1]] : []));

/** Every input of a command line that loops a picture has its own -t. */
function loopsAreBounded(/** @type {string[]} */ args) {
  args.forEach((arg, at) => {
    if (arg !== "-loop") return;
    const input = args.indexOf("-i", at);
    assert.ok(args.slice(at, input).includes("-t"), `the looped input at ${at} has no -t`);
  });
}

/** What makes ffmpeg stall is never there. */
function staysClear(/** @type {string[]} */ args) {
  const graph = after(args, "-filter_complex").join(";");
  assert.ok(!/(^|[;,\]])\s*a?split\b/.test(graph), "the graph uses split");
  assert.ok(!args.includes("-shortest"), "the command uses -shortest");
  loopsAreBounded(args);
}

test("a length in frames becomes a -t that lets exactly those frames through", () => {
  assert.equal(toFrames(4.7), 141);
  assert.equal(limit(141), "4.700000");
  // 137 frames are 4.5666… s; rounded up, the limit would let the 138th in.
  assert.equal(limit(137), "4.566666");
  assert.equal(frameTime(137), "4.566667");
});

test("a simulator recording gets its tags, its wall-clock length, the scene's trim, speed and hold, and the canvas", () => {
  const scene = { id: "inbox", trim: /** @type {[number, number]} */ ([0.6, 7.2]), speed: 1.5, hold: 1 };
  const window = sceneWindow(scene, sim);
  assert.deepEqual(window, { start: 0.6, end: 7.2, speed: 1.5 });
  const place = placement(IPHONE, [1320, 2868], null);
  const chain = footageChain({ sidecar: sim, window, turn: null, size: IPHONE, place, seconds: 5.4 }).split(",");
  assert.equal(chain[0], "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709");
  assert.deepEqual(chain.slice(1, 5), ["setpts=PTS-STARTPTS", "fps=30", "tpad=stop_mode=clone:stop_duration=7.84", "trim=duration=7.84"]);
  assert.ok(chain.includes("trim=start=0.6:end=7.2"));
  assert.ok(chain.includes("setpts=PTS/1.5"));
  assert.ok(chain.includes("tpad=stop_mode=clone:stop_duration=5.4"));
  assert.deepEqual(chain.slice(-3), ["scale=886:1920:force_original_aspect_ratio=increase:flags=lanczos", "crop=886:1920", "setsar=1"]);
  assert.ok(!chain.some((part) => part.startsWith("transpose")));
});

test("an imported file and a page stepped frame by frame keep their own length; a page recorded in real time does not", () => {
  const window = { start: 0, end: 5, speed: 1 };
  const place = placement(IPHONE, [1320, 2868], null);
  const chain = (/** @type {object} */ sidecar) => footageChain({ sidecar: { size: [1320, 2868], wall: 5, ...sidecar }, window, turn: null, size: IPHONE, place, seconds: 5 });
  assert.ok(!chain({ source: "import" }).includes("stop_duration=5,trim=duration=5"));
  assert.ok(!chain({ source: "web" }).includes("trim=duration=5"));
  assert.ok(chain({ source: "web", realtime: true }).includes("tpad=stop_mode=clone:stop_duration=5,trim=duration=5"));
  // A recording shown whole is not trimmed again.
  assert.ok(!chain({ source: "sim" }).includes("trim=start"));
});

test("the trim comes from the plan, from what auto found, or is the whole recording, and never trims to nothing", () => {
  assert.deepEqual(sceneWindow({ id: "a", trim: "auto" }, { ...sim, trim: [0.5, 6] }), { start: 0.5, end: 6, speed: 1 });
  assert.deepEqual(sceneWindow({ id: "a", trim: "auto" }, sim), { start: 0, end: 7.84, speed: 1 });
  assert.deepEqual(sceneWindow({ id: "a", trim: [1, 20] }, sim), { start: 1, end: 7.84, speed: 1 });
  assert.throws(() => sceneWindow({ id: "a", trim: [9, 10] }, sim), /trimmed to nothing/);
  assert.throws(() => sceneWindow({ id: "a" }, { source: "sim", size: [1, 1] }), /record --scene a --again/);
});

test("a scene is as long as its window at its speed and its hold, and a cut auto made once is not used without auto", () => {
  const recorded = { ...sim, wall: 8, trim: /** @type {[number, number]} */ ([1, 5]) };
  const length = (/** @type {any} */ scene) => sceneFrames(scene, sceneWindow(scene, recorded));
  assert.equal(length({ id: "a", trim: "auto", speed: 1, hold: 0 }), 120);
  // The plan dropped "auto" after the recording: the whole recording, and as long as all of it.
  assert.deepEqual(sceneWindow({ id: "a", trim: null, speed: 1, hold: 0 }, recorded), { start: 0, end: 8, speed: 1 });
  assert.equal(length({ id: "a", trim: null, speed: 1, hold: 0 }), 240);
  assert.equal(length({ id: "a", trim: [0.6, 7.2], speed: 1.5, hold: 1 }), 162);
  assert.equal(length({ id: "a", trim: [2, 20] }), 180);
});

test("a buffer recorded the other way round is turned, and its touches with it; a Mac window never is", () => {
  const portrait = { ...sim, size: /** @type {[number, number]} */ ([1320, 2868]) };
  const landscape = { ...sim, size: /** @type {[number, number]} */ ([2868, 1320]) };
  assert.equal(turnOf(portrait, "landscape", false), "clock");
  assert.equal(turnOf(landscape, "portrait", false), "cclock");
  assert.equal(turnOf(portrait, "portrait", false), null);
  assert.equal(turnOf(portrait, "landscape", true), null);

  const window = { start: 0, end: 7.84, speed: 1 };
  const place = placement([1920, 886], [2868, 1320], null);
  const chain = footageChain({ sidecar: portrait, window, turn: "clock", size: [1920, 886], place, seconds: 7.84 });
  assert.ok(chain.includes("transpose=clock"));
  // A point near the top left of the portrait buffer lands near the top right once it is turned clockwise.
  const [point] = touchPoints({ ...portrait, touches: [[1, 100, 50]] }, window, "clock", place, 7.84);
  assert.ok(point.x > 1700 && point.y < 100, JSON.stringify(point));
});

test("touches outside the scene's window are left out, the rest move with the trim and the speed, at most 12", () => {
  const window = { start: 1, end: 7, speed: 2 };
  const place = placement(IPHONE, [1320, 2868], null);
  const points = touchPoints({ ...sim, touches: [[0.5, 10, 10], [3, 660, 1434], [7.5, 10, 10]] }, window, null, place, 4);
  assert.equal(points.length, 1);
  assert.equal(points[0].t, 1);
  assert.ok(Math.abs(points[0].x - 443) < 1 && Math.abs(points[0].y - 960) < 1, JSON.stringify(points[0]));
  const many = touchPoints({ ...sim, touches: Array.from({ length: 20 }, (_, at) => /** @type {[number, number, number]} */ ([at * 0.3, 100, 100])) }, { start: 0, end: 7.84, speed: 1 }, null, place, 7.84);
  assert.equal(many.length, 12);
});

test("the touch ring follows the touches with one overlay: shown around each, placed by nested ifs, commas escaped", () => {
  const overlay = touchOverlay([
    { t: 3.1, x: 64.5, y: 812 },
    { t: 1.4, x: 135, y: 430 },
  ]);
  assert.equal(overlay, "overlay=x=if(lt(t\\,3.1)\\,135\\,64.5)-w/2:y=if(lt(t\\,3.1)\\,430\\,812)-h/2:enable=between(t\\,1.4\\,1.75)+between(t\\,3.1\\,3.45):eval=frame");
  assert.equal(touchOverlay([{ t: 2, x: 10, y: 20 }]), "overlay=x=10-w/2:y=20-h/2:enable=between(t\\,2\\,2.35):eval=frame");
});

test("a Mac window lies on the plate below the captions, kept to its shape at even sizes", () => {
  const bands = captionBands(
    [
      { kind: "caption", locale: "en", box: [60, 40, 1800, 110] },
      { kind: "caption", locale: "de", box: [60, 40, 1800, 300] },
      { kind: "plate", locale: null },
    ],
    "en",
    MAC,
  );
  assert.deepEqual(bands, { top: 150, bottom: 0 });
  const box = plateBox(MAC, bands);
  assert.deepEqual(box, { x: 43, y: 193, width: 1834, height: 844 });
  const place = placement(MAC, [2880, 1800], box);
  assert.deepEqual(place, { kind: "plate", width: 1350, height: 844, x: 285, y: 193 });
  assert.equal(place.width % 2, 0);
  // A caption at the bottom takes its band there instead.
  assert.deepEqual(captionBands([{ kind: "caption", locale: "en", box: [60, 900, 1800, 120] }], "en", MAC), { top: 0, bottom: 180 });
});

test("a scene's command: the footage, the plate, the caption fading in, the rings, and exactly its frames", () => {
  const window = sceneWindow({ id: "inbox" }, sim);
  const box = plateBox(MAC, { top: 150, bottom: 0 });
  const place = placement(MAC, [2880, 1800], box);
  const args = sceneArgs({
    footage: "/raw/mac/en/inbox.mov",
    sidecar: { ...sim, source: "mac", size: [2880, 1800] },
    window,
    turn: null,
    size: MAC,
    place,
    frames: 141,
    plate: "/layers/s/plate.png",
    caption: "/layers/s/en/caption-inbox.png",
    captionAt: 0.5,
    ring: "/layers/s/touch.png",
    touches: [{ t: 1, x: 500, y: 500 }],
    codec,
  });
  staysClear(args);
  assert.deepEqual(after(args, "-i"), ["/raw/mac/en/inbox.mov", "/layers/s/plate.png", "/layers/s/en/caption-inbox.png", "/layers/s/touch.png"]);
  assert.deepEqual(after(args, "-t"), ["4.700000", "4.700000", "4.700000", "4.700000"]);
  assert.equal(args.at(-1), "4.700000");
  const graph = after(args, "-filter_complex")[0];
  assert.match(graph, /\[plate\]\[footage\]overlay=x=285:y=193\[placed\]/);
  assert.match(graph, /fade=t=in:st=0\.5:d=0\.35:alpha=1/);
  assert.match(graph, /scale=out_color_matrix=bt709:out_range=tv,format=yuva420p\[caption\]/);
  assert.match(graph, /\[touched\]setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv420p\[v\]$/);
  assert.ok(args.includes("-an"));
});

test("a scene without caption, plate or touches is the footage alone; a window without a plate lies on black", () => {
  const window = sceneWindow({ id: "a" }, sim);
  const args = sceneArgs({ footage: "/a.mov", sidecar: sim, window, turn: null, size: IPHONE, place: placement(IPHONE, [1320, 2868], null), frames: 90, codec });
  assert.deepEqual(after(args, "-i"), ["/a.mov"]);
  assert.match(after(args, "-filter_complex")[0], /\[footage\]setparams=.*\[v\]$/);
  const black = sceneArgs({ footage: "/a.mov", sidecar: sim, window, turn: null, size: MAC, place: placement(MAC, [2880, 1800], plateBox(MAC, { top: 0, bottom: 0 })), frames: 90, codec });
  assert.ok(after(black, "-i").includes("color=c=black:s=1920x1080:r=30"));
  staysClear(black);
});

test("a card fades its logo in first and its text after it, on the plate or on black", () => {
  const args = cardArgs({ size: IPHONE, frames: 45, plate: "/p.png", logo: "/logo.png", text: "/text.png", at: 0.4, codec });
  staysClear(args);
  const graph = after(args, "-filter_complex")[0];
  assert.match(graph, /\[1:v\]format=rgba,fade=t=in:st=0\.4:d=0\.35:alpha=1/);
  assert.match(graph, /\[2:v\]format=rgba,fade=t=in:st=0\.75:d=0\.35:alpha=1/);
  assert.equal(args.at(-1), "1.500000");
  const plain = cardArgs({ size: IPHONE, frames: 60, plate: null, logo: null, text: "/text.png", codec });
  assert.equal(after(plain, "-i")[0], "color=c=black:s=886x1920:r=30");
  assert.match(after(plain, "-filter_complex")[0], /fade=t=in:st=0\.35/);
});

test("the joins start where the segments before them end, less the transitions", () => {
  assert.deepEqual(joinPoints([45, 141, 144, 180, 60], 12), { offsets: [33, 162, 294, 462], total: 522 });
  assert.deepEqual(joinPoints([300, 150], 0), { offsets: [300], total: 450 });
  assert.deepEqual(joinPoints([450], 12), { offsets: [], total: 450 });
});

test("stage 2 joins with xfade at frame-exact offsets, adds the audio, and cuts to the preview's frames", () => {
  const segments = ["/w/a.mp4", "/w/b.mp4", "/w/c.mp4"];
  const audio = previewAudio(null, 498);
  const args = joinArgs({ segments, lengths: [45, 300, 177], transition: { type: "dissolve", frames: 12 }, audio, codec: finalCodec({ encoder: "libx264" }) });
  staysClear(args);
  const graph = after(args, "-filter_complex")[0];
  assert.match(graph, /\[0:v\]settb=AVTB,fps=30,format=yuv420p,setsar=1\[s0\]/);
  assert.match(graph, /\[s0\]\[s1\]xfade=transition=dissolve:duration=0\.400000:offset=1\.100000\[x1\]/);
  assert.match(graph, /\[x1\]\[s2\]xfade=transition=dissolve:duration=0\.400000:offset=10\.700000\[x2\]/);
  assert.match(graph, /\[3:a\]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo\[a\]/);
  assert.deepEqual(after(args, "-map"), ["[v]", "[a]"]);
  assert.equal(args.at(-1), limit(498));
  assert.ok(after(args, "-i").includes("anullsrc=r=48000:cl=stereo"));

  const cut = joinArgs({ segments, lengths: [45, 300, 177], transition: { type: "none", frames: 0 }, audio, codec });
  assert.match(after(cut, "-filter_complex")[0], /\[s0\]\[s1\]\[s2\]concat=n=3:v=1:a=0\[joined\]/);
  assert.equal(cut.at(-1), limit(522));

  const one = joinArgs({ segments: ["/w/a.mp4"], lengths: [480], transition: { type: "fade", frames: 12 }, audio, codec });
  assert.match(after(one, "-filter_complex")[0], /\[s0\]setparams=/);
  assert.ok(!after(one, "-filter_complex")[0].includes("xfade"));
});

test("the preview is encoded to Apple's specification, and a draft quickly", () => {
  const full = finalCodec({ encoder: "libx264" });
  for (const part of ["-profile:v high", "-level:v 4.0", "-pix_fmt yuv420p", "-r 30", "-g 30", "-b:v 11M", "-minrate 11M", "-maxrate 11M", "-bufsize 22M", "-x264-params nal-hrd=cbr:force-cfr=1", "-colorspace bt709", "-c:a aac", "-b:a 256k", "-ar 48000", "-ac 2", "-movflags +faststart", "-map_metadata -1"])
    assert.ok(full.join(" ").includes(part), part);
  const draft = finalCodec({ encoder: "libx264", draft: true }).join(" ");
  assert.ok(draft.includes("-preset ultrafast -crf 28"));
  assert.ok(!draft.includes("nal-hrd"));
  assert.ok(draft.includes("comment=appshots draft"));
  const mac = finalCodec({ encoder: "h264_videotoolbox" }).join(" ");
  assert.ok(mac.includes("-c:v h264_videotoolbox") && mac.includes("-b:v 11M") && !mac.includes("x264"));
  assert.ok(segmentCodec({ encoder: "libx264", draft: true }).join(" ").includes("ultrafast"));
});

test("music is looped or cut to the preview, normalised, then faded, as a stereo track at 48 kHz", () => {
  const music = { file: "/m/theme.m4a", volume: 0.8, start: 2, fadeOut: 1.5 };
  const audio = previewAudio(music, 600);
  assert.deepEqual(audio.input, ["-stream_loop", "-1", "-t", "23.000000", "-i", "/m/theme.m4a"]);
  const chain = audio.chain(4);
  assert.ok(chain.startsWith("[4:a:0]atrim=start=2:duration=20.000000,asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11"), chain);
  assert.ok(chain.indexOf("loudnorm") < chain.indexOf("afade=t=in"), "the fades come after the normalisation");
  assert.ok(chain.includes("afade=t=out:st=18.5:d=1.5"));
  assert.ok(chain.endsWith("channel_layouts=stereo[a]"));
  const silence = previewAudio(null, 600);
  assert.deepEqual(silence.input, ["-f", "lavfi", "-t", "20.000000", "-i", "anullsrc=r=48000:cl=stereo"]);
  assert.match(keptAudio(600).chain(1), /^\[0:a:0\].*apad=whole_dur=20\.000000,atrim=duration=20\.000000\[a\]$/);
  const pass = passArgs({ file: "/r/out.mp4", frames: 600, audio: keptAudio(600), codec: finalCodec({ encoder: "libx264" }) });
  staysClear(pass);
  assert.equal(pass.at(-1), "20.000000");
});

test("the plan's music is found next to the plan, with its defaults, and refused when it is not there", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "appshots-video-music-"));
  try {
    await writeFile(path.join(dir, "theme.m4a"), "not really music");
    assert.equal(musicOf({}, dir), null);
    assert.deepEqual(musicOf({ music: { file: "theme.m4a" } }, dir), { file: path.join(dir, "theme.m4a"), volume: 0.8, start: 0, fadeOut: 1.5 });
    assert.throws(() => musicOf({ music: { file: "gone.m4a" } }, dir), /gone\.m4a is not there/);
    assert.throws(() => musicOf({ music: { file: "theme.m4a", volume: 2 } }, dir), /from 0 to 1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
