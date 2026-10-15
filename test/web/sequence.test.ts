import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { sequenced, writeQuery } from "../../web/src/state/sequence.ts";

// A poll that was sent before the Studio wrote into the cache must not take that write back.

test("an answer older than a write is dropped, and a newer one is kept", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["renders"];
  let answer!: (list: string[]) => void;
  const queryFn = sequenced(() => new Promise<string[]>((resolve) => (answer = resolve)));

  const polled = client.fetchQuery({ queryKey: key, queryFn });
  // Started a render while the poll was out: the Studio put it in the list itself.
  writeQuery<string[]>(client, key, ["started"]);
  answer([]);
  assert.deepEqual(await polled, ["started"]);
  assert.deepEqual(client.getQueryData(key), ["started"]);

  const next = client.fetchQuery({ queryKey: key, queryFn, staleTime: 0 });
  answer(["started", "another"]);
  assert.deepEqual(await next, ["started", "another"]);
  client.clear();
});
