import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { svgLogo } from "../helpers/images.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";
import { type FakeCapturer, fakeCapturer, gate } from "./video-fakes.ts";

// The video layers over HTTP, with the browser swapped for a capturer that makes plain pictures: what the routes
// answer, what they let a caller fetch, and what a run does when its caller cancels it or goes away.

const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let server: TestServer;
let fake: FakeCapturer;
let id: string;

const call = async (route: string, init: RequestInit = {}) => {
  const response = await server.fetch(route, init);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
};
const layers = (body: unknown) => call(`/api/projects/${id}/video-layers`, send("POST", body));
/** The run a page was drawn for, from the page's address. */
const jobOf = (capture: { path: string }) => new URL(capture.path, "http://page").searchParams.get("job")!;
async function settled(job: string) {
  for (;;) {
    const answer = await call(`/api/renders/${job}`);
    if (answer.body.finishedAt) return answer.body;
    await sleep(10);
  }
}
async function drawing() {
  while (fake.calls.length === 0) await sleep(5);
  return fake.calls[0]!;
}

before(async () => {
  server = await startServer({ inProcess: true });
  const { videoService } = await import("../../src/video/service.ts");
  fake = fakeCapturer();
  videoService.useCapturer(fake);
  id = (await call("/api/projects", send("POST", { name: "Preview", locales: ["en", "de"] }))).body.id;
  const slides = [
    { layout: "statement", headline: { en: "Plan your *week*", de: "Plane deine *Woche*" }, logo: { image: "logo", shape: "app-icon" } },
    { layout: "statement", headline: { en: "Share in one tap", de: "Mit einem Tipp teilen" } },
  ];
  assert.equal((await call(`/api/projects/${id}`, send("PUT", { slides }))).status, 200);
  await server.fetch(`/api/projects/${id}/images/logo`, { method: "PUT", body: new Uint8Array(svgLogo) });
});
after(async () => {
  await server?.stop();
});
beforeEach(() => {
  fake.calls.length = 0;
  fake.before = undefined;
});

const BODY = { display: "iphone", captions: [{ id: "plan", text: { slide: 1 } }], intro: { headline: { slide: 1 } }, outro: { lines: [{ slide: 2 }] } };

test("a set is drawn, read back and zipped, and its pictures are kept by the browser alone", async () => {
  const project = await call(`/api/projects/${id}`);
  const list = await call("/api/projects");

  const drawn = await layers(BODY);
  assert.equal(drawn.status, 200, JSON.stringify(drawn.body));
  assert.deepEqual(Object.keys(drawn.body).sort(), ["charged", "display", "layers", "locales", "rendersLeft", "set", "size", "warnings", "zip"]);
  assert.equal(drawn.body.charged, true);
  assert.equal(drawn.body.rendersLeft, null, "a server without sign-in counts no renders");
  assert.equal(drawn.headers.get("cache-control"), "private, no-cache");
  const { set } = drawn.body;
  assert.deepEqual(Object.keys(drawn.body.layers[1]).sort(), ["box", "file", "fit", "height", "id", "kind", "locale", "text", "width", "fallback"].sort());

  const read = await call(`/api/projects/${id}/video-layers/${set}`);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "private, no-cache");
  const { rendersLeft: _, ...manifest } = drawn.body;
  assert.deepEqual(read.body, { ...manifest, charged: false });

  const zip = await server.fetch(drawn.body.zip);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get("content-type"), "application/zip");
  assert.equal(zip.headers.get("cache-control"), "private, no-cache");
  assert.match(zip.headers.get("content-disposition")!, new RegExp(`filename="${id}-video-layers-${set}.zip"`));
  const archive = Buffer.from(await zip.arrayBuffer());
  for (const name of ["manifest.json", "plate.png", "en/caption-plan.png", "de/intro-text.png", "de/outro-logo.png"]) assert.ok(archive.includes(Buffer.from(name)), name);

  for (const layer of drawn.body.layers) {
    const picture = await server.fetch(layer.file);
    assert.equal(picture.status, 200, layer.file);
    assert.equal(picture.headers.get("content-type"), "image/png");
    assert.equal(picture.headers.get("cache-control"), "private, max-age=31536000, immutable");
  }

  const again = await layers(BODY);
  assert.equal(again.body.charged, false);
  assert.equal(again.body.set, set);
  assert.equal(fake.calls.length, 2, "two languages, drawn once");

  // The project, its list entry and its revisions do not change for a set of layers.
  assert.deepEqual((await call(`/api/projects/${id}`)).body, project.body);
  assert.deepEqual((await call("/api/projects")).body, list.body);
});

test("a run in the background answers at once and is followed and finished through /api/renders", async () => {
  const hold = gate();
  fake.before = () => hold.opened;
  const started = await layers({ ...BODY, captions: [{ id: "later", text: "Later" }], background: true });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.deepEqual(Object.keys(started.body).sort(), ["job", "rendersLeft", "set"]);
  const { job, set } = started.body;
  assert.equal(job.set, set);
  assert.equal(job.project, id);
  assert.equal(job.name, "Preview");

  const page = await drawing();
  assert.equal(jobOf(page), job.id);
  const running = await call(`/api/renders/${job.id}`);
  assert.equal(running.status, 200);
  assert.equal(running.body.state, "running");
  assert.equal(running.body.set, set);
  // A video run is not one of the renders the list shows, which the Studio's queue reads.
  assert.ok(!(await call("/api/renders")).body.some?.((entry: { id: string }) => entry.id === job.id));
  assert.equal((await call(`/api/projects/${id}/video-layers/${set}`)).status, 404, "not there before it is placed");

  hold.open();
  const done = await settled(job.id);
  assert.equal(done.state, "done");
  assert.equal(done.files, 11);
  assert.equal((await call(`/api/projects/${id}/video-layers/${set}`)).status, 200);
});

test("a run cancelled through /api/renders keeps nothing", async () => {
  const hold = gate();
  fake.before = () => hold.opened;
  const started = await layers({ ...BODY, captions: [{ id: "cancelled", text: "Cancelled" }], background: true });
  const { job, set } = started.body;
  await drawing();
  const cancelled = await call(`/api/renders/${job.id}`, { method: "DELETE" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.id, job.id);
  hold.open();
  assert.equal((await settled(job.id)).state, "cancelled");
  assert.equal(fake.calls.length, 1);
  assert.equal((await call(`/api/projects/${id}/video-layers/${set}`)).status, 404);
  assert.equal((await call("/api/renders/nope", { method: "DELETE" })).status, 404, "other jobs still reach the renders' routes");
});

test("a caller that goes away while it waits takes its run with it", async () => {
  const hold = gate();
  fake.before = () => hold.opened;
  const caller = new AbortController();
  const request = server.fetch(`/api/projects/${id}/video-layers`, { ...send("POST", { ...BODY, captions: [{ id: "gone", text: "Gone" }] }), signal: caller.signal }).catch(() => null);
  const page = await drawing();
  caller.abort();
  await request;
  while (!page.signal.aborted) await sleep(5);
  hold.open();
  const done = await settled(jobOf(page));
  assert.equal(done.state, "cancelled");
  assert.equal(fake.calls.length, 1, "the second language was never drawn");
});

test("the page a run draws from is there while it runs, for its own languages only", async () => {
  const hold = gate();
  fake.before = () => hold.opened;
  await layers({ ...BODY, captions: [{ id: "page", text: "Page" }], background: true });
  const page = await drawing();
  const html = await server.fetch(page.path);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.match(await html.text(), /data-layer="caption-page"/);
  assert.equal((await server.fetch(page.path.replace("locale=en", "locale=fr"))).status, 404);
  assert.equal((await server.fetch(`/render/${id}/video?job=nope&locale=en`)).status, 404);
  hold.open();
  await settled(jobOf(page));
  assert.equal((await server.fetch(page.path)).status, 404, "gone once the run ended");
});

test("a request that cannot be drawn is refused with a JSON error and costs nothing", async () => {
  const cases: [string, unknown, number, RegExp][] = [
    [id, { display: "iphone", captions: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, text: "A" })) }, 400, /captions/],
    [id, { display: "iphone", size: [887, 1920] }, 400, /even/],
    [id, { display: "iphone", locales: ["fr"] }, 400, /no language "fr"/],
    [id, { display: "iphone", captions: [{ id: "a", text: { slide: 7 } }] }, 400, /no slide 7/],
    [id, { display: "mac", orientation: "portrait" }, 400, /landscape only/],
    [id, {}, 400, /Give the display/],
    ["no-such-project", { display: "iphone" }, 404, /./],
  ];
  for (const [project, body, status, error] of cases) {
    const answer = await call(`/api/projects/${project}/video-layers`, send("POST", body));
    assert.equal(answer.status, status, JSON.stringify(body));
    assert.match(answer.body.error, error, JSON.stringify(body));
  }
  assert.equal(fake.calls.length, 0);
  const missing = await call(`/api/projects/${id}/video-layers/0123456789abcdef`);
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /newest 3 are kept/);
  assert.equal((await call(`/api/projects/${id}/video-layers/0123456789abcdef/layers.zip`)).status, 404);
  assert.equal((await call(`/api/projects/${id}/video-layers/..%2F..%2Fproject.json`)).status, 404);
});

test("a picture's address reaches nothing but the pictures of a set", async () => {
  const { set } = (await layers(BODY)).body;
  const base = `/files/${id}/video/${set}`;
  assert.equal((await server.fetch(`${base}/plate.png`)).status, 200);
  for (const route of [
    `${base}/..%2F..%2Fproject.json`,
    `${base}/%2E%2E/%2E%2E/project.json`,
    `${base}/..%2F..%2F..%2F${id}%2Fproject.json`,
    `${base}/manifest.json`,
    `${base}/en/..%2F..%2F..%2Fimages%2Flogo.png`,
    `/files/${id}/video/not-a-set/plate.png`,
    `/files/${id}/video/${set.toUpperCase()}/plate.png`,
    `/files/no-such-project/video/${set}/plate.png`,
  ]) {
    const answer = await server.fetch(route);
    assert.notEqual(answer.status, 200, route);
    assert.ok(!(await answer.text()).includes('"slides"'), route);
  }
});
