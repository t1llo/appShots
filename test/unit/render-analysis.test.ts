import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import sharp from "sharp";
import { hasBakedIsland, paletteFor, remembered, statusBarLook } from "../../src/render/analysis.ts";
import { png } from "../helpers/images.ts";
import { tmpData } from "../helpers/tmp-data.ts";

// What the slide pages work out from a screenshot: its colours, its status bar and whether it shows an island.

const data = await tmpData("analysis");
after(() => data.remove());

async function picture(name: string, width: number, height: number, background = "#3B82F6"): Promise<string> {
  const file = path.join(data.dir, name);
  await writeFile(file, await png(width, height, background));
  return file;
}

test("a wide strip filed as an iPhone screenshot has no island, and still has a status bar colour", async () => {
  const strip = await picture("strip.png", 1320, 100);
  assert.equal(await hasBakedIsland(strip, 1, 1320), false);
  const look = await statusBarLook(strip, 1, "iphone", 1320);
  assert.match(look.fill, /^linear-gradient\(90deg,rgb\(59 130 246\)/);
  assert.equal(look.light, true);
});

test("a black pill where the island sits is found", async () => {
  const width = 1320;
  const pill = await sharp({ create: { width, height: 2868, channels: 3, background: "#F4F4F5" } })
    .composite([{ input: await png(Math.round(width * 0.2), Math.round(width * 0.08), "#000000"), left: Math.round(width * 0.4), top: Math.round(width * 0.04) }])
    .png()
    .toBuffer();
  const file = path.join(data.dir, "island.png");
  await writeFile(file, pill);
  assert.equal(await hasBakedIsland(file, 1, width), true);
  assert.equal(await hasBakedIsland(await picture("plain.png", 1320, 2868), 1, width), false);
});

test("a colourful screenshot gets a backdrop of its own hue, a grey one a neutral backdrop", async () => {
  assert.equal((await paletteFor(await picture("blue.png", 240, 480), 1)).length, 4);
  assert.deepEqual(await paletteFor(await picture("grey.png", 240, 480, "#F4F4F5"), 1), ["#18181B", "#3F3F46", "#27272A", "#52525B"]);
});

test("remembered asks once per key, forgets failures and keeps no more than it may", async () => {
  const ask = remembered<number>(2);
  let calls = 0;
  const work = (value: number) => async () => {
    calls++;
    return value;
  };
  // Two at once wait for the one answer.
  assert.deepEqual(await Promise.all([ask("a", work(1)), ask("a", work(2))]), [1, 1]);
  assert.equal(calls, 1);

  await assert.rejects(ask("broken", () => Promise.reject(new Error("unreadable"))));
  assert.equal(await ask("broken", work(3)), 3);

  // "broken" was asked for last, then "c" comes in: "a" is the oldest, and goes.
  await ask("c", work(4));
  calls = 0;
  assert.equal(await ask("broken", work(5)), 3);
  assert.equal(await ask("a", work(6)), 6);
  assert.equal(calls, 1);
});
