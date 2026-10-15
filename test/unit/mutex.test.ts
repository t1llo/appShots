import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { createMutex } from "../../src/storage/mutex.ts";

test("work for one key runs one at a time, in order", async () => {
  const withLock = createMutex();
  const seen: string[] = [];
  await Promise.all(
    [30, 10, 0].map((ms, i) =>
      withLock("a", async () => {
        seen.push(`start ${i}`);
        await sleep(ms);
        seen.push(`end ${i}`);
      }),
    ),
  );
  assert.deepEqual(seen, ["start 0", "end 0", "start 1", "end 1", "start 2", "end 2"]);
});

test("work for different keys runs side by side", async () => {
  const withLock = createMutex();
  let running = 0;
  let most = 0;
  await Promise.all(
    ["a", "b", "c"].map((key) =>
      withLock(key, async () => {
        most = Math.max(most, ++running);
        await sleep(10);
        running--;
      }),
    ),
  );
  assert.equal(most, 3);
});

test("a failure reaches its caller and does not stop the work behind it", async () => {
  const withLock = createMutex();
  const failed = withLock("a", () => {
    throw new Error("refused");
  });
  const next = withLock("a", () => "ran");
  await assert.rejects(failed, /refused/);
  assert.equal(await next, "ran");
});

test("read-modify-write under the lock loses no update", async () => {
  const withLock = createMutex();
  let value = 0;
  await Promise.all(
    Array.from({ length: 100 }, () =>
      withLock("counter", async () => {
        const read = value;
        await sleep(0);
        value = read + 1;
      }),
    ),
  );
  assert.equal(value, 100);
});
