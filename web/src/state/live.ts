// What the Studio shows of the server stays current without a reload: the list of projects, the project that is
// open, and the renders, whether an agent changes them through MCP, the CLI uploads a capture or a render was started
// elsewhere. The server tells of each change over GET /api/events, and only what a change names is asked for again.
// A clock asks for everything shown as well: seldom while the stream works, and as often as before there was a stream
// while it does not, such as on a server from before it. The decisions themselves are in stream.ts.

import { type Query, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { type Detail, detailQuery, isGone, projectsQuery, type RenderJob, revisionOf, revisionsQuery } from "../api.ts";
import { rendersQuery, working } from "../renders.tsx";
import { writeQuery } from "./sequence.ts";
import { dueOn, type Known, LiveLink, type LiveEvent, noWants, type Wants, want } from "./stream.ts";

const TICK_MS = 1000;
/** Events are looked at together after this long, so a burst of them asks for each thing once. */
const BATCH_MS = 150;
/** A tab nobody has looked at for this long closes its stream, unless a render works: a browser lets a site keep only a few connections open. */
const IDLE_MS = 60_000;

/** Projects the clock leaves alone for now, such as one being deleted, whose page would otherwise see it gone. */
const hushed = new Set<string>();

/** Stops asking for a project on the clock, and hands back how to start again. */
export function hush(id: string): () => void {
  hushed.add(id);
  return () => void hushed.delete(id);
}

/** An open project's detail, unless the project is gone: polling a deleted project would only fail again. */
const openDetail = (query: Query) => query.queryKey[0] === "project" && query.queryKey.length === 2 && !hushed.has(query.queryKey[1] as string) && !isGone(query.state.error);

/** What the cache holds, as the events are looked at. */
function knownIn(queryClient: QueryClient): Known {
  return {
    revision(id) {
      const query = queryClient.getQueryCache().find<Detail>({ queryKey: detailQuery(id).queryKey, exact: true });
      if (!query || isGone(query.state.error)) return undefined;
      return query.state.data ? revisionOf(query.state.data) : null;
    },
    job: (id) => queryClient.getQueryData(rendersQuery.queryKey)?.jobs.find((job) => job.id === id),
    hushed: (id) => hushed.has(id),
  };
}

function act(queryClient: QueryClient, wants: Wants): void {
  if (wants.jobs.size) {
    const told = (job: RenderJob) => {
      const update = wants.jobs.get(job.id);
      return update ? { ...job, ...update } : job;
    };
    writeQuery(queryClient, rendersQuery.queryKey, (current) => current && { ...current, jobs: current.jobs.map(told) });
  }
  if (wants.renders) void queryClient.invalidateQueries({ queryKey: rendersQuery.queryKey, exact: true });
  if (wants.projects) void queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey, exact: true });
  for (const id of wants.details) void queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey, exact: true });
  for (const id of wants.revisions) void queryClient.invalidateQueries({ queryKey: revisionsQuery(id).queryKey, exact: true });
}

/** Everything shown, asked for again after the stream was not heard for a while. */
function resync(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: rendersQuery.queryKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey, exact: true });
  void queryClient.invalidateQueries({ predicate: openDetail });
}

/** Keeps what the Studio shows current while it is open: the stream of the server's changes, and the clock. */
export function useLive(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let pending: LiveEvent[] = [];
    let batch: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      batch = undefined;
      // Looked at only now, so a change the Studio saved itself is in the cache at its revision and is not asked for.
      const known = knownIn(queryClient);
      const wants = noWants();
      for (const event of pending.splice(0)) want(event, known, wants);
      act(queryClient, wants);
    };
    const link = new LiveLink({
      connect: () => new EventSource("/api/events"),
      onEvent(event) {
        pending.push(event);
        batch ??= setTimeout(flush, BATCH_MS);
      },
      onResync: () => resync(queryClient),
    });
    const streams = typeof EventSource === "function";

    let hiddenSince = document.hidden ? Date.now() : 0;
    const shown = () => {
      if (document.hidden) return void (hiddenSince ||= Date.now());
      hiddenSince = 0;
      if (streams) link.start();
    };
    shown();
    document.addEventListener("visibilitychange", shown);

    let tick = 0;
    // A request still out is left to answer rather than asked again.
    const again = { cancelRefetch: false };
    const timer = setInterval(() => {
      tick++;
      const seen = !document.hidden;
      const rendering = queryClient.getQueryData(rendersQuery.queryKey)?.jobs.some(working) ?? false;
      if (streams && hiddenSince && !rendering && Date.now() - hiddenSince >= IDLE_MS) link.stop();
      const due = dueOn(tick, { live: link.state === "live", seen, rendering });
      if (due.renders) void queryClient.refetchQueries({ queryKey: rendersQuery.queryKey, type: "active" }, again);
      if (!due.projects) return;
      void queryClient.refetchQueries({ queryKey: projectsQuery.queryKey, type: "active" }, again);
      void queryClient.refetchQueries({ predicate: openDetail, type: "active" }, again);
    }, TICK_MS);

    return () => {
      clearInterval(timer);
      clearTimeout(batch);
      document.removeEventListener("visibilitychange", shown);
      link.stop();
      pending = [];
    };
  }, [queryClient]);
}
