import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PIXEL, cliHome, quietly } from "./helpers.mjs";
import { useDoubles } from "./video-compose-doubles.mjs";

const home = await cliHome("video-compose");
useDoubles();
const doubles = await import("./video-compose-doubles.mjs");
const { compose, setParts, posterTime, buildSegments, planSegments } = await import("../../cli/src/video/compose.mjs");

/** @type {string} */
let dir;
/** @type {string} */
let ffmpeg;
/** @type {string} */
let log;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "appshots-video-compose-"));
  log = path.join(dir, "ffmpeg.log");
  ffmpeg = path.join(dir, "ffmpeg");
  // A stand-in for ffmpeg that writes what it was asked to, notes when it started and ended, and can be slowed
  // down or made to fail for commands that match a pattern.
  await writeFile(
    ffmpeg,
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const started = Date.now();
const finish = () => {
  if (process.env.FAKE_FAIL && args.join(" ").includes(process.env.FAKE_FAIL)) { console.error("Error while filtering"); process.exit(1); }
  fs.writeFileSync(args.at(-1), "made by the stand-in");
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, started, ended: Date.now() }) + "\\n");
  process.stdout.write("out_time_us=1000000\\nprogress=end\\n");
};
setTimeout(finish, Number(process.env.FAKE_DELAY || 0));
`,
  );
  await chmod(ffmpeg, 0o755);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await home.remove();
});

beforeEach(() => {
  rmSync(log, { force: true });
  delete process.env.FAKE_DELAY;
  delete process.env.FAKE_FAIL;
});

/** @returns {Array<{ args: string[], started: number, ended: number }>} */
const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const isJoin = (/** @type {{ args: string[] }} */ call) => call.args.includes("-c:a");

const tools = { ffmpeg: "", ffprobe: "ffprobe", version: "9.0", encoders: new Set(["libx264", "aac"]), filters: new Set(["xfade"]) };

/**
 * A folder with a plan, recordings of each scene for each display and language, and the layers the server
 * would have drawn, and the parts compose takes, standing in for the other modules.
 * @param {{ displays?: string[], locales?: string[], intro?: boolean, outro?: boolean, wall?: number, reuse?: boolean, scenes?: any[], [key: string]: unknown }} [options]
 */
function project({ displays = ["iphone"], locales = ["en", "de"], intro = true, outro = true, wall = 6, reuse = true, ...plan } = {}) {
  const base = path.join(dir, `project-${Math.random().toString(36).slice(2, 8)}`);
  const root = path.join(base, "appshots-video");
  const scenes = /** @type {any[]} */ (plan.scenes) ?? [
    { id: "inbox", caption: { slide: 2 }, trim: [0.5, 6], hold: 0.5 },
    { id: "search", caption: "Find anything" },
    { id: "share", caption: false },
  ];
  /** @type {Record<string, any>} */
  const manifests = {};
  for (const display of displays) {
    const set = `set${display.replace(/\W/g, "")}0123456`.slice(0, 16);
    const size = /** @type {any} */ (doubles.PREVIEW_SPECS)[display][display === "mac" ? "landscape" : "portrait"];
    /** @type {any[]} */
    const layers = [{ id: "plate", locale: null, kind: "plate" }, { id: "touch", locale: null, kind: "touch" }];
    mkdirSync(path.join(root, "layers", set), { recursive: true });
    writeFileSync(path.join(root, "layers", set, "plate.png"), PIXEL);
    writeFileSync(path.join(root, "layers", set, "touch.png"), PIXEL);
    for (const locale of locales) {
      const folder = path.join(root, "layers", set, locale);
      mkdirSync(folder, { recursive: true });
      for (const scene of scenes.filter((item) => item.caption)) {
        writeFileSync(path.join(folder, `caption-${scene.id}.png`), Buffer.concat([PIXEL, Buffer.from(`${locale} ${scene.id}`)]));
        layers.push({ id: `caption-${scene.id}`, locale, kind: "caption", box: [64, 132, size[0] - 128, 236] });
      }
      for (const [kind, wanted] of [["intro-text", intro], ["intro-logo", intro], ["outro-text", outro]]) {
        if (!wanted) continue;
        writeFileSync(path.join(folder, `${kind}.png`), Buffer.concat([PIXEL, Buffer.from(`${locale} ${kind}`)]));
        layers.push({ id: String(kind), locale, kind: String(kind) });
      }
      for (const scene of scenes) {
        // The older iPhone and iPad sizes are cut from the current one's recordings, as the recorder keeps them.
        const raw = path.join(root, "raw", doubles.footageDisplay(display), locale);
        mkdirSync(raw, { recursive: true });
        const recorded = display === "mac" ? [2880, 1800] : display.startsWith("ipad") ? [2064, 2752] : [1320, 2868];
        const sidecar = { version: 1, scene: scene.id, locale, display, source: display === "mac" ? "mac" : "sim", size: recorded, orientation: "portrait", wall, touches: [[1.5, 400, 900]], reuse: null };
        if (reuse && locale !== locales[0]) writeFileSync(path.join(raw, `${scene.id}.json`), JSON.stringify({ ...sidecar, reuse: locales[0] }));
        else {
          writeFileSync(path.join(raw, `${scene.id}.mov`), `footage of ${scene.id} in ${locale}`);
          writeFileSync(path.join(raw, `${scene.id}.json`), JSON.stringify(sidecar));
        }
      }
    }
    manifests[display] = { set, charged: false, size, warnings: [], layers };
  }
  const full = { version: 1, project: "p_example", app: { platform: "ios" }, displays, locales, transition: { type: "fade", seconds: 0.4 }, ...(intro ? { intro: { seconds: 1.5 } } : {}), ...(outro ? { outro: { seconds: 2 } } : {}), ...plan, scenes };
  const planFile = path.join(base, "appshots.video.json");
  writeFileSync(planFile, JSON.stringify(full));
  /** @type {Array<{ at: number, out: string }>} */
  const posters = [];
  /** @type {Array<{ display: string, draft: boolean }>} */
  const checks = [];
  /** @type {Array<{ display: string, locales: string[] | undefined }>} */
  const fetched = [];
  /** @type {Record<string, any>} The sets 'video layers' left on the Mac, by display and language: none at first. */
  const local = {};
  /** @type {any[]} */
  const found = [];
  setParts({
    findFfmpeg: async (/** @type {any} */ options) => {
      found.push(options);
      return { ...tools, ffmpeg };
    },
    fetchLayers: async (/** @type {any} */ _plan, /** @type {any} */ { display, locales: asked }) => {
      fetched.push({ display, locales: asked });
      return manifests[display];
    },
    localLayers: (/** @type {any} */ _plan, /** @type {string} */ display, /** @type {string} */ locale) => local[`${display} ${locale}`] ?? null,
    readSidecar: doubles.readSidecar,
    captionLayerId: doubles.captionLayerId,
    specs: doubles.PREVIEW_SPECS,
    probe: async (/** @type {string} */ file) => ({ streams: [{ codec_type: "video" }, { codec_type: "audio" }], format: { filename: file } }),
    checkProbe: (/** @type {any} */ _probe, /** @type {string} */ display, /** @type {any} */ { draft }) => {
      checks.push({ display, draft });
      return { errors: draft ? [{ rule: "draft", value: "a draft", expected: "a full encode" }] : [], warnings: [] };
    },
    posterFrame: async (/** @type {string} */ _file, /** @type {number} */ at, /** @type {string} */ out) => {
      posters.push({ at, out });
      writeFileSync(out, PIXEL);
    },
  });
  return { base, root, plan: full, planFile, flags: /** @type {Record<string, string | true>} */ ({ plan: planFile }), posters, checks, fetched, local, found, manifests };
}

test("compose makes a preview per display and language, with its poster and check.json, from segments built per scene", async () => {
  const p = project();
  /** @type {any[]} */
  let results = [];
  const printed = await quietly(async () => {
    results = await compose(p.plan, p.flags);
  });
  assert.deepEqual(
    results.map((result) => [result.locale, result.display, path.relative(p.root, result.file)]),
    [
      ["en", "iphone", "out/en/iphone/preview.mp4"],
      ["de", "iphone", "out/de/iphone/preview.mp4"],
    ],
  );
  // intro 1.5 + inbox 6 + search 6 + share 6 + outro 2, less four transitions of 0.4.
  assert.equal(results[0].seconds, 19.9);
  assert.deepEqual(results[0].check, { errors: [], warnings: [] });
  assert.deepEqual(p.fetched, [{ display: "iphone", locales: ["en", "de"] }]);
  // ffmpeg.mjs puts its own question before an install, which a bare Return answers with no.
  assert.deepEqual(p.found, [{ root: p.root }]);

  const made = calls();
  assert.equal(made.filter(isJoin).length, 2);
  // The intro and outro differ by language; the scenes do too, by their captions, except "share", which has none.
  assert.equal(made.filter((call) => !isJoin(call)).length, 9);
  for (const call of made) assert.ok(!call.args.includes("-shortest") && !call.args.join(" ").includes("split"));
  // German reuses the English footage, with German captions.
  const german = made.find((call) => call.args.some((arg) => arg.endsWith(path.join("de", "caption-inbox.png"))));
  assert.ok(german?.args.includes(path.join(p.root, "raw", "iphone", "en", "inbox.mov")));

  // A preview is written in work/ and moved into out/ when it is whole, so out/ never holds a half-written one.
  assert.ok(made.filter(isJoin).every((call) => path.dirname(call.args.at(-1) ?? "") === path.join(p.root, "work")));
  for (const locale of ["en", "de"]) {
    const out = path.join(p.root, "out", locale, "iphone");
    assert.deepEqual(readdirSync(out).sort(), ["preview.check.json", "preview.mp4", "preview.poster.png"]);
    const record = JSON.parse(readFileSync(path.join(out, "preview.check.json"), "utf8"));
    assert.equal(record.version, 1);
    assert.equal(record.file, "preview.mp4");
    // The size of the file it was written for, so a record of an earlier file of that name is not taken for it.
    assert.equal(record.bytes, statSync(path.join(out, "preview.mp4")).size);
    assert.deepEqual([record.display, record.locale, record.draft, record.seconds], ["iphone", locale, false, 19.9]);
    assert.deepEqual([record.errors, record.warnings, record.cut], [[], [], []]);
    assert.match(record.key, /^[0-9a-f]{16}$/);
    // The first scene starts at 1.1 s, and its caption has faded in by 0.85 s into it; one second later.
    assert.deepEqual(record.poster, { seconds: 2.966666666666667, timecode: "00:00:02:29" });
  }
  assert.deepEqual(
    p.posters.map((poster) => poster.at),
    [2.966666666666667, 2.966666666666667],
  );
  assert.match(printed, /iphone, en: 5 segments, 19\.9 s/);
  assert.match(printed, /check: OK/);
  // Work files are named by content, and nothing half-written is left over.
  const work = readdirSync(path.join(p.root, "work"));
  assert.ok(work.every((name) => /^[0-9a-f]{16}\.mp4$/.test(name)), work.join(", "));
});

test("a second compose builds nothing that did not change, and a changed caption only its own scene and preview", async () => {
  const p = project();
  await quietly(() => compose(p.plan, p.flags));
  rmSync(log, { force: true });
  const printed = await quietly(() => compose(p.plan, p.flags));
  assert.equal(calls().length, 0);
  assert.match(printed, /preview\.mp4 is unchanged/);

  writeFileSync(path.join(p.root, "layers", p.manifests.iphone.set, "de", "caption-search.png"), Buffer.concat([PIXEL, Buffer.from("new words")]));
  const changed = await quietly(() => compose(p.plan, p.flags));
  const made = calls();
  assert.equal(made.length, 2);
  assert.ok(made[0].args.some((arg) => arg.endsWith(path.join("de", "caption-search.png"))));
  assert.ok(isJoin(made[1]));
  assert.match(changed, /out\/en\/iphone\/preview\.mp4 is unchanged/);
  assert.match(changed, /out\/de\/iphone\/preview\.mp4\n/);

  // A recording made again is new footage, even at the same path.
  rmSync(log, { force: true });
  const footage = path.join(p.root, "raw", "iphone", "en", "share.mov");
  writeFileSync(footage, "a new take, longer than the first");
  await quietly(() => compose(p.plan, p.flags));
  // "share" has no caption, so English and German share its segment; both previews are encoded again.
  assert.deepEqual(
    calls().map((call) => (isJoin(call) ? "join" : "segment")),
    ["segment", "join", "join"],
  );
});

test("--jobs sets how many segments are built at once", async () => {
  const p = project({ locales: ["en"] });
  process.env.FAKE_DELAY = "300";
  await quietly(() => compose(p.plan, { ...p.flags, jobs: "1" }));
  const one = calls().filter((call) => !isJoin(call));
  const overlaps = (/** @type {typeof one} */ list) => list.some((a) => list.some((b) => a !== b && a.started < b.ended && b.started < a.ended));
  assert.equal(one.length, 5);
  assert.ok(!overlaps(one), "one at a time");

  rmSync(path.join(p.root, "work"), { recursive: true, force: true });
  rmSync(log, { force: true });
  // Long enough that three stand-ins started together overlap, however slowly a busy machine starts each.
  process.env.FAKE_DELAY = "1500";
  await quietly(() => compose(p.plan, { ...p.flags, jobs: "3" }));
  assert.ok(overlaps(calls().filter((call) => !isJoin(call))), "several at once");

  await assert.rejects(compose(p.plan, { ...p.flags, jobs: "0" }), /--jobs takes how many segments to build at once, from 1 to 16/);
  await assert.rejects(compose(p.plan, { ...p.flags, jobs: "many" }), /--jobs/);
});

test("--draft encodes quickly, is checked as a draft, and does not fail for being one", async () => {
  const p = project({ locales: ["en"] });
  const printed = await quietly(() => compose(p.plan, { ...p.flags, draft: true }));
  const join = calls().find(isJoin);
  const line = join?.args.join(" ") ?? "";
  assert.ok(line.includes("-preset ultrafast -crf 28") && !line.includes("nal-hrd") && line.includes("comment=appshots draft"), line);
  assert.ok(calls().filter((call) => !isJoin(call)).every((call) => call.args.join(" ").includes("-preset ultrafast")));
  assert.deepEqual(p.checks, [{ display: "iphone", draft: true }]);
  assert.equal(JSON.parse(readFileSync(path.join(p.root, "out", "en", "iphone", "preview.check.json"), "utf8")).draft, true);
  assert.match(printed, /These are drafts/);
  assert.match(printed, /error: draft/);
});

test("the full encode is to Apple's specification, with silence when the plan has no music", async () => {
  const p = project({ locales: ["en"] });
  await quietly(() => compose(p.plan, p.flags));
  const line = calls().find(isJoin)?.args.join(" ") ?? "";
  for (const part of ["-preset slow", "-level:v 4.0", "-b:v 11M", "nal-hrd=cbr", "-movflags +faststart", "anullsrc=r=48000:cl=stereo", "xfade=transition=fade"]) assert.ok(line.includes(part), part);
  // 19.9 s, exactly 597 frames.
  assert.ok(line.includes("-t 19.900000 -f mp4"), line);
});

test("music next to the plan is looped to the preview's length and normalised", async () => {
  const p = project({ locales: ["en"], music: { file: "theme.m4a", fadeOut: 2 } });
  writeFileSync(path.join(p.base, "theme.m4a"), "music");
  await quietly(() => compose(p.plan, p.flags));
  const line = calls().find(isJoin)?.args.join(" ") ?? "";
  assert.ok(line.includes(`-stream_loop -1 -t 20.900000 -i ${path.join(p.base, "theme.m4a")}`), line);
  assert.ok(line.includes("loudnorm=I=-16:TP=-1.5:LRA=11") && line.includes("afade=t=out:st=17.9:d=2"), line);

  const silent = project({ locales: ["en"], music: { file: "none.m4a" } });
  await assert.rejects(compose(silent.plan, silent.flags), /The music file none\.m4a is not there/);
});

test("everything that would stop a compose is found before the first encode", async () => {
  const missing = project({ locales: ["en"] });
  rmSync(path.join(missing.root, "raw", "iphone", "en", "search.json"));
  await assert.rejects(compose(missing.plan, missing.flags), /Scene "search" has no recording for en on iphone\. Record it: appshots video record --scene search --lang en --display iphone/);

  const layerless = project({ locales: ["en"] });
  layerless.manifests.iphone.layers = layerless.manifests.iphone.layers.filter((/** @type {any} */ layer) => layer.id !== "caption-inbox");
  await assert.rejects(compose(layerless.plan, layerless.flags), /no caption for scene "inbox" in en\. Draw them again: appshots video layers --display iphone/);

  const gone = project({ locales: ["en"] });
  rmSync(path.join(gone.root, "layers", gone.manifests.iphone.set, "en", "intro-text.png"));
  await assert.rejects(compose(gone.plan, gone.flags), /The layer intro-text for en is not in .*Fetch the layers again/);

  const long = project({ locales: ["en"], wall: 12 });
  await assert.rejects(compose(long.plan, long.flags), /would be 31\.9 s long, and Apple takes 15 to 30 s\. Cut 1\.9 s/);

  const short = project({ locales: ["en"], wall: 3, intro: false, outro: false });
  await assert.rejects(compose(short.plan, short.flags), /would be 8\.2 s long.*Add 6\.8 s/);

  const sized = project({ locales: ["en"] });
  sized.manifests.iphone.size = [1200, 1600];
  await assert.rejects(compose(sized.plan, sized.flags), /The iphone layers are 1200×1600, and its previews are 886×1920/);

  assert.equal(calls().length, 0);
});

test("the layers 'video layers' left on the Mac are used without the server, which is asked only for a language without them", async () => {
  const p = project();
  p.local["iphone en"] = p.manifests.iphone;
  p.local["iphone de"] = p.manifests.iphone;
  const printed = await quietly(() => compose(p.plan, p.flags));
  assert.deepEqual(p.fetched, []);
  assert.doesNotMatch(printed, /server/);
  assert.ok(existsSync(path.join(p.root, "out", "de", "iphone", "preview.mp4")));

  // German was drawn for a caption the plan has since changed, so the server draws it again, and says it costs.
  delete p.local["iphone de"];
  p.manifests.iphone = { ...p.manifests.iphone, charged: true };
  const again = await quietly(() => compose(p.plan, p.flags));
  assert.deepEqual(p.fetched, [{ display: "iphone", locales: ["de"] }]);
  assert.match(again, /iphone: the layers in de are not on this Mac for the plan as it is now; asking the server for them\niphone: drawing them used one render\n/);
});

test("--lang and --display pick out of the plan, and refuse what it does not have", async () => {
  const p = project({ displays: ["iphone", "ipad"] });
  /** @type {any[]} */
  let results = [];
  await quietly(async () => {
    results = await compose(p.plan, { ...p.flags, lang: "de", display: "ipad" });
  });
  assert.deepEqual(
    results.map((result) => `${result.display} ${result.locale}`),
    ["ipad de"],
  );
  assert.deepEqual(p.fetched, [{ display: "ipad", locales: ["de"] }]);
  await assert.rejects(compose(p.plan, { ...p.flags, lang: "fr" }), /The plan has no language fr; it has en, de/);
  await assert.rejects(compose(p.plan, { ...p.flags, display: "mac" }), /The plan has no display mac; it has iphone, ipad/);
  await assert.rejects(compose(p.plan, { ...p.flags, engine: "avfoundation" }), /--engine takes ffmpeg or remotion/);
});

test("a preview that fails the check fails the compose, after its files and check.json are written", async () => {
  const p = project({ locales: ["en"] });
  setParts({ checkProbe: () => ({ errors: [{ rule: "frame rate", value: "25/1", expected: "30/1" }], warnings: [{ rule: "bitrate", value: "7.1 Mbps", expected: "8 to 14 Mbps" }] }) });
  let printed = "";
  await assert.rejects(async () => {
    printed = await quietly(() => compose(p.plan, p.flags));
  }, /1 of 1 preview does not pass Apple's specification: .*preview\.mp4/);
  const record = JSON.parse(readFileSync(path.join(p.root, "out", "en", "iphone", "preview.check.json"), "utf8"));
  assert.deepEqual(record.errors, [{ rule: "frame rate", value: "25/1", expected: "30/1" }]);
  assert.equal(printed, "");
});

test("the Mac window lies on the plate, and a scene without touches gets no ring", async () => {
  const p = project({ displays: ["mac"], locales: ["en"], scenes: [{ id: "board", caption: "Plan the week" }, { id: "notes", caption: "Write it down", touches: false }, { id: "share", caption: "Send it" }] });
  await quietly(() => compose(p.plan, p.flags));
  const scene = (/** @type {string} */ id) => calls().find((call) => call.args.some((arg) => arg.endsWith(`${id}.mov`)));
  const board = scene("board")?.args ?? [];
  const graph = board[board.indexOf("-filter_complex") + 1];
  assert.match(graph, /\[plate\]\[footage\]overlay=x=\d+:y=\d+\[placed\]/);
  assert.match(graph, /overlay=x=.*:enable=between/);
  assert.ok(board.some((arg) => arg.endsWith("plate.png")));
  const notes = scene("notes")?.args ?? [];
  assert.ok(!notes.some((arg) => arg.endsWith("touch.png")));
});

test("the poster is a second after the first caption, or where the plan puts it", () => {
  const jobs = /** @type {any[]} */ ([
    { kind: "intro", scene: "intro", frames: 45 },
    { kind: "scene", scene: "inbox", frames: 180 },
    { kind: "scene", scene: "search", frames: 180 },
    { kind: "outro", scene: "outro", frames: 60 },
  ]);
  assert.equal(posterTime({}, jobs, 12), 89 / 30);
  assert.equal(posterTime({}, jobs.slice(1), 12), 44 / 30);
  assert.equal(posterTime({ poster: { scene: "search", at: 2 } }, jobs, 12), (33 + 168 + 60) / 30);
  assert.equal(posterTime({ poster: { time: 5.5 } }, jobs, 12), 5.5);
  // 465 frames less three overlaps of 12: the last frame is the 429th.
  assert.equal(posterTime({ poster: { time: 99 } }, jobs, 12), 428 / 30);
  assert.throws(() => posterTime({ poster: { scene: "intro" } }, jobs, 12), /poster\.scene in the plan is "intro"/);
});

test("for Remotion, the scenes are built without captions or touches, and its render gets the last pass", async () => {
  const p = project({ locales: ["en"] });
  const rendered = path.join(p.root, "remotion-out.mp4");
  /** @type {any[]} */
  const handed = [];
  setParts({
    composeRemotion: async (/** @type {any} */ ctx, /** @type {any[]} */ segments) => {
      handed.push({ ctx, segments });
      writeFileSync(rendered, "rendered");
      return rendered;
    },
  });
  await quietly(() => compose(p.plan, { ...p.flags, engine: "remotion" }));
  assert.equal(handed.length, 1);
  assert.deepEqual(
    handed[0].segments.map((/** @type {any} */ segment) => [segment.scene, segment.frames]),
    [
      ["inbox", 180],
      ["search", 180],
      ["share", 180],
    ],
  );
  assert.equal(handed[0].ctx.locale, "en");
  const segmentsMade = calls().filter((call) => !isJoin(call));
  assert.equal(segmentsMade.length, 3);
  for (const call of segmentsMade) assert.ok(!call.args.some((arg) => arg.endsWith(".png")), call.args.join(" "));
  const pass = calls().find(isJoin)?.args ?? [];
  assert.equal(pass[pass.indexOf("-i") + 1], rendered);
  // Remotion mixed the music; the pass keeps its sound and cuts both to the plan's length.
  assert.ok(pass.join(" ").includes("apad=whole_dur=19.900000"));
  assert.deepEqual(pass.slice(-5), ["-t", "19.900000", "-f", "mp4", pass.at(-1)]);
});

test("buildSegments makes the segments of one preview, and needs no job count", async () => {
  const p = project({ locales: ["en"] });
  const ctx = { plan: p.plan, root: p.root, display: "iphone", locale: "en", size: /** @type {[number, number]} */ ([886, 1920]), layers: p.manifests.iphone, tools: { ...tools, ffmpeg } };
  const segments = await buildSegments(/** @type {any} */ (ctx), { captions: true });
  assert.deepEqual(
    segments.map((segment) => [segment.scene, segment.seconds, segment.built]),
    [
      ["intro", 1.5, true],
      ["inbox", 6, true],
      ["search", 6, true],
      ["share", 6, true],
      ["outro", 2, true],
    ],
  );
  assert.ok(segments.every((segment) => existsSync(segment.file)));
  assert.equal(planSegments(/** @type {any} */ (ctx), { captions: false }).length, 3);
});

test("a scene whose plan dropped auto after it was recorded shows the whole recording, and is as long as it", () => {
  const p = project({ locales: ["en"], wall: 8, scenes: [{ id: "inbox", caption: "Inbox", trim: null }, { id: "search", caption: "Find anything", trim: "auto" }] });
  // Both recordings keep the cut that auto made of them.
  for (const scene of ["inbox", "search"]) {
    const file = path.join(p.root, "raw", "iphone", "en", `${scene}.json`);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), trim: [1, 5] }));
  }
  const ctx = { plan: p.plan, root: p.root, display: "iphone", locale: "en", size: /** @type {[number, number]} */ ([886, 1920]), layers: p.manifests.iphone, tools: { ...tools, ffmpeg } };
  const jobs = planSegments(/** @type {any} */ (ctx), { captions: true });
  const scene = (/** @type {string} */ id) => /** @type {any} */ (jobs.find((job) => job.scene === id));
  assert.equal(scene("inbox").frames, 240);
  assert.ok(!scene("inbox").args.join(" ").includes("trim=start"));
  assert.deepEqual(scene("inbox").args.slice(-2), ["-t", "8.000000"]);
  assert.equal(scene("search").frames, 120);
  assert.ok(scene("search").args.join(" ").includes("trim=start=1:end=5"));
});

test("a stage that fails stops the compose and names it", async () => {
  const p = project({ locales: ["en"] });
  process.env.FAKE_FAIL = "search.mov";
  await assert.rejects(quietly(() => compose(p.plan, { ...p.flags, jobs: "1" })), /ffmpeg failed on stage 1, scene "search" \(iphone, en\) \(exit status 1\):\nError while filtering/);
  assert.ok(!readdirSync(path.join(p.root, "work")).some((name) => name.includes("partial")));
});

test("a preview for an older iPhone is cut from the iPhone's recordings", async () => {
  const p = project({ displays: ["iphone-5.5"], locales: ["en"] });
  assert.ok(existsSync(path.join(p.root, "raw", "iphone", "en", "inbox.mov")));
  /** @type {any[]} */
  let results = [];
  await quietly(async () => {
    results = await compose(p.plan, p.flags);
  });
  assert.equal(path.relative(p.root, results[0].file), path.join("out", "en", "iphone-5.5", "preview.mp4"));
  const inbox = calls().find((call) => call.args.includes(path.join(p.root, "raw", "iphone", "en", "inbox.mov")));
  assert.ok(inbox, calls().map((call) => call.args.join(" ")).join("\n"));
  assert.ok(inbox.args.join(" ").includes("1080:1920"), inbox.args.join(" "));

  // A sidecar that does not name its movie is looked up in the same folder.
  rmSync(path.join(p.root, "work"), { recursive: true, force: true });
  rmSync(log, { force: true });
  setParts({
    readSidecar: (/** @type {[string, string, string, string]} */ ...args) => {
      const { file, ...rest } = /** @type {any} */ (doubles.readSidecar(...args));
      return rest;
    },
  });
  await quietly(() => compose(p.plan, p.flags));
  assert.ok(calls().some((call) => call.args.includes(path.join(p.root, "raw", "iphone", "en", "inbox.mov"))));
});

test("a compose again moves the poster the plan moved, without encoding the preview again", async () => {
  const p = project({ locales: ["en"] });
  await quietly(() => compose(p.plan, p.flags));
  const record = path.join(p.root, "out", "en", "iphone", "preview.check.json");
  const first = JSON.parse(readFileSync(record, "utf8"));
  rmSync(log, { force: true });

  const printed = await quietly(() => compose({ ...p.plan, poster: { time: 12 } }, p.flags));
  assert.equal(calls().length, 0);
  assert.match(printed, /preview\.mp4 is unchanged/);
  assert.match(printed, /poster at 12 s/);
  assert.deepEqual(
    p.posters.map((poster) => poster.at),
    [2.966666666666667, 12],
  );
  const moved = JSON.parse(readFileSync(record, "utf8"));
  assert.deepEqual(moved.poster, { seconds: 12, timecode: "00:00:12:00" });
  // The video, and so what the check found of it, is the one that was there.
  assert.deepEqual([moved.key, moved.bytes, moved.probe], [first.key, first.bytes, first.probe]);

  // Nothing moved this time: no poster, and the record stays as it is.
  const again = await quietly(() => compose({ ...p.plan, poster: { time: 12 } }, p.flags));
  assert.doesNotMatch(again, /poster at/);
  assert.equal(p.posters.length, 2);
  assert.equal(JSON.parse(readFileSync(record, "utf8")).checkedAt, moved.checkedAt);

  // A poster that is gone is exported again.
  rmSync(path.join(p.root, "out", "en", "iphone", "preview.poster.png"));
  await quietly(() => compose({ ...p.plan, poster: { time: 12 } }, p.flags));
  assert.ok(existsSync(path.join(p.root, "out", "en", "iphone", "preview.poster.png")));
});

test("a poster chosen with 'video poster --at' stays where it was put, through a compose that reuses the preview or encodes it again", async () => {
  const p = project({ locales: ["en"] });
  await quietly(() => compose(p.plan, p.flags));
  const record = path.join(p.root, "out", "en", "iphone", "preview.check.json");
  // What 'video poster --at 10' leaves: the record as it was, with the time it chose.
  const choose = (/** @type {number} */ seconds) => writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, "utf8")), poster: { seconds, timecode: "00:00:10:00", chosen: true } }));
  choose(10);
  p.posters.length = 0;
  rmSync(log, { force: true });

  await quietly(() => compose(p.plan, p.flags));
  assert.equal(calls().length, 0);
  assert.deepEqual(p.posters, []);
  assert.deepEqual(JSON.parse(readFileSync(record, "utf8")).poster, { seconds: 10, timecode: "00:00:10:00", chosen: true });

  // A new caption makes a new video, and the poster stays at the time that was chosen.
  writeFileSync(path.join(p.root, "layers", p.manifests.iphone.set, "en", "caption-search.png"), Buffer.concat([PIXEL, Buffer.from("other words")]));
  await quietly(() => compose(p.plan, p.flags));
  assert.ok(calls().some(isJoin));
  assert.deepEqual(
    p.posters.map((poster) => poster.at),
    [10],
  );
  assert.deepEqual(JSON.parse(readFileSync(record, "utf8")).poster, { seconds: 10, timecode: "00:00:10:00", chosen: true });

  // A preview that came out shorter than the time keeps its poster on its last frame. 19.9 s is 597 frames.
  choose(25);
  writeFileSync(path.join(p.root, "layers", p.manifests.iphone.set, "en", "caption-search.png"), Buffer.concat([PIXEL, Buffer.from("more words")]));
  await quietly(() => compose(p.plan, p.flags));
  assert.equal(p.posters.at(-1)?.at, 596 / 30);
  assert.equal(JSON.parse(readFileSync(record, "utf8")).poster.chosen, true);
});

test("what the check cannot see in the file, the cut's warnings, goes into the record and the lines, and fails nothing", async () => {
  const p = project({ locales: ["en"], captionStyle: "band" });
  const inbox = p.manifests.iphone.layers.find((/** @type {any} */ layer) => layer.id === "caption-inbox" && layer.locale === "en");
  inbox.fit = 0.6;
  /** @type {any[]} */
  let results = [];
  // Cards of 2.5 and 2 s, and the first scene comes in at 2.5 − 0.4 s.
  const printed = await quietly(async () => {
    results = await compose({ ...p.plan, intro: { seconds: 2.5 } }, p.flags);
  });
  const rules = ["cards", "first-app-frame", "caption-style", "caption-fit"];
  assert.deepEqual(
    results[0].check.warnings.map((/** @type {any} */ rule) => rule.rule),
    rules,
  );
  assert.deepEqual(results[0].check.errors, []);
  for (const rule of rules) assert.match(printed, new RegExp(`warning: ${rule} is`));
  assert.match(printed, /first-app-frame is 2\.10 s/);
  const record = JSON.parse(readFileSync(path.join(p.root, "out", "en", "iphone", "preview.check.json"), "utf8"));
  assert.deepEqual(
    record.cut.map((/** @type {any} */ rule) => rule.rule),
    rules,
  );
  // The file's own findings stay apart from the cut's, as 'video check' adds the one to the other.
  assert.deepEqual(record.warnings, []);
});
