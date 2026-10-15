import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { cliHome, PIXEL, quietly, scriptedRunner, stubServer } from "./helpers.mjs";

// A Mac with one booted simulator and a server with one project, both stood in for.
const home = await cliHome("shoot");
after(() => home.remove());
const server = await stubServer(({ method, url }) => {
  if (method === "GET" && url === "/api/projects/demo") return [200, { project: { id: "demo", locales: ["en"] } }];
  const shot = /^\/api\/projects\/demo\/shots\/([^?]+)/.exec(url);
  if (method === "PUT" && shot) return [200, { name: decodeURIComponent(shot[1]), device: "iphone", width: 1320, height: 2868 }];
  return [404, { error: "not found" }];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;
process.env.APPSHOTS_TOKEN = "test-token";
process.env.DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";

const { host, setRunner } = await import("../../cli/src/proc.mjs");
const { parseArgs } = await import("../../cli/src/args.mjs");
const { shoot } = await import("../../cli/src/shoot.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
host.platform = "darwin";

const BENCH = { name: "Bench", udid: "11111111-2222-3333-4444-555555555555" };
const LISTING = JSON.stringify({
  devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [{ ...BENCH, state: "Booted", isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max" }] },
  devicetypes: [],
  runtimes: [],
});
const HEADING = "Current Status Bar Overrides:\n=============================\n";

/** What the status bar has, as simctl would list it. */
let statusBar = "";

const script = scriptedRunner((command, args) => {
  if (command !== "xcrun") return { status: 1, stderr: `${command} is not part of this test` };
  const [tool, verb, , action] = args;
  if (tool === "simctl" && verb === "list") return { stdout: LISTING };
  if (tool === "simctl" && verb === "status_bar" && action === "list") return { stdout: `${HEADING}${statusBar}` };
  if (tool === "simctl" && verb === "status_bar" && action === "override") {
    statusBar = "Time: 9:41\nBattery: 100%, charged\n";
    return {};
  }
  if (tool === "simctl" && verb === "status_bar" && action === "clear") {
    statusBar = "";
    return {};
  }
  if (tool === "simctl" && verb === "io") {
    writeFileSync(args[4], PIXEL);
    return {};
  }
  return { status: 1, stderr: `simctl ${verb} is not part of this test` };
});
setRunner(script.runner);

/** @param {string[]} pressed */
const keys = (pressed) => ({ next: async () => pressed.shift() ?? "q", close: () => {} });

beforeEach(() => {
  script.calls.length = 0;
  server.requests.length = 0;
  statusBar = "";
});

const shortly = (calls) => calls.map((call) => call.replace(BENCH.udid, "<sim>").replace(/ \S+\.png$/, " <file>").replace(/--time \S+ .*/, "--time …"));

test("shoot sets the status bar once, captures and uploads each screen in turn, and clears it after", async () => {
  const out = path.join(home.home, "shots");
  // Return takes one, s skips one, and a slip of the finger is no answer.
  const printed = await quietly(() => shoot(parseArgs(["demo", "home", "stats", "settings", "--clean", "--out", out]), { keys: keys(["\r", "s", "x", "\n"]) }));
  assert.deepEqual(shortly(script.calls), [
    "xcrun simctl list --json",
    "xcrun simctl status_bar <sim> list",
    "xcrun simctl status_bar <sim> override --time …",
    "xcrun simctl io <sim> screenshot <file>",
    "xcrun simctl io <sim> screenshot <file>",
    "xcrun simctl status_bar <sim> clear",
  ]);
  const uploads = server.requests.filter((request) => request.method === "PUT");
  assert.deepEqual(uploads.map((request) => request.url), ["/api/projects/demo/shots/home", "/api/projects/demo/shots/settings"]);
  assert.equal(uploads[0].headers.authorization, "Bearer test-token");
  assert.deepEqual(uploads[0].body, PIXEL);
  assert.match(printed, /^Captured Bench -> .*home\.png$/m);
  assert.match(printed, /^Uploaded home \(iphone, 1320x2868\) to demo$/m);
  assert.match(printed, /^Taken 2 of 3 for demo: home, settings$/m);
  assert.match(printed, /^Skipped: stats$/m);
});

test("an override that was there before stays when shoot is done", async () => {
  statusBar = "Time: 10:00\n";
  await quietly(() => shoot(parseArgs(["demo", "home", "--clean"]), { keys: keys(["\r"]) }));
  assert.ok(!script.calls.some((call) => call.endsWith(" clear")), "the status bar was cleared");
});

test("q stops before the next screen and the status bar is still cleared", async () => {
  await quietly(() => shoot(parseArgs(["demo", "home", "stats", "--clean"]), { keys: keys(["q"]) }));
  assert.equal(script.calls.filter((call) => call.includes(" io ")).length, 0);
  assert.ok(script.calls.at(-1)?.endsWith(" clear"));
});

test("a word --sim took is a screen when no simulator has that name", async () => {
  await quietly(() => shoot(parseArgs(["demo", "--sim", "home", "stats"]), { keys: keys(["\r", "\r"]) }));
  const uploads = server.requests.filter((request) => request.method === "PUT").map((request) => request.url);
  assert.deepEqual(uploads, ["/api/projects/demo/shots/home", "/api/projects/demo/shots/stats"]);
});

test("--sim with a simulator's name picks that one", async () => {
  await quietly(() => shoot(parseArgs(["demo", "--sim", "Bench", "home"]), { keys: keys(["\r"]) }));
  assert.deepEqual(server.requests.filter((request) => request.method === "PUT").map((request) => request.url), ["/api/projects/demo/shots/home"]);
});

test("shoot --mac captures a window without asking for a simulator", async () => {
  const before = setRunner(async (command, args) => {
    script.calls.push([command, ...args].join(" "));
    if (command === "osascript") return { status: 0, signal: null, stdout: JSON.stringify([{ id: 42, app: "Ledger", width: 1280, height: 800 }]), stderr: "", timedOut: false };
    if (command === "screencapture") writeFileSync(args.at(-1), PIXEL);
    return { status: command === "screencapture" ? 0 : 1, signal: null, stdout: "", stderr: "", timedOut: false };
  });
  try {
    await quietly(() => shoot(parseArgs(["demo", "home", "--mac", "Ledger", "--clean"]), { keys: keys(["\r"]) }));
  } finally {
    setRunner(before);
  }
  assert.ok(!script.calls.some((call) => call.startsWith("xcrun")), script.calls.join("\n"));
  assert.ok(script.calls.some((call) => call.startsWith("screencapture -x -o -l 42 ")));
  const upload = server.requests.find((request) => request.method === "PUT");
  assert.equal(upload?.url, "/api/projects/demo/shots/home?device=mac");
});

test("a project the server does not have stops shoot before anything is captured", async () => {
  await assert.rejects(quietly(() => shoot(parseArgs(["nope", "home"]), { keys: keys(["\r"]) })), Failure);
  assert.deepEqual(script.calls, []);
});
