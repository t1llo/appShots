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
    server = await startServer({ env: { PUBLIC_URL: "https://appshots.example.com", ALLOWED_HOSTS: "studio.test" } });
  });
  after(() => server?.stop());

  const tools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  test("while sign-in is off, the API, MCP, files and pages answer only to the server's own names", async () => {
    const { port } = new URL(server.url);
    for (const host of [`localhost:${port}`, `app.localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, "192.168.1.20", "appshots.example.com", "studio.test:8080", "STUDIO.test"]) {
      assert.equal((await asHost(server, host, "/api/projects")).status, 200, host);
    }
    for (const host of [`rebound.example.com:${port}`, "example.com", "appshots.example.com.rebound.test", "studio.test.example.com"]) {
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

/** A session cookie as the server seals it, for account u1 at `epoch`, running out `left` milliseconds from now. */
function sessionCookie(epoch: number, left: number): string {
  const payload = Buffer.from(JSON.stringify({ u: "u1", k: epoch, _p: "session", _e: Date.now() + left })).toString("base64url");
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
    const aged = sessionCookie(1, SESSION_TTL - 2 * DAY);
    for (const route of ["/healthz", "/", "/home", "/icons.svg", "/fonts/fonts.css", "/og.jpg", "/skill.md", "/skill.json", "/cli/appshots.mjs", "/docs/api.md", "/auth/config", "/nothing-here"]) {
      const answer = await server.fetch(route, { headers: { Cookie: aged }, redirect: "manual" });
      assert.equal(answer.headers.get("set-cookie"), null, route);
    }
    const api = await server.fetch("/api/projects", { headers: { Cookie: aged } });
    assert.equal(api.status, 200);
    assert.match(api.headers.get("set-cookie") ?? "", /^appshots_session=[^;]+;.*HttpOnly/);
    assert.match(api.headers.get("cache-control") ?? "", /private/);
    // A cookie from today is left as it is.
    assert.equal((await server.fetch("/api/projects", { headers: { Cookie: sessionCookie(1, SESSION_TTL) } })).headers.get("set-cookie"), null);
  });

  test("signing out ends the session in every browser, and API tokens keep working (srv-11)", async () => {
    const here = sessionCookie(1, SESSION_TTL);
    const there = sessionCookie(1, SESSION_TTL - DAY / 2);
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
    assert.equal((await server.fetch("/api/projects", { headers: { Cookie: sessionCookie(2, SESSION_TTL) } })).status, 200);
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
