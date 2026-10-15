// An answer to a poll can arrive after the Studio wrote newer data into the cache itself: a list of renders asked
// for before a render was started comes back without it. Every request is numbered as it goes out, and so is every
// write the Studio makes, so an answer to a request older than the last write is dropped instead of undoing it.

import { hashKey, type InferDataFromTag, type QueryClient, type QueryFunctionContext, type QueryKey, type Updater } from "@tanstack/react-query";

let sequence = 0;
const written = new Map<string, number>();

/** A query function whose answer gives way to data the Studio wrote while it was on its way. */
export function sequenced<T>(fetch: (signal: AbortSignal) => Promise<T>) {
  return async ({ client, queryKey, signal }: QueryFunctionContext): Promise<T> => {
    const asked = ++sequence;
    const answer = await fetch(signal);
    const current = client.getQueryData<T>(queryKey);
    return (written.get(hashKey(queryKey)) ?? 0) > asked && current !== undefined ? current : answer;
  };
}

/** Writes data into the cache that is newer than any answer still on its way. */
export function writeQuery<TKey extends QueryKey, TData = InferDataFromTag<unknown, TKey>>(
  client: QueryClient,
  queryKey: TKey,
  updater: Updater<NoInfer<TData> | undefined, NoInfer<TData> | undefined>,
): void {
  written.set(hashKey(queryKey), ++sequence);
  client.setQueryData<TData, TKey, TData>(queryKey, updater);
}
