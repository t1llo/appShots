import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { libraryStandIn, REF_DATA } from "./helpers/asc-library-standin.mjs";
import { cliHome, quietly } from "./helpers.mjs";

// 'appshots video push' against a stand-in for App Store Connect's asset library on this machine. Apple is never
// called: APPSHOTS_STORE_API only takes a localhost address.
const home = await cliHome("video-push");
after(() => home.remove());

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const keyFile = path.join(home.home, "AuthKey_TESTKEY123.p8");
writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
process.env.ASC_ISSUER_ID = "00000000-1111-2222-3333-444444444444";
process.env.ASC_KEY_ID = "TESTKEY123";
process.env.ASC_KEY_PATH = keyFile;

const asc = await libraryStandIn(publicKey);
after(() => asc.close());
process.env.APPSHOTS_STORE_API = asc.url;

const { videoPush, PUSH_TIMING } = await import("../../cli/src/video/push.mjs");
const library = await import("../../cli/src/store/library.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
Object.assign(PUSH_TIMING, { first: 5, most: 20, wait: 3000 });

const IPHONE = "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE";
const IPAD = "IPAD_13_PROFILE";
const MAC = "MAC_PROFILE";

/** @type {Record<string, [number, number]>} */
const SIZES = { iphone: [886, 1920], ipad: [1200, 1600], mac: [1920, 1080], "iphone-5.5": [1080, 1920], "iphone-4.7": [750, 1334], "ipad-9.7": [900, 1200] };

/**
 * What ffprobe says of a preview that passes Apple's specification, as the real check reads it.
 * @param {number} width
 * @param {number} height
 * @param {number} seconds
 * @param {number} bytes
 */
const probeOf = (width, height, seconds, bytes) => ({
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", profile: "High", level: 40, pix_fmt: "yuv420p", width, height, sample_aspect_ratio: "1:1", field_order: "progressive", r_frame_rate: "30/1", avg_frame_rate: "30/1", nb_read_frames: String(Math.round(seconds * 30)), duration: seconds.toFixed(6), bit_rate: "11000000", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709", disposition: { default: 1, attached_pic: 0 } },
    { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000", duration: seconds.toFixed(6), bit_rate: "256000", disposition: { default: 1, attached_pic: 0 } },
  ],
  format: { duration: seconds.toFixed(6), size: String(bytes), bit_rate: "11300000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
});

let projects = 0;

/**
 * A plan's folder with previews in appshots-video/out, each with the check record the compose leaves beside it.
 * `record` is "v3" for the inspection's record, "v2" for the compose's, or false for none.
 * @param {Array<{ locale: string, display: string, seconds?: number, draft?: boolean, poster?: number | null, mark?: string, bytes?: number, size?: [number, number], record?: "v3" | "v2" | false, recordBytes?: number }>} files
 */
function project(files) {
  const root = path.join(home.home, `project-${++projects}`);
  for (const { locale, display, seconds = 20, draft = false, poster = 3.5, mark = "", bytes = 10000, size = SIZES[display], record = "v3", recordBytes = bytes } of files) {
    const folder = path.join(root, "appshots-video", "out", locale, display);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "preview.mp4"), Buffer.alloc(bytes, `${locale} ${display} ${mark} `));
    const probe = probeOf(size[0], size[1], seconds, recordBytes);
    const frame = poster === null ? undefined : { seconds: poster, timecode: "" };
    const stored =
      record === "v3"
        ? { version: 1, file: "preview.mp4", bytes: recordBytes, display, draft, poster: frame, errors: [], warnings: [], probe, checkedAt: "2026-10-16T00:00:00Z" }
        : { version: 1, key: "synthetic", file: "preview.mp4", display, locale, draft, seconds, poster: poster === null ? undefined : { at: poster, file: "preview.poster.png" }, result: { errors: [], warnings: [] }, probe };
    if (record) writeFileSync(path.join(folder, "preview.check.json"), JSON.stringify(stored));
  }
  return root;
}

/**
 * The plan as readPlan gives it.
 * @param {string} root
 * @param {{ locales?: string[], displays?: string[] }} [options]
 */
const planOf = (root, { locales = ["en", "de"], displays = ["iphone", "ipad", "mac"] } = {}) => ({ version: 1, name: "preview", project: "demo", app: { platform: "ios", bundleId: "com.example.demo" }, displays, locales, file: path.join(root, "appshots.video.json"), root });

/**
 * The reference name a file of a plan's folder is uploaded under.
 * @param {string} root
 * @param {string} locale
 * @param {string} display
 */
const nameOf = (root, locale, display) => `appshots preview ${locale} ${display} ${createHash("sha256").update(readFileSync(path.join(root, "appshots-video", "out", locale, display, "preview.mp4"))).digest("hex").slice(0, 8)}`;

/**
 * Runs the push, and gives back what it printed and the exit code it set.
 * @param {any} plan
 * @param {Record<string, string | true>} [flags]
 */
async function push(plan, flags = {}) {
  process.exitCode = undefined;
  const printed = await quietly(() => videoPush(plan, flags));
  const code = process.exitCode ?? 0;
  process.exitCode = undefined;
  return { printed, code };
}

/**
 * A push that has to stop, and the message it stops with.
 * @param {any} plan
 * @param {Record<string, string | true>} flags
 * @param {RegExp} message
 */
async function refused(plan, flags, message) {
  await assert.rejects(
    () => quietly(() => videoPush(plan, flags)),
    (/** @type {any} */ error) => {
      assert.ok(error instanceof Failure, error.stack);
      assert.match(error.message, message);
      return true;
    },
  );
}

/** @param {string} root */
const stateOf = (root) => JSON.parse(readFileSync(path.join(root, "appshots-video", "out", ".push-state.json"), "utf8"));

beforeEach(() => {
  asc.reset();
  process.exitCode = undefined;
});

test("push uploads each preview once, places it in its group on the page of its language, and submits nothing", async () => {
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "en", display: "ipad", poster: 6 },
    { locale: "en", display: "mac" },
    { locale: "de", display: "iphone" },
    { locale: "de", display: "ipad", record: "v2", poster: 2 },
  ]);
  const { printed, code } = await push(planOf(root));
  assert.equal(code, 0);
  assert.deepEqual(asc.violations, []);
  assert.deepEqual(asc.page("en-US", IPHONE), [nameOf(root, "en", "iphone")]);
  assert.deepEqual(asc.page("en-US", IPAD), [nameOf(root, "en", "ipad")]);
  assert.deepEqual(asc.page("de-DE", IPHONE), [nameOf(root, "de", "iphone")]);
  assert.deepEqual(asc.page("de-DE", IPAD), [nameOf(root, "de", "ipad")]);
  assert.deepEqual(asc.page("en-US", MAC, "MAC_OS"), [nameOf(root, "en", "mac")]);
  // Only the group of the largest display of each size gets the preview.
  assert.equal(asc.state.placements.size, 5);
  // Every byte arrived, in parts, and the poster frame is the record's time as a timecode.
  const videos = [...asc.state.videos.values()];
  assert.equal(videos.length, 5);
  for (const video of videos) {
    const [, , locale, display] = video.referenceName.split(" ");
    assert.deepEqual(video.bytes, readFileSync(path.join(root, "appshots-video", "out", locale, display, "preview.mp4")));
    assert.equal(video.parts.size, 3);
  }
  assert.deepEqual(videos.map((video) => video.timecode).sort(), ["00:00:02:00", "00:00:03:15", "00:00:03:15", "00:00:03:15", "00:00:06:00"]);
  const writes = asc.writes();
  assert.equal(writes.filter((write) => write === "POST /v1/appAssetLibraryVideos").length, 5);
  assert.equal(writes.filter((write) => write === "PATCH /v1/appAssetLibraryVideos/video-n").length, 5);
  assert.equal(writes.filter((write) => write === "POST /v1/appAssetLibraryPlacements").length, 5);
  assert.ok(writes.every((write) => /^(POST|PATCH|PUT) /.test(write)), writes.join("\n"));
  assert.match(printed, /^Demo 1\.1 for iOS \(being prepared\)$/m);
  assert.match(printed, /^en-US +iphone +placed in IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE, preview 1 of 1$/m);
  assert.match(printed, /^5 previews placed, 5 uploaded\.$/m);
  assert.match(printed, /Nothing was submitted for review\./);
  assert.match(printed, /appstoreconnect\.apple\.com\/apps\/1001/);
  // What was done is kept, for --resume.
  const state = stateOf(root);
  assert.equal(state.app, "1001");
  assert.equal(state.previews["en/iphone/preview"].referenceName, nameOf(root, "en", "iphone"));
  assert.deepEqual(Object.keys(state.previews["en/iphone/preview"].placements), ["loc-IOS-en-US"]);

  // The same files again change nothing.
  asc.requests.length = 0;
  const again = await push(planOf(root));
  assert.equal(again.code, 0);
  assert.deepEqual(asc.writes(), []);
  assert.match(again.printed, /^5 there already\.$/m);
});

test("a dry run only asks, and says what it would do", async () => {
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "de", display: "iphone" },
  ]);
  asc.seed({ locale: "en-US", group: IPHONE, referenceName: "Hero video" });
  const { printed, code } = await push(planOf(root), { "dry-run": true });
  assert.equal(code, 0);
  assert.ok(asc.requests.every((request) => request.method === "GET"));
  assert.deepEqual(asc.violations, []);
  assert.equal(existsSync(path.join(root, "appshots-video", "out", ".push-state.json")), false);
  assert.match(printed, /^Dry run: nothing is changed\.$/m);
  assert.match(printed, /^en-US +iphone +would upload .*preview\.mp4 \(0\.0 MB, 20\.0 s, poster at 00:00:03:15\) and place it in IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE, as preview 2 of at most 3$/m);
  assert.match(printed, /^de-DE +iphone +would upload/m);
  assert.match(printed, /^Run it again without --dry-run to do it\.$/m);
});

test("--no-wait stops after the upload, and --resume places what Apple has processed without uploading again", async () => {
  asc.reset({ processAfter: 3 });
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "de", display: "iphone" },
  ]);
  const first = await push(planOf(root), { "no-wait": true });
  assert.equal(first.code, 0);
  assert.equal(asc.state.placements.size, 0);
  assert.equal(asc.state.videos.size, 2);
  assert.match(first.printed, /^2 uploaded\.$/m);
  assert.match(first.printed, /Apple is still processing 2 previews\. Run 'appshots video push --resume' later/);
  assert.ok(Object.values(stateOf(root).previews).every((entry) => /** @type {any} */ (entry).video));

  asc.requests.length = 0;
  const second = await push(planOf(root), { resume: true });
  assert.equal(second.code, 0);
  assert.deepEqual(asc.violations, []);
  assert.deepEqual(asc.writes(), ["POST /v1/appAssetLibraryPlacements", "POST /v1/appAssetLibraryPlacements"]);
  assert.equal(asc.state.videos.size, 2);
  assert.deepEqual(asc.page("en-US", IPHONE), [nameOf(root, "en", "iphone")]);
  assert.deepEqual(asc.page("de-DE", IPHONE), [nameOf(root, "de", "iphone")]);
  assert.match(second.printed, /was uploaded before, and is not sent again/);
  assert.match(second.printed, /^2 previews placed\.$/m);
});

test("while Apple processes the uploads, each round asks about all of them in one request", async () => {
  asc.reset({ processAfter: 3 });
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "en", display: "ipad" },
    { locale: "de", display: "iphone" },
  ]);
  const { code } = await push(planOf(root));
  assert.equal(code, 0);
  assert.deepEqual(asc.violations, []);
  assert.equal(asc.state.placements.size, 3);
  const asked = asc.requests.filter((request) => request.method === "GET" && request.url.includes("filter[id]="));
  assert.equal(asked.length, 3);
  for (const request of asked) assert.equal(new URLSearchParams(request.url.split("?")[1]).get("filter[id]")?.split(",").length, 3);
  assert.equal(asc.requests.filter((request) => request.method === "GET" && request.url.startsWith("/v1/appAssetLibraryVideos/")).length, 0);

  // A video the list leaves out is asked for alone.
  asc.reset();
  asc.state.listsById = false;
  const next = project([
    { locale: "en", display: "iphone" },
    { locale: "de", display: "iphone" },
  ]);
  assert.equal((await push(planOf(next))).code, 0);
  assert.equal(asc.state.placements.size, 2);
  assert.equal(asc.requests.filter((request) => request.method === "GET" && request.url.startsWith("/v1/appAssetLibraryVideos/")).length, 2);
});

test("an upload that stopped before it was finished is uploaded anew by the next push, and placed", async () => {
  const root = project([{ locale: "en", display: "iphone" }]);
  asc.state.loseCommits = 1;
  await refused(planOf(root), {}, /could not finish preview\.mp4/);
  assert.deepEqual([...asc.state.videos.values()].map((video) => [video.referenceName, video.state]), [[nameOf(root, "en", "iphone"), "AWAITING_UPLOAD"]]);
  assert.equal(existsSync(path.join(root, "appshots-video", "out", ".push-state.json")), false);

  // The reservation that never got its file is not taken for an upload of it.
  const { printed, code } = await push(planOf(root));
  assert.equal(code, 0);
  assert.deepEqual(asc.violations, []);
  assert.doesNotMatch(printed, /uploaded before/);
  assert.match(printed, /^1 preview placed, 1 uploaded\.$/m);
  assert.deepEqual(asc.page("en-US", IPHONE), [nameOf(root, "en", "iphone")]);
  // It stays in the library, as appShots deletes nothing there.
  assert.deepEqual([...asc.state.videos.values()].map((video) => video.state), ["AWAITING_UPLOAD", "PREPARE_FOR_SUBMISSION"]);
});

test("--resume needs an earlier push of the same files", async () => {
  const root = project([{ locale: "en", display: "iphone" }]);
  await refused(planOf(root), { resume: true }, /Nothing to resume: there is no .*\.push-state\.json/);
  await push(planOf(root), { "no-wait": true });
  // A file composed again after the upload is not the one the last push left off with.
  writeFileSync(path.join(root, "appshots-video", "out", "en", "iphone", "preview.mp4"), Buffer.alloc(10000, "changed "));
  await refused(planOf(root), { resume: true }, /the last push uploaded none of these previews as they are now/);
});

test("--replace takes only appShots' earlier upload of the same preview off the page, and puts the new one in its place", async () => {
  const root = project([{ locale: "en", display: "iphone" }]);
  asc.seed({ locale: "en-US", group: IPHONE, referenceName: "Hero video" });
  asc.seed({ locale: "en-US", group: IPHONE, referenceName: "appshots preview en iphone 0badc0de" });
  asc.seed({ locale: "en-US", group: IPHONE, referenceName: "Walkthrough" });
  const videos = asc.state.videos.size;

  // Without a person to ask and without --replace, it stops before it changes anything.
  await refused(planOf(root), {}, /Ask the user whether appShots may take it off.*--replace\. Nothing was changed\./);
  assert.deepEqual(asc.writes(), []);

  const { printed, code } = await push(planOf(root), { replace: true });
  assert.equal(code, 0);
  assert.deepEqual(asc.violations, []);
  assert.deepEqual(asc.page("en-US", IPHONE), ["Hero video", nameOf(root, "en", "iphone"), "Walkthrough"]);
  // The group was full, so the earlier one made room first; the video itself stays in the library.
  const writes = asc.writes().filter((write) => !write.startsWith("PUT") && !write.startsWith("PATCH"));
  assert.deepEqual(writes, ["POST /v1/appAssetLibraryVideos", "DELETE /v1/appAssetLibraryPlacements/placement-n", "POST /v1/appAssetLibraryPlacements", "POST /v1/appAssetLibraryPlacementOrderingRequests"]);
  assert.equal(asc.state.videos.size, videos + 1);
  assert.match(printed, /placed in IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE, in place of appShots' earlier upload, preview 2 of 3/);
});

test("with room in the group, the new preview goes onto the page before the earlier one comes off", async () => {
  const root = project([{ locale: "en", display: "iphone" }]);
  asc.seed({ locale: "en-US", group: IPHONE, referenceName: "appshots preview en iphone 0badc0de" });
  asc.seed({ locale: "en-US", group: IPHONE, referenceName: "Hero video" });
  const { code } = await push(planOf(root), { replace: true });
  assert.equal(code, 0);
  assert.deepEqual(asc.violations, []);
  assert.deepEqual(asc.page("en-US", IPHONE), [nameOf(root, "en", "iphone"), "Hero video"]);
  const writes = asc.writes().filter((write) => !write.startsWith("PUT") && !write.startsWith("PATCH"));
  assert.deepEqual(writes, ["POST /v1/appAssetLibraryVideos", "POST /v1/appAssetLibraryPlacements", "DELETE /v1/appAssetLibraryPlacements/placement-n", "POST /v1/appAssetLibraryPlacementOrderingRequests"]);
});

test("a group the user filled stops the push, with --replace as well", async () => {
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "en", display: "ipad" },
  ]);
  for (const name of ["One", "Two", "Three"]) asc.seed({ locale: "en-US", group: IPHONE, referenceName: name });
  await refused(planOf(root), {}, /^en-US +iphone +IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE holds 3 previews already.*Take one off in App Store Connect first\.\nNothing was changed\.$/m);
  await refused(planOf(root), { replace: true }, /holds 3 previews already/);
  assert.deepEqual(asc.writes(), []);
  assert.deepEqual(asc.page("en-US", IPHONE), ["One", "Two", "Three"]);

  const { printed, code } = await push(planOf(root), { "dry-run": true });
  assert.equal(code, 1);
  assert.match(printed, /! en-US +iphone +IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE holds 3 previews already/);
  assert.match(printed, /^en-US +ipad +would upload/m);
});

test("a version that is not being prepared is refused, as this command makes none", async () => {
  const root = project([{ locale: "en", display: "iphone" }]);
  asc.reset({ ios: null });
  await refused(planOf(root), {}, /No version of Demo for iOS is being prepared: the latest is 1\.0 \(on the App Store\)\. .*Nothing was changed\./);
  asc.reset({ ios: "WAITING_FOR_REVIEW" });
  await refused(planOf(root), {}, /the latest is 1\.1 \(waiting for review\)/);
  asc.reset();
  await refused(planOf(root), { version: "1.2" }, /There is no version 1\.2 of Demo for iOS in App Store Connect\. The one being prepared is 1\.1/);
  await refused(planOf(root), { version: "1.0" }, /Version 1\.0 \(on the App Store\) of Demo for iOS can no longer be changed/);
  assert.deepEqual(asc.writes(), []);
  assert.deepEqual(asc.violations, []);
});

test("an app with no version for a platform says so, and --display leaves its previews out", async () => {
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "en", display: "mac" },
  ]);
  asc.reset({ platforms: ["IOS"] });
  await refused(planOf(root), {}, /^Demo has no macOS version in App Store Connect\. Mac previews go onto the macOS version of an app: add that platform there first, or leave them out with --display iphone\. Nothing was changed\.$/);
  assert.deepEqual(asc.writes(), []);
  const { code } = await push(planOf(root), { display: "iphone" });
  assert.equal(code, 0);
  assert.deepEqual(asc.page("en-US", IPHONE), [nameOf(root, "en", "iphone")]);

  asc.reset({ platforms: ["MAC_OS"] });
  await refused(planOf(root), {}, /^Demo has no iOS version in App Store Connect\. iPhone and iPad previews go onto the iOS version of an app: add that platform there first, or leave them out with --display mac\. Nothing was changed\.$/);
  await refused(planOf(root), { display: "iphone" }, /add that platform there first\. Nothing was changed\.$/);
  assert.deepEqual(asc.writes(), []);
  assert.deepEqual(asc.violations, []);
});

test("drafts, files that fail the check and files without a record of it never reach App Store Connect", async () => {
  const cases = [
    [{ locale: "en", display: "iphone", draft: true }, /is a draft, which App Store Connect does not take/],
    [{ locale: "en", display: "iphone", seconds: 40 }, /does not pass Apple's specification: duration/],
    [{ locale: "en", display: "iphone", size: /** @type {[number, number]} */ ([1080, 1920]) }, /does not pass Apple's specification: size/],
    [{ locale: "en", display: "iphone", record: /** @type {const} */ (false) }, /has no check record beside it/],
    [{ locale: "en", display: "iphone", recordBytes: 9000 }, /changed after it was checked/],
  ];
  for (const [file, message] of cases) {
    const root = project([/** @type {any} */ (file), { locale: "de", display: "iphone" }]);
    await refused(planOf(root), {}, message);
    assert.equal(asc.requests.length, 0);
  }
});

test("a preview Apple refuses is reported, and the others are placed", async () => {
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "de", display: "iphone" },
  ]);
  asc.state.refuse.push("appshots preview de ");
  const { printed, code } = await push(planOf(root));
  assert.equal(code, 1);
  assert.deepEqual(asc.violations, []);
  assert.deepEqual(asc.page("en-US", IPHONE), [nameOf(root, "en", "iphone")]);
  assert.deepEqual(asc.page("de-DE", IPHONE), []);
  assert.match(printed, /! de-DE +iphone +Apple did not take .*preview\.mp4: The video is shorter than the placement allows\./);
  assert.equal(stateOf(root).previews["de/iphone/preview"].video, null);
});

test("a language the version does not have is left out with a line, and the rest is placed", async () => {
  asc.reset({ locales: ["en-US"] });
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "de", display: "iphone" },
  ]);
  const { printed, code } = await push(planOf(root));
  assert.equal(code, 1);
  assert.deepEqual(asc.page("en-US", IPHONE), [nameOf(root, "en", "iphone")]);
  assert.match(printed, /! de: version 1\.1 for iOS has no such language on its store page\. It has en-US\. 'appshots store push <project> --add-languages' adds it as de-DE\./);
});

test("--lang picks the languages and says which store language each goes onto; --display picks the displays", async () => {
  asc.reset({ locales: ["en-US", "en-GB", "de-DE"] });
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "en", display: "ipad" },
    { locale: "de", display: "iphone" },
  ]);
  const { code } = await push(planOf(root), { lang: "en=en-GB", display: "iphone" });
  assert.equal(code, 0);
  assert.deepEqual(asc.page("en-GB", IPHONE), [nameOf(root, "en", "iphone")]);
  assert.deepEqual(asc.page("en-US", IPHONE), []);
  assert.deepEqual(asc.page("en-GB", IPAD), []);
  assert.deepEqual(asc.page("de-DE", IPHONE), []);

  // Without --lang, en goes onto the app's primary language among its English pages, and it says so.
  const next = project([{ locale: "en", display: "ipad" }]);
  const { printed } = await push(planOf(next));
  assert.match(printed, /^en goes onto en-US; the store page has en-GB as well, which --lang en=en-GB picks$/m);
  assert.deepEqual(asc.page("en-US", IPAD), [nameOf(next, "en", "ipad")]);

  await refused(planOf(root), { display: "watch" }, /--display takes iphone, ipad, mac/);
});

test("two folders of one language that go onto one page stop the push, and --lang picks a folder by its own code", async () => {
  asc.reset({ locales: ["en-GB", "de-DE"] });
  const root = project([
    { locale: "en", display: "iphone" },
    { locale: "en-GB", display: "iphone" },
  ]);
  const plan = planOf(root, { locales: ["en", "en-GB"] });
  await refused(plan, {}, /en\/iphone\/preview\.mp4 and .*en-GB\/iphone\/preview\.mp4 would both go onto en-GB\. Leave one out with --lang\. Nothing was changed\./);
  assert.deepEqual(asc.writes(), []);
  const { code } = await push(plan, { lang: "en-GB" });
  assert.equal(code, 0);
  assert.deepEqual(asc.page("en-GB", IPHONE), [nameOf(root, "en-GB", "iphone")]);
  assert.equal(asc.state.videos.size, 1);
});

test("a poster frame chosen after the upload is moved on the video that is there", async () => {
  const root = project([{ locale: "en", display: "iphone", poster: 3.5 }]);
  await push(planOf(root));
  const record = path.join(root, "appshots-video", "out", "en", "iphone", "preview.check.json");
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, "utf8")), poster: { seconds: 8, timecode: "00:00:08:00", chosen: true } }));
  asc.requests.length = 0;
  const { printed } = await push(planOf(root));
  assert.deepEqual(asc.writes(), ["PATCH /v1/appAssetLibraryVideos/video-n"]);
  assert.equal([...asc.state.videos.values()][0].timecode, "00:00:08:00");
  assert.match(printed, /moved the poster frame of .*preview\.mp4 to 00:00:08:00/);
});

test("a dry run says which poster frames the push would move, and which stay as they are", async () => {
  // Uploaded with --no-wait, not placed yet, and its poster chosen again since.
  const root = project([{ locale: "en", display: "iphone", poster: 3 }]);
  await push(planOf(root), { "no-wait": true });
  const record = path.join(root, "appshots-video", "out", "en", "iphone", "preview.check.json");
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, "utf8")), poster: { seconds: 8, timecode: "00:00:08:00", chosen: true } }));
  asc.requests.length = 0;
  const dry = await push(planOf(root), { "dry-run": true });
  assert.ok(asc.requests.every((request) => request.method === "GET"));
  assert.match(dry.printed, /^en-US +iphone +would place .*preview\.mp4, uploaded before, in IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE, as preview 1 of at most 3; its poster frame would move to 00:00:08:00$/m);
  const real = await push(planOf(root));
  assert.deepEqual(asc.writes(), ["PATCH /v1/appAssetLibraryVideos/video-n", "POST /v1/appAssetLibraryPlacements"]);
  assert.match(real.printed, /moved the poster frame of .*preview\.mp4 to 00:00:08:00/);

  // A video that is in review keeps its poster frame, in the dry run as in the push.
  const placed = project([{ locale: "de", display: "iphone", poster: 8 }]);
  asc.seed({ locale: "de-DE", group: IPHONE, referenceName: nameOf(placed, "de", "iphone"), state: "IN_REVIEW" });
  asc.requests.length = 0;
  const looked = await push(planOf(placed), { "dry-run": true });
  assert.match(looked.printed, /^de-DE +iphone +.*preview\.mp4 is there already, in IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE$/m);
  assert.match(looked.printed, /! .*preview\.mp4: Apple has the poster frame at 00:00:01:00, and the video is in review, so it stays there\./);
  const left = await push(planOf(placed));
  assert.deepEqual(asc.writes(), []);
  assert.match(left.printed, /so it stays there\. Change it in App Store Connect\./);
});

test("the group of a preview comes from the reference data: the largest display of its size, on its platform", () => {
  const group = (/** @type {string} */ display, /** @type {number} */ width, /** @type {number} */ height, ref = REF_DATA) => library.previewGroup(/** @type {any} */ (ref), { display, width, height })?.group ?? null;
  assert.equal(group("iphone", 886, 1920), "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE");
  assert.equal(group("iphone", 1920, 886), "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE");
  assert.equal(group("ipad", 1200, 1600), "IPAD_13_PROFILE");
  assert.equal(group("ipad-9.7", 900, 1200), "IPAD_97_PROFILE");
  assert.equal(group("iphone-5.5", 1080, 1920), "IPHONE_HOME_BUTTON_LARGE_PROFILE");
  assert.equal(group("iphone-4.7", 750, 1334), "IPHONE_HOME_BUTTON_MEDIUM_PROFILE");
  // The Mac's size is also the 5.5-inch iPhone's landscape one: the platform tells them apart.
  assert.equal(group("mac", 1920, 1080), "MAC_PROFILE");
  assert.equal(group("iphone-5.5", 1920, 1080), "IPHONE_HOME_BUTTON_LARGE_PROFILE");
  assert.equal(group("iphone", 1000, 1000), null);
  assert.equal(library.previewGroup(/** @type {any} */ (REF_DATA), { display: "iphone", width: 886, height: 1920 })?.limit, 3);
  // Without the large group, a group for this size alone wins over the larger foldable one that takes others too;
  // the group of custom product pages is never one.
  const fewer = { ...REF_DATA, placementTypes: REF_DATA.placementTypes.map((type) => ({ ...type, specMappings: type.specMappings.filter((/** @type {any} */ mapping) => mapping.placementGroupId !== IPHONE) })) };
  assert.equal(group("iphone", 886, 1920, fewer), "IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE");
});

test("the client refuses every write but an upload, a placement, the removal of its own and an order", async () => {
  const { guardWrite, removePlacement } = library;
  for (const [method, route, body] of /** @type {Array<[string, string, any]>} */ ([
    ["GET", "/v1/apps/1001/appStoreVersions", undefined],
    ["POST", "/v1/appAssetLibraryVideos", { data: { attributes: { fileName: "a.mp4" } } }],
    ["PATCH", "/v1/appAssetLibraryVideos/video-1", { data: { attributes: { uploaded: true } } }],
    ["PATCH", "/v1/appAssetLibraryVideos/video-1", { data: { attributes: { previewFrameTimeCode: "00:00:01:00" } } }],
    ["POST", "/v1/appAssetLibraryPlacements", { data: {} }],
    ["DELETE", "/v1/appAssetLibraryPlacements/placement-1", undefined],
    ["POST", "/v1/appAssetLibraryPlacementOrderingRequests", { data: {} }],
  ])) {
    assert.doesNotThrow(() => guardWrite(method, route, body), `${method} ${route}`);
  }
  for (const [method, route, body] of /** @type {Array<[string, string, any]>} */ ([
    ["POST", "/v1/reviewSubmissions", { data: {} }],
    ["POST", "/v1/appStoreVersionSubmissions", { data: {} }],
    ["POST", "/v1/appStoreVersionReleaseRequests", { data: {} }],
    ["PATCH", "/v1/appStoreVersions/IOS-1.1", { data: { attributes: { releaseType: "AFTER_APPROVAL" } } }],
    ["PATCH", "/v1/appAssetLibraryVideos/video-1", { data: { attributes: { archived: true } } }],
    ["PATCH", "/v1/appAssetLibraryVideos/video-1", { data: { attributes: { uploaded: true, referenceName: "x" } } }],
    ["DELETE", "/v1/appAssetLibraryVideos/video-1", undefined],
    ["DELETE", "/v1/appStoreVersionLocalizations/loc-1", undefined],
    ["POST", "/v1/appAssetLibraryPlacements/../reviewSubmissions", { data: {} }],
  ])) {
    assert.throws(() => guardWrite(method, route, body), (/** @type {any} */ error) => error instanceof Failure && /never submits, releases, archives or deletes/.test(error.message), `${method} ${route}`);
  }
  // A placement of a video the user uploaded is not taken off, and App Store Connect is not even asked.
  asc.requests.length = 0;
  await assert.rejects(() => removePlacement(/** @type {any} */ ({}), { id: "placement-1", video: { id: "video-1", referenceName: "Hero video", state: "PREPARE_FOR_SUBMISSION", timecode: null } }), /only takes its own previews off a page/);
  await assert.rejects(() => removePlacement(/** @type {any} */ ({}), { id: "placement-1", video: null }), /only takes its own previews off a page/);
  assert.equal(asc.requests.length, 0);
});

test("the specification of a group is read against a file's size, length and kind", () => {
  assert.equal(library.isoSeconds("PT15S"), 15);
  assert.equal(library.isoSeconds("PT1M30S"), 90);
  assert.equal(library.isoSeconds("PT0.5S"), 0.5);
  assert.equal(library.isoSeconds("15"), null);
  assert.equal(library.isoSeconds("PT"), null);
  const spec = REF_DATA.videoSpecs[0];
  assert.deepEqual(library.specProblems(spec, { file: "preview.mp4", bytes: 1000, seconds: 20 }), []);
  assert.deepEqual(library.specProblems(spec, { file: "preview.mp4", bytes: 1000, seconds: null }), []);
  const problems = library.specProblems(spec, { file: "preview.avi", bytes: 600 * 1048576, seconds: 31 });
  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /it is 600\.0 MB, and the group takes at most 500\.0 MB/);
  assert.match(problems.join("\n"), /it is 31\.0 s long, and the group takes 15 to 30 s/);
  assert.match(problems.join("\n"), /the group takes \.mp4, \.m4v, \.mov files/);
});
