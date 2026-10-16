import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { cliHome, PIXEL, png, quietly, stubServer } from "./helpers.mjs";

// A Mac with an iPhone and an iPad simulator, and a server with one project in English and German, all stood in for.
const home = await cliHome("capture-plan");
after(() => home.remove());

/** What the project has, as GET /api/projects/:id answers. */
let shots = [];
const server = await stubServer(({ method, url }) => {
  if (method === "GET" && url === "/api/projects/demo") return [200, { project: { id: "demo", locales: ["en", "de"] }, shots }];
  const shot = /^\/api\/projects\/demo\/shots\/([^?]+)\?(.*)$/.exec(url);
  if (method === "PUT" && shot) {
    const query = new URLSearchParams(shot[2]);
    return [201, { name: decodeURIComponent(shot[1]), device: query.get("device"), locale: query.get("locale"), width: 1320, height: 2868 }];
  }
  return [404, { error: "not found" }];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;
process.env.APPSHOTS_TOKEN = "test-token";
process.env.APPSHOTS_NO_WINDOW = "1";
process.env.DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";

const { host, setRunner } = await import("../../cli/src/proc.mjs");
const { parseArgs } = await import("../../cli/src/args.mjs");
const { shoot } = await import("../../cli/src/shoot.mjs");
const { forgetSimulators } = await import("../../cli/src/sim.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
host.platform = "darwin";

/**
 * A device type whose bundle says the size of its screen, as Xcode's do.
 * @param {string} name
 * @param {number} width
 * @param {number} height
 */
function deviceType(name, width, height) {
  const bundle = path.join(home.home, "types", `${name}.simdevicetype`);
  mkdirSync(path.join(bundle, "Contents", "Resources"), { recursive: true });
  writeFileSync(
    path.join(bundle, "Contents", "Resources", "capabilities.plist"),
    `<?xml version="1.0"?><plist><dict><key>capabilities</key><dict><key>ScreenDimensionsCapability</key><dict><key>main-screen-height</key><integer>${height}</integer><key>main-screen-width</key><integer>${width}</integer></dict></dict></dict></plist>`,
  );
  return { identifier: `com.apple.CoreSimulator.SimDeviceType.${name.replaceAll(" ", "-")}`, name, productFamily: name.startsWith("iPad") ? "iPad" : "iPhone", bundlePath: bundle };
}

const PHONE = { name: "iPhone 18 Pro Max", udid: "11111111-0000-0000-0000-000000000001" };
const PAD = { name: "iPad Pro 13-inch (M5)", udid: "22222222-0000-0000-0000-000000000002" };
const types = [deviceType(PHONE.name, 1320, 2868), deviceType(PAD.name, 2064, 2752)];
const RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-27-0";

/** Whether the iPad is booted, and what each simulator's appearance is. */
let padBooted = false;
let appearance = {};
let statusBar = {};
/** What a launch answers: 0, or a failure. */
let launchStatus = 0;
/** Every program run, with the udids made short. */
const calls = [];
/** The env of the last xcodebuild test run. */
let testEnv = null;

const short = (text) => text.replaceAll(PHONE.udid, "<phone>").replaceAll(PAD.udid, "<pad>");

/** @type {import("../../cli/src/proc.mjs").Runner} */
async function runner(command, args, options) {
  calls.push(short([command, ...args].join(" ")));
  const answer = (status = 0, stdout = "", stderr = "") => ({ status, signal: null, stdout, stderr, timedOut: false });
  if (command === "xcodebuild") return xcodebuild(args, options, answer);
  if (command !== "xcrun" || args[0] !== "simctl") return answer(1, "", `${command} is not part of this test`);
  const [, verb, udid, action, value] = args;
  switch (verb) {
    case "list":
      return answer(
        0,
        JSON.stringify({
          devicetypes: types,
          runtimes: [{ identifier: RUNTIME, name: "iOS 27.0", version: "27.0", isAvailable: true }],
          devices: {
            [RUNTIME]: [
              { ...PHONE, state: "Booted", isAvailable: true, deviceTypeIdentifier: types[0].identifier },
              { ...PAD, state: padBooted ? "Booted" : "Shutdown", isAvailable: true, deviceTypeIdentifier: types[1].identifier },
            ],
          },
        }),
      );
    case "boot":
      padBooted = true;
      return answer();
    case "bootstatus":
    case "get_app_container":
    case "install":
      return answer();
    case "status_bar":
      if (action === "list") return answer(0, `Current Status Bar Overrides:\n=============================\n${statusBar[udid] ?? ""}`);
      statusBar[udid] = action === "override" ? "Time: 9:41\n" : "";
      return answer();
    case "ui":
      if (value) appearance[udid] = value;
      return answer(0, `${appearance[udid] ?? "light"}\n`);
    case "launch":
      return launchStatus === 0 ? answer() : answer(launchStatus, "", "The app could not be started.");
    case "openurl":
    case "terminate":
      return answer();
    case "io":
      writeFileSync(args[4], PIXEL);
      return answer();
  }
  return answer(1, "", `simctl ${verb} is not part of this test`);
}

/** What xcodebuild does in this test: builds, reads settings, and runs a UI test that says when its screen is up. */
let xcodebuild = async (args, options, answer) => {
  if (args.includes("test-without-building")) {
    testEnv = options.env;
    const signal = options.env.TEST_RUNNER_APPSHOTS_SIGNAL;
    writeFileSync(path.join(signal, "ready"), "");
    while (!existsSync(path.join(signal, "done"))) await new Promise((resolve) => setTimeout(resolve, 10));
    return answer();
  }
  if (args.includes("-showBuildSettings")) {
    const dir = path.join(home.home, "Build", "Products");
    mkdirSync(path.join(dir, "Notes.app"), { recursive: true });
    const settings = { PRODUCT_TYPE: "com.apple.product-type.application", PLATFORM_NAME: "iphonesimulator", TARGET_NAME: "Notes", TARGET_BUILD_DIR: dir, WRAPPER_NAME: "Notes.app", PRODUCT_BUNDLE_IDENTIFIER: "com.example.notes" };
    return answer(0, JSON.stringify([{ buildSettings: settings }]));
  }
  return answer();
};
setRunner(runner);

const work = path.join(home.home, "app");
mkdirSync(path.join(work, "Notes.xcodeproj"), { recursive: true });

/**
 * Writes a plan into the app's folder and returns its path.
 * @param {object} plan
 */
function writePlan(plan) {
  const file = path.join(work, "appshots.capture.json");
  writeFileSync(file, JSON.stringify(plan));
  return file;
}

/** @param {string[]} argv */
const shootWith = (argv) => quietly(() => shoot(parseArgs(argv)));
const uploads = () => server.requests.filter((request) => request.method === "PUT").map((request) => request.url.replace("/api/projects/demo/shots/", ""));
const simctl = (verb) => calls.filter((call) => call.startsWith(`xcrun simctl ${verb} `));

beforeEach(() => {
  calls.length = 0;
  server.requests.length = 0;
  shots = [];
  padBooted = false;
  appearance = {};
  statusBar = {};
  launchStatus = 0;
  testEnv = null;
  forgetSimulators();
});

const NOTES = { project: "demo", app: { bundleId: "com.example.notes", args: ["-demo"] }, wait: 0 };

test("a plan is taken device by device, appearance by appearance, then language and screen, and each one uploaded where it belongs", async () => {
  const file = writePlan({
    ...NOTES,
    devices: ["iphone", "ipad"],
    appearances: ["light", "dark"],
    screens: [{ id: "home" }, { id: "board", launch: { args: ["-tab", "board"], url: "notes://board" }, devices: ["ipad"] }],
  });
  const printed = await shootWith(["--plan", file]);
  assert.deepEqual(uploads(), [
    "home?device=iphone&locale=en",
    "home?device=iphone&locale=de",
    "home-dark?device=iphone&locale=en",
    "home-dark?device=iphone&locale=de",
    "home?device=ipad&locale=en",
    "board?device=ipad&locale=en",
    "home?device=ipad&locale=de",
    "board?device=ipad&locale=de",
    "home-dark?device=ipad&locale=en",
    "board-dark?device=ipad&locale=en",
    "home-dark?device=ipad&locale=de",
    "board-dark?device=ipad&locale=de",
  ]);
  // The iPad is booted while nothing else waits for it, and only once.
  assert.deepEqual(simctl("boot"), ["xcrun simctl boot <pad>"]);
  // Each simulator gets its status bar once and has it taken away after, and its appearance set back.
  const statusBars = simctl("status_bar").filter((call) => !call.endsWith(" list")).map((call) => call.replace(/ --time .*/, " --time …"));
  assert.deepEqual(statusBars, ["xcrun simctl status_bar <phone> override --time …", "xcrun simctl status_bar <phone> clear", "xcrun simctl status_bar <pad> override --time …", "xcrun simctl status_bar <pad> clear"]);
  assert.deepEqual(simctl("ui").filter((call) => call.split(" ").length === 6), ["xcrun simctl ui <phone> appearance dark", "xcrun simctl ui <phone> appearance light", "xcrun simctl ui <pad> appearance dark", "xcrun simctl ui <pad> appearance light"]);
  // The app starts in the screen's language with the plan's arguments first, and the link is opened in it.
  const launches = simctl("launch");
  assert.equal(launches[0], "xcrun simctl launch --terminate-running-process <phone> com.example.notes -demo -AppleLanguages (en) -AppleLocale en");
  assert.equal(launches[5], "xcrun simctl launch --terminate-running-process <pad> com.example.notes -demo -tab board -AppleLanguages (en) -AppleLocale en");
  assert.equal(calls[calls.indexOf(launches[5]) + 1], "xcrun simctl openurl <pad> notes://board");
  assert.ok(existsSync(path.join(work, "raw-shots", "de", "ipad-13", "board-dark.png")));
  assert.equal(printed.split("\n")[0], `${file}: 12 screenshots for demo, 2 screens in en and de in light and dark, on iphone-6.9 and ipad-13`);
  assert.match(printed, /^1\/12 home \(iphone-6\.9, en, light\): launch com\.example\.notes -demo$/m);
  assert.match(printed, /^Taken 12 of 12 screenshots for demo\.$/m);
  assert.match(printed, /^Booted for this run and still running: iPad Pro 13-inch \(M5\) \(22222222-0000-0000-0000-000000000002\)\./m);
});

test("what the project has already is skipped, --again takes it again, and --only and --lang narrow the run", async () => {
  const file = writePlan({ ...NOTES, screens: [{ id: "home" }, { id: "stats" }] });
  // The first language's screenshots are filed under none.
  shots = [{ name: "home", device: "iphone" }, { name: "stats", device: "iphone", locale: "de" }, { name: "stats", device: "ipad" }];
  let printed = await shootWith(["--plan", file]);
  assert.deepEqual(uploads(), ["stats?device=iphone&locale=en", "home?device=iphone&locale=de"]);
  assert.match(printed, /^Taken 2 of 2 screenshots for demo; skipped 2 the project has \(--again takes them as well\)\.$/m);

  shots = [{ name: "home", device: "iphone" }, { name: "home", device: "iphone", locale: "de" }, { name: "stats", device: "iphone" }, { name: "stats", device: "iphone", locale: "de" }];
  server.requests.length = 0;
  calls.length = 0;
  printed = await shootWith(["--plan", file]);
  assert.deepEqual(uploads(), []);
  assert.match(printed, /^Nothing to take: demo has all 4 screenshots of the plan already\. --again takes them again\.$/m);
  assert.ok(!calls.some((call) => call.includes(" launch ") || call.includes(" io ")), "nothing is started for a run with nothing to take");

  printed = await shootWith(["--plan", file, "--again", "--only", "stats", "--lang", "de"]);
  assert.deepEqual(uploads(), ["stats?device=iphone&locale=de"]);
});

test("--dry-run says what it would take, where and how, and changes nothing", async () => {
  const file = writePlan({ ...NOTES, devices: ["iphone", "ipad"], appearances: ["dark"], screens: [{ id: "home" }, { id: "safari", app: "com.apple.mobilesafari", launch: { url: "https://example.com" }, devices: ["ipad"] }] });
  shots = [{ name: "home", device: "iphone", locale: "de" }];
  const printed = await shootWith(["--plan", file, "--dry-run", "--lang", "de"]);
  const lines = printed.trim().split("\n");
  assert.deepEqual(lines.slice(1), [
    "iphone-6.9 on iPhone 18 Pro Max, iOS 27.0, booted",
    "  skip home (de, dark): the project has it",
    "ipad-13 on iPad Pro 13-inch (M5), iOS 27.0, to be booted",
    `  take home (de, dark): launch com.example.notes -demo -> ${path.relative(process.cwd(), path.join(work, "raw-shots", "de", "ipad-13", "home.png"))}`,
    `  take safari (de, dark): launch com.apple.mobilesafari, then open https://example.com -> ${path.relative(process.cwd(), path.join(work, "raw-shots", "de", "ipad-13", "safari.png"))}`,
    "Would take 2 screenshots and skip 1 the project has (--again takes them as well). Nothing was captured or uploaded (--dry-run).",
  ]);
  assert.deepEqual(uploads(), []);
  assert.deepEqual(calls, ["xcrun simctl list --json"]);
});

test("a simulator of a display's size is picked by its size, and a missing one is said before anything starts", async () => {
  const file = writePlan({ ...NOTES, devices: ["iphone", "ipad-11"], screens: [{ id: "home" }] });
  await assert.rejects(shootWith(["--plan", file]), (error) => error instanceof Failure && /^ipad-11: No simulator takes ipad-11 screenshots \(1668x2420 or 1488x2266 or 1668x2388 or 1640x2360\)\. .*list ipad instead/.test(error.message));
  assert.deepEqual(uploads(), []);
  assert.ok(!calls.some((call) => call.includes(" launch ")));
  // A simulator the plan names has to be of its display's size.
  const named = writePlan({ ...NOTES, devices: [{ display: "iphone-6.3", sim: "iPhone 18 Pro Max" }], screens: [{ id: "home" }] });
  await assert.rejects(shootWith(["--plan", named]), /iPhone 18 Pro Max takes 1320x2868 screenshots, which are not iphone-6\.3's/);
});

test("an app the plan does not build has to be installed, and is checked before the first screen", async (t) => {
  const file = writePlan({ ...NOTES, screens: [{ id: "home" }] });
  const before = setRunner(async (command, args, options) => (args[1] === "get_app_container" ? { status: 2, signal: null, stdout: "", stderr: "No such app", timedOut: false } : runner(command, args, options)));
  t.after(() => setRunner(before));
  await assert.rejects(shootWith(["--plan", file]), /com\.example\.notes is not installed on iPhone 18 Pro Max\. Build and install it there with 'appshots run --sim 11111111-0000-0000-0000-000000000001', or name the Xcode project in app\.xcode/);
  assert.ok(!calls.some((call) => call.includes(" launch ") || call.includes(" io ")));
});

test("with app.xcode the plan builds the app once, installs it, and starts it by the bundle id the build says", async () => {
  const file = writePlan({ project: "demo", app: { xcode: ".", scheme: "Notes" }, wait: 0, locales: ["en"], devices: ["iphone", "ipad"], screens: [{ id: "home" }] });
  await shootWith(["--plan", file]);
  const builds = calls.filter((call) => call.startsWith("xcodebuild") && call.endsWith(" build"));
  assert.equal(builds.length, 1);
  assert.match(builds[0], /-project .*Notes\.xcodeproj -scheme Notes -configuration Debug -destination platform=iOS Simulator,id=<phone> build$/);
  assert.deepEqual(simctl("install").map((call) => call.replace(/ \/.*$/, "")), ["xcrun simctl install <phone>", "xcrun simctl install <pad>"]);
  assert.deepEqual(
    simctl("launch").map((call) => call.split(" ").slice(4, 6).join(" ")),
    ["<phone> com.example.notes", "<pad> com.example.notes"],
  );
  assert.deepEqual(uploads(), ["home?device=iphone&locale=en", "home?device=ipad&locale=en"]);
});

test("a project with several schemes, none named like it, is told to name the app's in the plan", async (t) => {
  const file = writePlan({ project: "demo", app: { xcode: "." }, wait: 0, locales: ["en"], screens: [{ id: "home" }] });
  const schemes = JSON.stringify({ project: { name: "Notes", schemes: ["Notes Free", "Notes Pro"] } });
  const before = setRunner(async (command, args, options) => (command === "xcodebuild" && args.includes("-list") ? { status: 0, signal: null, stdout: schemes, stderr: "", timedOut: false } : runner(command, args, options)));
  t.after(() => setRunner(before));
  // shoot takes no --scheme, so the plan's own field is the one named.
  await assert.rejects(shootWith(["--plan", file]), (error) => error instanceof Failure && error.message === `Notes.xcodeproj has several schemes; name the app's in app.scheme of ${file}:\n  Notes Free\n  Notes Pro`);
  assert.ok(!calls.some((call) => call.endsWith(" build") || call.includes(" launch ")));
});

test("a UI test brings its screen up and waits while the screenshot is taken", async () => {
  const file = writePlan({ project: "demo", app: { xcode: "Notes.xcodeproj", scheme: "Notes" }, wait: 0, locales: ["de"], screens: [{ id: "share", uitest: "NotesUITests/Shots/testShare" }] });
  await shootWith(["--plan", file]);
  assert.equal(calls.filter((call) => call.includes(" build-for-testing")).length, 1);
  const run = calls.find((call) => call.includes(" test-without-building"));
  assert.match(run ?? "", /-scheme Notes -destination platform=iOS Simulator,id=<phone> -derivedDataPath \S+-tests test-without-building -only-testing:NotesUITests\/Shots\/testShare -testLanguage de$/);
  assert.equal(testEnv?.TEST_RUNNER_APPSHOTS_LOCALE, "de");
  // The screenshot is taken between the test saying ready and it being let go.
  assert.ok(calls.indexOf(run ?? "") < calls.findIndex((call) => call.includes(" io ")));
  assert.ok(!calls.some((call) => call.includes(" launch ")), "a UI test starts the app itself");
  assert.deepEqual(uploads(), ["share?device=iphone&locale=de"]);
});

test("the app the last screen started is closed before another one starts, so that no link back to it shows", async () => {
  const file = writePlan({
    ...NOTES,
    locales: ["en"],
    screens: [{ id: "home" }, { id: "web", app: "com.apple.mobilesafari", launch: { url: "https://appshots.example.com" } }, { id: "stats", launch: ["-tab", "stats"] }, { id: "board" }],
  });
  await shootWith(["--plan", file]);
  const steps = calls.filter((call) => / (launch|terminate|openurl) /.test(call)).map((call) => call.replace("xcrun simctl ", "").replace(" --terminate-running-process", "").replace(/ -AppleLanguages .*$/, ""));
  assert.deepEqual(steps, [
    "launch <phone> com.example.notes -demo",
    "terminate <phone> com.example.notes",
    "launch <phone> com.apple.mobilesafari",
    "openurl <phone> https://appshots.example.com",
    "terminate <phone> com.apple.mobilesafari",
    "launch <phone> com.example.notes -demo -tab stats",
    "launch <phone> com.example.notes -demo",
  ]);
});

test("a web link opened with no app comes up in Safari, which is closed before the next screen starts its app", async () => {
  const file = writePlan({
    project: "demo",
    wait: 0,
    locales: ["en"],
    screens: [{ id: "settings", app: "com.apple.Preferences" }, { id: "web", launch: { url: "https://appshots.example.com/docs" } }, { id: "more-web", launch: { url: "https://appshots.example.com/faq" } }, { id: "settings-again", app: "com.apple.Preferences" }],
  });
  await shootWith(["--plan", file]);
  const steps = calls.filter((call) => / (launch|terminate|openurl) /.test(call)).map((call) => call.replace("xcrun simctl ", "").replace(" --terminate-running-process", "").replace(/ -AppleLanguages .*$/, ""));
  assert.deepEqual(steps, [
    "launch <phone> com.apple.Preferences",
    "terminate <phone> com.apple.Preferences",
    "openurl <phone> https://appshots.example.com/docs",
    "openurl <phone> https://appshots.example.com/faq",
    "terminate <phone> com.apple.mobilesafari",
    "launch <phone> com.apple.Preferences",
  ]);
});

test("an app a failed launch or link may have brought up is closed before the next screen all the same", async (t) => {
  const file = writePlan({
    project: "demo",
    wait: 0,
    locales: ["en"],
    screens: [{ id: "web", launch: { url: "https://appshots.example.com/slow" } }, { id: "settings", app: "com.apple.Preferences" }, { id: "maps", app: "com.apple.Maps" }, { id: "home", app: "com.example.notes" }],
  });
  // simctl gives up on the link and on Maps, though each may have come up by then.
  const before = setRunner(async (command, args, options) => {
    if (args[1] === "openurl" || (args[1] === "launch" && args.includes("com.apple.Maps"))) {
      calls.push(short([command, ...args].join(" ")));
      return { status: 1, signal: null, stdout: "", stderr: "Operation timed out", timedOut: false };
    }
    return runner(command, args, options);
  });
  t.after(() => setRunner(before));
  t.mock.method(console, "error", () => {});
  await assert.rejects(shootWith(["--plan", file]), (error) => error instanceof Failure && /^2 of 4 screenshots not taken:\n {2}web \(iphone-6\.9, en\): Could not open https:\/\/appshots\.example\.com\/slow on iPhone 18 Pro Max\n {2}maps \(iphone-6\.9, en\): Could not launch com\.apple\.Maps/.test(error.message));
  const steps = calls.filter((call) => / (launch|terminate|openurl) /.test(call)).map((call) => call.replace("xcrun simctl ", "").replace(" --terminate-running-process", "").replace(/ -AppleLanguages .*$/, ""));
  assert.deepEqual(steps, [
    "openurl <phone> https://appshots.example.com/slow",
    "terminate <phone> com.apple.mobilesafari",
    "launch <phone> com.apple.Preferences",
    "terminate <phone> com.apple.Preferences",
    "launch <phone> com.apple.Maps",
    "terminate <phone> com.apple.Maps",
    "launch <phone> com.example.notes",
  ]);
  assert.deepEqual(uploads(), ["settings?device=iphone&locale=en", "home?device=iphone&locale=en"]);
});

test("a screen still blank after fifteen seconds is not uploaded, and one with its own wait is taken as it is", async (t) => {
  const file = writePlan({ ...NOTES, wait: undefined, locales: ["en"], screens: [{ id: "home" }, { id: "splash", wait: 0 }] });
  // Each frame comes four seconds after the one before, as far as the capture's clock goes.
  const now = Date.now.bind(Date);
  let ahead = 0;
  t.mock.method(Date, "now", () => now() + ahead);
  const blank = png(400, 800, () => [250, 250, 250]);
  const before = setRunner(async (command, args, options) => {
    if (args[1] !== "io") return runner(command, args, options);
    writeFileSync(args[4], blank);
    ahead += 4000;
    return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
  });
  t.after(() => setRunner(before));
  t.mock.method(console, "error", () => {});
  await assert.rejects(shootWith(["--plan", file]), (error) => {
    assert.equal(error.message.split("\n").slice(0, 2).join("\n"), '1 of 2 screenshots not taken:\n  home (iphone-6.9, en): iPhone 18 Pro Max still showed nothing 15 seconds after the start, so home was not uploaded. Run the plan again, or give the screen a "wait" in seconds to take it as it is.');
    return true;
  });
  assert.deepEqual(uploads(), ["splash?device=iphone&locale=en"]);
});

test("a screen that fails is reported at the end, and a device is given up after three in a row", async (t) => {
  const file = writePlan({ ...NOTES, locales: ["en"], screens: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }] });
  launchStatus = 1;
  const errors = t.mock.method(console, "error", () => {});
  await assert.rejects(shootWith(["--plan", file]), (error) => {
    assert.ok(error instanceof Failure);
    assert.match(error.message, /^5 of 5 screenshots not taken:\n {2}a \(iphone-6\.9, en\): Could not launch com\.example\.notes on iPhone 18 Pro Max:/);
    assert.match(error.message, /\n {2}d \(iphone-6\.9, en\): not tried after 3 failures in a row on iPhone 18 Pro Max\n/);
    assert.match(error.message, /Run the plan again once that is fixed: it takes only what the project does not have yet\.$/);
    return true;
  });
  assert.equal(simctl("launch").length, 3);
  assert.equal(errors.mock.callCount(), 3);
  // The status bar is put back all the same.
  assert.equal(simctl("status_bar").at(-1), "xcrun simctl status_bar <phone> clear");
});

test("a plan needs nobody at the Terminal, and its own options are refused without one", async () => {
  const file = writePlan({ ...NOTES, screens: [{ id: "home" }] });
  await assert.rejects(shootWith(["--plan", file, "--sim", "iPhone 18 Pro Max"]), /--sim is for shooting by hand\. A plan says itself where its screens are taken/);
  await assert.rejects(shootWith(["demo", "home", "--dry-run"]), /--dry-run goes with a capture plan/);
  await assert.rejects(shootWith(["demo", "other", "--plan", file]), /Usage: appshots shoot \[<project>\] --plan/);
  const nameless = writePlan({ app: { bundleId: "com.example.notes" }, screens: [{ id: "home" }] });
  await assert.rejects(shootWith(["--plan", nameless]), /names no project\. Add "project": "<id>" to it, or name one: appshots shoot <project> --plan /);
  // The project named on the command line goes before the plan's.
  await assert.rejects(shootWith(["nope", "--plan", file]), /GET \/api\/projects\/nope failed \(404\): not found/);
});
