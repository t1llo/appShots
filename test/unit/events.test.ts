import assert from "node:assert/strict";
import http from "node:http";
import { after, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import express from "express";
import { eventFrame, eventRoutes } from "../../src/http/routes/events.ts";
import { createEventBus, type SpaceEvent } from "../../src/services/events.ts";
import { ConflictError } from "../../src/domain/errors.ts";
import { createProjectRepository } from "../../src/storage/projects.ts";
import { openEvents, within } from "../helpers/events.ts";
import { tmpData } from "../helpers/tmp-data.ts";

// The bus that tells an account what changed in it, what the project repository tells it, and the route that sends it
// down a stream, here on a small app of its own whose sign-in is a header naming the account.

const changed = (id: string, revision = 2): SpaceEvent => ({ type: "project", id, revision, actor: "api" });

describe("the bus", () => {
  test("an event reaches the followers of its own space and nobody else", () => {
    const bus = createEventBus();
    const got: Record<string, SpaceEvent[]> = { a1: [], a2: [], b: [] };
    bus.follow("a", { send: (event) => got.a1!.push(event) });
    bus.follow("a", { send: (event) => got.a2!.push(event) });
    bus.follow("b", { send: (event) => got.b!.push(event) });
    bus.publish("a", changed("one"));
    bus.publish("c", changed("nobody"));
    assert.deepEqual(got, { a1: [changed("one")], a2: [changed("one")], b: [] });
    assert.equal(bus.followers("a"), 2);
    assert.equal(bus.followers("c"), 0);
  });

  test("a follower that stops hears nothing more, and a space nobody follows is let go", () => {
    const bus = createEventBus();
    const got: SpaceEvent[] = [];
    const stop = bus.follow("a", { send: (event) => got.push(event) });
    bus.publish("a", changed("before"));
    stop();
    stop();
    bus.publish("a", changed("after"));
    assert.deepEqual(got, [changed("before")]);
    assert.equal(bus.followers("a"), 0);
  });

  test("a follower that throws keeps the event from nobody else", () => {
    const logged: string[] = [];
    const bus = createEventBus({ log: (message) => logged.push(message) });
    const got: SpaceEvent[] = [];
    bus.follow("a", {
      send: () => {
        throw new Error("socket gone");
      },
    });
    bus.follow("a", { send: (event) => got.push(event) });
    bus.publish("a", changed("one"));
    assert.deepEqual(got, [changed("one")]);
    assert.match(logged.join("\n"), /socket gone/);
  });

  test("a follower may stop while it is told, and the others are told all the same", () => {
    const bus = createEventBus();
    const got: string[] = [];
    const first = bus.follow("a", {
      send: () => {
        got.push("first");
        first();
      },
    });
    bus.follow("a", { send: () => void got.push("second") });
    bus.publish("a", changed("one"));
    bus.publish("a", changed("two"));
    assert.deepEqual(got, ["first", "second", "second"]);
  });

  test("a recheck and the end reach the followers of every space", () => {
    const bus = createEventBus();
    const got: string[] = [];
    for (const space of ["a", "b"]) bus.follow(space, { send: () => {}, recheck: () => void got.push(`recheck ${space}`), end: () => void got.push(`end ${space}`) });
    // One that only listens for events is left alone.
    bus.follow("c", { send: () => {} });
    bus.recheck();
    bus.endAll();
    assert.deepEqual(got, ["recheck a", "recheck b", "end a", "end b"]);
  });

  test("an event goes down a stream as its type and its fields on one line of JSON", () => {
    assert.equal(eventFrame(changed("demo", 7)), 'event: project\ndata: {"id":"demo","revision":7,"actor":"api"}\n\n');
    // A name with a line break in it stays on the one line.
    const job: SpaceEvent = { type: "job", id: "j1", project: "demo", name: "Two\nlines", state: "running", done: 1, total: 4, createdAt: "2026-01-01T00:00:00.000Z" };
    assert.equal(eventFrame(job).split("\n").length, 4);
  });
});

describe("what the project repository tells", async () => {
  const data = await tmpData("events");
  after(() => data.remove());
  const bus = createEventBus();
  const got: SpaceEvent[] = [];
  bus.follow(data.space.id, { send: (event) => got.push(event) });
  const projects = createProjectRepository({ events: bus, log: () => {} });

  test("a new project, each change and a restore, in the order they were made", async () => {
    got.length = 0;
    const { project } = await projects.create(data.space, { name: "Told" }, { actor: "mcp" });
    await Promise.all(Array.from({ length: 5 }, (_, i) => projects.mutate(data.space, project.id, (current) => ({ ...current, name: `Told ${i}` }), { actor: "studio" })));
    await projects.restore(data.space, project.id, 1, { actor: "api" });
    assert.deepEqual(got, [
      { type: "project-created", id: project.id, actor: "mcp" },
      ...[2, 3, 4, 5, 6].map((revision) => ({ type: "project", id: project.id, revision, actor: "studio" })),
      { type: "project", id: project.id, revision: 7, actor: "api" },
    ]);
  });

  test("a change that is refused or throws tells nothing", async () => {
    const { project } = await projects.create(data.space, { name: "Quiet" });
    got.length = 0;
    await assert.rejects(
      projects.mutate(data.space, project.id, (current) => ({ ...current, name: "Stale" }), { ifRevision: 0 }),
      (error: unknown) => error instanceof ConflictError,
    );
    await assert.rejects(
      projects.mutate(data.space, project.id, () => {
        throw new Error("no");
      }),
    );
    assert.deepEqual(got, []);
  });
});

describe("the route", async () => {
  const bus = createEventBus();
  const app = express();
  // Sign-in stands in as a header naming the account; with sign-in off, a stream's sign-in always holds.
  app.use((req, res, next) => {
    res.locals.identity = { space: { id: req.get("x-space") ?? "a", root: "/nonexistent" }, session: true };
    next();
  });
  app.use("/api", eventRoutes({ heartbeatMs: 50, maxStreams: 2, bus }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/events`;
  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  test("a stream is private, kept from buffering, and says it is ready", async () => {
    const stream = await openEvents(url);
    try {
      assert.equal(stream.response.status, 200);
      assert.match(stream.response.headers.get("content-type") ?? "", /^text\/event-stream/);
      assert.match(stream.response.headers.get("cache-control") ?? "", /no-store/);
      assert.match(stream.response.headers.get("cache-control") ?? "", /private/);
      assert.equal(stream.response.headers.get("x-accel-buffering"), "no");
      assert.equal(stream.response.headers.get("content-encoding"), null);
      assert.deepEqual(await stream.next(), { type: "ready", data: { heartbeatMs: 50 } });
      assert.match(stream.text(), /^retry: \d+\n\n/);
    } finally {
      stream.close();
    }
  });

  test("a quiet stream gets a comment every heartbeat, and the events of its account only", async () => {
    const [mine, theirs] = await Promise.all([openEvents(url), openEvents(url, { headers: { "x-space": "b" } })]);
    try {
      await Promise.all([mine.next("ready"), theirs.next("ready")]);
      await sleep(180);
      assert.ok(mine.text().split(": heartbeat\n\n").length - 1 >= 2, mine.text());
      bus.publish("a", changed("for-a"));
      bus.publish("b", changed("for-b"));
      assert.deepEqual(await mine.next(), { type: "project", data: { id: "for-a", revision: 2, actor: "api" } });
      assert.deepEqual(await theirs.next(), { type: "project", data: { id: "for-b", revision: 2, actor: "api" } });
      await sleep(50);
      assert.deepEqual(mine.received.map((event) => event.type), ["ready", "project"]);
    } finally {
      mine.close();
      theirs.close();
    }
  });

  test("an account gets as many streams as the cap, and one more once one is closed", async () => {
    const first = await openEvents(url, { headers: { "x-space": "capped" } });
    const second = await openEvents(url, { headers: { "x-space": "capped" } });
    await Promise.all([first.next("ready"), second.next("ready")]);
    const refused = await fetch(url, { headers: { "x-space": "capped" } });
    assert.equal(refused.status, 429);
    assert.match((await refused.json()).error, /2 event streams open already/);
    first.close();
    // The server lets the stream go once it sees the connection closed.
    for (let tries = 0; tries < 50 && bus.followers("capped") > 1; tries++) await sleep(20);
    assert.equal(bus.followers("capped"), 1);
    const third = await openEvents(url, { headers: { "x-space": "capped" } });
    assert.equal(third.response.status, 200);
    second.close();
    third.close();
  });

  test("the streams end when the server stops", async () => {
    const stream = await openEvents(url);
    await stream.next("ready");
    bus.endAll();
    assert.equal(await within(stream.ended, 2000), true);
    for (let tries = 0; tries < 50 && bus.followers("a") > 0; tries++) await sleep(20);
    assert.equal(bus.followers("a"), 0);
  });
});
