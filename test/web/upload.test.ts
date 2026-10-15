import assert from "node:assert/strict";
import { test } from "node:test";
import { SLUG } from "../../src/schema.ts";
import { batchNames, inParallel, uploadName } from "../../web/src/project/upload.ts";

// The names the Studio gives dropped files, and how many of them go up at once.

test("a simulator screenshot is named by its time, so a batch of them does not collide", () => {
  const files = ["10.12.33", "10.13.01", "10.14.44"].map((time) => `Simulator Screenshot - iPhone 16 Pro - 2026-10-14 at ${time}.png`);
  assert.deepEqual(batchNames(files), ["2026-10-14-at-10-12-33", "2026-10-14-at-10-13-01", "2026-10-14-at-10-14-44"]);
  assert.equal(uploadName("Simulator Screenshot - iPhone 17 Pro Max - 2026-10-14 at 09.01.02.png"), "2026-10-14-at-09-01-02");
  assert.equal(uploadName("Screenshot 2026-10-14 at 10.12.33 AM.png"), "2026-10-14-at-10-12-33-am");
});

test("plain names are kept, and a name too long loses its middle rather than its end", () => {
  assert.equal(uploadName("Home Screen.png"), "home-screen");
  assert.equal(uploadName("Café ☕.jpeg"), "cafe");
  assert.equal(uploadName("☕.png"), "shot");
  const long = uploadName(`${"settings-".repeat(10)}dark-mode-at-10-12-33.png`);
  assert.ok(long.length <= 64, long);
  assert.ok(long.endsWith("dark-mode-at-10-12-33"), long);
  assert.ok(SLUG.test(long), long);
});

test("files of one batch that would share a name are told apart", () => {
  const names = batchNames(["home.png", "Home.png", "home.jpg", `${"x".repeat(80)}.png`, `${"x".repeat(80)}.jpg`]);
  assert.deepEqual(names.slice(0, 3), ["home", "home-2", "home-3"]);
  assert.notEqual(names[3], names[4]);
  for (const name of names) assert.ok(SLUG.test(name), name);
});

test("at most three uploads run at once, and each result keeps its place", async () => {
  let running = 0;
  let most = 0;
  const results = await inParallel([5, 1, 4, 2, 3, 0], 3, async (wait, index) => {
    running++;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, wait));
    running--;
    if (index === 3) throw new Error("refused");
    return index;
  });
  assert.equal(most, 3);
  assert.deepEqual(
    results.map((result) => (result.status === "fulfilled" ? result.value : "failed")),
    [0, 1, 2, "failed", 4, 5],
  );
});
