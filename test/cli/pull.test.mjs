import assert from "node:assert/strict";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { finished } from "node:stream/promises";
import path from "node:path";
import { after, test } from "node:test";
import { writeZip } from "../../src/zip.ts";
import { cliHome } from "./helpers.mjs";

const home = await cliHome("pull");
after(() => home.remove());
const { extractZip } = await import("../../cli/src/pull.mjs");

let made = 0;

/**
 * A download as the server zips it, with each file holding its own name and `mark`.
 * @param {string[]} names
 * @param {string} [mark]
 */
async function download(names, mark = "") {
  const zip = path.join(home.home, `download-${++made}.zip`);
  const out = createWriteStream(zip);
  await writeZip(out, names.map((name) => ({ name, data: Buffer.from(`${name}${mark}`) })));
  out.end();
  await finished(out);
  return zip;
}

/** @param {string} label */
const folder = (label) => path.join(home.home, label);

const has = (dir, name) => existsSync(path.join(dir, name));

test("a slide or a language an earlier pull brought that the set no longer has is taken out", async () => {
  const dir = folder("gone");
  await extractZip(await download(["README.txt", "en/iphone-6.9/01.png", "en/iphone-6.9/02.png", "de/iphone-6.9/01.png"]), dir);
  const files = await extractZip(await download(["README.txt", "en/iphone-6.9/01.png"], " again"), dir);
  assert.deepEqual(files.sort(), ["README.txt", path.join("en", "iphone-6.9", "01.png")]);
  assert.equal(readFileSync(path.join(dir, "en/iphone-6.9/01.png"), "utf8"), "en/iphone-6.9/01.png again");
  assert.equal(has(dir, "en/iphone-6.9/02.png"), false);
  // Nothing of the language is left for 'store push' to find.
  assert.equal(has(dir, "de"), false);
});

test("what the person put in the folder stays, also inside the folders a pull writes", async () => {
  const dir = folder("shared");
  mkdirSync(path.join(dir, "en-US"), { recursive: true });
  mkdirSync(path.join(dir, "de"), { recursive: true });
  writeFileSync(path.join(dir, "en-US", "iPhone-01_home.png"), "theirs");
  writeFileSync(path.join(dir, "notes.txt"), "theirs");
  await extractZip(await download(["en-US/iphone-6.9/01.png", "de/iphone-6.9/01.png"]), dir);
  writeFileSync(path.join(dir, "en-US", "iphone-6.9", "mine.txt"), "theirs");
  writeFileSync(path.join(dir, "de", "mine.txt"), "theirs");
  await extractZip(await download(["en-US/iphone-6.9/02.png"]), dir);
  assert.equal(readFileSync(path.join(dir, "en-US", "iPhone-01_home.png"), "utf8"), "theirs");
  assert.equal(readFileSync(path.join(dir, "notes.txt"), "utf8"), "theirs");
  assert.equal(readFileSync(path.join(dir, "en-US", "iphone-6.9", "mine.txt"), "utf8"), "theirs");
  assert.equal(has(dir, "en-US/iphone-6.9/01.png"), false);
  assert.equal(has(dir, "en-US/iphone-6.9/02.png"), true);
  // The language is gone from the set, but its folder holds a file of the person's.
  assert.equal(readFileSync(path.join(dir, "de", "mine.txt"), "utf8"), "theirs");
  assert.equal(has(dir, "de/iphone-6.9"), false);
});

test("the list of an earlier pull reaches nothing outside the folder", async () => {
  const dir = folder("listed");
  writeFileSync(path.join(home.home, "outside.png"), "theirs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, ".appshots-files.json"), JSON.stringify({ files: ["../outside.png", path.join(home.home, "outside.png"), ".", 7] }));
  await extractZip(await download(["01.png"]), dir);
  assert.equal(readFileSync(path.join(home.home, "outside.png"), "utf8"), "theirs");
  assert.equal(has(dir, "01.png"), true);
});
