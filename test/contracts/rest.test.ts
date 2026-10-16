import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { png, sizeOf, svgLogo } from "../helpers/images.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";

// The HTTP API as docs/api.md describes it and as clients use it today. Changes to it are additive only: a test
// here may gain assertions, but one that fails means a client somewhere breaks. Key sets are checked for what is
// there, so a new key passes and a missing one does not.

const RENDER = process.env.RENDER_TESTS === "1";
const renderTier = { skip: RENDER ? false : "draws with Chromium; run with RENDER_TESTS=1" };

let server: TestServer;
before(async () => {
  server = await startServer({ inProcess: true });
});
after(async () => {
  await server?.stop();
});

interface Answer {
  status: number;
  headers: Headers;
  body: any;
}

/** A request whose answer is read as JSON where it is JSON. */
async function call(route: string, init: RequestInit = {}): Promise<Answer> {
  const response = await server.fetch(route, init);
  const text = await response.text();
  const body = response.headers.get("content-type")?.includes("json") && text ? JSON.parse(text) : text;
  return { status: response.status, headers: response.headers, body };
}

const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const upload = (data: Buffer): RequestInit => ({ method: "PUT", body: new Uint8Array(data) });

function assertKeys(value: unknown, keys: string[]): void {
  assert.ok(value !== null && typeof value === "object", `expected an object, got ${JSON.stringify(value)}`);
  const missing = keys.filter((key) => !(key in value));
  assert.deepEqual(missing, [], `missing from ${JSON.stringify(value).slice(0, 300)}`);
}

/** The error shape of docs/api.md: one sentence under `error`. */
function assertError(answer: Answer, status: number, says?: RegExp): void {
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  assert.match(answer.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(typeof answer.body.error, "string");
  if (says) assert.match(answer.body.error, says);
}

const PROJECT_KEYS = ["id", "name", "createdAt", "updatedAt", "locales", "theme", "slides", "deviceSlides", "creatives", "mockups"];
const DETAIL_KEYS = ["project", "shots", "orphanedShots", "images", "outputs", "creativeOutputs", "defaultTargets"];
const LIST_KEYS = ["id", "name", "slides", "ownSets", "locales", "updatedAt"];
const SHOT_KEYS = ["name", "device", "file", "width", "height", "bytes", "version"];
const IMAGE_KEYS = ["name", "file", "width", "height", "bytes", "version"];
const JOB_KEYS = ["id", "project", "name", "state", "done", "total", "createdAt"];
const META_KEYS = [
  "account", "authEnabled", "backgrounds", "badgeTones", "badgeTypes", "badgesShown", "cardIcons", "cardLooks", "creativeLayouts", "deviceCatalog",
  "deviceColors", "deviceStyles", "devices", "emphasis", "featureLayouts", "featureStyles", "fontList", "fonts", "iconGroups", "iconRowSizes", "iconRowStyles",
  "iconRowTones", "icons", "layoutShots", "layoutSpread", "layouts", "logoShapes", "logoSizes", "placements", "pointStyles", "rendersLeft",
  "reviewsShown", "statusBars", "targets",
];

const THREE_SLIDES = [
  { layout: "device-bottom", headline: "First *slide*", screenshot: "home" },
  { layout: "statement", headline: "Second slide" },
  { layout: "statement", headline: "Third slide" },
];

/** Asks for a render until it has ended, as docs/api.md tells a client to. */
async function ended(job: { id: string; state: string }): Promise<any> {
  for (let tries = 0; tries < 1200 && (job.state === "queued" || job.state === "running"); tries++) {
    await sleep(50);
    job = (await call(`/api/renders/${job.id}`)).body;
  }
  return job;
}

async function createProject(body: Record<string, unknown>): Promise<string> {
  const created = await call("/api/projects", send("POST", body));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id;
}

describe("public addresses", () => {
  test("/healthz answers ok", async () => {
    const answer = await call("/healthz");
    assert.equal(answer.status, 200);
    assert.equal(answer.body, "ok");
    assert.match(answer.headers.get("content-type")!, /^text\/plain/);
  });

  test("/skill.md is the skill with this server's address in it", async () => {
    const answer = await call("/skill.md");
    assert.equal(answer.status, 200);
    assert.match(answer.headers.get("content-type")!, /^text\/markdown/);
    assert.ok(answer.body.includes(server.url));
    assert.ok(!answer.body.includes("{{SERVER}}"));
  });

  test("/skill.json holds a short hash of the skill and of the command", async () => {
    const answer = await call("/skill.json");
    assert.equal(answer.status, 200);
    assertKeys(answer.body, ["skill", "cli"]);
    assert.match(answer.body.skill, /^[0-9a-f]{16}$/);
    assert.match(answer.body.cli, /^[0-9a-f]{16}$/);
    assert.equal(answer.headers.get("cache-control"), "no-cache");
  });

  test("/install.sh is the setup script for this server", async () => {
    const answer = await call("/install.sh");
    assert.equal(answer.status, 200);
    assert.match(answer.headers.get("content-type")!, /^text\/plain/);
    assert.ok(answer.body.includes(server.url));
    assert.ok(!answer.body.includes("{{SERVER}}"));
  });

  test("/cli/appshots.mjs is one file that imports nothing but Node", async () => {
    const answer = await call("/cli/appshots.mjs");
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get("content-disposition"), 'attachment; filename="appshots.mjs"');
    assert.ok(answer.body.startsWith("#!/usr/bin/env node"));
    // ObjC.import() inside the JXA it runs on the Mac is not one.
    const imports = [...answer.body.matchAll(/(?:^import\s[^;]*?from\s*|(?<![\w.])import\()\s*["']([^"']+)["']/gm)].map((match) => match[1]);
    assert.ok(imports.length > 0);
    assert.deepEqual(imports.filter((name: string) => !name.startsWith("node:")), []);
  });

  for (const route of ["/docs/api.md", "/docs/mcp.md", "/docs/index.md", "/privacy.md", "/llms.txt", "/llms-full.txt"]) {
    test(`${route} is Markdown with this server's address in it`, async () => {
      const answer = await call(route);
      assert.equal(answer.status, 200);
      assert.match(answer.headers.get("content-type")!, /^text\/(markdown|plain)/);
      assert.ok(!answer.body.includes("{{SERVER}}"));
    });
  }

  test("a docs page is made once and answered 304 to a reader that has it", async () => {
    const first = await call("/docs/api.md");
    const etag = first.headers.get("etag");
    assert.ok(etag, "no ETag");
    assert.equal(first.headers.get("cache-control"), "no-cache");
    // fetch() sends Cache-Control: no-cache with If-None-Match and sets Host itself, so these go out by hand.
    const { port } = new URL(server.url);
    const statusOf = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const request = http.get({ host: "127.0.0.1", port, path: "/docs/api.md", headers }, (response) => {
          response.resume();
          resolve(response.statusCode!);
        });
        request.on("error", reject);
      });
    assert.equal(await statusOf({ "If-None-Match": etag }), 304);
    assert.equal((await call("/docs/api.md")).body, first.body);
    // Another address is another page.
    assert.equal(await statusOf({ "If-None-Match": etag, Host: `localhost:${port}` }), 200);
  });

  test("/llms.txt says whether people sign in as this server is set up", async () => {
    const answer = await call("/llms.txt");
    assert.match(answer.body, /without signing in/);
    assert.doesNotMatch(answer.body, /sign in with Google/);
  });

  test("fonts, icons and robots.txt are served", async () => {
    const css = await call("/fonts/fonts.css");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type")!, /^text\/css/);
    const icons = await call("/icons.svg");
    assert.equal(icons.status, 200);
    assert.match(icons.headers.get("content-type")!, /^image\/svg\+xml/);
    const robots = await call("/robots.txt");
    assert.equal(robots.status, 200);
    assert.match(robots.body, /Disallow: \/api\//);
  });

  test("every answer carries the security headers", async () => {
    for (const route of ["/healthz", "/api/meta", "/api/nothing"]) {
      const { headers } = await call(route);
      assert.equal(headers.get("x-content-type-options"), "nosniff", route);
      assert.equal(headers.get("referrer-policy"), "same-origin", route);
      assert.equal(headers.get("x-frame-options"), "SAMEORIGIN", route);
    }
  });
});

describe("errors", () => {
  test("an unknown address under /api is a JSON 404", async () => {
    const answer = await call("/api/nothing");
    assertError(answer, 404);
    assert.deepEqual(answer.body, { error: "Not found" });
  });

  test("an invalid project id is a 400, an unknown one a 404", async () => {
    assertError(await call("/api/projects/Bad%20Id"), 400, /project id/);
    assertError(await call("/api/projects/no-such-project"), 404, /No project "no-such-project"/);
    assertError(await call("/api/projects/no-such-project", send("PUT", { name: "x" })), 404);
    assertError(await call("/api/projects/no-such-project", { method: "DELETE" }), 404);
  });

  test("a body the schema refuses is a 400 that says why", async () => {
    assertError(await call("/api/projects", send("POST", {})), 400, /name/);
    assertError(await call("/api/projects", send("POST", { name: "x", locales: ["not a locale"] })), 400);
    assertError(await call("/api/projects", send("POST", { name: "x", slides: [{ layout: "no-such-layout" }] })), 400, /layout/);
  });

  test("/mcp takes POST only", async () => {
    const answer = await call("/mcp");
    assert.equal(answer.status, 405);
    assert.equal(answer.headers.get("allow"), "POST");
    assert.equal(answer.body.jsonrpc, "2.0");
    assert.equal(answer.body.error.code, -32000);
  });

  test("an unknown render is a 404", async () => {
    assertError(await call("/api/renders/abc"), 404, /No such render/);
    assertError(await call("/api/renders/abc", { method: "DELETE" }), 404, /No such render/);
  });

  test("tokens need a sign-in and people need the admin", async () => {
    assertError(await call("/api/account/tokens"), 400, /sign-in is off/);
    assertError(await call("/api/admin/people"), 403);
  });
});

describe("projects", () => {
  test("/api/meta lists every option, with no account while sign-in is off", async () => {
    const answer = await call("/api/meta");
    assert.equal(answer.status, 200);
    assertKeys(answer.body, META_KEYS);
    assert.equal(answer.body.authEnabled, false);
    assert.equal(answer.body.account, null);
    assert.equal(answer.body.rendersLeft, null);
    assert.ok(Array.isArray(answer.body.devices) && answer.body.devices.length > 0);
    assertKeys(answer.body.targets, ["iphone-6.9", "ipad-13", "mac-2880"]);
    // Every device kind with its models, each with the sizes it is drawn at and the export sizes made for it.
    assert.deepEqual(
      answer.body.deviceCatalog.map((kind: { id: string }) => kind.id),
      answer.body.devices.map((kind: { id: string }) => kind.id),
    );
    const targets = answer.body.deviceCatalog.flatMap((kind: { models: Array<{ targets: string[] }> }) => kind.models.flatMap((model) => model.targets));
    assert.ok(targets.includes("iphone-6.9") && targets.includes("mac-2880"));
    for (const kind of answer.body.deviceCatalog) for (const model of kind.models) assertKeys(model, ["id", "label", "sizes", "targets"]);
  });

  test("create, list, read, change and delete a project", async () => {
    const created = await call("/api/projects", send("POST", { name: "Contract App", locales: ["en-US", "de-DE"] }));
    assert.equal(created.status, 201);
    assertKeys(created.body, PROJECT_KEYS);
    assert.equal(created.body.id, "contract-app");
    assert.deepEqual(created.body.locales, ["en-US", "de-DE"]);
    assert.deepEqual(created.body.slides, []);

    // The same name again gets a number behind the id.
    assert.equal(await createProject({ name: "Contract App" }), "contract-app-2");

    const list = await call("/api/projects");
    assert.equal(list.status, 200);
    const item = list.body.find((each: { id: string }) => each.id === "contract-app");
    assertKeys(item, LIST_KEYS);
    assert.equal(item.slides, 0);
    assert.deepEqual(item.ownSets, []);

    const detail = await call("/api/projects/contract-app");
    assert.equal(detail.status, 200);
    assertKeys(detail.body, DETAIL_KEYS);
    assert.deepEqual(detail.body.shots, []);
    // Without screenshots the project exports the standard iPhone sizes.
    assert.deepEqual(detail.body.defaultTargets, ["iphone-6.9", "iphone-6.3", "iphone-6.5", "iphone-6.1"]);

    const changed = await call("/api/projects/contract-app", send("PUT", { name: "Contract App Two", slides: THREE_SLIDES, targets: ["iphone-6.9", "iphone-5.5"] }));
    assert.equal(changed.status, 200);
    assertKeys(changed.body, DETAIL_KEYS);
    assert.equal(changed.body.project.name, "Contract App Two");
    assert.equal(changed.body.project.slides.length, 3);
    assert.deepEqual(changed.body.defaultTargets, ["iphone-6.9", "iphone-5.5"]);
    assert.equal((await call("/api/projects")).body.find((each: { id: string }) => each.id === "contract-app").slides, 3);

    // [] goes back to the standard sizes.
    const standard = await call("/api/projects/contract-app", send("PUT", { targets: [] }));
    assert.equal(standard.body.project.targets, undefined);
    assertError(await call("/api/projects/contract-app", send("PUT", { locales: [] })), 400);

    const removed = await call("/api/projects/contract-app-2", { method: "DELETE" });
    assert.equal(removed.status, 204);
    assertError(await call("/api/projects/contract-app-2"), 404);
  });

  test("one slide is changed with PATCH, counting from 0", async () => {
    const id = await createProject({ name: "Patched", slides: THREE_SLIDES });
    const answer = await call(`/api/projects/${id}/slides/1`, send("PATCH", { changes: { headline: "Second, changed", headlne: "x" } }));
    assert.equal(answer.status, 200);
    assertKeys(answer.body, DETAIL_KEYS);
    assert.equal(answer.body.project.slides[1].headline, "Second, changed");
    assert.equal(answer.body.slide.headline, "Second, changed");
    assert.equal(answer.body.revision, 2);
    assert.deepEqual(answer.body.warnings, ["Ignored, because a slide has no such field: headlne."]);

    const named = await call(`/api/projects/${id}/slides/0`, send("PATCH", { changes: { screenshot: "setings" }, remove: ["subheading"] }));
    assert.deepEqual(named.body.warnings, [
      "Not uploaded yet, so these will render as placeholders: setings.",
      "Not cleared, because a slide has no such field: subheading.",
    ]);
    assertError(await call(`/api/projects/${id}/slides/3`, send("PATCH", { changes: { headline: "x" } })), 400, /^Slide 4 does not exist; the project has 3\.$/);
    assertError(await call(`/api/projects/${id}/slides/0`, send("PATCH", { of: "ipad", changes: { headline: "x" } })), 400, /no slide set of its own/);
    assertError(await call(`/api/projects/${id}/slides/one`, send("PATCH", { changes: {} })), 400);
    assertError(await call(`/api/projects/nope/slides/0`, send("PATCH", { changes: {} })), 404);
  });

  test("a project can be created whole", async () => {
    const id = await createProject({
      name: "Whole",
      locales: ["en"],
      targets: ["iphone-6.9"],
      theme: { font: "inter" },
      slides: THREE_SLIDES,
      deviceSlides: { ipad: [{ layout: "statement", headline: "iPad" }] },
      creatives: { readme: { headline: "A banner" } },
    });
    const { body } = await call(`/api/projects/${id}`);
    assert.equal(body.project.slides.length, 3);
    assert.equal(body.project.deviceSlides.ipad.length, 1);
    assertKeys(body.project.creatives, ["readme"]);
    const item = (await call("/api/projects")).body.find((each: { id: string }) => each.id === id);
    assert.deepEqual(item.ownSets, ["ipad"]);
  });

  test("/api/usage counts what the account keeps", async () => {
    const answer = await call("/api/usage");
    assert.equal(answer.status, 200);
    assertKeys(answer.body, ["projects", "slides", "shots", "images", "bytes", "uploadBytes"]);
    for (const value of Object.values(answer.body)) assert.equal(typeof value, "number");
  });

  test("everything under /api is private to the account", async () => {
    await createProject({ name: "Private" });
    for (const route of ["/api/meta", "/api/projects", "/api/projects/private", "/api/usage", "/api/renders", "/api/nothing", "/api/projects/private/export.zip"]) {
      assert.match((await server.fetch(route)).headers.get("cache-control") ?? "", /private|no-store/, route);
    }
  });
});

describe("screenshots and images", () => {
  let id: string;
  let iphone: Buffer;
  before(async () => {
    id = await createProject({ name: "Shots", locales: ["en-US", "de-DE"] });
    iphone = await png(1320, 2868);
  });

  test("a screenshot is filed under the device its size says", async () => {
    const answer = await call(`/api/projects/${id}/shots/home`, upload(iphone));
    assert.equal(answer.status, 201, JSON.stringify(answer.body));
    assertKeys(answer.body, SHOT_KEYS);
    assert.equal(answer.body.device, "iphone");
    assert.equal(answer.body.file, "home.iphone.png");
    assert.equal(answer.body.width, 1320);
    assert.equal(answer.body.height, 2868);
    assert.equal(answer.body.locale, undefined);

    const ipad = await call(`/api/projects/${id}/shots/settings`, upload(await png(2064, 2752)));
    assert.equal(ipad.body.device, "ipad");
    const mac = await call(`/api/projects/${id}/shots/window`, upload(await png(2880, 1800)));
    assert.equal(mac.body.device, "mac");
  });

  test("?device and ?locale say it instead", async () => {
    const told = await call(`/api/projects/${id}/shots/told?device=ipad`, upload(iphone));
    assert.equal(told.body.device, "ipad");
    assert.equal(told.body.file, "told.ipad.png");

    const german = await call(`/api/projects/${id}/shots/home?locale=de-DE`, upload(iphone));
    assert.equal(german.status, 201);
    assert.equal(german.body.locale, "de-DE");
    assert.equal(german.body.file, "home.iphone.de-DE.png");
    // "de" finds "de-DE".
    const short = await call(`/api/projects/${id}/shots/short?locale=de`, upload(iphone));
    assert.equal(short.body.locale, "de-DE");

    assertError(await call(`/api/projects/${id}/shots/home?locale=fr`, upload(iphone)), 400, /no language "fr"/);
  });

  test("the project lists its screenshots with their language", async () => {
    const { body } = await call(`/api/projects/${id}`);
    for (const shot of body.shots) assertKeys(shot, SHOT_KEYS);
    const files = body.shots.map((shot: { file: string }) => shot.file);
    assert.ok(files.includes("home.iphone.png") && files.includes("home.iphone.de-DE.png"));
    assert.equal(body.shots.find((shot: { file: string }) => shot.file === "home.iphone.de-DE.png").locale, "de-DE");
    // Screenshots of iPhone, iPad and Mac: the standard sizes of all three.
    assert.ok(body.defaultTargets.includes("iphone-6.9") && body.defaultTargets.includes("ipad-13") && body.defaultTargets.includes("mac-2880"));
  });

  test("an upload that is not a screenshot is a 400", async () => {
    assertError(await call(`/api/projects/${id}/shots/empty`, { method: "PUT" }), 400, /Send the image file/);
    assertError(await call(`/api/projects/${id}/shots/text`, upload(Buffer.from("not an image"))), 400, /Not a readable image/);
    assertError(await call(`/api/projects/${id}/shots/tiny`, upload(await png(100, 100))), 400, /too small/);
    assertError(await call(`/api/projects/${id}/shots/Bad%20Name`, upload(iphone)), 400, /screenshot name/);
    assertError(await call(`/api/projects/no-such-project/shots/home`, upload(iphone)), 404);
  });

  test("a screenshot is refiled with PATCH and deleted with DELETE", async () => {
    const moved = await call(`/api/projects/${id}/shots/told.ipad.png`, send("PATCH", { device: "duo" }));
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assertKeys(moved.body, SHOT_KEYS);
    assert.equal(moved.body.file, "told.duo.png");

    const german = await call(`/api/projects/${id}/shots/told.duo.png`, send("PATCH", { locale: "de-DE" }));
    assert.equal(german.body.file, "told.duo.de-DE.png");
    const back = await call(`/api/projects/${id}/shots/told.duo.de-DE.png`, send("PATCH", { locale: null }));
    assert.equal(back.body.file, "told.duo.png");

    assertError(await call(`/api/projects/${id}/shots/told.duo.png`, send("PATCH", {})), 400);
    assertError(await call(`/api/projects/${id}/shots/gone.iphone.png`, send("PATCH", { device: "ipad" })), 404);

    assert.equal((await call(`/api/projects/${id}/shots/told.duo.png`, { method: "DELETE" })).status, 204);
    assertError(await call(`/api/projects/${id}/shots/not-a-file`, { method: "DELETE" }), 400);
  });

  test("a screenshot is served as a file of the project", async () => {
    const response = await server.fetch(`/files/${id}/shots/home.iphone.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("cache-control")!, /private/);
    assert.deepEqual(await sizeOf(await response.arrayBuffer()), { width: 1320, height: 2868 });
  });

  test("a logo goes up as SVG and is stored as PNG", async () => {
    const answer = await call(`/api/projects/${id}/images/logo`, upload(svgLogo));
    assert.equal(answer.status, 201, JSON.stringify(answer.body));
    assertKeys(answer.body, IMAGE_KEYS);
    assert.equal(answer.body.file, "logo.png");
    assert.ok(answer.body.width >= 64);

    const { body } = await call(`/api/projects/${id}`);
    assert.deepEqual(
      body.images.map((image: { name: string }) => image.name),
      ["logo"],
    );
    assertError(await call(`/api/projects/${id}/images/broken`, upload(Buffer.from("<svg"))), 400, /Not a readable image/);
    assert.equal((await call(`/api/projects/${id}/images/logo.png`, { method: "DELETE" })).status, 204);
    assert.deepEqual((await call(`/api/projects/${id}`)).body.images, []);
  });
});

describe("rendering, without drawing", () => {
  let id: string;
  before(async () => {
    id = await createProject({ name: "Render", locales: ["en-US", "de-DE"], slides: THREE_SLIDES });
    await call(`/api/projects/${id}/shots/home`, upload(await png(1320, 2868)));
  });

  test("a project with nothing in it has nothing to render", async () => {
    const empty = await createProject({ name: "Empty" });
    assertError(await call(`/api/projects/${empty}/render`, send("POST", {})), 400, /nothing to render yet/);
  });

  test("render bodies are checked first", async () => {
    assertError(await call(`/api/projects/${id}/render`, send("POST", { slides: [-1] })), 400);
    assertError(await call(`/api/projects/${id}/render`, send("POST", { targets: ["iphone-99"] })), 400);
    assertError(await call(`/api/projects/${id}/render`, send("POST", { creatives: ["poster"] })), 400);
    assertError(await call(`/api/projects/no-such-project/render`, send("POST", { background: true })), 404);
  });

  test("a language the project does not have is refused before anything is queued", async () => {
    for (const background of [false, true]) {
      assertError(await call(`/api/projects/${id}/render`, send("POST", { locales: ["fr"], background })), 400, /no language "fr"/);
    }
  });

  test("slides count from 0 here: index 3 of three slides is slide 4", async () => {
    assertError(await call(`/api/projects/${id}/render`, send("POST", { slides: [3] })), 400, /^Slide 4 does not exist; the project has 3\.$/);
  });

  test("an asset the project does not have is refused", async () => {
    assertError(await call(`/api/projects/${id}/render`, send("POST", { creatives: ["readme"] })), 400, /no .* asset yet/);
  });

  test("a background render answers 202 with the job and ends in /api/renders", async () => {
    const empty = await createProject({ name: "Background" });
    const answer = await call(`/api/projects/${empty}/render`, send("POST", { background: true }));
    assert.equal(answer.status, 202);
    assertKeys(answer.body, ["job", "rendersLeft"]);
    assert.equal(answer.body.rendersLeft, null);
    assertKeys(answer.body.job, JOB_KEYS);
    assert.equal(answer.body.job.project, empty);
    assert.equal(answer.body.job.state, "queued");

    const job = await ended(answer.body.job);
    assertKeys(job, [...JOB_KEYS, "finishedAt", "error"]);
    assert.equal(job.state, "failed");
    assert.match(job.error, /nothing to render yet/);

    const list = await call("/api/renders");
    assert.equal(list.status, 200);
    assertKeys(list.body, ["jobs", "rendersLeft"]);
    assert.ok(list.body.jobs.some((each: { id: string }) => each.id === job.id));
    // Cancelling one that has ended changes nothing.
    const cancelled = await call(`/api/renders/${job.id}`, { method: "DELETE" });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.state, "failed");
  });

  test("the ZIP needs a render first", async () => {
    assertError(await call(`/api/projects/${id}/export.zip`), 400, /Nothing has been rendered yet/);
  });

  test("slide pages count from 0 too", async () => {
    const first = await server.fetch(`/render/${id}/0`);
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type")!, /^text\/html/);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.match(await first.text(), /First/);
    assert.equal((await server.fetch(`/render/${id}/2?target=iphone-6.9&locale=de-DE`)).status, 200);
    assertError(await call(`/render/${id}/3`), 404, /Slide 3 does not exist/);
  });

  test("mockups are listed without drawing them", async () => {
    const answer = await call(`/api/projects/${id}/mockups`);
    assert.equal(answer.status, 200);
    assertKeys(answer.body, ["settings", "locale", "items"]);
    assert.equal(answer.body.locale, "en-US");
    assert.equal(answer.body.items.length, 1);
    const [item] = answer.body.items;
    assertKeys(item, ["file", "name", "device", "version", "saveAs", "stage", "page", "png"]);
    assert.equal(item.file, "home.iphone.png");
    assert.equal(item.png, `/api/projects/${id}/mockups/home.iphone.png`);
    assert.equal(item.page, `/render/${id}/mockup/home.iphone.png`);
    assertKeys(item.stage, ["width", "height"]);

    assert.equal((await call(`/api/projects/${id}/mockups?locale=de`)).body.locale, "de-DE");
    assertError(await call(`/api/projects/${id}/mockups?settings=nope`), 400, /JSON/);
    assertError(await call(`/api/projects/${id}/mockups/nope.iphone.png`), 404);
  });

  test("mockup settings are saved with the project", async () => {
    const mockups = { device: { style: "clay", color: "silver", shadow: "soft", rotate: -8 }, width: 1200 };
    const answer = await call(`/api/projects/${id}`, send("PUT", { mockups }));
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body.project.mockups, mockups);
    assert.deepEqual((await call(`/api/projects/${id}/mockups`)).body.settings, mockups);
  });

  test("mockups of a project without screenshots are refused", async () => {
    const empty = await createProject({ name: "No Shots" });
    assertError(await call(`/api/projects/${empty}/mockups.zip`), 400, /no screenshots yet/);
  });
});

describe("parallel writes", () => {
  test("50 PUTs at once to one project leave a project.json that parses", async () => {
    const id = await createProject({ name: "Parallel" });
    const answers = await Promise.all(
      Array.from({ length: 50 }, (_, i) => call(`/api/projects/${id}`, send("PUT", { name: `Parallel ${i}`, slides: [{ layout: "statement", headline: `Edit ${i}` }] }))),
    );
    assert.deepEqual(
      answers.map((answer) => answer.status),
      Array(50).fill(200),
    );
    const dir = path.join(server.dataDir, "projects", id);
    const saved = JSON.parse(await readFile(path.join(dir, "project.json"), "utf8"));
    assert.equal(saved.id, id);
    assert.match(saved.name, /^Parallel \d+$/);
    // The last write wins whole: its name and its slide belong together.
    assert.equal(saved.slides[0].headline, `Edit ${saved.name.split(" ")[1]}`);
    // No temporary file is left behind; the history of the versions is kept beside it.
    assert.deepEqual(
      (await readdir(dir)).filter((file) => file !== "project.json" && file !== ".history"),
      [],
    );
    const detail = await call(`/api/projects/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.revision, 51);
  });

  test("parallel PUTs of different fields keep every one of them", async () => {
    const id = await createProject({ name: "Fields" });
    await Promise.all([
      call(`/api/projects/${id}`, send("PUT", { name: "Renamed" })),
      call(`/api/projects/${id}`, send("PUT", { locales: ["en", "de"] })),
      call(`/api/projects/${id}`, send("PUT", { theme: { font: "inter" } })),
      call(`/api/projects/${id}`, send("PUT", { slides: [{ layout: "statement", headline: "Kept" }] })),
    ]);
    const { project } = (await call(`/api/projects/${id}`)).body;
    assert.equal(project.name, "Renamed");
    assert.deepEqual(project.locales, ["en", "de"]);
    assert.equal(project.theme.font, "inter");
    assert.equal(project.slides[0].headline, "Kept");
  });
});

describe("revisions", () => {
  const ifMatch = (revision: string, body: unknown): RequestInit => ({ method: "PUT", headers: { "Content-Type": "application/json", "If-Match": revision }, body: JSON.stringify(body) });

  test("a project carries its revision, as the ETag too, and is not kept by caches", async () => {
    const id = await createProject({ name: "Tagged" });
    const detail = await call(`/api/projects/${id}`);
    assert.equal(detail.body.revision, 1);
    assert.equal(detail.headers.get("etag"), '"1"');
    assert.match(detail.headers.get("cache-control") ?? "", /no-store/);
    const changed = await call(`/api/projects/${id}`, send("PUT", { name: "Tagged Again" }));
    assert.equal(changed.body.revision, 2);
    assert.equal(changed.headers.get("etag"), '"2"');
  });

  test("If-Match with the current revision saves; with an older one it is a 409 with the project as it is", async () => {
    const id = await createProject({ name: "Matched" });
    const saved = await call(`/api/projects/${id}`, ifMatch('"1"', { name: "First Edit" }));
    assert.equal(saved.status, 200);
    assert.equal(saved.body.revision, 2);
    // W/"2" and a bare 2 are read the same.
    assert.equal((await call(`/api/projects/${id}`, ifMatch('W/"2"', { name: "Second Edit" }))).body.revision, 3);
    assert.equal((await call(`/api/projects/${id}`, ifMatch("3", { name: "Third Edit" }))).body.revision, 4);

    const stale = await call(`/api/projects/${id}`, ifMatch('"2"', { name: "Lost" }));
    assertError(stale, 409, /revision 2/);
    assert.equal(stale.body.revision, 4);
    assertKeys(stale.body.project, DETAIL_KEYS);
    assert.equal(stale.body.project.project.name, "Third Edit");
    assert.equal((await call(`/api/projects/${id}`)).body.project.name, "Third Edit");

    assertError(await call(`/api/projects/${id}`, ifMatch("latest", { name: "Garbage" })), 400, /If-Match/);
    // Without If-Match, or with *, a PUT saves on whatever is current, as before.
    assert.equal((await call(`/api/projects/${id}`, ifMatch("*", { name: "Any" }))).body.revision, 5);
  });

  test("a slide changed on an older revision is a 409 with the project as it is", async () => {
    const id = await createProject({ name: "Slide Matched", slides: THREE_SLIDES });
    await call(`/api/projects/${id}`, send("PUT", { name: "Moved On" }));
    const stale = await call(`/api/projects/${id}/slides/0`, { ...ifMatch('"1"', { changes: { headline: "Lost" } }), method: "PATCH" });
    assertError(stale, 409, /revision 1/);
    assert.equal(stale.body.revision, 2);
    assert.equal(stale.headers.get("etag"), '"2"');
    assert.equal(stale.body.project.project.slides[0].headline, "First *slide*");
    const saved = await call(`/api/projects/${id}/slides/0`, { ...ifMatch('"2"', { changes: { headline: "Kept" } }), method: "PATCH" });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.revision, 3);
  });

  test("the Studio is named in the history when it says it is the Studio", async () => {
    const id = await createProject({ name: "Who Saved" });
    await call(`/api/projects/${id}`, { ...send("PUT", { name: "By The Studio" }), headers: { "Content-Type": "application/json", "X-Appshots-Client": "studio" } });
    await call(`/api/projects/${id}`, send("PUT", { name: "By A Script" }));
    const actors = (await call(`/api/projects/${id}/revisions`)).body.revisions.map((row: { actor: string }) => row.actor);
    assert.deepEqual(actors, ["api", "studio", "api"]);
  });

  test("a PUT says which fields it left out", async () => {
    const id = await createProject({ name: "Typos" });
    const answer = await call(`/api/projects/${id}`, send("PUT", { nmae: "Typo", id, revision: 1, slides: [{ layout: "statement", headline: "Hi", headlne: "x" }] }));
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body.warnings, ["Ignored, because a project has no such field: nmae, slides[0].headlne."]);
    assert.equal(answer.body.project.slides[0].headline, "Hi");
    assert.equal((await call(`/api/projects/${id}`, send("PUT", { name: "Clean" }))).body.warnings, undefined);
  });

  test("a language given twice is taken once, in its first spelling", async () => {
    const created = await call("/api/projects", send("POST", { name: "Twice", locales: ["en", "de", "EN"] }));
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.locales, ["en", "de"]);
    const answer = await call(`/api/projects/${created.body.id}`, send("PUT", { locales: ["de-DE", "en", "de-de", "DE-DE"] }));
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body.project.locales, ["de-DE", "en"]);
    assert.deepEqual(answer.body.warnings, ["Each language is kept once, in the first of its spellings: left out de-de, DE-DE from locales."]);
  });

  test("the revisions are listed and an earlier one restored as a new one", async () => {
    const id = await createProject({ name: "Undo" });
    await call(`/api/projects/${id}`, send("PUT", { slides: [{ layout: "statement", headline: "Good" }] }));
    await call(`/api/projects/${id}`, send("PUT", { slides: [{ layout: "statement", headline: "Worse" }] }));
    const listed = await call(`/api/projects/${id}/revisions`);
    assert.equal(listed.status, 200);
    assert.match(listed.headers.get("cache-control") ?? "", /private|no-store/);
    assert.equal(listed.body.revision, 3);
    assert.deepEqual(
      listed.body.revisions.map((row: { revision: number }) => row.revision),
      [3, 2, 1],
    );
    for (const row of listed.body.revisions) {
      assertKeys(row, ["revision", "time", "actor", "size"]);
      assert.equal(row.actor, "api");
    }

    const restored = await call(`/api/projects/${id}/restore`, send("POST", { revision: 2 }));
    assert.equal(restored.status, 200);
    assertKeys(restored.body, DETAIL_KEYS);
    assert.equal(restored.body.revision, 4);
    assert.equal(restored.body.project.slides[0].headline, "Good");
    assert.equal((await call(`/api/projects/${id}/revisions`)).body.revisions[0].revision, 4);

    assertError(await call(`/api/projects/${id}/restore`, send("POST", { revision: 99 })), 404, /keeps no revision 99/);
    assertError(await call(`/api/projects/${id}/restore`, send("POST", {})), 400);
    assertError(await call("/api/projects/nope/revisions"), 404);
  });

  test("a damaged project is listed, restored from its history or deleted", async () => {
    const id = await createProject({ name: "Broken" });
    await call(`/api/projects/${id}`, send("PUT", { name: "Broken Kept" }));
    await writeFile(path.join(server.dataDir, "projects", id, "project.json"), '{"id": "broken",');
    const item = (await call("/api/projects")).body.find((each: { id: string }) => each.id === id);
    assertKeys(item, LIST_KEYS);
    assert.equal(item.damaged, "project.json is not valid JSON");
    const opened = await call(`/api/projects/${id}`);
    assertError(opened, 400, /damaged/);
    assert.doesNotMatch(opened.body.error, /JSON|position/);
    assert.equal((await call(`/api/projects/${id}/revisions`)).body.revision, null);

    const restored = await call(`/api/projects/${id}/restore`, send("POST", { revision: 2 }));
    assert.equal(restored.status, 200);
    assert.equal(restored.body.project.name, "Broken Kept");
    assert.equal(restored.body.revision, 3);

    await writeFile(path.join(server.dataDir, "projects", id, "project.json"), "");
    assert.equal((await call(`/api/projects/${id}`, { method: "DELETE" })).status, 204);
    assert.ok(!(await call("/api/projects")).body.some((each: { id: string }) => each.id === id));
  });
});

describe("open bugs", () => {
  test("a lookup by a name every object has is a 404, not a 500 (srv-16)", async () => {
    assert.equal((await call("/fonts/constructor/a.woff2")).status, 404);
    assert.equal((await call("/fonts/toString/a.woff2")).status, 404);
    const id = await createProject({ name: "Lookup" });
    assert.equal((await call(`/render/${id}/creative/constructor`)).status, 404);
    // An export size by such a name is no size, and the slide is drawn at the project's own.
    assert.equal((await call(`/api/projects/${id}`, send("PUT", { slides: THREE_SLIDES }))).status, 200);
    const named = await server.fetch(`/render/${id}/0?target=constructor`);
    assert.equal(named.status, 200);
    assert.equal(await named.text(), await (await server.fetch(`/render/${id}/0`)).text());
  });

  test("a missing file is a 404 that names no server path and is not kept (srv-15)", async () => {
    const id = await createProject({ name: "Missing File" });
    const answer = await call(`/files/${id}/shots/missing.png`);
    assert.equal(answer.status, 404);
    assert.doesNotMatch(JSON.stringify(answer.body), /ENOENT|\/projects\//);
    assert.doesNotMatch(answer.headers.get("cache-control") ?? "", /immutable|max-age=[1-9]/);
  });

  test("a request that names a folder rather than a file is a 404", async () => {
    const id = await createProject({ name: "Folder" });
    // fetch() reads %2E as "." and drops it from the path, so these go out by hand, as curl sends them.
    const { port } = new URL(server.url);
    for (const route of [`/files/${id}/out/%2E`, `/files/${id}/out/%2E/`, `/files/${id}/shots/%2E`, `/files/${id}/images/%2E`]) {
      const answer = await new Promise<{ status: number; cacheControl: unknown; body: string }>((resolve, reject) => {
        http
          .get({ host: "127.0.0.1", port, path: route }, (response) => {
            let body = "";
            response.setEncoding("utf8").on("data", (chunk: string) => (body += chunk));
            response.on("end", () => resolve({ status: response.statusCode!, cacheControl: response.headers["cache-control"], body }));
          })
          .on("error", reject);
      });
      assert.equal(answer.status, 404, `${route}: ${answer.body}`);
      assert.deepEqual(JSON.parse(answer.body), { error: "Not found" }, route);
      assert.equal(answer.cacheControl, "no-store", route);
    }
  });

  test("an upload sent as JSON is stored as the image it is (srv-17)", async () => {
    const id = await createProject({ name: "Typed Upload" });
    const answer = await call(`/api/projects/${id}/shots/home`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: new Uint8Array(await png(1320, 2868)) });
    assert.equal(answer.status, 201, JSON.stringify(answer.body));
  });

  test("a file over the limit is told the limit of its kind (docs-6)", async () => {
    const id = await createProject({ name: "Too Large" });
    const answer = await call(`/api/projects/${id}/images/big`, upload(Buffer.alloc(21 * 1024 * 1024)));
    assertError(answer, 413, /20 MB/);
  });

  test("a request for another host name is refused (srv-4)", async () => {
    // fetch() sets Host itself, so this goes out by hand, as a page that rebinds its name to this server would send it.
    const { port } = new URL(server.url);
    const status = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ name: "Rebound" });
      const request = http.request({ host: "127.0.0.1", port, path: "/api/projects", method: "POST", headers: { Host: `rebound.example.com:${port}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (response) => {
        response.resume();
        resolve(response.statusCode!);
      });
      request.on("error", reject).end(body);
    });
    assert.ok(status >= 400 && status < 500, `answered ${status}`);
  });
});

describe("rendering, drawn with Chromium", renderTier, () => {
  let id: string;
  before(async () => {
    id = await createProject({ name: "Drawn", slides: THREE_SLIDES.slice(0, 2) });
    await call(`/api/projects/${id}/shots/home`, upload(await png(1320, 2868)));
  });

  test("a render answers with the files and the account's renders", async () => {
    const answer = await call(`/api/projects/${id}/render`, send("POST", { targets: ["iphone-6.9", "iphone-6.5"] }));
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assertKeys(answer.body, ["files", "sheets", "creatives", "warnings", "outputs", "creativeOutputs", "rendersLeft"]);
    const set = answer.body.outputs.find((each: { target: string }) => each.target === "iphone-6.9");
    assertKeys(set, ["locale", "target", "files", "version"]);
    assert.deepEqual(set.files, ["01.png", "02.png"]);

    const file = await server.fetch(`/files/${id}/out/en/iphone-6.9/01.png`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("cache-control")!, /private/);
    assert.deepEqual(await sizeOf(await file.arrayBuffer()), { width: 1320, height: 2868 });
    const scaled = await server.fetch(`/files/${id}/out/en/iphone-6.5/02.png`);
    assert.deepEqual(await sizeOf(await scaled.arrayBuffer()), { width: 1284, height: 2778 });
  });

  test("slides count from 0: [1] draws the second slide only", async () => {
    const answer = await call(`/api/projects/${id}/render`, send("POST", { slides: [1], targets: ["iphone-6.9"] }));
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.deepEqual(
      answer.body.files.map((file: { slide: number }) => file.slide),
      [1],
    );
  });

  test("the ZIP holds the notes and every rendered file", async () => {
    const response = await server.fetch(`/api/projects/${id}/export.zip`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.match(response.headers.get("cache-control")!, /private/);
    const zip = Buffer.from(await response.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const text = zip.toString("latin1");
    for (const name of ["README.txt", "en/iphone-6.9/01.png", "en/iphone-6.9/02.png", "en/iphone-6.5/01.png"]) assert.ok(text.includes(name), name);
  });

  test("a mockup is a transparent PNG at the width asked for", async () => {
    const response = await server.fetch(`/api/projects/${id}/mockups/home.iphone.png?width=600`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("cache-control")!, /private/);
    assert.equal((await sizeOf(await response.arrayBuffer())).width, 600);
    const zip = await server.fetch(`/api/projects/${id}/mockups.zip`);
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get("content-type"), "application/zip");
  });

  test("a cancelled render leaves the previous files as they were", async () => {
    const statement = (headline: string) => ({ layout: "statement", headline });
    const names = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));
    const other = await createProject({ name: "Kept", targets: ["iphone-6.9"], slides: names.map((n) => statement(`Before ${n}`)) });
    assert.equal((await call(`/api/projects/${other}/render`, send("POST", {}))).status, 200);
    // Compared by hash: a failing deepEqual of ten PNGs would spend minutes on the diff.
    const files = () => Promise.all(names.map(async (n) => createHash("sha256").update(new Uint8Array(await (await server.fetch(`/files/${other}/out/en/iphone-6.9/${n}.png`)).arrayBuffer())).digest("hex")));
    const before = await files();

    await call(`/api/projects/${other}`, send("PUT", { slides: names.map((n) => statement(`After ${n}`)) }));
    let job = (await call(`/api/projects/${other}/render`, send("POST", { background: true }))).body.job;
    for (let tries = 0; tries < 1000 && job.state === "queued"; tries++) {
      await sleep(10);
      job = (await call(`/api/renders/${job.id}`)).body;
    }
    await call(`/api/renders/${job.id}`, { method: "DELETE" });
    assert.equal((await ended(job)).state, "cancelled");
    assert.deepEqual(await files(), before);
  });

  test("a screenshot that is gone fails the render with its name", async () => {
    const other = await createProject({ name: "Gone", slides: [{ layout: "device-bottom", headline: "Gone", screenshot: "home" }] });
    await call(`/api/projects/${other}/shots/home`, upload(await png(1320, 2868)));
    const started = await call(`/api/projects/${other}/render`, send("POST", { background: true, targets: ["iphone-6.9"] }));
    await call(`/api/projects/${other}/shots/home.iphone.png`, { method: "DELETE" });
    const job = await ended(started.body.job);
    assert.equal(job.state, "failed");
    assert.match(job.error, /home/);
  });

  test("rendering fewer slides leaves none of the old ones behind", async () => {
    const slides = ["One", "Two", "Three"].map((headline) => ({ layout: "statement", headline }));
    const other = await createProject({ name: "Fewer", targets: ["iphone-6.9"], slides });
    await call(`/api/projects/${other}/render`, send("POST", {}));
    await call(`/api/projects/${other}`, send("PUT", { slides: slides.slice(0, 2) }));
    // Slide 1 of the two that are left: a partial render, which keeps the folder.
    await call(`/api/projects/${other}/render`, send("POST", { slides: [0] }));
    const { body } = await call(`/api/projects/${other}`);
    assert.deepEqual(body.outputs[0].files, ["01.png", "02.png"]);
  });
});
