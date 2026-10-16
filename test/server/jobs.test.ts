import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { callTool, textOf } from "../helpers/mcp.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";
import { type TmpData, tmpData } from "../helpers/tmp-data.ts";

// Renders over HTTP from start to end, drawn by a stand-in for the browser that takes as long per page as a test
// needs: waiting, cancelling, a client that goes away, deleting and moving what is being drawn, exporting, and the
// server stopping in the middle of it. Everything but the pictures is the real thing.

const FAKE = ["test/helpers/fake-renderer-preload.ts"];
/** Quick to encode: the made-up pictures are scaled to the full size of the slot, and compressing them hard costs time. */
const QUICK = { RENDER_PNG_LEVEL: "1" };

const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const statement = (n: number) => Array.from({ length: n }, (_, i) => ({ layout: "statement", headline: { en: `Slide ${i + 1}` } }));
const exists = (file: string) => stat(file).then(
  () => true,
  () => false,
);

/** Asks until `check` is true, for up to `ms`. */
async function until(check: () => Promise<boolean>, ms = 10_000, what = "the condition"): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Waited ${ms} ms for ${what}`);
    await sleep(50);
  }
}

/** The settings that turn sign-in on. No request in these tests goes to Google. */
const SIGN_IN = { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", ADMIN_EMAIL: "admin@example.com" };
const SECRET = "fedcba9876543210".repeat(4);
const DAY = 24 * 3600 * 1000;

function sessionCookie(user: string): string {
  const payload = Buffer.from(JSON.stringify({ u: user, k: 1, _p: "session", _e: Date.now() + DAY })).toString("base64url");
  return `appshots_session=${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

/** Accounts as accounts.json keeps them, each with an API token, and the secret sessions are sealed with. */
async function writeAccounts(dir: string, people: { id: string; email: string; token: string; renders?: number }[]): Promise<void> {
  const users = people.map(({ id, email, token, renders }) => ({
    id,
    email,
    name: email.split("@")[0],
    createdAt: "2026-01-01T00:00:00.000Z",
    epoch: 1,
    ...(renders === undefined ? {} : { renders }),
    tokens: [{ id: `t-${id}`, name: "Test", hash: createHash("sha256").update(token).digest("hex"), hint: token.slice(-4), createdAt: "2026-01-01T00:00:00.000Z" }],
  }));
  await writeFile(path.join(dir, "accounts.json"), JSON.stringify({ signup: "open", signupChosen: true, allowed: [], users, spent: {} }));
  await writeFile(path.join(dir, "secret.key"), SECRET);
}

const newToken = () => `appshots_${randomBytes(24).toString("base64url")}`;

interface Job {
  id: string;
  project: string;
  state: string;
  done: number;
  total: number;
}

describe("renders, without sign-in", () => {
  let server: TestServer;
  const call = async (route: string, init?: RequestInit) => {
    const response = await server.fetch(route, init);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  };
  const create = async (name: string, slides = 3): Promise<string> => (await call("/api/projects", json("POST", { name, locales: ["en"], targets: ["iphone-6.9"], slides: statement(slides) }))).body.id;
  const jobs = async (): Promise<Job[]> => (await call("/api/renders")).body.jobs;
  const jobOf = async (project: string) => (await jobs()).find((job) => job.project === project);
  const projectsDir = () => path.join(server.dataDir, "projects");

  before(async () => {
    server = await startServer({ imports: FAKE, env: { ...QUICK, FAKE_RENDER_DELAY_MS: "250" } });
  });
  after(async () => {
    await server?.stop();
  });

  test("a render the client stops waiting for is cancelled, and keeps nothing", async () => {
    const id = await create("Walk away");
    const controller = new AbortController();
    const asked = server.fetch(`/api/projects/${id}/render`, { ...json("POST", {}), signal: controller.signal }).catch(() => null);
    await until(async () => (await jobOf(id))?.state === "running", 5000, "the render to start");
    controller.abort();
    await asked;
    await until(async () => (await jobOf(id))?.state === "cancelled", 5000, "the render to be cancelled");
    assert.ok((await jobOf(id))!.done < 3, "stopped before its last picture");
    assert.equal(await exists(path.join(projectsDir(), id, "out")), false, "nothing put in place");
  });

  test("a render still waiting its turn ends the moment it is cancelled", async () => {
    const id = await create("Queue");
    const first = (await call(`/api/projects/${id}/render`, json("POST", { background: true }))).body.job as Job;
    const second = (await call(`/api/projects/${id}/render`, json("POST", { background: true }))).body.job as Job;
    assert.equal((await call(`/api/renders/${second.id}`)).body.state, "queued");
    const started = Date.now();
    assert.equal((await call(`/api/renders/${second.id}`, { method: "DELETE" })).status, 200);
    await until(async () => (await call(`/api/renders/${second.id}`)).body.state === "cancelled", 2000, "the waiting render to end");
    assert.ok(Date.now() - started < 600, "it did not wait for the render ahead of it");
    assert.equal((await call(`/api/renders/${first.id}`)).body.state, "running");
    await until(async () => (await call(`/api/renders/${first.id}`)).body.state === "done", 10_000, "the first render to finish");
  });

  test("deleting a project while it renders stops the render and leaves no folder behind", async () => {
    const id = await create("Doomed");
    const { job } = (await call(`/api/projects/${id}/render`, json("POST", { background: true }))).body as { job: Job };
    await until(async () => (await call(`/api/renders/${job.id}`)).body.done >= 1, 5000, "the first picture");
    assert.equal((await call(`/api/projects/${id}`, { method: "DELETE" })).status, 204);
    // Answered once the render has stopped.
    assert.equal((await call(`/api/renders/${job.id}`)).body.state, "cancelled");
    await sleep(800);
    assert.equal(await exists(path.join(projectsDir(), id)), false, "no folder came back");
    assert.deepEqual((await readdir(path.join(projectsDir(), ".staging")).catch(() => [])).filter((name) => name === job.id), []);
    assert.equal((await call("/api/projects")).body.some((project: { id: string }) => project.id === id), false);
    assert.equal(await create("Doomed"), id, "the name is free again");
  });

  test("an export renders and sends a whole ZIP with its length", async () => {
    const id = await create("Export", 2);
    const response = await server.fetch(`/api/projects/${id}/exports`, json("POST", {}));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.match(response.headers.get("cache-control") ?? "", /private|no-store/);
    const zip = Buffer.from(await response.arrayBuffer());
    assert.equal(Number(response.headers.get("content-length")), zip.length);
    const file = path.join(server.dataDir, "export.zip");
    await writeFile(file, zip);
    const { stdout } = await promisify(execFile)("unzip", ["-l", file]);
    for (const name of ["README.txt", "en/iphone-6.9/01.png", "en/iphone-6.9/02.png"]) assert.match(stdout, new RegExp(name.replaceAll(".", "\\.")));
    await promisify(execFile)("unzip", ["-tq", file]);
    // What a render left behind for the export is gone again.
    assert.deepEqual((await readdir(path.join(projectsDir(), ".staging")).catch(() => [])).filter((name) => name.startsWith("export-")), []);
  });

  test("an export in the background answers with the run and where the ZIP will be", async () => {
    const id = await create("Later", 1);
    const answer = await call(`/api/projects/${id}/exports`, json("POST", { background: true }));
    assert.equal(answer.status, 202);
    assert.equal(answer.body.download, `/api/projects/${id}/export.zip`);
    assert.equal(answer.body.job.project, id);
    await until(async () => (await call(`/api/renders/${answer.body.job.id}`)).body.state === "done", 10_000, "the render");
    const zip = await server.fetch(answer.body.download);
    assert.equal(zip.status, 200);
    assert.equal(Number(zip.headers.get("content-length")), (await zip.arrayBuffer()).byteLength);
  });

  test("the CLI's export.zip?render=1 still works, and nothing rendered yet is a clear error", async () => {
    const id = await create("Command line", 1);
    const before = await call(`/api/projects/${id}/export.zip`);
    assert.equal(before.status, 400);
    assert.match(before.body.error, /Nothing has been rendered yet/);
    const response = await server.fetch(`/api/projects/${id}/export.zip?render=1`);
    assert.equal(response.status, 200);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  });

  test("an agent starts a render in the background, follows it and gets the pictures once it is done", async () => {
    const id = await create("Agent", 2);
    const started = await callTool(server, "render", { project: id, background: true });
    assert.notEqual(started.isError, true, textOf(started));
    const job = /render ([0-9a-f]{16})/.exec(textOf(started))?.[1];
    assert.ok(job, textOf(started));
    assert.match(textOf(await callTool(server, "get_render", { job })), /waits for its turn|is drawing: \d of 2 pictures/);
    await until(async () => (await call(`/api/renders/${job}`)).body.state === "done", 10_000, "the render");
    const done = await callTool(server, "get_render", { job });
    assert.match(textOf(done), /^Rendered 2 PNGs\./);
    assert.match(textOf(done), new RegExp(`/files/${id}/out/en/iphone-6\\.9/01\\.png`));
    const listed = JSON.parse(textOf(await callTool(server, "get_render", {})));
    assert.ok(listed.some((each: Job) => each.id === job && each.state === "done"));
    assert.match(textOf(await callTool(server, "cancel_render", { job })), /has ended already: done/);
    const unknown = await callTool(server, "get_render", { job: "0000000000000000" });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /No such render/);
  });

  test("an agent cancels a render it started, and one that stops waiting for its render cancels it", async () => {
    const id = await create("Agent cancels", 4);
    const job = /render ([0-9a-f]{16})/.exec(textOf(await callTool(server, "render", { project: id, background: true })))![1]!;
    assert.match(textOf(await callTool(server, "cancel_render", { job })), /^Cancelled the render/);
    await until(async () => (await call(`/api/renders/${job}`)).body.state === "cancelled", 5000, "the cancel");
    assert.match(textOf(await callTool(server, "get_render", { job })), /was cancelled/);

    const controller = new AbortController();
    const asked = server
      .fetch("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "render", arguments: { project: id } } }),
        signal: controller.signal,
      })
      .catch(() => null);
    await until(async () => (await jobs()).some((each) => each.project === id && each.state === "running"), 5000, "the render to start");
    controller.abort();
    await asked;
    await until(async () => (await jobs()).filter((each) => each.project === id).every((each) => each.state === "cancelled"), 5000, "the render to be cancelled");
  });

  test("mockups.zip of a project without screenshots is an error, not an empty file", async () => {
    const id = await create("Mockups", 1);
    const empty = await call(`/api/projects/${id}/mockups.zip`);
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /no screenshots yet/);
  });
});

describe("renders, with sign-in", () => {
  let server: TestServer;
  let data: TmpData;
  const tokens = { admin: newToken(), two: newToken(), three: newToken() };
  const admin = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { Authorization: `Bearer ${tokens.admin}`, ...init.headers } });
  const two = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { Authorization: `Bearer ${tokens.two}`, ...init.headers } });
  const three = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { Authorization: `Bearer ${tokens.three}`, ...init.headers } });
  const session = (user: string, headers: Record<string, string> = {}): RequestInit => ({ headers: { Cookie: sessionCookie(user), ...headers } });
  const call = async (route: string, init?: RequestInit) => {
    const response = await server.fetch(route, init);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  };
  const create = async (as: (init?: RequestInit) => RequestInit, name: string, slides = 3): Promise<string> =>
    (await call("/api/projects", as(json("POST", { name, locales: ["en"], targets: ["iphone-6.9"], slides: statement(slides) })))).body.id;
  const left = async (as: (init?: RequestInit) => RequestInit) => (await call("/api/renders", as())).body.rendersLeft as number;

  before(async () => {
    data = await tmpData("jobs-sign-in");
    await writeAccounts(data.dir, [
      { id: "u0", email: "admin@example.com", token: tokens.admin },
      { id: "u2", email: "two@example.com", token: tokens.two },
      { id: "u3", email: "three@example.com", token: tokens.three },
    ]);
    server = await startServer({ dataDir: data.dir, imports: FAKE, env: { ...SIGN_IN, ...QUICK, USER_RENDER_CREDITS: "5", FAKE_RENDER_DELAY_MS: "250" } });
  });
  after(async () => {
    await server?.stop();
    await data?.remove();
  });

  test("a render the client stops waiting for gives its render back", async () => {
    const id = await create(two, "Gone");
    assert.equal(await left(two), 5);
    const controller = new AbortController();
    const asked = server.fetch(`/api/projects/${id}/render`, two({ ...json("POST", {}), signal: controller.signal })).catch(() => null);
    await until(async () => (await call("/api/renders", two())).body.jobs.some((job: Job) => job.project === id && job.state === "running"), 5000, "the render to start");
    assert.equal(await left(two), 4, "set aside while it runs");
    controller.abort();
    await asked;
    await until(async () => (await call("/api/renders", two())).body.jobs.some((job: Job) => job.project === id && job.state === "cancelled"), 5000, "the cancel");
    assert.equal(await left(two), 5);
  });

  test("export.zip?render=1 renders only for a request from this server's pages or from no page at all", async () => {
    const id = await create(two, "Linked", 1);
    // Another site's link, followed by a browser that is signed in.
    const crossSite = await call(`/api/projects/${id}/export.zip?render=1`, session("u2", { "Sec-Fetch-Site": "cross-site" }));
    assert.equal(crossSite.status, 403);
    const oldBrowser = await call(`/api/projects/${id}/export.zip?render=1`, session("u2", { Referer: "https://elsewhere.example.com/page" }));
    assert.equal(oldBrowser.status, 403);
    assert.equal(await left(two), 5, "no render was spent");
    // The Studio's own pages, an address typed in, and a token, which no other site has.
    assert.equal((await server.fetch(`/api/projects/${id}/export.zip?render=1`, session("u2", { "Sec-Fetch-Site": "same-origin" }))).status, 200);
    assert.equal((await server.fetch(`/api/projects/${id}/export.zip?render=1`, session("u2", { "Sec-Fetch-Site": "none" }))).status, 200);
    assert.equal((await server.fetch(`/api/projects/${id}/export.zip?render=1`, two({ headers: { "Sec-Fetch-Site": "cross-site" } }))).status, 200);
    // Without render=1 it only reads, from anywhere.
    assert.equal((await server.fetch(`/api/projects/${id}/export.zip`, session("u2", { "Sec-Fetch-Site": "cross-site" }))).status, 200);
    assert.equal(await left(two), 2);
  });

  test("deleting an account while it renders stops the render before its folder goes", async () => {
    const id = await create(three, "Last one", 4);
    const { job } = (await call(`/api/projects/${id}/render`, three(json("POST", { background: true })))).body as { job: Job };
    await until(async () => (await call(`/api/renders/${job.id}`, three())).body.state === "running", 5000, "the render to start");
    const deleted = await server.fetch("/api/account", { ...json("DELETE", { confirm: "three@example.com" }), headers: { Cookie: sessionCookie("u3"), Origin: server.url, "Content-Type": "application/json" } });
    assert.equal(deleted.status, 204);
    await sleep(1500);
    assert.equal(await exists(path.join(data.dir, "users", "u3")), false, "no folder came back");
  });

  test("the admin's health page shows the renderer, the queue, the caches and damaged projects, to the admin alone", async () => {
    const asTwo = await call("/api/admin/health", session("u2"));
    assert.equal(asTwo.status, 403);
    const health = await call("/api/admin/health", session("u0"));
    assert.equal(health.status, 200);
    assert.match(health.headers.get("cache-control") ?? "", /private/);
    for (const key of ["browser", "running", "queue", "renders", "damaged", "caches"]) assert.ok(key in health.body, key);
    assert.deepEqual(Object.keys(health.body.queue).sort(), ["mockup", "render"]);
    assert.ok(Array.isArray(health.body.damaged));
    assert.equal(typeof health.body.caches.mockups.bytes, "number");
  });

  test("the admin moves a project between spaces, under a free id, and the API tokens cannot", async () => {
    const id = await create(two, "Handover", 1);
    assert.equal((await call("/api/admin/projects/move", admin(json("POST", { project: id, from: "two@example.com", to: "main" })))).status, 403);
    const moved = await call("/api/admin/projects/move", { ...json("POST", { project: id, from: "two@example.com", to: "main" }), headers: { Cookie: sessionCookie("u0"), Origin: server.url, "Content-Type": "application/json" } });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.project, id);
    assert.equal((await call(`/api/projects/${id}`, two())).status, 404);
    assert.equal((await call(`/api/projects/${id}`, admin())).body.project.name, "Handover");
    // Back again, where a project of the same name has been made meanwhile.
    await create(two, "Handover", 1);
    const back = await call("/api/admin/projects/move", { ...json("POST", { project: id, from: "main", to: "two@example.com" }), headers: { Cookie: sessionCookie("u0"), Origin: server.url, "Content-Type": "application/json" } });
    assert.equal(back.body.project, `${id}-2`);
    const there = await call(`/api/projects/${id}-2`, two());
    assert.equal(there.body.project.id, `${id}-2`);
    assert.equal(JSON.parse(await readFile(path.join(data.dir, "users", "u2", "projects", `${id}-2`, "project.json"), "utf8")).id, `${id}-2`);
    const unknown = await call("/api/admin/projects/move", { ...json("POST", { project: id, from: "nobody@example.com", to: "main" }), headers: { Cookie: sessionCookie("u0"), Origin: server.url, "Content-Type": "application/json" } });
    assert.equal(unknown.status, 404);
  });
});

describe("stopping the server", () => {
  test("a signal lets the renders under way finish for a few seconds, cancels the rest, and saves the accounts", async () => {
    const data = await tmpData("jobs-stop");
    const token = newToken();
    await writeAccounts(data.dir, [{ id: "u2", email: "two@example.com", token, renders: 0 }]);
    const server = await startServer({ dataDir: data.dir, imports: FAKE, env: { ...SIGN_IN, ...QUICK, USER_RENDER_CREDITS: "5", FAKE_RENDER_DELAY_MS: "700" } });
    try {
      const as = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
      const make = async (name: string, slides: number) => (await (await server.fetch("/api/projects", as(json("POST", { name, locales: ["en"], targets: ["iphone-6.9"], slides: statement(slides) })))).json()).id as string;
      const short = await make("Short", 2);
      const long = await make("Long", 10);
      for (const id of [short, long]) assert.equal((await server.fetch(`/api/projects/${id}/render`, as(json("POST", { background: true })))).status, 202);

      const started = Date.now();
      const code = await server.signal!("SIGTERM");
      const took = Date.now() - started;
      assert.equal(code, 0);
      assert.ok(took < 9000, `stopped in ${took} ms`);
      assert.ok(took > 5000, "waited for the render under way");

      const projects = path.join(data.dir, "users", "u2", "projects");
      assert.ok(await exists(path.join(projects, short, "out", "en", "iphone-6.9", "02.png")), "the short render finished and was put in place");
      assert.equal(await exists(path.join(projects, long, "out")), false, "the long one was cancelled and kept nothing");
      const saved = JSON.parse(await readFile(path.join(data.dir, "accounts.json"), "utf8"));
      assert.equal(saved.users[0].renders, 1, "the finished render was counted and saved, the cancelled one was not");
      assert.match(server.output(), /Stopping/);
    } finally {
      await server.stop();
      await data.remove();
    }
  });
});
