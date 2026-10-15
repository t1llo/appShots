import assert from "node:assert/strict";
import { after, test } from "node:test";
import { cliHome } from "./helpers.mjs";

const home = await cliHome("sim");
after(() => home.remove());
process.env.DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
process.env.APPSHOTS_NO_WINDOW = "1";

const { defaultTimeout, host, setRunner } = await import("../../cli/src/proc.mjs");
const { boot, install } = await import("../../cli/src/sim.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
host.platform = "darwin";

/** The time limit each simctl call was given, by its verb. */
const limits = new Map();
/** The verb that takes longer than it is given. */
let slow = "";
const before = setRunner(async (command, args, { timeout }) => {
  limits.set(args[1], timeout);
  if (args[1] === slow) return { status: null, signal: "SIGTERM", stdout: "", stderr: "", timedOut: true };
  return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
});
after(() => setRunner(before));

const SIM = { name: "Bench", udid: "11111111-2222-3333-4444-555555555555", booted: false };

test("booting and installing get minutes, where a question to simctl gets a minute", async () => {
  limits.clear();
  slow = "";
  await boot(SIM);
  await install(SIM, "/tmp/Demo.app");
  const minute = defaultTimeout("xcrun");
  for (const verb of ["boot", "bootstatus", "install"]) assert.ok(limits.get(verb) >= 5 * minute, `simctl ${verb} gets ${limits.get(verb)} ms`);
});

test("an install that never ends still stops, and says what did not answer", async () => {
  slow = "install";
  await assert.rejects(install(SIM, "/tmp/Demo.app"), (error) => error instanceof Failure && /xcrun simctl install did not answer within 300 seconds/.test(error.message));
});
