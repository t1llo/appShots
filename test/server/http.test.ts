import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { png } from "../helpers/images.ts";
import { cleanEnv, startServer, type TestServer } from "../helpers/spawn-server.ts";
import { type TmpData, tmpData } from "../helpers/tmp-data.ts";

// How the server answers over HTTP in setups the contract tests do not cover: other settings, other folders, sign-in
// on. Everything is made up for the test: example.com and .test names, and accounts that never reach Google.

const root = path.resolve(import.meta.dirname, "..", "..");

/** Starts src/server.ts and resolves with its exit code and what it printed, for a start that is meant to fail. */
async function failedStart(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  const data = await tmpData("start");
  try {
    const child = spawn(process.execPath, ["src/server.ts"], { cwd: root, env: { ...cleanEnv(), DATA_DIR: data.dir, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    clearTimeout(timer);
    return { code, output };
  } finally {
    await data.remove();
  }
}

describe("starting", { concurrency: true }, () => {
  test("a port that is taken ends the start with the reason and a failing exit code", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, resolve));
    try {
      const { port } = taken.address() as { port: number };
      const { code, output } = await failedStart({ PORT: String(port) });
      assert.notEqual(code, 0, output);
      assert.match(output, new RegExp(`port ${port} is in use`));
      assert.doesNotMatch(output, /listening/);
    } finally {
      taken.close();
    }
  });

  test("a setting that cannot be right stops the start and is named (srv-19)", async () => {
    const { code, output } = await failedStart({ PUBLIC_URL: "appshots.example.com" });
    assert.notEqual(code, 0, output);
    assert.match(output, /PUBLIC_URL has to be the address people open/);
  });
});

/** A request with a Host header of its own, which fetch() does not allow: as a page that rebinds its name would send it. */
function asHost(server: TestServer, host: string, route: string, method = "GET", body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { Host: host, Accept: "application/json, text/event-stream" };
    if (body) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    const request = http.request({ host: "127.0.0.1", port, path: route, method, headers }, (response) => {
      let text = "";
      response.setEncoding("utf8").on("data", (chunk: string) => (text += chunk));
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, text }));
    });
    request.on("error", reject).end(body);
  });
}

describe("host names (srv-4, mcp-8)", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer({ env: { PUBLIC_URL: "https://appshots.example.com", ALLOWED_HOSTS: "studio.test, app_shots" } });
  });
  after(() => server?.stop());

  const tools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  test("while sign-in is off, the API, MCP, files and pages answer only to the server's own names", async () => {
    const { port } = new URL(server.url);
    for (const host of [`localhost:${port}`, `app.localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, "192.168.1.20", "appshots.example.com", "appshots.example.com.", "studio.test:8080", "STUDIO.test", "app_shots:3000"]) {
      assert.equal((await asHost(server, host, "/api/projects")).status, 200, host);
    }
    for (const host of [`rebound.example.com:${port}`, "example.com", "appshots.example.com.rebound.test", "studio.test.example.com", "other_shots", "localhost/x"]) {
      const answer = await asHost(server, host, "/api/projects");
      assert.equal(answer.status, 403, host);
      assert.match(JSON.parse(answer.text).error, /ALLOWED_HOSTS/);
      assert.equal(answer.headers["cache-control"], "no-store");
      assert.equal((await asHost(server, host, "/api/projects", "POST", JSON.stringify({ name: "Rebound" }))).status, 403, host);
      assert.equal((await asHost(server, host, "/mcp", "POST", tools)).status, 403, host);
      assert.equal((await asHost(server, host, "/files/any/shots/home.png")).status, 403, host);
      assert.equal((await asHost(server, host, "/render/any/0")).status, 403, host);
    }
    assert.equal((await asHost(server, `localhost:${port}`, "/mcp", "POST", tools)).status, 200);
  });

  test("public pages and the health check answer to any name", async () => {
    for (const route of ["/healthz", "/skill.md", "/docs/api.md"]) assert.equal((await asHost(server, "rebound.example.com", route)).status, 200, route);
  });
});

/** The settings that turn sign-in on. No request in these tests goes to Google. */
const SIGN_IN = { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", ADMIN_EMAIL: "admin@example.com" };
const SECRET = "0123456789abcdef".repeat(4);
const DAY = 24 * 3600 * 1000;
const SESSION_TTL = 30 * DAY;

/** A session cookie as the server seals it, for an account at `epoch`, running out `left` milliseconds from now. */
function sessionCookie(user: string, epoch: number, left: number): string {
  const payload = Buffer.from(JSON.stringify({ u: user, k: epoch, _p: "session", _e: Date.now() + left })).toString("base64url");
  return `appshots_session=${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

describe("sessions", () => {
  let server: TestServer;
  let data: TmpData;
  const token = `appshots_${randomBytes(24).toString("base64url")}`;
  before(async () => {
    data = await tmpData("sessions");
    const tokens = [{ id: "t1", name: "Test", hash: createHash("sha256").update(token).digest("hex"), hint: token.slice(-4), createdAt: "2026-01-01T00:00:00.000Z" }];
    const user = { id: "u1", email: "person@example.com", name: "Person", createdAt: "2026-01-01T00:00:00.000Z", epoch: 1, tokens };
    await writeFile(path.join(data.dir, "accounts.json"), JSON.stringify({ signup: "open", signupChosen: true, allowed: [], users: [user], spent: {} }));
    await writeFile(path.join(data.dir, "secret.key"), SECRET);
    server = await startServer({ dataDir: data.dir, env: SIGN_IN });
  });
  after(async () => {
    await server?.stop();
    await data?.remove();
  });

  test("a session is renewed on the account's own answers only, never on public ones a CDN may keep (srv-5)", async () => {
    const aged = sessionCookie("u1", 1, SESSION_TTL - 2 * DAY);
    for (const route of ["/healthz", "/", "/home", "/icons.svg", "/fonts/fonts.css", "/og.jpg", "/skill.md", "/skill.json", "/skill/start.md", "/cli/appshots.mjs", "/docs/api.md", "/auth/config", "/nothing-here"]) {
      const answer = await server.fetch(route, { headers: { Cookie: aged }, redirect: "manual" });
      assert.equal(answer.headers.get("set-cookie"), null, route);
    }
    const api = await server.fetch("/api/projects", { headers: { Cookie: aged } });
    assert.equal(api.status, 200);
    assert.match(api.headers.get("set-cookie") ?? "", /^appshots_session=[^;]+;.*HttpOnly/);
    assert.match(api.headers.get("cache-control") ?? "", /private/);
    // A cookie from today is left as it is.
    assert.equal((await server.fetch("/api/projects", { headers: { Cookie: sessionCookie("u1", 1, SESSION_TTL) } })).headers.get("set-cookie"), null);
  });

  test("refusing someone who is not signed in, or a write from another site, keeps the answer out of caches", async () => {
    for (const route of ["/api/projects", "/mcp", "/files/any/shots/home.png", "/render/any/0"]) {
      const answer = await server.fetch(route, { headers: { Accept: "application/json" } });
      assert.equal(answer.status, 401, route);
      assert.equal(answer.headers.get("cache-control"), "no-store", route);
    }
    const crossSite = await server.fetch("/api/projects", {
      method: "POST",
      headers: { Cookie: sessionCookie("u1", 1, SESSION_TTL), Origin: "https://elsewhere.example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Elsewhere" }),
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.headers.get("cache-control"), "no-store");
  });

  test("signing out ends the session in every browser, and API tokens keep working (srv-11)", async () => {
    const here = sessionCookie("u1", 1, SESSION_TTL);
    const there = sessionCookie("u1", 1, SESSION_TTL - DAY / 2);
    // Another site cannot sign anybody out.
    const forged = await server.fetch("/logout", { method: "POST", headers: { Cookie: here, Origin: "https://elsewhere.example.com" }, redirect: "manual" });
    assert.equal(forged.status, 403);
    assert.equal((await server.fetch("/api/projects", { headers: { Cookie: there } })).status, 200);

    const out = await server.fetch("/logout", { method: "POST", headers: { Cookie: here, Origin: server.url }, redirect: "manual" });
    assert.equal(out.status, 302);
    assert.match(out.headers.get("set-cookie") ?? "", /^appshots_session=;/);
    for (const cookie of [here, there]) assert.equal((await server.fetch("/api/projects", { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await server.fetch("/api/projects", { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    // Signing in again starts a new session, which the sign-out does not touch.
    assert.equal((await server.fetch("/api/projects", { headers: { Cookie: sessionCookie("u1", 2, SESSION_TTL) } })).status, 200);
  });
});

describe("accounts", () => {
  let server: TestServer;
  let data: TmpData;
  const account = (id: string, email: string) => ({ id, email, name: email.split("@")[0], createdAt: "2026-01-01T00:00:00.000Z", epoch: 1, tokens: [] });
  const as = (user: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { Cookie: sessionCookie(user, 1, SESSION_TTL), Origin: server.url, "Content-Type": "application/json", ...init.headers } });
  before(async () => {
    data = await tmpData("accounts");
    const users = [account("u0", "admin@example.com"), account("u2", "two@example.com")];
    await writeFile(path.join(data.dir, "accounts.json"), JSON.stringify({ signup: "open", signupChosen: true, allowed: [], users, spent: {} }));
    await writeFile(path.join(data.dir, "secret.key"), SECRET);
    // The admin had an ordinary account, with a project of its own, before ADMIN_EMAIL named them.
    await mkdir(path.join(data.dir, "users", "u0", "projects", "earlier"), { recursive: true });
    server = await startServer({ dataDir: data.dir, env: { ...SIGN_IN, USER_RENDER_CREDITS: "0" } });
  });
  after(async () => {
    await server?.stop();
    await data?.remove();
  });

  test("the admin's projects from an ordinary account are named at startup, not lost from sight (store-15)", () => {
    assert.match(server.output(), /admin's projects from before ADMIN_EMAIL named them are in .*users[/\\]u0[/\\]projects/);
  });

  test("a render limit of 0 leaves an account no renders, and the admin's are not counted (srv-19)", async () => {
    assert.equal(((await (await server.fetch("/api/renders", as("u2"))).json()) as { rendersLeft: unknown }).rendersLeft, 0);
    assert.equal(((await (await server.fetch("/api/renders", as("u0"))).json()) as { rendersLeft: unknown }).rendersLeft, null);
  });

  test("a check says an account without renders would be refused, in the render's words", async () => {
    const created = await server.fetch("/api/projects", as("u2", { method: "POST", body: JSON.stringify({ name: "Spent", slides: [{ layout: "statement", headline: "One" }] }) }));
    const { id } = (await created.json()) as { id: string };
    const check = (await (await server.fetch(`/api/projects/${id}/check`, as("u2", { method: "POST", body: "{}" }))).json()) as { ok: boolean; refused: string[]; plan: unknown; rendersLeft: number };
    assert.equal(check.ok, false);
    assert.deepEqual(check.refused, ["This account has used all of its 0 renders. The person who runs this server can give it more."]);
    assert.ok(check.plan, "says what it would draw all the same");
    assert.equal(check.rendersLeft, 0);
    const render = await server.fetch(`/api/projects/${id}/render`, as("u2", { method: "POST", body: "{}" }));
    assert.equal(render.status, 400);
    assert.equal(((await render.json()) as { error: string }).error, check.refused[0]);
  });

  test("a token works from the moment it is made until it is revoked", async () => {
    const made = await server.fetch("/api/account/tokens", as("u2", { method: "POST", body: JSON.stringify({ name: "Laptop" }) }));
    assert.equal(made.status, 201);
    const { token, id } = (await made.json()) as { token: string; id: string };
    const bearer = { headers: { Authorization: `Bearer ${token}` } };
    assert.equal((await server.fetch("/api/projects", bearer)).status, 200);
    assert.equal((await server.fetch(`/api/account/tokens/${id}`, as("u2", { method: "DELETE" }))).status, 204);
    assert.equal((await server.fetch("/api/projects", bearer)).status, 401);
  });

  test("deleting an account takes the address in any case and with spaces around it (srv-20)", async () => {
    const wrong = await server.fetch("/api/account", as("u2", { method: "DELETE", body: JSON.stringify({ confirm: "someone@example.com" }) }));
    assert.equal(wrong.status, 400);
    const deleted = await server.fetch("/api/account", as("u2", { method: "DELETE", body: JSON.stringify({ confirm: " Two@Example.com " }) }));
    assert.equal(deleted.status, 204);
    assert.equal((await server.fetch("/api/projects", as("u2"))).status, 401);
  });
});

describe("checking a render", () => {
  let server: TestServer;
  let data: TmpData;
  before(async () => {
    data = await tmpData("check");
    const users = [{ id: "u3", email: "three@example.com", name: "three", createdAt: "2026-01-01T00:00:00.000Z", epoch: 1, tokens: [] }];
    await writeFile(path.join(data.dir, "accounts.json"), JSON.stringify({ signup: "open", signupChosen: true, allowed: [], users, spent: {} }));
    await writeFile(path.join(data.dir, "secret.key"), SECRET);
    server = await startServer({ dataDir: data.dir, env: { ...SIGN_IN, USER_RENDER_CREDITS: "2" } });
  });
  after(async () => {
    await server?.stop();
    await data?.remove();
  });

  test("uses none of the account's renders, over the HTTP API and as an MCP tool", async () => {
    const as = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { Cookie: sessionCookie("u3", 1, SESSION_TTL), Origin: server.url, "Content-Type": "application/json" } });
    const created = await server.fetch("/api/projects", as({ method: "POST", body: JSON.stringify({ name: "Counted", slides: [{ layout: "statement", headline: "One" }] }) }));
    const { id } = (await created.json()) as { id: string };
    for (let i = 0; i < 3; i++) {
      const check = (await (await server.fetch(`/api/projects/${id}/check`, as({ method: "POST", body: "{}" }))).json()) as { ok: boolean; rendersLeft: number };
      assert.deepEqual([check.ok, check.rendersLeft], [true, 2]);
    }
    const made = await server.fetch("/api/account/tokens", as({ method: "POST", body: JSON.stringify({ name: "Agent" }) }));
    const { token } = (await made.json()) as { token: string };
    const mcp = await server.fetch("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_project", arguments: { project: id } } }),
    });
    const answer = await mcp.text();
    assert.match(answer, /A render of this would start\..*Checking used no render\. Renders left on this account: 2\./s);
    assert.equal(((await (await server.fetch("/api/renders", as())).json()) as { rendersLeft: number }).rendersLeft, 2);
  });
});

describe("errors and uploads", () => {
  let server: TestServer;
  let id: string;
  before(async () => {
    server = await startServer();
    const created = await server.fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Errors" }) });
    ({ id } = (await created.json()) as { id: string });
  });
  after(() => server?.stop());

  test("a missing file is a 404 that is not kept and names no path on the server (srv-15)", async () => {
    const css = await (await server.fetch("/fonts/fonts.css")).text();
    const font = /\/fonts\/([^/]+)\//.exec(css)![1];
    for (const route of [`/fonts/${font}/missing.woff2`, `/files/${id}/shots/missing.png`, `/files/${id}/images/missing.png`, `/files/${id}/out/iphone-6.9/missing.png`, "/fonts/nothing/a.woff2"]) {
      const answer = await server.fetch(route);
      assert.equal(answer.status, 404, route);
      assert.equal(answer.headers.get("cache-control"), "no-store", route);
      assert.equal(answer.headers.get("content-disposition"), null, route);
      const text = await answer.text();
      assert.doesNotMatch(text, /ENOENT|node_modules|appshots-test|\/(Users|home|tmp|var|private)\//, route);
    }
    const missing = await server.fetch("/api/projects/nothing-here");
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
  });

  test("a body over its limit is told the limit of its own kind (srv-17)", async () => {
    const big = JSON.stringify({ name: "x".repeat(3 * 1024 * 1024) });
    for (const route of ["/api/projects", "/mcp"]) {
      const answer = await server.fetch(route, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: big });
      assert.equal(answer.status, 413, route);
      assert.equal(((await answer.json()) as { error: string }).error, "Request body too large (limit 2 MB)", route);
    }
  });

  test("an upload names a device it knows, in any case, or is refused (srv-17)", async () => {
    const image = new Uint8Array(await png(1320, 2868));
    const refused = await server.fetch(`/api/projects/${id}/shots/home?device=phone`, { method: "PUT", body: image });
    assert.equal(refused.status, 400);
    assert.match(((await refused.json()) as { error: string }).error, /iphone, duo, ipad, mac/);
    const filed = await server.fetch(`/api/projects/${id}/shots/home?device=iPad`, { method: "PUT", body: image });
    assert.equal(filed.status, 201);
    assert.equal(((await filed.json()) as { device: string }).device, "ipad");
    // No device, or an empty one, is still told from the picture.
    for (const query of ["", "?device="]) assert.equal((await server.fetch(`/api/projects/${id}/shots/home${query}`, { method: "PUT", body: image })).status, 201, query);
  });
});

describe("files", { concurrency: true }, () => {
  test("files are served from a data directory inside a hidden folder", async () => {
    const data = await tmpData("hidden");
    const dir = path.join(data.dir, ".appshots", "data");
    await mkdir(dir, { recursive: true });
    const server = await startServer({ dataDir: dir });
    try {
      const created = await server.fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hidden" }) });
      const { id } = (await created.json()) as { id: string };
      const shot = await server.fetch(`/api/projects/${id}/shots/home`, { method: "PUT", body: new Uint8Array(await png(1320, 2868)) });
      assert.equal(shot.status, 201);
      const { file } = (await shot.json()) as { file: string };
      const served = await server.fetch(`/files/${id}/shots/${file}`);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/png");
    } finally {
      await server.stop();
      await data.remove();
    }
  });
});
