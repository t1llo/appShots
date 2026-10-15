import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftStore, merge3, type Remote, SaveError, same, share } from "../../web/src/state/draft.ts";

// The Studio's draft store on its own: no browser, no server. The server is a function that answers each save the
// way the test says, and time is a clock the test moves on.

interface Slide {
  headline: string;
  layout?: string;
}
interface Doc {
  name: string;
  locales: string[];
  theme: { font?: string; accentColor?: string };
  slides: Slide[];
}

const doc = (headlines: string[], extra: Partial<Doc> = {}): Doc => ({ name: "Demo", locales: ["en"], theme: {}, slides: headlines.map((headline) => ({ headline })), ...extra });
const remote = (value: Doc, revision: number | null, second = revision ?? 0): Remote<Doc> => ({ doc: value, revision, updatedAt: `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z` });

/** Lets the promise callbacks that are due run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

interface Sent {
  changes: Partial<Doc>;
  revision: number | null;
  keepalive: boolean;
  answer: (value: Remote<Doc>) => void;
  fail: (error: unknown) => void;
}

/** A store whose saves wait in `sent` until the test answers them, and whose timers run when the test moves time on. */
function harness(initial: Remote<Doc>) {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  const sent: Sent[] = [];
  const store = new DraftStore<Doc>({
    initial,
    send: (changes, revision, keepalive) => new Promise((answer, fail) => sent.push({ changes: structuredClone(changes), revision, keepalive, answer, fail })),
    clock: () => now,
    schedule: (run, ms) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => void (timers = timers.filter((other) => other !== timer));
    },
  });
  /** Moves time on, running every timer that falls due on the way. */
  const wait = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((timer) => timer !== due);
      now = due.at;
      due.run();
      await settle();
    }
    now = until;
    await settle();
  };
  /** Answers the oldest save still waiting as a server keeping revisions would: the changes over its copy, one revision on. */
  const accept = async (over: Remote<Doc>) => {
    const save = sent.shift()!;
    const next = remote({ ...over.doc, ...save.changes }, over.revision == null ? null : over.revision + 1, (over.revision ?? 0) + 1);
    save.answer(next);
    await settle();
    return { save, next };
  };
  return { store, sent, wait, accept, typeAhead: (ms: number) => void (now += ms) };
}

const headlines = (value: Doc) => value.slides.map((slide) => slide.headline);

test("an edit is saved after a pause, with the keys it changed and the revision it was made on", async () => {
  const { store, sent, wait } = harness(remote(doc(["One", "Two"]), 4));
  store.edit((value) => void (value.slides[0]!.headline = "First"));
  assert.equal(store.getState().save.kind, "waiting");
  assert.equal(sent.length, 0, "even the first keystroke waits a moment");
  await wait(200);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]!.changes), ["slides"]);
  assert.equal(sent[0]!.revision, 4);
  assert.equal(sent[0]!.keepalive, false);
});

test("typing is saved once, after it pauses", async () => {
  const { store, sent, wait, typeAhead } = harness(remote(doc(["One"]), 1));
  for (const text of ["H", "He", "Hel", "Hell", "Hello"]) {
    store.edit((value) => void (value.slides[0]!.headline = text));
    typeAhead(100);
  }
  await wait(1000);
  assert.equal(sent.length, 1);
  assert.deepEqual(headlines(sent[0]!.changes as Doc), ["Hello"]);
});

test("a remote edit that arrives while the user types is merged in, and both reach the server", async () => {
  const { store, sent, wait, accept } = harness(remote(doc(["Hello", "Two"]), 1));
  store.edit((value) => void (value.slides[0]!.headline = "Hello world"));
  // An agent changes the second slide, and the Studio's poll brings it in before the save goes out.
  const agent = remote(doc(["Hello", "AGENT EDIT"]), 2);
  store.receive(agent);
  assert.deepEqual(headlines(store.getState().draft), ["Hello world", "AGENT EDIT"]);
  assert.deepEqual(store.getState().conflicts, []);
  await wait(500);
  assert.equal(sent[0]!.revision, 2, "saved on the revision that has the agent's edit");
  assert.deepEqual(headlines(sent[0]!.changes as Doc), ["Hello world", "AGENT EDIT"]);
  await accept(agent);
  assert.equal(store.getState().save.kind, "saved");
  assert.equal(store.dirty, false);
});

test("a save the server refuses as stale is merged with the server's copy and sent again", async () => {
  const { store, sent, wait, accept } = harness(remote(doc(["Hello", "Two"]), 1));
  store.edit((value) => void (value.slides[0]!.headline = "Hello world"));
  await wait(500);
  // The agent wrote between the Studio's last poll and its save.
  const agent = remote(doc(["Hello", "AGENT EDIT"], { theme: { font: "lora" } }), 2);
  sent.shift()!.fail(new SaveError("The project changed", 409, agent));
  await settle();
  assert.equal(sent.length, 1, "sent again at once");
  assert.equal(sent[0]!.revision, 2);
  assert.deepEqual(headlines(sent[0]!.changes as Doc), ["Hello world", "AGENT EDIT"]);
  assert.equal(sent[0]!.changes.theme, undefined, "the agent's theme is not sent back");
  const { next } = await accept(agent);
  const { draft, base, conflicts } = store.getState();
  assert.deepEqual(draft, next.doc);
  assert.equal(base.revision, 3);
  assert.deepEqual(draft.theme, { font: "lora" });
  assert.deepEqual(conflicts, []);
});

test("a field both sides changed keeps the local value and is reported", async () => {
  const { store, sent, wait, accept } = harness(remote(doc(["Hello", "Two"]), 1));
  store.edit((value) => void (value.slides[0]!.headline = "Mine"));
  const agent = remote(doc(["Theirs", "Two"], { theme: { accentColor: "#FF0000" } }), 2);
  store.receive(agent);
  const { draft, conflicts } = store.getState();
  assert.equal(draft.slides[0]!.headline, "Mine");
  assert.equal(draft.theme.accentColor, "#FF0000", "what does not conflict is still taken");
  assert.deepEqual(conflicts, [{ path: ["slides", 0, "headline"], theirs: "Theirs" }]);
  await wait(500);
  await accept(agent);
  // Taking theirs is one more edit, which is saved and can be undone.
  store.keep("theirs");
  assert.equal(store.getState().draft.slides[0]!.headline, "Theirs");
  assert.deepEqual(store.getState().conflicts, []);
  await wait(10);
  assert.deepEqual(headlines(sent[0]!.changes as Doc), ["Theirs", "Two"]);
  store.undo();
  assert.equal(store.getState().draft.slides[0]!.headline, "Mine");
});

test("a failed save is tried again, with longer waits, until it goes through", async () => {
  const { store, sent, wait, accept } = harness(remote(doc(["One"]), 1));
  store.edit((value) => void (value.slides[0]!.headline = "Two"), true);
  await wait(0);
  const flushed = store.flush();
  sent.shift()!.fail(new SaveError("Failed to fetch"));
  await settle();
  assert.equal(await flushed, false, "a flush waiting on the save learns that it failed");
  const state = store.getState().save;
  assert.equal(state.kind, "retrying");
  assert.equal(sent.length, 0);
  await wait(1000);
  assert.equal(sent.length, 1, "tried again after a second");
  sent.shift()!.fail(new SaveError("Bad gateway", 502));
  await settle();
  await wait(1999);
  assert.equal(sent.length, 0, "the second wait is longer");
  await wait(1);
  assert.equal(sent.length, 1);
  await accept(remote(doc(["One"]), 1));
  assert.equal(store.getState().save.kind, "saved");
  assert.equal(store.dirty, false);
});

test("a save the server refuses as invalid is not tried again by itself", async () => {
  const { store, sent, wait } = harness(remote(doc(["One"]), 1));
  store.edit((value) => void (value.name = ""), true);
  await wait(0);
  sent.shift()!.fail(new SaveError("Name is required", 400));
  await settle();
  assert.deepEqual(store.getState().save, { kind: "failed", error: "Name is required" });
  await wait(60_000);
  assert.equal(sent.length, 0);
  store.edit((value) => void (value.name = "Fixed"));
  await wait(500);
  assert.equal(sent.length, 1, "the next edit tries again");
});

test("a project deleted elsewhere stops saving", async () => {
  const { store, sent, wait } = harness(remote(doc(["One"]), 1));
  store.edit((value) => void (value.name = "Renamed"), true);
  await wait(0);
  sent.shift()!.fail(new SaveError('No project "demo"', 404));
  await settle();
  assert.equal(store.getState().save.kind, "gone");
  store.edit((value) => void (value.name = "Again"));
  await wait(60_000);
  assert.equal(sent.length, 0);
  assert.equal(await store.flush(), false);
});

test("undo restores the draft as it was, and redo brings the edit back", async () => {
  const { store, wait } = harness(remote(doc(["One", "Two"]), 1));
  const before = store.getState().draft;
  store.edit((value) => void value.slides.push({ headline: "Three" }), true);
  store.edit((value) => void (value.slides[0]!.headline = "First"), true);
  assert.equal(store.getState().canUndo, true);
  store.undo();
  assert.deepEqual(headlines(store.getState().draft), ["One", "Two", "Three"]);
  store.undo();
  assert.deepEqual(store.getState().draft, before);
  assert.equal(store.getState().canUndo, false);
  assert.equal(store.getState().canRedo, true);
  store.redo();
  store.redo();
  assert.deepEqual(headlines(store.getState().draft), ["First", "Two", "Three"]);
  // A new edit drops what could be redone.
  store.undo();
  store.edit((value) => void (value.name = "Other"), true);
  assert.equal(store.getState().canRedo, false);
  await wait(0);
});

test("a burst of typing is undone as one step, and the steps are capped at 100", () => {
  const { store, typeAhead } = harness(remote(doc(["One"]), 1));
  for (const text of ["T", "Ty", "Typ", "Type"]) {
    store.edit((value) => void (value.slides[0]!.headline = text));
    typeAhead(100);
  }
  store.undo();
  assert.equal(store.getState().draft.slides[0]!.headline, "One");
  for (let n = 0; n < 150; n++) store.edit((value) => void (value.name = `Name ${n}`), true);
  let steps = 0;
  while (store.getState().canUndo) {
    store.undo();
    steps++;
  }
  assert.equal(steps, 100);
  assert.equal(store.getState().draft.name, "Name 49");
});

test("undo leaves alone what someone else changed since", () => {
  const { store } = harness(remote(doc(["One", "Two"]), 1));
  store.edit((value) => void (value.slides[0]!.headline = "Mine"), true);
  store.receive(remote(doc(["One", "Agent"], { theme: { font: "lora" } }), 2));
  store.undo();
  assert.deepEqual(headlines(store.getState().draft), ["One", "Agent"]);
  assert.deepEqual(store.getState().draft.theme, { font: "lora" });
});

test("undo brings back a removed slide after someone else changed another one", async () => {
  const { store, wait, accept } = harness(remote(doc(["A", "B", "C"]), 1));
  store.edit((value) => void value.slides.splice(1, 1), true);
  await wait(0);
  const { next } = await accept(remote(doc(["A", "B", "C"]), 1));
  const agent = structuredClone(next.doc);
  agent.slides[1]!.layout = "hero";
  store.receive(remote(agent, 3));
  store.undo();
  assert.deepEqual(store.getState().draft.slides, [{ headline: "A" }, { headline: "B" }, { headline: "C", layout: "hero" }]);
  assert.deepEqual(store.getState().conflicts, []);
  store.redo();
  assert.deepEqual(store.getState().draft.slides, [{ headline: "A" }, { headline: "C", layout: "hero" }]);
});

test("undo wins where someone else changed the same field since, and what it replaced is offered back", async () => {
  const { store, sent, wait, accept } = harness(remote(doc(["One"]), 1));
  store.edit((value) => void (value.slides[0]!.headline = "Mine"), true);
  await wait(0);
  await accept(remote(doc(["One"]), 1));
  store.receive(remote(doc(["Agent"]), 3));
  store.undo();
  assert.equal(store.getState().draft.slides[0]!.headline, "One");
  assert.deepEqual(store.getState().conflicts, [{ path: ["slides", 0, "headline"], theirs: "Agent" }]);
  await wait(500);
  assert.deepEqual(headlines(sent.at(-1)!.changes as Doc), ["One"]);
  store.keep("theirs");
  assert.equal(store.getState().draft.slides[0]!.headline, "Agent");
});

test("against a server that keeps no revisions it saves without one and goes by updatedAt", async () => {
  const { store, sent, wait, accept } = harness(remote(doc(["One", "Two"]), null, 1));
  store.edit((value) => void (value.slides[0]!.headline = "Mine"));
  store.receive(remote(doc(["One", "Agent"]), null, 1));
  assert.equal(store.getState().draft.slides[1]!.headline, "Two", "a copy no newer than the base is not news");
  store.receive(remote(doc(["One", "Agent"]), null, 5));
  assert.deepEqual(headlines(store.getState().draft), ["Mine", "Agent"]);
  await wait(500);
  assert.equal(sent[0]!.revision, null);
  await accept(remote(doc(["One", "Agent"]), null, 5));
  assert.equal(store.getState().save.kind, "saved");
});

test("a copy that arrives during a save waits for it, so the save's own edit is no conflict", async () => {
  const { store, sent, wait, accept, typeAhead } = harness(remote(doc(["One"]), 1));
  store.edit((value) => void (value.slides[0]!.headline = "Hel"));
  await wait(500);
  // The user types on while the save is out, and a poll brings back the server's copy with "Hel" in it.
  store.edit((value) => void (value.slides[0]!.headline = "Hello"));
  typeAhead(10);
  store.receive(remote(doc(["Hel"]), 2));
  const { next } = await accept(remote(doc(["One"]), 1));
  assert.equal(next.revision, 2);
  assert.equal(store.getState().draft.slides[0]!.headline, "Hello");
  assert.deepEqual(store.getState().conflicts, []);
  await wait(500);
  assert.deepEqual(headlines(sent[0]!.changes as Doc), ["Hello"]);
});

test("the server's own form of what was sent is taken over without saving again", async () => {
  const { store, sent, wait } = harness(remote(doc(["One"]), 1));
  store.edit((value) => void (value.slides[0] = { headline: "One", layout: "hero" }), true);
  await wait(0);
  // The server answers with the keys in its own order and a default filled in.
  sent.shift()!.answer(remote({ ...doc([]), slides: [{ layout: "hero", headline: "One", extra: true } as Slide] }, 2));
  await settle();
  await wait(5000);
  assert.equal(sent.length, 0);
  assert.equal(store.getState().save.kind, "saved");
  assert.equal(store.dirty, false);
});

test("closing the page sends what is unsaved in a request that outlives it, and asks first when it cannot", async () => {
  const small = harness(remote(doc(["One"]), 1));
  assert.equal(small.store.unload(), "clean");
  small.store.edit((value) => void (value.name = "Renamed"));
  assert.equal(small.store.unload(), "sent");
  assert.equal(small.sent[0]!.keepalive, true);
  assert.equal(small.sent[0]!.revision, 1);
  assert.equal(small.store.unload(), "warn", "a save that is still out may not land");
  assert.equal(small.sent.length, 1, "what is on its way already is not sent again");

  // Edits too large for that go out in an ordinary save, which may still get out before the page goes.
  const large = harness(remote(doc(["One"]), 1));
  large.store.edit((value) => void (value.slides[0]!.headline = "x".repeat(70_000)));
  assert.equal(large.store.unload(), "warn");
  assert.deepEqual(large.sent.map((save) => save.keepalive), [false]);

  // The limit is on bytes: 25,000 characters of Japanese take 75,000 of them.
  const wide = harness(remote(doc(["One"]), 1));
  wide.store.edit((value) => void (value.slides[0]!.headline = "語".repeat(25_000)));
  assert.equal(wide.store.unload(), "warn");
  assert.deepEqual(wide.sent.map((save) => save.keepalive), [false]);
});

test("projects closing together share the browser's room for requests that outlive the page", () => {
  const room = { bytes: 60_000 };
  const first = harness(remote(doc(["One"]), 1));
  const second = harness(remote(doc(["One"]), 1));
  first.store.edit((value) => void (value.slides[0]!.headline = "x".repeat(35_000)));
  second.store.edit((value) => void (value.slides[0]!.headline = "y".repeat(35_000)));
  assert.equal(first.store.unload(room), "sent");
  assert.equal(second.store.unload(room), "warn");
  assert.deepEqual(second.sent.map((save) => save.keepalive), [false]);
});

test("closing the page during a save sends the newer edits beside it only where the server keeps revisions", async () => {
  for (const revision of [1, null]) {
    const { store, sent, wait } = harness(remote(doc(["One"]), revision, 1));
    store.edit((value) => void (value.name = "Renamed"), true);
    await wait(0);
    store.edit((value) => void (value.name = "Renamed again"));
    assert.equal(store.unload(), "warn");
    if (revision == null) {
      // An older save that lands after the newer one would put its values back, and nothing on the server stops it.
      assert.equal(sent.length, 1);
    } else {
      // That older save is refused if the newer one lands first, since it was made on the revision before.
      assert.equal(sent.length, 2);
      assert.deepEqual(sent[1]!.changes, { name: "Renamed again" });
      assert.equal(sent[1]!.revision, null);
      assert.equal(sent[1]!.keepalive, true);
    }
  }
});

test("a save the browser drops as the page closes may still land, so without revisions nothing goes out after it", async () => {
  for (const revision of [1, null]) {
    const { store, sent, wait } = harness(remote(doc(["One"]), revision, 1));
    store.edit((value) => void (value.name = "Renamed"), true);
    await wait(0);
    store.edit((value) => void (value.name = "Renamed again"));
    // The page asks before it closes, then drops the save under way, which the server may have had already, and
    // saves what it can once more as it goes.
    assert.equal(store.unload(), "warn");
    sent.shift()!.fail(new SaveError("Failed to fetch"));
    await settle();
    assert.equal(store.unload(), "warn");
    if (revision == null) assert.equal(sent.length, 0);
    else assert.deepEqual(sent.map((save) => [save.changes.name, save.revision, save.keepalive]), [["Renamed again", null, true]], "sent once, beside it");
  }
  // The browser drops even a request that outlives the page as far as the page can tell, and it is not sent twice.
  const { store, sent } = harness(remote(doc(["One"]), 1));
  store.edit((value) => void (value.name = "Renamed"));
  assert.equal(store.unload(), "sent");
  sent.shift()!.fail(new SaveError("Failed to fetch"));
  await settle();
  assert.equal(store.unload(), "warn");
  assert.equal(sent.length, 0);
});

test("a save that failed before the page began to close is tried once more as it closes", async () => {
  const { store, sent, wait } = harness(remote(doc(["One"]), null, 1));
  store.edit((value) => void (value.name = "Renamed"), true);
  await wait(0);
  sent.shift()!.fail(new SaveError("Failed to fetch"));
  await settle();
  assert.equal(store.unload(), "warn");
  assert.deepEqual(sent.map((save) => [save.changes.name, save.keepalive]), [["Renamed", true]]);
});

test("lists merge by index while both sides only change items in place or add at the end", () => {
  const base = { slides: [{ headline: "A" }, { headline: "B" }] };
  const theirs = { slides: [{ headline: "A" }, { headline: "B" }, { headline: "Theirs" }] };
  assert.deepEqual(merge3(base, { slides: [{ headline: "A!" }, { headline: "B" }] }, theirs), { slides: [{ headline: "A!" }, { headline: "B" }, { headline: "Theirs" }] });
  assert.deepEqual(merge3(base, { slides: [{ headline: "A" }, { headline: "B" }, { headline: "Mine" }] }, theirs), { slides: [{ headline: "A" }, { headline: "B" }, { headline: "Mine" }, { headline: "Theirs" }] });
  // Where both sides inserted, removed or moved items, no order is right: the whole list is a conflict, and ours stays.
  const conflicts: { path: (string | number)[]; theirs: unknown }[] = [];
  const shifted = { slides: [{ headline: "New" }, { headline: "A" }, { headline: "B" }] };
  assert.deepEqual(merge3(base, { slides: [{ headline: "B" }, { headline: "A" }] }, shifted, [], conflicts), { slides: [{ headline: "B" }, { headline: "A" }] });
  assert.deepEqual(conflicts, [{ path: ["slides"], theirs: shifted.slides }]);
});

test("a list one side rearranged keeps the other side's changes to the items it kept", () => {
  const base = { slides: [{ headline: "A" }, { headline: "B" }, { headline: "C" }] };
  const removed = { slides: [{ headline: "A" }, { headline: "C" }] };
  const edited = { slides: [{ headline: "A" }, { headline: "B" }, { headline: "C", layout: "hero" }] };
  const conflicts: { path: (string | number)[]; theirs: unknown }[] = [];
  assert.deepEqual(merge3(base, removed, edited, [], conflicts), { slides: [{ headline: "A" }, { headline: "C", layout: "hero" }] });
  // An insert in front, against a change in place.
  const shifted = { slides: [{ headline: "New" }, ...base.slides] };
  assert.deepEqual(merge3(base, edited, shifted, [], conflicts), { slides: [{ headline: "New" }, ...edited.slides] });
  // Moving a slide swaps it with its neighbour. That keeps the length, but is no change in place: the other side's
  // change goes with the slide that moved, not to the one now at its index.
  const inPlace = { slides: [{ headline: "A" }, { headline: "B", layout: "hero" }, { headline: "C" }] };
  assert.deepEqual(merge3(base, { slides: [{ headline: "B" }, { headline: "A" }, { headline: "C" }] }, inPlace, [], conflicts), {
    slides: [{ headline: "B", layout: "hero" }, { headline: "A" }, { headline: "C" }],
  });
  // An item changed in the same go counts as the old one removed and a new one put in.
  const moved = { slides: [{ headline: "C" }, { headline: "A!" }, { headline: "B" }] };
  assert.deepEqual(merge3(base, inPlace, moved, [], conflicts), { slides: [{ headline: "C" }, { headline: "A!" }, { headline: "B", layout: "hero" }] });
  assert.deepEqual(conflicts, []);
  // A copy added at the end is not taken for an item the list already has.
  assert.deepEqual(merge3(base, removed, { slides: [...base.slides, { headline: "A" }] }), { slides: [{ headline: "A" }, { headline: "C" }, { headline: "A" }] });
  assert.deepEqual(merge3({ locales: ["en", "de"] }, { locales: ["en"] }, { locales: ["en", "de", "fr"] }), { locales: ["en", "fr"] });
  // A change to an item the other side removed cannot go anywhere: the whole list is a conflict, and ours stays.
  const gone = { slides: [{ headline: "A" }, { headline: "B!" }, { headline: "C" }] };
  assert.deepEqual(merge3(base, removed, gone, [], conflicts), removed);
  assert.deepEqual(conflicts, [{ path: ["slides"], theirs: gone.slides }]);
});

test("equal values are equal whatever their key order, and unchanged parts keep their identity", () => {
  assert.equal(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
  assert.equal(same({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(same({ a: null }, { a: undefined }), false);
  assert.equal(same([1, 2], [2, 1]), false);
  const prev = { slides: [{ headline: "A" }, { headline: "B" }], theme: { font: "inter" } };
  const next = structuredClone(prev);
  next.slides[1]!.headline = "B!";
  const shared = share(prev, next);
  assert.notEqual(shared, prev);
  assert.equal(shared.slides[0], prev.slides[0]);
  assert.notEqual(shared.slides[1], prev.slides[1]);
  assert.equal(shared.theme, prev.theme);
  assert.equal(share(prev, structuredClone(prev)), prev);
});
