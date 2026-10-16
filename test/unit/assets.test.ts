import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { INDEX_FILE } from "../../src/storage/index-cache.ts";
import { createProject, findShot, InputError, listImages, listShots, moveShot, readShots, saveImage, saveShot, shotsDir, type Space, TooLargeError, updateProject, usageOf } from "../../src/store.ts";
import { bombPng, jpegSaying, macWindow, png, svgLogo } from "../helpers/images.ts";
import { tmpData } from "../helpers/tmp-data.ts";

const data = await tmpData("assets");
after(() => data.remove());
const { space } = data;

const root = path.resolve(import.meta.dirname, "..", "..");

/** An account other than the admin, with a folder of its own and room for `bytes` of uploads. */
const limitedSpace = (id: string, shots = 40, bytes?: number): Space => ({ id, root: path.join(data.dir, "users", id), limits: { projects: 20, shots, ...(bytes === undefined ? {} : { bytes }) } });

let photo: Promise<Buffer> | undefined;
/** A 48-megapixel camera's photo, taken upright: 8064×6048 as stored, turned by its orientation. */
const cameraPhoto = () => (photo ??= sharp({ create: { width: 8064, height: 6048, channels: 3, background: "#64748B" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer());

/** Counts what sharp is asked to read while `work` runs. */
async function sharpCalls(t: TestContext, work: () => Promise<unknown>): Promise<number> {
  const metadata = t.mock.method(sharp.prototype, "metadata");
  const toBuffer = t.mock.method(sharp.prototype, "toBuffer");
  await work();
  const calls = metadata.mock.callCount() + toBuffer.mock.callCount();
  metadata.mock.restore();
  toBuffer.mock.restore();
  return calls;
}

test("a picture with more pixels than any screen has is refused before it is decoded (srv-2)", async () => {
  // In a process of its own, so that what it takes in memory is the upload's alone. Decoded, this picture is 1 GB.
  const script = `
    import { createProject, saveShot, TooLargeError } from ${JSON.stringify(pathToFileURL(path.join(root, "src/store.ts")).href)};
    import { bombPng } from ${JSON.stringify(pathToFileURL(path.join(root, "test/helpers/images.ts")).href)};
    const space = { id: "main", root: process.env.BOMB_DIR };
    const { id } = await createProject(space, { name: "Bomb" });
    const refused = await saveShot(space, id, "bomb", bombPng(16000, 16000)).then(() => null, (error) => error);
    console.log(JSON.stringify({ tooLarge: refused instanceof TooLargeError, message: refused?.message, maxRssKb: process.resourceUsage().maxRSS }));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, BOMB_DIR: path.join(data.dir, "bomb") } });
  const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
  assert.equal(result.tooLarge, true, result.message);
  assert.match(result.message, /16000×16000 pixels, more than any screen has/);
  assert.ok(result.maxRssKb < 200 * 1024, `took ${Math.round(result.maxRssKb / 1024)} MB`);
});

test("a photo with more pixels than any screen is read shrunk, in little memory", async () => {
  // In a process of its own, as the one above. Decoded whole and turned upright, this photo takes 300 MB.
  const photo = path.join(data.dir, "photo.jpg");
  await writeFile(photo, await cameraPhoto());
  const script = `
    import { readFile } from "node:fs/promises";
    import { createProject, saveImage } from ${JSON.stringify(pathToFileURL(path.join(root, "src/store.ts")).href)};
    const space = { id: "main", root: process.env.PHOTO_DIR };
    const { id } = await createProject(space, { name: "Photo" });
    const data = await readFile(process.env.PHOTO);
    const before = process.resourceUsage().maxRSS;
    const image = await saveImage(space, id, "photo", data);
    console.log(JSON.stringify({ size: [image.width, image.height], grewKb: process.resourceUsage().maxRSS - before }));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, PHOTO: photo, PHOTO_DIR: path.join(data.dir, "photo") } });
  const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
  assert.deepEqual(result.size, [1536, 2048]);
  assert.ok(result.grewKb < 100 * 1024, `took ${Math.round(result.grewKb / 1024)} MB more`);
});

test("a picture with a side longer than any screen's is refused, an image too (srv-2)", async () => {
  const { id } = await createProject(space, { name: "Too Long" });
  await assert.rejects(saveShot(space, id, "strip", await png(10_001, 400)), TooLargeError);
  await assert.rejects(saveImage(space, id, "logo", bombPng(9000, 9000)), TooLargeError);
  // Within the limits, a large picture is stored as before.
  assert.equal((await saveShot(space, id, "large", await png(6016, 3384))).width, 6016);
});

test("an image may be a photo or a drawing larger than any screen, since it is kept smaller", async () => {
  const { id } = await createProject(space, { name: "Photo" });
  assert.deepEqual(await saveImage(space, id, "photo", await cameraPhoto()).then(({ width, height }) => [width, height]), [1536, 2048]);
  // A progressive JPEG is decoded whole, so it has the limit of every other picture.
  const progressive = jpegSaying(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#64748B" } }).jpeg({ progressive: true }).toBuffer(), 8064, 6048);
  assert.deepEqual(await sharp(progressive).metadata().then(({ width, height, isProgressive }) => [width, height, isProgressive]), [8064, 6048, true]);
  await assert.rejects(saveImage(space, id, "progressive", progressive), (error: Error) => error instanceof TooLargeError && /8064×6048 pixels\. Upload one of at most 40 million/.test(error.message));
  const drawing = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12000" height="8000"><rect width="12000" height="8000" fill="#F59E0B"/></svg>');
  assert.deepEqual(await saveImage(space, id, "drawing", drawing).then(({ width, height }) => [width, height]), [2048, 1365]);
  const endless = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2000000" height="2000000"><rect width="10" height="10"/></svg>');
  await assert.rejects(saveImage(space, id, "endless", endless), (error: Error) => error instanceof TooLargeError && /says it is 2000000×2000000 pixels/.test(error.message));
});

test("a listing reads no picture it has read before", async (t) => {
  const { id } = await createProject(space, { name: "Warm" });
  await saveShot(space, id, "home", await png(1320, 2868));
  await saveShot(space, id, "window", await macWindow(1600, 1000));
  await saveImage(space, id, "logo", svgLogo);
  const listed = await listShots(space, id);
  assert.equal(await sharpCalls(t, () => Promise.all([listShots(space, id), listImages(space, id)])), 0);
  // Without its index the folder is read again, and the same comes out.
  await rm(path.join(shotsDir(space, id), INDEX_FILE));
  assert.ok((await sharpCalls(t, () => listShots(space, id))) > 0);
  assert.deepEqual(await listShots(space, id), listed);
  assert.equal(await sharpCalls(t, () => listShots(space, id)), 0);
});

test("an index that cannot be read is rebuilt", async () => {
  const { id } = await createProject(space, { name: "Damaged Index" });
  await saveShot(space, id, "home", await png(1320, 2868));
  const listed = await listShots(space, id);
  const index = path.join(shotsDir(space, id), INDEX_FILE);
  for (const damage of ['{"version": 1, "files": {"home.iphone.png": {"size": "big"}}}', "{", '{"version": 99}']) {
    await writeFile(index, damage);
    assert.deepEqual(await listShots(space, id), listed);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(index, "utf8")).files), ["home.iphone.png"]);
  }
});

test("a file replaced behind the server's back is read again", async () => {
  const { id } = await createProject(space, { name: "Replaced" });
  await saveShot(space, id, "home", await png(1320, 2868));
  await writeFile(path.join(shotsDir(space, id), "home.iphone.png"), await png(1206, 2622));
  assert.deepEqual((await listShots(space, id)).map(({ width, height }) => [width, height]), [[1206, 2622]]);
});

test("a Mac window keeps its corner when it is moved (store-13)", async (t) => {
  const { id } = await createProject(space, { name: "Window", locales: ["en-US", "de-DE"] });
  const saved = await saveShot(space, id, "main", await macWindow(1600, 1000));
  assert.equal(saved.device, "mac");
  assert.ok(saved.corner && Math.abs(saved.corner - 20) <= 2, `corner ${saved.corner}`);
  let moved: Awaited<ReturnType<typeof moveShot>> | undefined;
  // The file is renamed, not read again.
  assert.equal(await sharpCalls(t, async () => (moved = await moveShot(space, id, saved.file, { locale: "de-DE" }))), 0);
  assert.equal(moved!.file, "main.mac.de-DE.png");
  assert.equal(moved!.corner, saved.corner);
});

test("a Mac window is found in a 16-bit capture and in one in grey", async () => {
  const { id } = await createProject(space, { name: "Depths" });
  const window = await macWindow(1600, 1000);
  const deep = await saveShot(space, id, "deep", await sharp(window).toColourspace("rgb16").png().toBuffer());
  assert.deepEqual([deep.width, deep.height, deep.corner], [1520, 920, (await saveShot(space, id, "plain", window)).corner]);
  // A picture in grey with see-through parts is kept whole: only a colour capture is cut down to its window.
  const grey = await saveShot(space, id, "grey", await sharp(window).toColourspace("b-w").png().toBuffer());
  assert.deepEqual([grey.width, grey.height], [1600, 1000]);
});

test("a screenshot moved into a language counts against that language's limit (store-13)", async () => {
  const limited = limitedSpace("moves", 1);
  const { id } = await createProject(limited, { name: "Moves", locales: ["en-US", "de-DE"] });
  await saveShot(limited, id, "one", await png(1320, 2868), undefined, "de-DE");
  const other = await saveShot(limited, id, "two", await png(1320, 2868));
  await assert.rejects(moveShot(limited, id, other.file, { locale: "de-DE" }), (error: Error) => error instanceof InputError && /per language, and de-DE has that many/.test(error.message));
  // Within its language it stays one of that language's.
  assert.equal((await moveShot(limited, id, other.file, { device: "ipad" })).file, "two.ipad.png");
});

test("an account has room for so many bytes of uploads (store-8)", async () => {
  const limited = limitedSpace("room", 40, 1_000_000);
  const { id } = await createProject(limited, { name: "Room" });
  const first = await saveShot(limited, id, "first", await png(1320, 2868));
  // Room for one and a half of them.
  limited.limits!.bytes = Math.round(first.bytes * 1.5);
  await assert.rejects(
    saveShot(limited, id, "second", await png(1320, 2868, "#10B981")),
    (error: Error) => error instanceof TooLargeError && /^This upload needs \d+ KB, and this account has \d+ KB left of the \d+ KB it has for screenshots and images\./.test(error.message),
  );
  // Replacing a screenshot frees what it took.
  await saveShot(limited, id, "first", await png(1320, 2868, "#EF4444"));
  const usage = await usageOf(limited);
  assert.equal(usage.uploadLimit, limited.limits!.bytes);
  assert.equal(usage.uploadBytes, (await listShots(limited, id))[0]!.bytes);
  // A full account is refused before the picture is decoded.
  limited.limits!.bytes = usage.uploadBytes;
  await assert.rejects(saveImage(limited, id, "logo", svgLogo), (error: Error) => error instanceof TooLargeError && /^This account has no room left/.test(error.message));
});

test("an account past its room can still replace an upload with a smaller one", async () => {
  const limited = limitedSpace("past", 40, 10_000_000);
  const { id } = await createProject(limited, { name: "Past" });
  const shot = await saveShot(limited, id, "home", await png(1320, 2868));
  const image = await saveImage(limited, id, "logo", svgLogo);
  // Room that was there when they were uploaded, and is less now: nothing new fits.
  limited.limits!.bytes = shot.bytes + image.bytes - 100;
  await assert.rejects(saveShot(limited, id, "other", await png(1320, 2868)), TooLargeError);
  const replaced = await saveShot(limited, id, "home", await png(1206, 2622));
  assert.ok(replaced.bytes <= shot.bytes, `${replaced.bytes} > ${shot.bytes}`);
  assert.equal(replaced.file, shot.file);
  assert.ok((await saveImage(limited, id, "logo", await png(64, 64))).bytes < image.bytes);
});

test("two uploads at once cannot both take the last of the room (store-8)", async () => {
  const limited = limitedSpace("race", 40, 1_000_000);
  const { id } = await createProject(limited, { name: "Race" });
  const picture = await png(1320, 2868);
  const probe = await saveShot(limited, id, "probe", picture);
  limited.limits!.bytes = probe.bytes * 2 + 100;
  const results = await Promise.allSettled(["a", "b", "c"].map((name) => saveShot(limited, id, name, picture)));
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected", "rejected"]);
});

test("an account without a limit is not counted", async () => {
  const usage = await usageOf(space);
  assert.equal(usage.uploadLimit, undefined);
  assert.equal(typeof usage.uploadBytes, "number");
});

test("screenshots of a language the project no longer has stand in for no other (store-14)", async () => {
  const { id } = await createProject(space, { name: "Dropped", locales: ["en-US", "fr-FR"] });
  const french = await saveShot(space, id, "home", await png(1320, 2868), undefined, "fr-FR");
  assert.equal(findShot(await listShots(space, id), "home", "iphone", "en-US")?.file, french.file);
  await updateProject(space, id, { locales: ["en-US", "de-DE"] });
  assert.equal(findShot(await listShots(space, id), "home", "iphone", "de-DE"), undefined);
  const { shots, orphaned } = await readShots(space, id);
  assert.deepEqual(shots, []);
  assert.deepEqual(orphaned.map((shot) => shot.file), [french.file]);
  // Adding the language again brings it back; moving it to another language keeps it.
  await updateProject(space, id, { locales: ["en-US", "de-DE", "fr-FR"] });
  assert.deepEqual((await listShots(space, id)).map((shot) => shot.file), [french.file]);
  // A caller that holds the project gives its languages, and they are not read again.
  assert.deepEqual(await listShots(space, id, ["en-US", "de-DE"]), []);
  await updateProject(space, id, { locales: ["en-US", "de-DE"] });
  const moved = await moveShot(space, id, french.file, { locale: "de-DE" });
  assert.deepEqual((await listShots(space, id)).map((shot) => shot.file), [moved.file]);
});

test("a temporary file a write left behind is cleared once it is old", async () => {
  const { id } = await createProject(space, { name: "Leftovers" });
  await saveShot(space, id, "home", await png(1320, 2868));
  const dir = shotsDir(space, id);
  const fresh = `home.iphone.png.${crypto.randomUUID()}.tmp`;
  const old = `home.iphone.png.${crypto.randomUUID()}.tmp`;
  await writeFile(path.join(dir, fresh), "");
  await writeFile(path.join(dir, old), "");
  await utimes(path.join(dir, old), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  await listShots(space, id);
  // Swept after the listing answers.
  for (let wait = 0; wait < 100 && (await readdir(dir)).includes(old); wait++) await sleep(20);
  const left = await readdir(dir);
  assert.ok(left.includes(fresh) && !left.includes(old), left.join(", "));
});
