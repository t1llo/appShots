import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

// App Store Connect stood in for by a server on this machine: one app with a version being prepared, its store
// page in a few languages, and the screenshots each display holds.
const home = await cliHome("store");
after(() => home.remove());

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const keyFile = path.join(home.home, "AuthKey_TESTKEY123.p8");
writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
process.env.ASC_ISSUER_ID = "00000000-1111-2222-3333-444444444444";
process.env.ASC_KEY_ID = "TESTKEY123";
process.env.ASC_KEY_PATH = keyFile;

/** @type {{ app: any, locales: string[], sets: Map<string, { display: string, language: string, shots: string[] }>, shots: Map<string, any>, failOnce: Set<string>, slow: Set<string> }} */
let store;
let next = 0;
const reset = (locales, primaryLocale) => {
  store = { app: { id: "1001", attributes: { name: "Demo", bundleId: "com.example.demo", primaryLocale } }, locales, sets: new Map(), shots: new Map(), failOnce: new Set(), slow: new Set() };
};
const language = (locale) => ({ id: `loc-${locale}`, type: "appStoreVersionLocalizations", attributes: { locale } });
const shot = (id) => {
  const { fileName, checksum, state } = store.shots.get(id);
  return { id, type: "appScreenshots", attributes: { fileName, sourceFileChecksum: checksum, assetDeliveryState: { state } } };
};

const server = await stubServer(async ({ method, url, headers, body }) => {
  const route = url.split("?")[0];
  if (route.startsWith("/upload/")) {
    // The bytes go to storage without the token.
    assert.equal(headers.authorization, undefined);
    store.shots.get(route.slice(8)).bytes = body.length;
    return [200, ""];
  }
  if (store.failOnce.delete(`${method} ${route}`)) return [503, { errors: [{ detail: "Try again" }] }, { "retry-after": "1" }];
  const [scheme, token] = String(headers.authorization).split(" ");
  const [head, claims, signature] = token.split(".");
  assert.equal(scheme, "Bearer");
  assert.ok(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
  const json = body.length > 0 ? JSON.parse(body.toString()) : null;
  let match;
  if (method === "GET" && route === "/v1/apps") return [200, { data: [store.app], links: {} }];
  if (method === "GET" && route === `/v1/apps/${store.app.id}/appStoreVersions`) {
    return [200, { data: [{ id: "v1", type: "appStoreVersions", attributes: { versionString: "1.1", appVersionState: "PREPARE_FOR_SUBMISSION", platform: "IOS", createdDate: "2026-09-01T00:00:00Z" } }] }];
  }
  if (method === "GET" && route === "/v1/appStoreVersions/v1/appStoreVersionLocalizations") return [200, { data: store.locales.map(language) }];
  if (method === "GET" && (match = /^\/v1\/appStoreVersionLocalizations\/([^/]+)\/appScreenshotSets$/.exec(route))) {
    const sets = [...store.sets.entries()].filter(([, set]) => set.language === match[1]);
    return [200, { data: sets.map(([id, set]) => ({ id, type: "appScreenshotSets", attributes: { screenshotDisplayType: set.display } })) }];
  }
  if (method === "GET" && (match = /^\/v1\/appScreenshotSets\/([^/]+)\/appScreenshots$/.exec(route))) return [200, { data: store.sets.get(match[1]).shots.map(shot) }];
  if (method === "POST" && route === "/v1/appScreenshotSets") {
    const id = `set-${++next}`;
    store.sets.set(id, { display: json.data.attributes.screenshotDisplayType, language: json.data.relationships.appStoreVersionLocalization.data.id, shots: [] });
    return [201, { data: { id, type: "appScreenshotSets", attributes: json.data.attributes } }];
  }
  if (method === "POST" && route === "/v1/appScreenshots") {
    const id = `shot-${++next}`;
    const { fileName, fileSize } = json.data.attributes;
    // Files are sent side by side, so they can arrive in another order than the slides.
    if (store.slow.has(fileName)) await new Promise((resolve) => setTimeout(resolve, 50));
    store.shots.set(id, { fileName, checksum: null, state: "AWAITING_UPLOAD" });
    store.sets.get(json.data.relationships.appScreenshotSet.data.id).shots.push(id);
    const operations = [{ method: "PUT", url: `${server.url}/upload/${id}`, offset: 0, length: fileSize, requestHeaders: [{ name: "Content-Type", value: "image/png" }] }];
    return [201, { data: { id, type: "appScreenshots", attributes: { fileName, uploadOperations: operations } } }];
  }
  if (method === "PATCH" && (match = /^\/v1\/appScreenshots\/([^/]+)$/.exec(route))) {
    Object.assign(store.shots.get(match[1]), { checksum: json.data.attributes.sourceFileChecksum, state: "COMPLETE" });
    return [200, { data: shot(match[1]) }];
  }
  if (method === "PATCH" && (match = /^\/v1\/appScreenshotSets\/([^/]+)\/relationships\/appScreenshots$/.exec(route))) {
    store.sets.get(match[1]).shots = json.data.map((entry) => entry.id);
    return [204, ""];
  }
  if (method === "DELETE" && (match = /^\/v1\/appScreenshots\/([^/]+)$/.exec(route))) {
    for (const set of store.sets.values()) set.shots = set.shots.filter((id) => id !== match[1]);
    store.shots.delete(match[1]);
    return [204, ""];
  }
  return [404, { errors: [{ detail: `${method} ${route} is not part of this test` }] }];
});
after(() => server.close());
process.env.APPSHOTS_STORE_API = server.url;

const { storePush } = await import("../../cli/src/store/push.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");

/**
 * A PNG that says it is `width` by `height`, and a byte that tells the files apart.
 * @param {number} width
 * @param {number} height
 * @param {number} mark
 */
function png(width, height, mark) {
  const data = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(data);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data[40] = mark;
  return data;
}

/** An export as 'appshots pull' leaves it: a folder per language, and in it one per display. */
function exported(label, files) {
  const root = path.join(home.home, label);
  for (const [folder, count] of Object.entries(files)) {
    const [, target] = folder.split("/");
    const [width, height] = target.startsWith("ipad") ? [2064, 2752] : [1320, 2868];
    mkdirSync(path.join(root, folder), { recursive: true });
    for (let at = 1; at <= count; at++) writeFileSync(path.join(root, folder, `${String(at).padStart(2, "0")}.png`), png(width, height, at));
  }
  return root;
}

const shotsOf = (locale, display) => {
  const [, set] = [...store.sets.entries()].find(([, entry]) => entry.language === `loc-${locale}` && entry.display === display) ?? [];
  return set ? set.shots.map((id) => store.shots.get(id).fileName) : null;
};

beforeEach(() => {
  process.exitCode = undefined;
});

test("push sends each language onto its store language and keeps the order of the slides", async () => {
  reset(["en-US", "en-GB", "de-DE"], "en-GB");
  store.slow.add("01.png");
  const from = exported("first", { "en/iphone-6.9": 4, "en/ipad-13": 1, "de/iphone-6.9": 2 });
  const printed = await quietly(() => storePush(undefined, { app: "com.example.demo", from }));
  // en goes onto the app's primary language among its English pages.
  assert.deepEqual(shotsOf("en-GB", "APP_IPHONE_67"), ["01.png", "02.png", "03.png", "04.png"]);
  assert.deepEqual(shotsOf("en-GB", "APP_IPAD_PRO_3GEN_129"), ["01.png"]);
  assert.deepEqual(shotsOf("de-DE", "APP_IPHONE_67"), ["01.png", "02.png"]);
  assert.equal(shotsOf("en-US", "APP_IPHONE_67"), null);
  assert.ok([...store.shots.values()].every((entry) => entry.bytes === 64 && entry.state === "COMPLETE"));
  assert.match(printed, /^en goes onto en-GB; the store page has en-US as well, which --lang en=en-US picks$/m);
  assert.match(printed, /^7 screenshots uploaded\.$/m);
  assert.match(printed, /Nothing was submitted for review\./);
  assert.equal(process.exitCode, undefined);

  // The same files a second time change nothing.
  const again = await quietly(() => storePush(undefined, { app: "com.example.demo", from }));
  assert.match(again, /unchanged, the same 4 screenshots are there/);
  assert.match(again, /App Store Connect has these screenshots already/);
});

test("new files replace the ones a display holds, in their order", async () => {
  reset(["en-US"], "en-US");
  await quietly(() => storePush(undefined, { app: "com.example.demo", from: exported("before", { "en/iphone-6.9": 5 }) }));
  const before = new Set(store.shots.keys());
  await quietly(() => storePush(undefined, { app: "com.example.demo", from: exported("after", { "en-US/iphone-6.9": 3 }) }));
  assert.deepEqual(shotsOf("en-US", "APP_IPHONE_67"), ["01.png", "02.png", "03.png"]);
  assert.ok([...store.shots.keys()].every((id) => !before.has(id)));
});

test("a language that could go onto two store languages is left out, and the command ends with status 1", async () => {
  reset(["en-AU", "en-CA", "de-DE"], "de-DE");
  const from = exported("unclear", { "en/iphone-6.9": 1, "de/iphone-6.9": 1 });
  const printed = await quietly(() => storePush(undefined, { app: "com.example.demo", from }));
  assert.match(printed, /en: version 1\.1 for iOS has en-AU and en-CA, and either could be meant\. Say which with --lang en=en-AU\./);
  assert.deepEqual(shotsOf("de-DE", "APP_IPHONE_67"), ["01.png"]);
  assert.equal(process.exitCode, 1);
  process.exitCode = undefined;

  // Named, it goes there, and only the languages --lang names go at all.
  await quietly(() => storePush(undefined, { app: "com.example.demo", from, lang: "en=en-CA" }));
  assert.deepEqual(shotsOf("en-CA", "APP_IPHONE_67"), ["01.png"]);
  assert.equal(process.exitCode, undefined);
});

test("a language the store page lacks is not added without --add-languages", async () => {
  reset(["en-US"], "en-US");
  const printed = await quietly(() => storePush(undefined, { app: "com.example.demo", from: exported("french", { "en/iphone-6.9": 1, "fr/iphone-6.9": 1 }) }));
  assert.match(printed, /fr: version 1\.1 for iOS has no such language on its store page\. It has en-US\. --add-languages adds it as fr-FR\./);
  assert.equal(process.exitCode, 1);
  process.exitCode = undefined;
});

test("a picture of the wrong size stops the push before anything changes", async () => {
  reset(["en-US"], "en-US");
  const from = exported("wrong", { "en/iphone-6.9": 1 });
  writeFileSync(path.join(from, "en", "iphone-6.9", "02.png"), png(1290, 2796, 9));
  await assert.rejects(quietly(() => storePush(undefined, { app: "com.example.demo", from })), (error) => error instanceof Failure && /is 1290 x 2796, and the pictures of iphone-6\.9 are 1320 x 2868\. Nothing was changed\./.test(error.message));
  assert.equal(store.sets.size, 0);
});

test("a question App Store Connect could not answer for a moment is asked again", async () => {
  reset(["en-US"], "en-US");
  store.failOnce.add("GET /v1/apps");
  await quietly(() => storePush(undefined, { app: "com.example.demo", from: exported("retry", { "en/iphone-6.9": 1 }) }));
  assert.deepEqual(shotsOf("en-US", "APP_IPHONE_67"), ["01.png"]);
});
