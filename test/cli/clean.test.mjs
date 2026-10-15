import assert from "node:assert/strict";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cliHome, quietly } from "./helpers.mjs";

const home = await cliHome("clean");
after(() => home.remove());
const { BUILD_CACHE } = await import("../../cli/src/config.mjs");
const { clean } = await import("../../cli/src/clean.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");

/**
 * A project's build log and --fresh build, as 'appshots run' leaves them, last touched `days` ago.
 * @param {string} name
 * @param {number} days
 */
function built(name, days) {
  const at = new Date(Date.now() - days * 86400000);
  mkdirSync(path.join(BUILD_CACHE, name, "Build"), { recursive: true });
  writeFileSync(path.join(BUILD_CACHE, name, "Build", "App"), "x".repeat(1000));
  writeFileSync(path.join(BUILD_CACHE, `${name}.log`), "log");
  utimesSync(path.join(BUILD_CACHE, name), at, at);
  utimesSync(path.join(BUILD_CACHE, `${name}.log`), at, at);
}

test("--older-than removes only the builds not used for that many days", async () => {
  built("Old", 40);
  built("Recent", 2);
  const printed = await quietly(() => clean({ builds: true, "older-than": "30d" }));
  assert.match(printed, /^ {2}Old {2}\(last built 40 days ago, 0 MB\)$/m);
  assert.match(printed, /^Removed 1 build from /m);
  assert.equal(existsSync(path.join(BUILD_CACHE, "Old")), false);
  assert.equal(existsSync(path.join(BUILD_CACHE, "Old.log")), false);
  assert.equal(existsSync(path.join(BUILD_CACHE, "Recent")), true);
});

test("--dry-run says what would go and leaves it", async () => {
  built("Kept", 5);
  const printed = await quietly(() => clean({ builds: true, "dry-run": true }));
  assert.match(printed, /^Would remove 2 builds from /m);
  assert.equal(existsSync(path.join(BUILD_CACHE, "Kept")), true);
});

test("--older-than needs a number", async () => {
  await assert.rejects(quietly(async () => clean({ builds: true, "older-than": true })), Failure);
  await assert.rejects(quietly(async () => clean({ builds: true, "older-than": "soon" })), Failure);
});
