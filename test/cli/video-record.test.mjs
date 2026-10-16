import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import vm from "node:vm";
import { cliHome, quietly, scriptedRunner } from "./helpers.mjs";

const home = await cliHome("video-record");
after(() => home.remove());
process.env.DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
process.env.APPSHOTS_NO_WINDOW = "1";

// The recorder codes against ffmpeg.mjs and plan.mjs of the video command, which are stood in for here: what
// they answer is the test's to say.
const VIDEO = new URL("../../cli/src/video/", import.meta.url);
const DOUBLES = {
  [new URL("ffmpeg.mjs", VIDEO).href]: "export const findFfmpeg = (...args) => globalThis.videoDoubles.findFfmpeg(...args);",
  [new URL("plan.mjs", VIDEO).href]: "export const planHash = (...args) => globalThis.videoDoubles.planHash(...args);\nexport const readPlan = (...args) => globalThis.videoDoubles.readPlan(...args);",
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
/** @type {Array<{ root: string }>} */
const ffmpegAsked = [];
/** @type {any} */ (globalThis).videoDoubles = {
  findFfmpeg: async (/** @type {any} */ options) => {
    ffmpegAsked.push(options);
    return { ffmpeg: "ffmpeg", ffprobe: "ffprobe", version: "7.1", encoders: new Set(["libx264"]), filters: new Set(["freezedetect"]) };
  },
  planHash: () => "9f2c41d0",
  readPlan: () => assert.fail("the recorder reads no plan"),
};

const { host, setRunner } = await import("../../cli/src/proc.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
const { setSpawner, startRecorder } = await import("../../cli/src/video/record/spawn.mjs");
const { Interrupted, interruption } = await import("../../cli/src/video/record/session.mjs");
const { readSidecar, recordScenes } = await import("../../cli/src/video/record/index.mjs");
const { buildUiTests, forgetUiTests, startDriver } = await import("../../cli/src/video/record/drive.mjs");
const { sidecarTouches, touchOf } = await import("../../cli/src/video/record/touches.mjs");
const { deviceSource } = await import("../../cli/src/video/record/device.mjs");
const { macSource } = await import("../../cli/src/video/record/mac.mjs");
const { clockScript } = await import("../../cli/src/video/record/web.mjs");
const { importFootage } = await import("../../cli/src/video/import.mjs");
host.platform = "darwin";

const bench = mkdtempSync(path.join(tmpdir(), "appshots-record-"));
after(() => rmSync(bench, { recursive: true, force: true }));

// A recorder that behaves as simctl does: it says when it records, finishes its movie on SIGINT, and leaves an
// empty file on SIGTERM. "silent" never says it records, "dies" stops at once, "length" records for its -V
// seconds and ends by itself, as screencapture does.
const RECORDER = path.join(bench, "recorder.mjs");
writeFileSync(
  RECORDER,
  `import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const file = args.includes("--destination") ? args[args.indexOf("--destination") + 1] : args.at(-1);
const mode = process.env.FAKE_RECORDER;
const log = (line) => appendFileSync(process.env.FAKE_LOG, line + "\\n");
log("start");
if (mode === "dies") {
  process.stderr.write("An error was encountered processing the command (code=405).\\n");
  process.exit(1);
}
process.on("SIGINT", () => {
  log("SIGINT");
  writeFileSync(file, "a finished movie");
  process.stderr.write("Wrote video to: " + file + "\\n");
  process.exit(0);
});
process.on("SIGTERM", () => {
  log("SIGTERM");
  writeFileSync(file, "");
  process.exit(143);
});
if (mode === "simctl") setTimeout(() => process.stderr.write("Note: No display specified, so the main display is used.\\nRecording started\\n"), 50);
if (mode === "length") setTimeout(() => (writeFileSync(file, "a movie of set length"), process.exit(0)), Number(args.find((arg) => arg.startsWith("-V")).slice(2)) * 1000);
setInterval(() => {}, 1000);
`,
);

// A driver, and a UI test run, that write down what they were given, report a touch on stdout and one in the
// touch log, and end after a moment; with --fail they fail.
const DRIVER = path.join(bench, "driver.mjs");
const DRIVEN = path.join(bench, "driven.json");
writeFileSync(
  DRIVER,
  `import { appendFileSync, writeFileSync } from "node:fs";
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.includes("APPSHOTS_")));
writeFileSync(${JSON.stringify(DRIVEN)}, JSON.stringify({ argv: process.argv.slice(2), env, cwd: process.cwd() }));
console.log("APPSHOTS_TOUCH 100 10 20");
if (process.env.APPSHOTS_TOUCH_LOG) appendFileSync(process.env.APPSHOTS_TOUCH_LOG, "APPSHOTS_TOUCH 300 30 40\\n");
setTimeout(() => process.exit(process.argv.includes("--fail") ? 3 : 0), 400);
`,
);

const fake = { mode: "simctl", log: path.join(bench, "signals.log"), started: 0, onStart: /** @type {(() => void) | null} */ (null) };
/** @type {string[][]} */
const spawned = [];
const before = setSpawner((command, args, options) => {
  spawned.push([command, ...args]);
  if ((command === "xcrun" && ["recordVideo", "screen-record"].includes(args[3])) || command === "screencapture") {
    fake.started++;
    fake.onStart?.();
    return spawn(process.execPath, [RECORDER, ...args], { ...options, env: { ...process.env, FAKE_RECORDER: fake.mode, FAKE_LOG: fake.log } });
  }
  if (command === "xcodebuild") return spawn(process.execPath, [DRIVER, ...args], options);
  return spawn(command, args, options);
});
after(() => setSpawner(before));
/** @type {number[]} */
const exits = [];
interruption.exit = (code) => void exits.push(code);

const SIM = "A1B2C3D4-0000-4000-8000-000000000001";
const RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-26-0";
const LIST = {
  devicetypes: [{ identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max", name: "iPhone 17 Pro Max", productFamily: "iPhone" }],
  runtimes: [{ identifier: RUNTIME, name: "iOS 26.0", version: "26.0", isAvailable: true }],
  devices: { [RUNTIME]: [{ name: "Bench iPhone", udid: SIM, state: "Booted", isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max" }] },
};
const state = { appearance: "light", probe: /** @type {any} */ ({ streams: [{ codec_type: "video", width: 1320, height: 2868 }], format: { duration: "3.2" } }), osascript: /** @type {(script: string) => string} */ (() => "") };
const { runner, calls } = scriptedRunner((command, args) => {
  if (command === "xcrun" && args[0] === "simctl" && args[1] === "list") return { stdout: JSON.stringify(LIST) };
  if (command === "xcrun" && args[1] === "listapps") return { stdout: "{}" };
  if (command === "plutil") return { stdout: JSON.stringify({ "com.example.notes": { ApplicationType: "User", CFBundleIdentifier: "com.example.notes", CFBundleName: "Notes" } }) };
  if (command === "xcrun" && args[1] === "ui") {
    if (args.length === 5) state.appearance = args[4];
    return { stdout: `${state.appearance}\n` };
  }
  if (command === "xcrun" && args[0] === "devicectl" && args[1] === "list") {
    const devices = [{ identifier: "E5F6", deviceProperties: { name: "Bench Phone", osVersionNumber: "26.1" }, hardwareProperties: { udid: "00008140-000000000000BEEF", marketingName: "iPhone 17 Pro", deviceType: "iPhone", reality: "physical" }, connectionProperties: { tunnelState: "connected" } }];
    writeFileSync(args[args.indexOf("--json-output") + 1], JSON.stringify({ result: { devices } }));
    return {};
  }
  if (command === "ffprobe") return { stdout: JSON.stringify(state.probe) };
  if (command === "osascript") return { stdout: state.osascript(args.at(-1) ?? "") };
  if (command === "sw_vers") return { stdout: "26.0\n" };
  return {};
});
const runnerBefore = setRunner(runner);
after(() => setRunner(runnerBefore));

const project = path.join(bench, "project");
mkdirSync(project, { recursive: true });
process.chdir(project);
const PLAN = path.join(project, "appshots.video.json");
const RAW = path.join(project, "appshots-video", "raw");

/** @param {any} [changes] */
function plan(changes = {}) {
  return {
    version: 1,
    project: "p_example",
    app: { platform: "ios", bundleId: "com.example.notes" },
    displays: ["iphone"],
    locales: ["en", "de"],
    scenes: [
      { id: "inbox", launch: { args: ["-AppshotsDemo", "inbox"], appearance: "dark" }, drive: { command: [process.execPath, DRIVER] }, record: { settle: 0 } },
      { id: "search", drive: { wait: 1 }, record: { settle: 0 } },
    ],
    ...changes,
  };
}

/** Everything left in a folder of recordings. */
const filesIn = (/** @type {string} */ dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const signals = () => (existsSync(fake.log) ? readFileSync(fake.log, "utf8").trim().split("\n") : []);

beforeEach(() => {
  rmSync(path.join(project, "appshots-video"), { recursive: true, force: true });
  rmSync(fake.log, { force: true });
  rmSync(DRIVEN, { force: true });
  calls.length = 0;
  spawned.length = 0;
  exits.length = 0;
  fake.mode = "simctl";
  fake.started = 0;
  fake.onStart = null;
  state.appearance = "light";
  state.probe = { streams: [{ codec_type: "video", width: 1320, height: 2868 }], format: { duration: "3.2" } };
});

test("a run on a fake simctl writes a movie and a sidecar for each scene and language", async () => {
  /** @type {any[]} */
  let written = [];
  const printed = await quietly(async () => (written = await recordScenes(plan(), { plan: PLAN, sim: "Bench iPhone" })));
  assert.equal(written.length, 4);
  for (const locale of ["en", "de"]) assert.deepEqual(filesIn(path.join(RAW, "iphone", locale)), ["inbox.json", "inbox.mov", "search.json", "search.mov"]);
  const sidecar = JSON.parse(readFileSync(path.join(RAW, "iphone", "de", "inbox.json"), "utf8"));
  // The keys in the order the sidecar's description has them.
  assert.deepEqual(Object.keys(sidecar), ["version", "scene", "locale", "display", "source", "model", "os", "size", "scale", "orientation", "wall", "driverOffset", "touches", "trim", "reuse", "planHash", "recordedAt"]);
  assert.equal(sidecar.scene, "inbox");
  assert.equal(sidecar.locale, "de");
  assert.equal(sidecar.display, "iphone");
  assert.equal(sidecar.source, "sim");
  assert.equal(sidecar.model, "iPhone 17 Pro Max");
  assert.equal(sidecar.os, "26.0");
  assert.deepEqual(sidecar.size, [1320, 2868]);
  assert.equal(sidecar.scale, 3);
  assert.equal(sidecar.orientation, "portrait");
  assert.equal(sidecar.trim, null);
  assert.equal(sidecar.reuse, null);
  assert.equal(sidecar.planHash, "9f2c41d0");
  assert.match(sidecar.recordedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  // The touches the driver printed and logged, at their time from the start of the recording, in pixels.
  assert.deepEqual(
    sidecar.touches.map((/** @type {number[]} */ touch) => touch.slice(1)),
    [
      [30, 60],
      [90, 120],
    ],
  );
  assert.ok(Math.abs(sidecar.touches[0][0] - (sidecar.driverOffset + 0.1)) < 0.02, `the first touch at ${sidecar.touches[0][0]}`);
  assert.ok(sidecar.driverOffset >= 0 && sidecar.driverOffset < 1, `the driver started ${sidecar.driverOffset} s in`);
  // The recorder was asked to stop with SIGINT every time, and never with anything else.
  assert.deepEqual(signals(), ["start", "SIGINT", "start", "SIGINT", "start", "SIGINT", "start", "SIGINT"]);
  const recordings = spawned.filter((argv) => argv[4] === "recordVideo");
  assert.equal(recordings.length, 4);
  assert.deepEqual(recordings[0].slice(0, 7), ["xcrun", "simctl", "io", SIM, "recordVideo", "--codec=h264", "--force"]);
  assert.match(recordings[0][7], /inbox\.recording\.mov$/);
  // The driver ran from the plan's folder with what it drives in its environment.
  const driven = JSON.parse(readFileSync(DRIVEN, "utf8"));
  assert.equal(driven.cwd, realpathSync(project));
  assert.equal(driven.env.APPSHOTS_LOCALE, "de");
  assert.equal(driven.env.APPSHOTS_DISPLAY, "iphone");
  assert.equal(driven.env.APPSHOTS_SCENE, "inbox");
  assert.equal(driven.env.APPSHOTS_UDID, SIM);
  assert.ok(Number(driven.env.APPSHOTS_START) > 1e12);
  // The app started in each language with the scene's arguments, dark for the scene that asks for it.
  assert.ok(calls.includes(`xcrun simctl launch --terminate-running-process ${SIM} com.example.notes -AppshotsDemo inbox -AppleLanguages (de) -AppleLocale de`));
  assert.ok(calls.includes(`xcrun simctl launch --terminate-running-process ${SIM} com.example.notes -AppleLanguages (en) -AppleLocale en`));
  assert.ok(calls.includes(`xcrun simctl ui ${SIM} appearance dark`));
  // The status bar was set once for the run and cleared at its end, and the simulator is light again.
  assert.equal(calls.filter((call) => call.startsWith(`xcrun simctl status_bar ${SIM} override`)).length, 1);
  assert.equal(calls.at(-1), `xcrun simctl status_bar ${SIM} clear`);
  assert.equal(state.appearance, "light");
  assert.equal(ffmpegAsked.at(-1)?.root, path.join(project, "appshots-video"));
  assert.match(printed, /Recorded inbox \(de, iphone\): [\d.]+ s, 2 touches/);
  assert.match(printed, /Recorded 4 scenes\. Next: appshots video sheet --raw/);

  // What has a recording is left alone, unless asked for again.
  spawned.length = 0;
  const again = await quietly(async () => assert.deepEqual(await recordScenes(plan(), { plan: PLAN, sim: "Bench iPhone" }), []));
  assert.equal(spawned.length, 0);
  assert.match(again, /Every scene has a recording already/);
  await quietly(async () => assert.equal((await recordScenes(plan(), { plan: PLAN, sim: "Bench iPhone", again: true, scene: "search", lang: "de" })).length, 1));
  assert.equal(spawned.length, 1);
});

test("the wall time is the clock's from 'Recording started' to the SIGINT, whatever the movie says", async () => {
  // simctl drops still frames, so a movie of a still screen says it is shorter than it took.
  state.probe = { streams: [{ codec_type: "video", width: 1320, height: 2868 }], format: { duration: "0.07" } };
  /** @type {any[]} */
  let written = [];
  const scenes = [{ id: "search", drive: { wait: 2.1 }, record: { settle: 0 } }];
  const printed = await quietly(async () => (written = await recordScenes(plan({ scenes }), { plan: PLAN, sim: "Bench iPhone", lang: "en" })));
  assert.equal(written.length, 1);
  assert.ok(written[0].wall >= 2.05 && written[0].wall < 3.5, `wall ${written[0].wall}`);
  assert.equal(written[0].file, path.join(RAW, "iphone", "en", "search.mov"));
  assert.match(printed, /Little moved on screen while search recorded/);
});

test("Ctrl+C finishes and deletes the recording in progress, keeps the earlier ones, clears the status bar and ends with 130", async () => {
  const scenes = [
    { id: "inbox", drive: { wait: 0.3 }, record: { settle: 0 } },
    { id: "share", drive: { wait: 8 }, record: { settle: 0 } },
  ];
  // The second recording is stopped a moment after it starts, as a person pressing Ctrl+C would.
  fake.onStart = () => fake.started === 2 && setTimeout(() => process.emit("SIGINT"), 300);
  const started = Date.now();
  await quietly(() => assert.rejects(recordScenes(plan({ scenes, locales: ["en"] }), { plan: PLAN, sim: "Bench iPhone" }), (error) => error instanceof Interrupted && error.code === 130));
  assert.ok(Date.now() - started < 6000, "it did not wait for the scene to run its length");
  assert.deepEqual(exits, [130]);
  assert.deepEqual(filesIn(path.join(RAW, "iphone", "en")), ["inbox.json", "inbox.mov"]);
  assert.deepEqual(signals(), ["start", "SIGINT", "start", "SIGINT"]);
  assert.equal(calls.at(-1), `xcrun simctl status_bar ${SIM} clear`);
  // The handler is gone again, so a later Ctrl+C is the terminal's.
  assert.equal(process.listeners("SIGINT").length, 0);
});

test("a stop asked for by another program ends with 143", async () => {
  const scenes = [{ id: "share", drive: { wait: 8 }, record: { settle: 0 } }];
  fake.onStart = () => setTimeout(() => process.emit("SIGTERM"), 300);
  await quietly(() => assert.rejects(recordScenes(plan({ scenes, locales: ["en"] }), { plan: PLAN, sim: "Bench iPhone" }), (error) => error instanceof Interrupted && error.code === 143));
  assert.deepEqual(exits, [143]);
  assert.deepEqual(filesIn(path.join(RAW, "iphone", "en")), []);
  assert.deepEqual(signals(), ["start", "SIGINT"]);
});

test("a driver that fails fails its scene, and its movie is deleted", async () => {
  const scenes = [{ id: "inbox", drive: { command: [process.execPath, DRIVER, "--fail"] }, record: { settle: 0 } }];
  await quietly(() => assert.rejects(recordScenes(plan({ scenes, locales: ["en"] }), { plan: PLAN, sim: "Bench iPhone" }), (error) => error instanceof Failure && /The driver .* failed with exit code 3\.\nAPPSHOTS_TOUCH 100 10 20/.test(error.message)));
  assert.deepEqual(filesIn(path.join(RAW, "iphone", "en")), []);
  assert.deepEqual(signals(), ["start", "SIGINT"]);
  assert.equal(calls.at(-1), `xcrun simctl status_bar ${SIM} clear`);
});

test("the recorder is waited for until it says it records, and no longer than its time", async () => {
  fake.mode = "silent";
  const file = path.join(bench, "silent.mov");
  const asked = Date.now();
  await assert.rejects(
    startRecorder("simctl", "xcrun", ["simctl", "io", SIM, "recordVideo", file], { ready: /Recording started/, timeout: 2000 }),
    (error) => error instanceof Failure && /^simctl did not start recording within 2 seconds\./.test(error.message),
  );
  // Well short of the 10 seconds a recorder is given by default, with room for a busy Mac.
  assert.ok(Date.now() - asked < 9000);
  assert.deepEqual(signals(), ["start", "SIGINT"]);

  rmSync(fake.log, { force: true });
  fake.mode = "dies";
  await assert.rejects(
    startRecorder("simctl", "xcrun", ["simctl", "io", SIM, "recordVideo", file], { ready: /Recording started/ }),
    (error) => error instanceof Failure && /^simctl stopped before it started recording\.\nAn error was encountered processing the command \(code=405\)\./.test(error.message),
  );

  fake.mode = "simctl";
  const recorder = await startRecorder("simctl", "xcrun", ["simctl", "io", SIM, "recordVideo", file], { ready: /Recording started/ });
  const exit = await recorder.stop();
  assert.equal(exit.status, 0);
  assert.ok(exit.stopped >= recorder.started);
  assert.equal(readFileSync(file, "utf8"), "a finished movie");
});

test("a scene driven by hand needs a person at the Terminal, which is said before anything is recorded", async () => {
  const scenes = [
    { id: "inbox", drive: { wait: 1 } },
    { id: "share", drive: "manual" },
  ];
  ffmpegAsked.length = 0;
  await assert.rejects(
    recordScenes(plan({ scenes }), { plan: PLAN, sim: "Bench iPhone" }),
    (error) => error instanceof Failure && /needs a person at the Terminal\. Ask the user to run 'appshots video record --scene share' in their own Terminal/.test(error.message),
  );
  await assert.rejects(recordScenes(plan(), { plan: PLAN, sim: "Bench iPhone", manual: true }), /The scene inbox is driven by hand/);
  assert.equal(spawned.length, 0);
  assert.equal(ffmpegAsked.length, 0);
  assert.deepEqual(calls, []);
});

test("one language's footage serves them all with footage primary, and readSidecar follows it", async () => {
  await quietly(() => recordScenes(plan({ footage: "primary", scenes: [{ id: "search", drive: { wait: 0.3 }, record: { settle: 0 } }] }), { plan: PLAN, sim: "Bench iPhone" }));
  assert.equal(fake.started, 1);
  assert.deepEqual(filesIn(path.join(RAW, "iphone", "de")), ["search.json"]);
  const stored = JSON.parse(readFileSync(path.join(RAW, "iphone", "de", "search.json"), "utf8"));
  assert.equal(stored.reuse, "en");
  const read = readSidecar(path.join(project, "appshots-video"), "iphone", "de", "search");
  assert.equal(read?.file, path.join(RAW, "iphone", "en", "search.mov"));
  assert.equal(read?.locale, "de");
  assert.equal(read?.reuse, "en");
  // The plan's folder does as well as the work folder, and an older iPhone size reads the iPhone's footage.
  assert.equal(readSidecar(project, "iphone-6.5", "en", "search")?.file, path.join(RAW, "iphone", "en", "search.mov"));
  assert.equal(readSidecar(project, "iphone", "fr", "search"), null);
  rmSync(path.join(RAW, "iphone", "en", "search.mov"));
  assert.equal(readSidecar(project, "iphone", "de", "search"), null);
});

test("a UI test is built once per run and runs with what it drives in its environment", async () => {
  forgetUiTests();
  const simulator = { name: "Bench iPhone", udid: SIM };
  const project = path.join(bench, "Notes.xcodeproj");
  /** @type {any[]} */
  let built = [];
  await quietly(async () => (built = await Promise.all([buildUiTests(project, "Notes", simulator, false), buildUiTests(project, "Notes", simulator, false)])));
  const [first, second] = built;
  assert.equal(calls.filter((call) => call.startsWith("xcodebuild") && call.endsWith("build-for-testing")).length, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first.args, ["-project", project, "-scheme", "Notes", "-destination", `platform=iOS Simulator,id=${SIM}`]);

  const touchLog = path.join(bench, "touches.log");
  const driving = startDriver({ uitest: "NotesUITests/PreviewTests/testInbox" }, { scene: "inbox", locale: "de", display: "iphone", cwd: bench, touchLog, seconds: 10, simulator, tests: first });
  const outcome = await driving.done;
  assert.equal(outcome.failed, undefined);
  assert.deepEqual(outcome.touches, [{ ms: 100, x: 10, y: 20 }]);
  assert.deepEqual(spawned.at(-1), ["xcodebuild", "test-without-building", ...first.args, "-only-testing:NotesUITests/PreviewTests/testInbox"]);
  const driven = JSON.parse(readFileSync(DRIVEN, "utf8"));
  // xcodebuild hands TEST_RUNNER_<name> to the test as <name>.
  assert.equal(driven.env.TEST_RUNNER_APPSHOTS_LOCALE, "de");
  assert.equal(driven.env.TEST_RUNNER_APPSHOTS_UDID, SIM);
  assert.equal(driven.env.TEST_RUNNER_APPSHOTS_TOUCH_LOG, touchLog);
  assert.equal(driven.env.APPSHOTS_SCENE, "inbox");
  rmSync(touchLog, { force: true });
});

test("a touch is counted from the driver's start, or read as a clock's time", () => {
  assert.deepEqual(touchOf("  APPSHOTS_TOUCH 1250 201.5 640"), { ms: 1250, x: 201.5, y: 640 });
  assert.equal(touchOf("Test Case '-[NotesUITests testInbox]' passed"), null);
  const driverStart = 1_760_000_000_000;
  assert.deepEqual(
    sidecarTouches(
      [
        { ms: 1250, x: 67, y: 213.4 },
        { ms: driverStart + 400, x: 10, y: 10 },
        { ms: 1250, x: 67, y: 213.4 },
        { ms: 9000, x: 1, y: 1 },
      ],
      { driverStart, offset: 0.25, scale: 3, wall: 5 },
    ),
    [
      [0.65, 30, 30],
      [1.5, 201, 640],
    ],
  );
});

test("a web page's clock answers for Date with new and without, and moves only when it is stepped", async () => {
  // Just enough of a window for the clock: its own Date, timers and animation frames come from the context.
  const page = vm.createContext({ performance: { now: () => 12345 }, document: { getAnimations: () => [] }, setTimeout, requestAnimationFrame: (/** @type {Function} */ fn) => setTimeout(() => fn(0), 0) });
  page.window = page;
  const epoch = Date.UTC(2026, 0, 2, 9, 41);
  vm.runInContext(clockScript(epoch), page);
  const at = (/** @type {string} */ code) => vm.runInContext(code, page);
  assert.equal(at("Date.now()"), epoch);
  assert.equal(at("new Date().getTime()"), epoch);
  assert.equal(at("Date()"), new Date(epoch).toString());
  assert.equal(at("new Date(0).getTime()"), 0);
  assert.equal(at("new Date(2020, 1, 3).getMonth()"), 1);
  assert.equal(at("Date.UTC(2020, 0, 1)"), Date.UTC(2020, 0, 1));
  assert.equal(at("Date.parse('2020-01-01T00:00:00Z')"), Date.UTC(2020, 0, 1));
  assert.equal(at("new Date() instanceof Date && new Date().constructor === Date"), true);
  assert.equal(at("class Later extends Date {}; const later = new Later(); later instanceof Later && later.getTime()"), epoch);

  at("var ticks = []; setInterval(() => ticks.push(performance.now()), 100); setTimeout(() => ticks.push('once'), 150);");
  assert.equal(at("performance.now()"), 0);
  await at("__appshotsStep(250)");
  assert.equal(at("JSON.stringify(ticks)"), JSON.stringify([100, "once", 200]));
  assert.equal(at("performance.now()"), 250);
  assert.equal(at("Date.now()"), epoch + 250);
  assert.equal(at("Date()"), new Date(epoch + 250).toString());
});

test("a device records with devicectl's screen recorder, after the app is launched in the scene's language", async () => {
  fake.mode = "silent";
  /** @type {any} */
  let source;
  const printed = await quietly(async () => (source = await deviceSource("iphone", plan(), { device: "Bench Phone" })));
  assert.match(printed, /Recording from a device is experimental/);
  assert.match(printed, /shows its own time and battery/);
  assert.equal(source.model, "iPhone 17 Pro");
  assert.equal(source.os, "26.1");
  assert.equal(source.extension, ".mp4");
  await quietly(() => source.open({ id: "inbox", launch: { args: ["-AppshotsDemo", "inbox"], url: "notes://inbox" } }, "de"));
  assert.equal(calls.at(-1), "xcrun devicectl device process launch --device 00008140-000000000000BEEF --terminate-existing --payload-url notes://inbox com.example.notes -AppshotsDemo inbox -AppleLanguages (de) -AppleLocale de");
  const file = path.join(bench, "device.mp4");
  const recorder = await source.record(file, { seconds: 4 });
  assert.deepEqual(spawned.at(-1), ["xcrun", "devicectl", "device", "capture", "screen-record", "--device", "00008140-000000000000BEEF", "--destination", file, "--codec", "h264"]);
  assert.equal((await recorder.stop()).status, 0);
  assert.deepEqual(signals(), ["start", "SIGINT"]);
  assert.match(source.help, /QuickTime Player.*appshots video import/);
  await assert.rejects(quietly(() => deviceSource("ipad", plan(), { device: "Bench Phone" })), /Bench Phone is an iPhone, and the ipad footage is recorded on an iPad/);
});

test("a Mac window records with screencapture for a set length, after the app starts again in the scene's language", async () => {
  fake.mode = "length";
  let running = "true";
  state.osascript = (script) => {
    if (script.includes("is running")) {
      const answer = running;
      running = "false";
      return answer;
    }
    if (script.includes("CGWindowListCopyWindowInfo")) return JSON.stringify([{ id: 42, app: "Ledger", width: 1200, height: 800 }]);
    return "";
  };
  const ledger = plan({ app: { platform: "mac", bundleId: "com.example.ledger" }, displays: ["mac"] });
  /** @type {any} */
  let source;
  await quietly(async () => (source = await macSource(ledger, { mac: "Ledger" })));
  assert.equal(source.padded, true);
  await quietly(() => source.open({ id: "books", launch: { appearance: "dark" } }, "de"));
  assert.ok(calls.includes('osascript -e tell application id "com.example.ledger" to quit'));
  assert.ok(calls.includes("open -b com.example.ledger --args -AppleLanguages (de) -AppleLocale de -AppleInterfaceStyle Dark"));
  const file = path.join(bench, "window.mov");
  const recorder = await source.record(file, { seconds: 0.6 });
  assert.deepEqual(spawned.at(-1), ["screencapture", "-x", "-o", "-v", "-V1", "-l42", file]);
  const exit = await recorder.stop();
  assert.equal(exit.status, 0);
  assert.equal(exit.stopped, recorder.started + 1000);
  // Nothing was sent to it: a signal would have lost the movie.
  assert.deepEqual(signals(), ["start"]);
  assert.equal(readFileSync(file, "utf8"), "a movie of set length");
  assert.equal(source.scale([2400, 1600]), 2);
  state.osascript = () => "";
});

test("a movie made elsewhere is imported as a scene's footage, upright as it plays", async () => {
  const movie = path.join(bench, "From QuickTime.MOV");
  writeFileSync(movie, "a movie from QuickTime");
  // Recorded on its side and marked to be shown turned.
  state.probe = { streams: [{ codec_type: "video", width: 2868, height: 1320, side_data_list: [{ rotation: -90 }] }, { codec_type: "audio" }], format: { duration: "4.504" } };
  /** @type {any} */
  let imported;
  const printed = await quietly(async () => (imported = await importFootage(plan({ footage: "primary" }), movie, { plan: PLAN, scene: "inbox" })));
  assert.equal(imported.file, path.join(RAW, "iphone", "en", "inbox.mov"));
  assert.equal(readFileSync(imported.file, "utf8"), "a movie from QuickTime");
  const sidecar = JSON.parse(readFileSync(path.join(RAW, "iphone", "en", "inbox.json"), "utf8"));
  assert.equal(sidecar.source, "import");
  assert.deepEqual(sidecar.size, [1320, 2868]);
  assert.equal(sidecar.wall, 4.5);
  assert.deepEqual(sidecar.touches, []);
  assert.match(printed, /Imported From QuickTime\.MOV as inbox \(en, iphone\): 1320×2868, 4\.5 s/);
  // The plan records one language's footage for all, so German uses it.
  assert.equal(readSidecar(project, "iphone", "de", "inbox")?.file, imported.file);
  assert.deepEqual(filesIn(path.join(RAW, "iphone", "en")), ["inbox.json", "inbox.mov"]);

  state.probe = { streams: [{ codec_type: "video", width: 1320, height: 2868 }], format: { duration: "0.6" } };
  await assert.rejects(importFootage(plan(), movie, { plan: PLAN, scene: "inbox" }), /is 0\.6 seconds long; a scene's footage takes a second at least/);
  state.probe = { streams: [{ codec_type: "audio" }], format: { duration: "9" } };
  await assert.rejects(importFootage(plan(), movie, { plan: PLAN, scene: "inbox" }), /holds no video that ffprobe can read/);
  await assert.rejects(importFootage(plan(), movie, { plan: PLAN }), /--scene says which scene From QuickTime\.MOV is/);
  await assert.rejects(importFootage(plan({ displays: ["iphone", "ipad"] }), movie, { plan: PLAN, scene: "inbox" }), /say which one From QuickTime\.MOV is for with --display/);
  writeFileSync(path.join(bench, "notes.txt"), "");
  await assert.rejects(importFootage(plan(), path.join(bench, "notes.txt"), { plan: PLAN, scene: "inbox" }), /is not a kind of movie appShots takes/);
});
