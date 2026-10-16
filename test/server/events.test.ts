import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { png } from "../helpers/images.ts";
import { type EventStream, openEvents, within } from "../helpers/events.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";
import { tmpData } from "../helpers/tmp-data.ts";

// GET /api/events on a real server: what each change in an account is told as, that it is told to that account only,
// and that a stream ends with the sign-in it was opened with. Renders are drawn by the stand-in for the browser.
// Everything here is made up: example.com addresses, tokens minted on the spot and sessions sealed with a test secret.

const FAKE = ["test/helpers/fake-renderer-preload.ts"];
const QUICK = { RENDER_PNG_LEVEL: "1" };

const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const statement = (n: number) => Array.from({ length: n }, (_, i) => ({ layout: "statement", headline: { en: `Slide ${i + 1}` } }));

describe("the event stream, with sign-in off", () => {
  let server: TestServer;
  const streams: EventStream[] = [];
  const open = async () => {
    const stream = await openEvents(`${server.url}/api/events`);
    streams.push(stream);
    await stream.next("ready");
    return stream;
  };

  before(async () => {
    server = await startServer({ imports: FAKE, env: { ...QUICK, FAKE_RENDER_DELAY_MS: "60" } });
  });
  after(async () => {
    for (const stream of streams) stream.close();
    await server?.stop();
  });

  test("a project made, changed, given a screenshot and deleted is told step by step", async () => {
    const stream = await open();
    const { id } = await (await server.fetch("/api/projects", json("POST", { name: "Told" }))).json();
    assert.deepEqual((await stream.next()).data, { id, actor: "api" });
    await server.fetch(`/api/projects/${id}`, json("PUT", { name: "Told again" }, { "x-appshots-client": "studio" }));
    assert.deepEqual(await stream.next(), { type: "project", data: { id, revision: 2, actor: "studio" } });
    await server.fetch(`/api/projects/${id}/shots/home?device=iphone`, { method: "PUT", body: new Uint8Array(await png(1320, 2868)) });
    assert.deepEqual(await stream.next(), { type: "assets", data: { project: id, kind: "shots" } });
    await server.fetch(`/api/projects/${id}/shots/home.iphone.png`, { method: "DELETE" });
    assert.deepEqual(await stream.next(), { type: "assets", data: { project: id, kind: "shots" } });
    assert.equal((await server.fetch(`/api/projects/${id}`, { method: "DELETE" })).status, 204);
    assert.deepEqual(await stream.next(), { type: "project-deleted", data: { id } });
  });

  test("a render is told as it is queued, as it draws and as it ends", async () => {
    const stream = await open();
    const { id } = await (await server.fetch("/api/projects", json("POST", { name: "Drawn", locales: ["en"], targets: ["iphone-6.9"], slides: statement(4) }))).json();
    const { job } = await (await server.fetch(`/api/projects/${id}/render`, json("POST", { background: true }))).json();
    const told = [];
    for (let event = await stream.next("job", 15_000); ; event = await stream.next("job", 15_000)) {
      told.push(event.data);
      if (event.data.finishedAt) break;
    }
    assert.ok(told.every((each) => each.id === job.id && each.project === id));
    assert.equal(told[0].state, "queued");
    assert.ok(told.some((each) => each.state === "running" && each.total === 4));
    const last = told.at(-1);
    assert.equal(last.state, "done");
    assert.equal(last.done, 4);
    assert.equal(last.files, 4);
    // Counts only grow, and the warnings stay with GET /api/renders/:job.
    assert.deepEqual(told.map((each) => each.done), told.map((each) => each.done).sort((a, b) => a - b));
    assert.ok(told.every((each) => !("warnings" in each) && !("lint" in each)));
  });

  test("the streams end when the server is told to stop, and it stops at once", async () => {
    const own = await startServer();
    const stream = await openEvents(`${own.url}/api/events`);
    await stream.next("ready");
    const started = Date.now();
    const code = await own.signal!("SIGTERM");
    assert.equal(code, 0);
    assert.ok(Date.now() - started < 3000, "an open stream did not hold the server up");
    assert.equal(await within(stream.ended, 1000), true);
    await own.stop();
  });
});

/** The settings that turn sign-in on. No request in these tests goes to Google. */
const SIGN_IN = { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", ADMIN_EMAIL: "admin@example.com" };
const SECRET = "0123456789abcdef".repeat(4);
const DAY = 24 * 3600 * 1000;
const newToken = () => `appshots_${randomBytes(24).toString("base64url")}`;

function sessionCookie(user: string): string {
  const payload = Buffer.from(JSON.stringify({ u: user, k: 1, _p: "session", _e: Date.now() + DAY })).toString("base64url");
  return `appshots_session=${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

describe("the event stream, with sign-in", () => {
  const people = [
    { id: "admin", email: "admin@example.com", token: newToken() },
    { id: "u1", email: "one@example.com", token: newToken() },
    { id: "u2", email: "two@example.com", token: newToken() },
  ];
  const [admin, one, two] = people as [(typeof people)[number], (typeof people)[number], (typeof people)[number]];
  const bearer = (person: { token: string }) => ({ Authorization: `Bearer ${person.token}` });
  let server: TestServer;
  const streams: EventStream[] = [];
  const open = async (headers: Record<string, string>) => {
    const stream = await openEvents(`${server.url}/api/events`, { headers });
    streams.push(stream);
    assert.equal(stream.response.status, 200);
    await stream.next("ready");
    return stream;
  };
  const create = async (person: { token: string }, name: string): Promise<string> => (await (await server.fetch("/api/projects", json("POST", { name }, bearer(person)))).json()).id;

  before(async () => {
    const data = await tmpData("events");
    const users = people.map(({ id, email, token }) => ({
      id,
      email,
      name: email.split("@")[0],
      createdAt: "2026-01-01T00:00:00.000Z",
      epoch: 1,
      tokens: [{ id: `t-${id}`, name: "Test", hash: createHash("sha256").update(token).digest("hex"), hint: token.slice(-4), createdAt: "2026-01-01T00:00:00.000Z" }],
    }));
    await writeFile(path.join(data.dir, "accounts.json"), JSON.stringify({ signup: "open", signupChosen: true, allowed: [], users, spent: {} }));
    await writeFile(path.join(data.dir, "secret.key"), SECRET);
    const started = await startServer({ dataDir: data.dir, env: SIGN_IN });
    server = { ...started, stop: async () => (await started.stop(), await data.remove()) };
  });
  after(async () => {
    for (const stream of streams) stream.close();
    await server?.stop();
  });

  test("a stream needs a sign-in", async () => {
    const refused = await server.fetch("/api/events");
    assert.equal(refused.status, 401);
    assert.match(refused.headers.get("cache-control") ?? "", /no-store/);
  });

  test("an account hears of its own changes and of nobody else's", async () => {
    const [mine, theirs] = await Promise.all([open(bearer(one)), open({ Cookie: sessionCookie("u2") })]);
    const id = await create(one, "Private");
    assert.deepEqual(await mine.next(), { type: "project-created", data: { id, actor: "api" } });
    const own = await create(two, "Their own");
    // The first event the other account hears of is its own project: the first one's was told before it, if at all.
    assert.deepEqual(await theirs.next(), { type: "project-created", data: { id: own, actor: "api" } });
    assert.ok(theirs.received.every((event) => event.data.id !== id));
    mine.close();
    theirs.close();
  });

  test("a stream ends when its session signs out", async () => {
    const cookie = sessionCookie("u1");
    const [session, token] = await Promise.all([open({ Cookie: cookie }), open(bearer(one))]);
    const out = await server.fetch("/logout", { method: "POST", headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal(out.status, 302);
    assert.equal(await within(session.ended, 2000), true, "the session's stream ended");
    // A token is no session, and its stream goes on.
    assert.equal(token.isEnded(), false);
    await create(one, "Still heard");
    assert.equal((await token.next()).type, "project-created");
    token.close();
  });

  test("a stream ends when its token is revoked", async () => {
    const stream = await open(bearer(two));
    const revoked = await server.fetch("/api/account/tokens/t-u2", { method: "DELETE", headers: { Cookie: sessionCookie("u2") } });
    assert.equal(revoked.status, 204);
    assert.equal(await within(stream.ended, 2000), true);
    assert.equal((await server.fetch("/api/events", { headers: bearer(two) })).status, 401);
  });

  test("a project the admin moves is gone from one account and new in the other", async () => {
    const id = await create(admin, "Moved");
    const [from, to] = await Promise.all([open(bearer(admin)), open({ Cookie: sessionCookie("u2") })]);
    const moved = await server.fetch("/api/admin/projects/move", json("POST", { project: id, from: "main", to: two.email }, { Cookie: sessionCookie("admin") }));
    assert.equal(moved.status, 200, await moved.clone().text());
    const { project } = await moved.json();
    assert.deepEqual(await from.next(), { type: "project-deleted", data: { id } });
    assert.deepEqual(await to.next(), { type: "project-created", data: { id: project, actor: "admin" } });
    from.close();
    to.close();
  });
});
