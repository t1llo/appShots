import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultTimeout, run } from "../../cli/src/proc.mjs";

test("run hands stdin over and gives back stdout, stderr and the exit status", async () => {
  const result = await run(process.execPath, ["-e", "process.stdin.pipe(process.stdout); console.error('note'); process.exitCode = 3"], { input: "piped" });
  assert.equal(result.stdout, "piped");
  assert.equal(result.stderr, "note\n");
  assert.equal(result.status, 3);
  assert.equal(result.timedOut, false);
});

test("a program that does not answer in time is stopped and says so", async () => {
  const started = Date.now();
  const result = await run(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeout: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
  assert.ok(Date.now() - started < 5000);
});

test("a program that is not there is an error, not an exception", async () => {
  const result = await run("appshots-no-such-program", []);
  assert.equal(result.status, null);
  assert.equal(/** @type {any} */ (result.error)?.code, "ENOENT");
});

test("each tool has a time limit of its own", () => {
  assert.equal(defaultTimeout("xcrun"), 60000);
  assert.equal(defaultTimeout("git"), 10000);
  assert.equal(defaultTimeout("osascript"), 30000);
});
