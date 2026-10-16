import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

// What fastlane snapshot leaves in fastlane/screenshots, and a server with one project in English and German.
const home = await cliHome("capture-plan-fastlane");
after(() => home.remove());

const server = await stubServer(({ method, url }) => {
  if (method === "GET" && url === "/api/projects/demo") return [200, { project: { id: "demo", locales: ["en", "de"] }, shots: [] }];
  if (method === "PUT" && url.startsWith("/api/projects/demo/shots/")) return [201, { name: "shot", width: 1320, height: 2868 }];
  return [404, { error: "not found" }];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;
process.env.APPSHOTS_TOKEN = "test-token";

const { parseArgs } = await import("../../cli/src/args.mjs");
const { shoot } = await import("../../cli/src/shoot.mjs");
const { fastlaneShots, splitSnapshotName } = await import("../../cli/src/capture-plan/fastlane.mjs");

/**
 * The start of a PNG, as far as its size: all that is read of one here.
 * @param {number} width
 * @param {number} height
 */
function png(width, height) {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "latin1");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return head;
}

const dir = path.join(home.home, "fastlane", "screenshots");
/** @type {Record<string, Buffer | string>} */
const files = {
  "en-US/iPhone 17 Pro Max-01Home.png": png(1320, 2868),
  "en-US/iPhone 17 Pro Max-01Home_framed.png": png(1500, 3100),
  // The same screen on a smaller iPhone, which the larger one's makes unneeded.
  "en-US/iPhone 11 Pro Max-01Home.png": png(1242, 2688),
  "en-US/iPad Pro 13-inch (M4)-02Stats.png": png(2064, 2752),
  // A size no display has is filed by the simulator's name.
  "en-US/iPhone 17 Pro Max-Settings.png": png(1000, 2000),
  "en-US/Apple Watch Ultra-01Home.png": png(410, 502),
  "en-US/notes.txt": "not a picture",
  "de-DE/iPhone 17 Pro Max-01Home.png": png(2868, 1320),
  "fr-FR/iPhone 17 Pro Max-01Home.png": png(1320, 2868),
  "screenshots.html": "<html></html>",
};
for (const [name, content] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  writeFileSync(path.join(dir, name), content);
}

/** @param {string[]} argv */
const shootWith = (argv) => quietly(() => shoot(parseArgs(argv)));
const uploads = () =>
  server.requests
    .filter((request) => request.method === "PUT")
    .map((request) => request.url.replace("/api/projects/demo/shots/", ""))
    .sort();

beforeEach(() => {
  server.requests.length = 0;
});

test("a fastlane file name is the simulator's, a hyphen, then the screenshot's", () => {
  assert.deepEqual(splitSnapshotName("iPhone 17 Pro Max-01Home"), { device: "iPhone 17 Pro Max", name: "01Home" });
  assert.deepEqual(splitSnapshotName("iPad Pro 13-inch (M4)-02Stats"), { device: "iPad Pro 13-inch (M4)", name: "02Stats" });
  assert.deepEqual(splitSnapshotName("iPad Pro (12.9-inch) (6th generation)-Home-Dark"), { device: "iPad Pro (12.9-inch) (6th generation)", name: "Home-Dark" });
  assert.deepEqual(splitSnapshotName("iPhone SE (3rd generation)-1-Home"), { device: "iPhone SE (3rd generation)", name: "1-Home" });
  assert.deepEqual(splitSnapshotName("Home"), { device: null, name: "Home" });
});

test("each picture is filed by its size and folder, one per name, family and language, the larger display's kept", () => {
  const { shots, left } = fastlaneShots(dir, ["en", "de"], { ids: ["home", "stats"] });
  assert.deepEqual(
    shots.map(({ relative, name, display, kind, locale }) => ({ relative, name, display, kind, locale })),
    [
      { relative: path.join("de-DE", "iPhone 17 Pro Max-01Home.png"), name: "home", display: "iphone-6.9", kind: "iphone", locale: "de" },
      { relative: path.join("en-US", "iPad Pro 13-inch (M4)-02Stats.png"), name: "stats", display: "ipad-13", kind: "ipad", locale: "en" },
      { relative: path.join("en-US", "iPhone 17 Pro Max-01Home.png"), name: "home", display: "iphone-6.9", kind: "iphone", locale: "en" },
      { relative: path.join("en-US", "iPhone 17 Pro Max-Settings.png"), name: "settings", display: null, kind: "iphone", locale: "en" },
    ],
  );
  assert.deepEqual(
    left.map(({ relative, why }) => `${relative}: ${why}`),
    [
      "en-US/Apple Watch Ultra-01Home.png: 410x502 is the size of no iPhone or iPad display",
      "fr-FR/iPhone 17 Pro Max-01Home.png: the run takes no language fr-FR, only en, de",
      "en-US/iPhone 11 Pro Max-01Home.png: en-US/iPhone 17 Pro Max-01Home.png is home in en already, and a project keeps one of each per family",
    ],
  );
  // Without a plan, a leading number is part of the name.
  assert.deepEqual(
    fastlaneShots(dir, ["en"]).shots.map((shot) => shot.name),
    ["02stats", "01home", "settings"],
  );
});

test("shoot --fastlane uploads each under its name, family and language", async () => {
  const printed = await shootWith(["demo", "--fastlane", dir]);
  assert.deepEqual(uploads(), ["01home?device=iphone&locale=de", "01home?device=iphone&locale=en", "02stats?device=ipad&locale=en", "settings?device=iphone&locale=en"]);
  assert.match(printed, /^en-US\/iPad Pro 13-inch \(M4\)-02Stats\.png -> 02stats \(ipad-13, en\)$/m);
  assert.match(printed, /^en-US\/iPhone 17 Pro Max-Settings\.png -> settings \(iphone, en\)$/m);
  assert.match(printed, /^ {2}! Left out fr-FR\/iPhone 17 Pro Max-01Home\.png: the run takes no language fr-FR, only en, de\.$/m);
  assert.match(printed, /^Imported 4 screenshots from fastlane into demo\.$/m);
});

test("with a plan, the screens take their ids and the project its name, and --only, --lang and --dry-run narrow it", async () => {
  const plan = path.join(home.home, "appshots.capture.json");
  writeFileSync(plan, JSON.stringify({ project: "demo", app: { bundleId: "com.example.notes" }, screens: [{ id: "home" }, { id: "stats" }] }));
  let printed = await shootWith(["--plan", plan, "--fastlane", dir, "--only", "home", "--dry-run"]);
  assert.deepEqual(uploads(), []);
  assert.deepEqual(printed.trim().split("\n").filter((line) => !line.startsWith("  ! ")), [
    `${path.join("de-DE", "iPhone 17 Pro Max-01Home.png")} -> home (iphone-6.9, de)`,
    `${path.join("en-US", "iPhone 17 Pro Max-01Home.png")} -> home (iphone-6.9, en)`,
    "Would upload 2 screenshots to demo. Nothing was uploaded (--dry-run).",
  ]);
  printed = await shootWith(["--plan", plan, "--fastlane", dir, "--lang", "de"]);
  assert.deepEqual(uploads(), ["home?device=iphone&locale=de"]);
  assert.match(printed, /^Imported 1 screenshot from fastlane into demo\.$/m);
});

test("--fastlane says what is wrong with what it is given", async () => {
  await assert.rejects(shootWith(["demo", "--fastlane", path.join(dir, "missing")]), /No such folder: .*missing\. --fastlane takes the folder fastlane snapshot writes into/);
  await assert.rejects(shootWith(["demo", "--fastlane", path.join(dir, "en-US")]), /has no folder per language, such as en-US/);
  await assert.rejects(shootWith(["demo", "--fastlane", dir, "--again"]), /--fastlane uploads all it finds, in place of what the project has, so it takes no --again/);
  await assert.rejects(shootWith(["demo", "--fastlane", dir, "--only", "nothing"]), /Nothing in .* to import named nothing\./);
  assert.deepEqual(uploads(), []);
});
