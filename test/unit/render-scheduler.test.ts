import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createScheduler } from "../../src/render/scheduler.ts";

// Who draws when: renders and mockups in lanes of their own, every account in turn, and a way to stop taking work.

test("accounts take turns: one with several runs waiting does not hold up another's first", async () => {
  const scheduler = createScheduler({ render: 1, mockup: 1 });
  const order: string[] = [];
  const run = (space: string, label: string) =>
    scheduler.schedule("render", space, async () => {
      order.push(label);
      await sleep(5);
    });
  await Promise.all([run("a", "a1"), run("a", "a2"), run("a", "a3"), run("b", "b1"), run("c", "c1"), run("b", "b2")]);
  assert.deepEqual(order, ["a1", "a2", "b1", "c1", "a3", "b2"]);
});

test("a mockup does not wait behind a render, and a lane runs no more than its limit", async () => {
  const scheduler = createScheduler({ render: 2, mockup: 1 });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let most = 0;
  let running = 0;
  const render = () =>
    scheduler.schedule("render", "a", async () => {
      most = Math.max(most, ++running);
      await blocked;
      running--;
    });
  const renders = [render(), render(), render()];
  await sleep(5);
  assert.deepEqual(scheduler.queueStats().render, { running: 2, waiting: 1 });
  assert.equal(await scheduler.schedule("mockup", "a", async () => "drawn"), "drawn");
  release();
  await Promise.all(renders);
  assert.equal(most, 2);
});

test("a failure settles its own run only", async () => {
  const scheduler = createScheduler({ render: 1, mockup: 1 });
  const failed = scheduler.schedule("render", "a", async () => {
    throw new Error("broken");
  });
  const next = scheduler.schedule("render", "a", async () => "fine");
  await assert.rejects(failed, /broken/);
  assert.equal(await next, "fine");
});

test("drain takes no more work and waits for what is queued", async () => {
  const scheduler = createScheduler({ render: 1, mockup: 1 });
  const done: string[] = [];
  const queued = ["one", "two"].map((label) =>
    scheduler.schedule("render", "a", async () => {
      await sleep(10);
      done.push(label);
    }),
  );
  const drained = scheduler.drain(5000);
  await assert.rejects(
    scheduler.schedule("mockup", "a", async () => {}),
    /shutting down/,
  );
  assert.equal(await drained, true);
  assert.deepEqual(done, ["one", "two"]);
  await Promise.all(queued);
});

test("drain gives up after its time", async () => {
  const scheduler = createScheduler({ render: 1, mockup: 1 });
  let release!: () => void;
  const stuck = scheduler.schedule("render", "a", () => new Promise<void>((resolve) => (release = resolve)));
  assert.equal(await scheduler.drain(20), false);
  release();
  await stuck;
  // With nothing left, it answers at once.
  assert.equal(await scheduler.drain(20), true);
});
