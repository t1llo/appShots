import assert from "node:assert/strict";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import { after, test } from "node:test";
import { writeZip } from "../../src/zip.ts";
import { cliHome, PIXEL, quietly, stubServer } from "./helpers.mjs";

// A server that draws the layers of the example plan, stood in for: at once, or as a background job.
const home = await cliHome("video-layers");
after(() => home.remove());
const FIXTURES = path.join(import.meta.dirname, "fixtures", "video");
const MANIFEST = JSON.parse(readFileSync(path.join(FIXTURES, "layers-manifest.json"), "utf8"));
const SET = MANIFEST.set;
const SET_ROUTE = `/api/projects/p_example/video-layers/${SET}`;

/** A set's zip as the server sends it, without the layers named in `leave`. */
async function zipOf(leave = []) {
  const file = path.join(home.home, `layers-${Math.random().toString(16).slice(2)}.zip`);
  const out = createWriteStream(file);
  const layers = MANIFEST.layers.filter((layer) => !leave.includes(`${layer.locale}/${layer.id}`));
  await writeZip(out, [{ name: "manifest.json", data: Buffer.from(JSON.stringify(MANIFEST)) }, ...layers.map((layer) => ({ name: layer.locale ? `${layer.locale}/${layer.id}.png` : `${layer.id}.png`, data: PIXEL }))]);
  out.end();
  await finished(out);
  return readFileSync(file);
}

/** How the stand-in answers: "ready" draws at once, "job" in the background, "failed" not at all, "odd" with nonsense. */
let mode = "ready";
let zip = await zipOf();
/** How often the render job has been asked after. */
let polls = 0;
const server = await stubServer(({ method, url }) => {
  if (method === "POST" && url === "/api/projects/p_example/video-layers") {
    if (mode === "odd") return [200, { hello: "there" }];
    if (mode === "ready") return [200, { ...MANIFEST, charged: false }];
    polls = 0;
    return [202, { job: { id: "r_example" } }];
  }
  if (method === "GET" && url === "/api/renders/r_example") {
    polls += 1;
    if (mode === "failed") return [200, { id: "r_example", state: "failed", done: 0, total: 3, error: "the font could not be loaded" }];
    return [200, polls < 2 ? { id: "r_example", state: "running", done: 1, total: 3 } : { id: "r_example", state: "done", done: 3, total: 3, set: SET }];
  }
  if (method === "GET" && url === SET_ROUTE) return [200, { ...MANIFEST, charged: false }];
  if (method === "GET" && url === `${SET_ROUTE}/layers.zip`) return [200, zip, { "content-type": "application/zip" }];
  return [404, { error: "not found" }];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;
process.env.APPSHOTS_TOKEN = "test-token";

const { validatePlan } = await import("../../cli/src/video/plan.mjs");
const { fetchLayers, layerFile, layersCommand, layersRequest, localLayers, readManifest } = await import("../../cli/src/video/layers.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");

let roots = 0;
/** The example plan in a folder of its own, its languages settled. */
function planOf(change = (plan) => plan) {
  const raw = change(JSON.parse(readFileSync(path.join(FIXTURES, "plan.json"), "utf8")));
  const { plan, problems } = validatePlan(raw);
  assert.deepEqual(problems, []);
  const root = path.join(home.home, `app-${++roots}`);
  mkdirSync(root, { recursive: true });
  return { ...plan, locales: plan.locales ?? ["en", "de"], root, file: path.join(root, "appshots.video.json") };
}

const downloads = () => server.requests.filter((request) => request.url.endsWith("/layers.zip")).length;

test("the request names the display, the captions of the scenes and the cards", () => {
  const plan = planOf();
  const body = layersRequest(plan, "iphone", ["en", "de"]);
  assert.equal(body.display, "iphone");
  assert.equal(body.orientation, "portrait");
  assert.deepEqual(body.locales, ["en", "de"]);
  assert.deepEqual(
    body.captions.map(({ id, text }) => [id, text]),
    [
      ["inbox", { slide: 2 }],
      ["search", { slide: 3 }],
      ["share", "Share in one tap"],
    ],
  );
  assert.deepEqual(body.intro.headline, { slide: 1 });
  assert.deepEqual(body.outro.disclosure, ["subscription"]);
  assert.equal(body.plate, true);
  // Touches are shown unless a scene says not to, and they need the ring.
  assert.equal(body.touch, true);
  assert.equal(body.background, true);
  // A scene without a caption is left out, and with no touches shown there is no ring.
  const quiet = layersRequest(planOf((raw) => ({ ...raw, scenes: raw.scenes.map((scene, index) => ({ ...scene, touches: false, ...(index === 0 ? { caption: false } : {}) })) })), "iphone", ["en"]);
  assert.deepEqual(
    quiet.captions.map(({ id }) => id),
    ["search", "share"],
  );
  assert.equal(quiet.touch, false);
  assert.equal(layersRequest(plan, "mac", ["en"]).orientation, "landscape");
});

test("a set drawn at once is unpacked into its folder, and found again without the server", async () => {
  mode = "ready";
  const plan = planOf();
  const before = downloads();
  const manifest = await fetchLayers(plan, { display: "iphone" });
  assert.equal(manifest.set, SET);
  assert.equal(manifest.charged, false);
  const dir = path.join(plan.root, "appshots-video", "layers", SET);
  assert.equal(manifest.dir, dir);
  for (const layer of manifest.layers) {
    assert.equal(layer.path, path.join(dir, layerFile(layer)));
    assert.ok(existsSync(layer.path), layer.path);
  }
  assert.ok(existsSync(path.join(dir, "de", "caption-search.png")));
  assert.equal(downloads(), before + 1);
  // Nothing is left of the download but the set.
  assert.deepEqual(readdirSync(path.dirname(dir)).sort(), [SET, "current.json"]);

  const current = JSON.parse(readFileSync(path.join(plan.root, "appshots-video", "layers", "current.json"), "utf8"));
  assert.deepEqual(Object.keys(current.iphone), ["en", "de"]);
  assert.equal(current.iphone.en.set, SET);
  assert.equal(localLayers(plan, "iphone", "de")?.dir, dir);
  assert.equal(readManifest(dir)?.layers.length, MANIFEST.layers.length);
  assert.equal(localLayers(plan, "ipad", "en"), null);

  // The same set is not downloaded again.
  await fetchLayers(plan, { display: "iphone", locales: ["en"] });
  assert.equal(downloads(), before + 1);

  // Once the plan's captions change, the layers on this Mac are not the plan's any more.
  const changed = { ...plan, scenes: plan.scenes.map((scene) => (scene.id === "share" ? { ...scene, caption: "Share it" } : scene)) };
  assert.equal(localLayers(changed, "iphone", "en"), null);
  assert.equal(readManifest(path.join(plan.root, "nowhere")), null);
});

test("a set drawn in the background is followed until it is done, and used a render", async () => {
  mode = "job";
  const plan = planOf();
  let manifest;
  const printed = await quietly(async () => {
    manifest = await fetchLayers(plan, { display: "ipad", locales: ["de"] });
  });
  assert.equal(manifest?.set, SET);
  assert.equal(manifest?.charged, true);
  assert.match(printed, /ipad: drawing, 1 of 3/);
  assert.ok(server.requests.some((request) => request.method === "GET" && request.url === SET_ROUTE));
  assert.ok(localLayers(plan, "ipad", "de"));
  assert.equal(localLayers(plan, "ipad", "en"), null);
});

test("a job that fails, a set that comes without a layer and an answer that is no set all stop the command", async () => {
  mode = "failed";
  await assert.rejects(quietly(() => fetchLayers(planOf(), { display: "iphone" })), (error) => error instanceof Failure && error.message === "The server could not draw the layers of iphone: the font could not be loaded.");

  mode = "ready";
  zip = await zipOf(["de/caption-share", "en/outro-text"]);
  const plan = planOf();
  await assert.rejects(fetchLayers(plan, { display: "iphone" }), (error) => error instanceof Failure && error.message === `The layers of set ${SET} came without en/outro-text.png, de/caption-share.png.`);
  // Nothing that looks like a whole set is left behind.
  assert.deepEqual(readdirSync(path.join(plan.root, "appshots-video", "layers")), []);
  zip = await zipOf();

  mode = "odd";
  await assert.rejects(fetchLayers(planOf(), { display: "iphone" }), (error) => error instanceof Failure && /something that is not a set of layers/.test(error.message));
  mode = "ready";
});

test("the layers command says which set each display has, whether it used a render, and what was shrunk", async () => {
  mode = "ready";
  const plan = planOf();
  const printed = await quietly(() => layersCommand(plan, { displays: ["iphone", "ipad"], locales: ["en", "de"] }));
  assert.match(printed, /^iphone: asking the server for the layers in en, de$/m);
  assert.match(printed, new RegExp(`^iphone: set ${SET}, 14 layers in /.*/appshots-video/layers/${SET}\\. Drawn before, so no render was used\\.$`, "m"));
  assert.match(printed, /^ {2}de caption-search: shrunk to 64 % to fit$/m);
  assert.match(printed, /^ {2}de caption-share: drawn in en$/m);
  assert.match(printed, /^ipad: set /m);
});
