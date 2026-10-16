import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { backoff, dueOn, type JobUpdate, type Known, LiveLink, type LiveEvent, noWants, parseEvent, QUIET_BEATS, READY_MS, type Source, SLOW_TICKS, type Timers, want } from "../../web/src/state/stream.ts";

// How the Studio follows the server's stream of changes, on its own: no browser, no server. The stream is a stand-in
// the test opens, drops and closes, time is a clock the test moves on, and the cache is a few maps.

class FakeSource implements Source {
  readyState = 0;
  closed = false;
  readonly #listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data?: unknown): void {
    if (type === "ready") this.readyState = 1;
    for (const listener of this.#listeners.get(type) ?? []) listener({ data: data === undefined ? undefined : JSON.stringify(data) });
  }
  /** The connection drops, and the browser says whether it opens it again (0) or gives up (2). */
  drop(then: 0 | 2): void {
    this.readyState = then;
    for (const listener of this.#listeners.get("error") ?? []) listener({});
  }
}

class FakeClock implements Timers {
  now = 0;
  #next = 1;
  readonly #due = new Map<number, { at: number; run: () => void }>();
  set(run: () => void, ms: number): unknown {
    const id = this.#next++;
    this.#due.set(id, { at: this.now + ms, run });
    return id;
  }
  clear(handle: unknown): void {
    this.#due.delete(handle as number);
  }
  /** Moves time on by `ms`, running what falls due on the way, in order. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const [id, first] = [...this.#due].sort(([, a], [, b]) => a.at - b.at)[0] ?? [];
      if (id === undefined || first!.at > end) break;
      this.#due.delete(id);
      this.now = first!.at;
      first!.run();
    }
    this.now = end;
  }
  get pending(): number {
    return this.#due.size;
  }
}

function harness() {
  const clock = new FakeClock();
  const sources: FakeSource[] = [];
  const events: LiveEvent[] = [];
  const states: string[] = [];
  let resyncs = 0;
  const link = new LiveLink({
    connect: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    onEvent: (event) => events.push(event),
    onResync: () => resyncs++,
    onState: (state) => states.push(state),
    timers: clock,
  });
  return { clock, sources, events, states, link, resyncs: () => resyncs, last: () => sources.at(-1)! };
}

describe("the link", () => {
  test("a stream that says it is ready counts as working, and hands on what it tells", () => {
    const { link, last, events, resyncs } = harness();
    link.start();
    assert.equal(link.state, "connecting");
    last().emit("ready", { heartbeatMs: 20000 });
    assert.equal(link.state, "live");
    last().emit("project", { id: "demo", revision: 3, actor: "mcp" });
    last().emit("project", { nonsense: true });
    last().emit("message", { id: "demo" });
    assert.deepEqual(events, [{ type: "project", id: "demo", revision: 3, actor: "mcp" }]);
    // The first stream opens as the Studio asks for what it shows, and nothing has gone unheard.
    assert.equal(resyncs(), 0);
  });

  test("a server without the stream, or one that refuses it, is tried again later and later", () => {
    const { link, last, sources, clock, states } = harness();
    link.start();
    // EventSource gives up on any answer but a stream, such as a 404 from a server from before it.
    last().drop(2);
    assert.equal(link.state, "down");
    assert.equal(sources.length, 1);
    clock.advance(backoff(1) - 1);
    assert.equal(sources.length, 1);
    clock.advance(1);
    assert.equal(sources.length, 2);
    assert.equal(link.state, "connecting");
    last().drop(2);
    clock.advance(backoff(2) - 1);
    assert.equal(sources.length, 2);
    clock.advance(1);
    assert.equal(sources.length, 3);
    assert.ok(sources.slice(0, -1).every((source) => source.closed));
    assert.deepEqual(states, ["connecting", "down", "connecting", "down", "connecting"]);
  });

  test("a stream that never says it is ready, such as one a proxy holds back, counts as not working", () => {
    const { link, last, sources, clock } = harness();
    link.start();
    clock.advance(READY_MS);
    assert.equal(link.state, "down");
    assert.equal(last().closed, true);
    clock.advance(backoff(1));
    assert.equal(sources.length, 2);
    // Once ready, the pause is short again.
    last().emit("ready", {});
    last().drop(2);
    clock.advance(backoff(1));
    assert.equal(sources.length, 3);
  });

  test("a stream that drops is opened again by the browser, and what went unheard meanwhile is asked for", () => {
    const { link, last, sources, clock, resyncs } = harness();
    link.start();
    last().emit("ready", {});
    last().drop(0);
    // Until it is ready again, the clock asks in its place.
    assert.equal(link.state, "down");
    assert.equal(sources.length, 1);
    last().emit("ready", {});
    assert.equal(link.state, "live");
    assert.equal(resyncs(), 1);
    // Ready again, the watchdog of the drop is off.
    clock.advance(READY_MS * 2);
    assert.equal(link.state, "live");
    assert.equal(sources.length, 1);
  });

  test("a live stream that goes quiet, such as one that died without a word while the laptop slept, counts as not working", () => {
    const { link, last, sources, clock, resyncs } = harness();
    const quiet = 20_000 * QUIET_BEATS;
    link.start();
    last().emit("ready", { heartbeatMs: 20_000 });
    // A ping says that it still works, and so does any event.
    clock.advance(quiet - 1);
    last().emit("ping", {});
    clock.advance(quiet - 1);
    last().emit("project", { id: "demo", revision: 3, actor: "mcp" });
    clock.advance(quiet - 1);
    assert.equal(link.state, "live");
    assert.equal(sources.length, 1);
    // Then nothing at all: the stream is closed, and opened again after the first pause.
    clock.advance(1);
    assert.equal(link.state, "down");
    assert.equal(last().closed, true);
    clock.advance(backoff(1));
    assert.equal(sources.length, 2);
    last().emit("ready", { heartbeatMs: 20_000 });
    assert.equal(link.state, "live");
    // What changed meanwhile went unheard, and is asked for.
    assert.equal(resyncs(), 1);
  });

  test("a stream whose server names no heartbeat is not held to one", () => {
    const { link, last, sources, clock } = harness();
    link.start();
    last().emit("ready", {});
    clock.advance(3_600_000);
    assert.equal(link.state, "live");
    assert.equal(sources.length, 1);
  });

  test("a stream that drops while live waits for ready again, not for its heartbeat", () => {
    const { link, last, clock } = harness();
    link.start();
    last().emit("ready", { heartbeatMs: 20_000 });
    last().drop(0);
    // Only ready makes it live again: a ping meanwhile does not put off the wait.
    last().emit("ping", {});
    clock.advance(READY_MS);
    assert.equal(link.state, "down");
    assert.equal(last().closed, true);
  });

  test("a stream that keeps dropping before it is ready is given up on for a while", () => {
    const { link, last, sources } = harness();
    link.start();
    last().drop(0);
    last().drop(0);
    assert.equal(last().closed, false);
    last().drop(0);
    assert.equal(last().closed, true);
    assert.equal(link.state, "down");
    assert.equal(sources.length, 1);
  });

  test("the pause before another try doubles, up to five minutes", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 20].map(backoff), [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
  });

  test("a stopped link closes its stream, waits for nothing, and asks for what it missed once it is back", () => {
    const { link, last, sources, clock, events, resyncs } = harness();
    link.start();
    last().emit("ready", {});
    link.stop();
    assert.equal(link.state, "off");
    assert.equal(last().closed, true);
    assert.equal(clock.pending, 0);
    // A late event from the closed stream is not handed on.
    last().emit("project", { id: "late", revision: 2, actor: "api" });
    assert.deepEqual(events, []);
    link.start();
    assert.equal(sources.length, 2);
    // Starting a link that is open already opens nothing more.
    link.start();
    assert.equal(sources.length, 2);
    last().emit("ready", {});
    assert.equal(resyncs(), 1);
  });

  test("a stopped link that was waiting to try again stays stopped", () => {
    const { link, last, sources, clock } = harness();
    link.start();
    last().drop(2);
    link.stop();
    clock.advance(backoff(10));
    assert.equal(sources.length, 1);
    assert.equal(link.state, "off");
  });
});

describe("what the stream says", () => {
  test("each kind of event is read, and one that is not whole is left out", () => {
    const text = (value: unknown) => JSON.stringify(value);
    assert.deepEqual(parseEvent("project-created", text({ id: "a", actor: "mcp" })), { type: "project-created", id: "a", actor: "mcp" });
    assert.deepEqual(parseEvent("project-deleted", text({ id: "a" })), { type: "project-deleted", id: "a" });
    assert.deepEqual(parseEvent("assets", text({ project: "a", kind: "images" })), { type: "assets", project: "a", kind: "images" });
    assert.equal(parseEvent("assets", text({ project: "a", kind: "fonts" })), null);
    const job = { id: "j", project: "a", name: "A", state: "running", done: 1, total: 4, createdAt: "2026-01-01T00:00:00.000Z" };
    assert.deepEqual(parseEvent("job", text(job)), { type: "job", job });
    assert.equal(parseEvent("job", text({ id: "j" })), null);
    assert.equal(parseEvent("project", "not json"), null);
    assert.equal(parseEvent("project", "null"), null);
    assert.equal(parseEvent("ready", text({})), null);
  });
});

describe("what an event asks for again", () => {
  const job = (id: string, state: JobUpdate["state"], done = 1): JobUpdate => ({ id, project: "a", name: "A", state, done, total: 4, createdAt: "2026-01-01T00:00:00.000Z" });
  const known = (held: { revisions?: Record<string, number | null>; jobs?: Record<string, string>; hushed?: string[] } = {}): Known => ({
    revision: (id) => held.revisions?.[id],
    job: (id) => (held.jobs?.[id] ? { state: held.jobs[id]! } : undefined),
    hushed: (id) => held.hushed?.includes(id) ?? false,
  });
  const asked = (events: LiveEvent[], cache: Known) => {
    const wants = noWants();
    for (const event of events) want(event, cache, wants);
    return { projects: wants.projects, renders: wants.renders, details: [...wants.details], revisions: [...wants.revisions], jobs: [...wants.jobs.keys()] };
  };
  const nothing = { projects: false, renders: false, details: [], revisions: [], jobs: [] };

  test("a project changed elsewhere asks for the list, its history, and its detail where it is open", () => {
    const change: LiveEvent = { type: "project", id: "a", revision: 4, actor: "mcp" };
    assert.deepEqual(asked([change], known({ revisions: { a: 3 } })), { ...nothing, projects: true, details: ["a"], revisions: ["a"] });
    // Not open: its detail is asked for when it opens anyway.
    assert.deepEqual(asked([change], known()), { ...nothing, projects: true, revisions: ["a"] });
    // From a server that counts no revisions, nothing tells the change apart from one the Studio holds.
    assert.deepEqual(asked([change], known({ revisions: { a: null } })).details, ["a"]);
  });

  test("a change the Studio saved itself, or one it holds already, asks for nothing", () => {
    assert.deepEqual(asked([{ type: "project", id: "a", revision: 4, actor: "studio" }], known({ revisions: { a: 4 } })), nothing);
    assert.deepEqual(asked([{ type: "project", id: "a", revision: 3, actor: "mcp" }], known({ revisions: { a: 4 } })), nothing);
  });

  test("a project being deleted here is left alone", () => {
    const cache = known({ revisions: { a: 3 }, hushed: ["a"] });
    assert.deepEqual(asked([{ type: "project", id: "a", revision: 4, actor: "studio" }, { type: "project-deleted", id: "a" }, { type: "assets", project: "a", kind: "shots" }], cache), nothing);
  });

  test("a project made or deleted elsewhere asks for the list, and an open page learns it is gone", () => {
    assert.deepEqual(asked([{ type: "project-created", id: "b", actor: "mcp" }], known()), { ...nothing, projects: true });
    assert.deepEqual(asked([{ type: "project-deleted", id: "a" }], known({ revisions: { a: 2 } })), { ...nothing, projects: true, details: ["a"] });
    assert.deepEqual(asked([{ type: "project-deleted", id: "b" }], known({ revisions: { a: 2 } })), { ...nothing, projects: true });
  });

  test("a screenshot or an image asks for the open project only", () => {
    assert.deepEqual(asked([{ type: "assets", project: "a", kind: "shots" }], known({ revisions: { a: 2 } })), { ...nothing, details: ["a"] });
    assert.deepEqual(asked([{ type: "assets", project: "b", kind: "images" }], known({ revisions: { a: 2 } })), nothing);
  });

  test("a render the list shows working goes on there without asking, and a new or ended one is asked for", () => {
    const cache = known({ jobs: { j1: "running", j2: "done" } });
    assert.deepEqual(asked([{ type: "job", job: job("j1", "running", 2) }], cache), { ...nothing, jobs: ["j1"] });
    assert.deepEqual(asked([{ type: "job", job: job("new", "queued") }], cache), { ...nothing, renders: true });
    // Its end is asked for, so the list has its warnings and the renders left: the progress before it is moot.
    assert.deepEqual(asked([{ type: "job", job: job("j1", "running", 3) }, { type: "job", job: job("j1", "done", 4) }], cache), { ...nothing, renders: true });
    assert.deepEqual(asked([{ type: "job", job: job("j2", "done", 4) }], cache), { ...nothing, renders: true });
  });

  test("a burst of events asks for each thing once", () => {
    const events: LiveEvent[] = [2, 3, 4, 5].map((revision) => ({ type: "project", id: "a", revision, actor: "mcp" }));
    assert.deepEqual(asked(events, known({ revisions: { a: 1 } })), { ...nothing, projects: true, details: ["a"], revisions: ["a"] });
  });
});

describe("the clock", () => {
  const ticks = (now: Parameters<typeof dueOn>[1], kind: "renders" | "projects", upTo = 60) =>
    Array.from({ length: upTo }, (_, i) => i + 1).filter((tick) => dueOn(tick, now)[kind]);

  test("without a stream, it asks as often as the Studio did before there was one", () => {
    assert.deepEqual(ticks({ live: false, seen: true, rendering: false }, "renders", 15), [5, 10, 15]);
    assert.deepEqual(ticks({ live: false, seen: true, rendering: false }, "projects", 9), [3, 6, 9]);
    assert.equal(ticks({ live: false, seen: false, rendering: true }, "renders", 10).length, 10);
    assert.deepEqual(ticks({ live: false, seen: false, rendering: false }, "renders"), []);
    assert.deepEqual(ticks({ live: false, seen: false, rendering: false }, "projects"), []);
  });

  test("with the stream, it asks only now and then, and not at all in the background", () => {
    assert.deepEqual(ticks({ live: true, seen: true, rendering: true }, "renders"), [SLOW_TICKS, SLOW_TICKS * 2]);
    assert.deepEqual(ticks({ live: true, seen: true, rendering: false }, "projects"), [SLOW_TICKS, SLOW_TICKS * 2]);
    assert.deepEqual(ticks({ live: true, seen: false, rendering: true }, "renders"), []);
  });
});
