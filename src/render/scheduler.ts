import { UnavailableError } from "../store.ts";

/**
 * Who draws when. Renders and mockups wait in lanes of their own, so a free mockup never waits behind a paid render.
 * Within a lane every account takes its turn: one with several runs queued does not hold up another's first.
 */
export type Lane = "render" | "mockup";

interface LaneState {
  limit: number;
  running: number;
  /** What each account has waiting, in the order it was asked for. */
  queues: Map<string, (() => void)[]>;
  /** The accounts with something waiting, the next to go first. */
  turn: string[];
}

export interface QueueStats {
  running: number;
  waiting: number;
}

export function createScheduler(limits: Record<Lane, number>) {
  const lanes = {
    render: { limit: limits.render, running: 0, queues: new Map(), turn: [] },
    mockup: { limit: limits.mockup, running: 0, queues: new Map(), turn: [] },
  } satisfies Record<Lane, LaneState>;
  let accepting = true;
  const idlers = new Set<() => void>();
  const idle = () => Object.values(lanes).every((lane) => lane.running === 0 && lane.turn.length === 0);

  function next(lane: LaneState): void {
    while (lane.running < lane.limit && lane.turn.length > 0) {
      const space = lane.turn.shift()!;
      const queue = lane.queues.get(space)!;
      const start = queue.shift()!;
      if (queue.length > 0) lane.turn.push(space);
      else lane.queues.delete(space);
      lane.running++;
      start();
    }
    if (idle()) for (const wake of idlers) wake();
  }

  return {
    /** Runs work in its lane once it is the account's turn and a place is free, and settles as the work does. */
    schedule<T>(lane: Lane, space: string, work: () => Promise<T>): Promise<T> {
      if (!accepting) return Promise.reject(new UnavailableError("The server is shutting down. Try again in a minute."));
      const state: LaneState = lanes[lane];
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          Promise.resolve()
            .then(work)
            .then(resolve, reject)
            .finally(() => {
              state.running--;
              next(state);
            });
        };
        const queue = state.queues.get(space);
        if (queue) queue.push(start);
        else {
          state.queues.set(space, [start]);
          state.turn.push(space);
        }
        next(state);
      });
    },

    /** How busy each lane is. */
    queueStats(): Record<Lane, QueueStats> {
      const stats = (lane: LaneState) => ({ running: lane.running, waiting: [...lane.queues.values()].reduce((sum, queue) => sum + queue.length, 0) });
      return { render: stats(lanes.render), mockup: stats(lanes.mockup) };
    },

    /** Takes no more work, and waits up to `timeoutMs` for what is queued and running. True when all of it finished. */
    drain(timeoutMs: number): Promise<boolean> {
      accepting = false;
      if (idle()) return Promise.resolve(true);
      return new Promise((resolve) => {
        const done = (finished: boolean) => {
          clearTimeout(timer);
          idlers.delete(wake);
          resolve(finished);
        };
        const wake = () => done(true);
        const timer = setTimeout(() => done(false), timeoutMs);
        idlers.add(wake);
      });
    },
  };
}
