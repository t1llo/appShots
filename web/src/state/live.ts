// What the Studio shows of the server is asked for again on one clock: the list of projects, the project that is
// open, and the renders. That way an agent working through MCP, the CLI uploading a capture and a render started
// elsewhere all show up without a reload. A stream of changes from the server can take this clock's place later.

import { type Query, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { isGone, projectsQuery } from "../api.ts";
import { rendersQuery, working } from "../renders.tsx";

const TICK_MS = 1000;

/** Projects the clock leaves alone for now, such as one being deleted, whose page would otherwise see it gone. */
const hushed = new Set<string>();

/** Stops asking for a project on the clock, and hands back how to start again. */
export function hush(id: string): () => void {
  hushed.add(id);
  return () => void hushed.delete(id);
}

/** An open project's detail, unless the project is gone: polling a deleted project would only fail again. */
const openDetail = (query: Query) => query.queryKey[0] === "project" && query.queryKey.length === 2 && !hushed.has(query.queryKey[1] as string) && !isGone(query.state.error);

/**
 * Runs the clock while the Studio is open. The renders are asked for every second while one works, even with the
 * tab in the background, so the ZIP is ready when the user comes back, and every five seconds otherwise. The
 * projects and the open project are asked for every three seconds, while the tab is looked at.
 */
export function useLiveClock(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let tick = 0;
    // A request still out is left to answer rather than asked again.
    const again = { cancelRefetch: false };
    const timer = setInterval(() => {
      tick++;
      const seen = !document.hidden;
      const rendering = queryClient.getQueryData(rendersQuery.queryKey)?.jobs.some(working) ?? false;
      if (rendering || (seen && tick % 5 === 0)) void queryClient.refetchQueries({ queryKey: rendersQuery.queryKey, type: "active" }, again);
      if (!seen || tick % 3 !== 0) return;
      void queryClient.refetchQueries({ queryKey: projectsQuery.queryKey, type: "active" }, again);
      void queryClient.refetchQueries({ predicate: openDetail, type: "active" }, again);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [queryClient]);
}
