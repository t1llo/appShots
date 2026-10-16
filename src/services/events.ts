import type { RenderJob } from "../render/jobs.ts";

// What changes in an account is told to whoever follows it, such as the Studio's open tabs over GET /api/events, so
// they ask for what changed instead of asking for everything on a clock. The project repository, the render runs
// and the lifecycle of projects publish here as they change something, and each event goes to the followers of the
// space it happened in, to no other. Nothing is kept: a follower that was away asks for everything again.

/** A render as its events carry it: what the list of renders shows. Its warnings come with GET /api/renders/:job. */
export type JobEvent = Pick<RenderJob, "id" | "project" | "name" | "state" | "done" | "total" | "createdAt" | "startedAt" | "finishedAt" | "files" | "error">;

export type SpaceEvent =
  /** A change to a project was saved as `revision`, by `actor`: studio, api or mcp. */
  | { type: "project"; id: string; revision: number; actor: string }
  /** A project was made, or moved into the space by the admin, whose `actor` is then admin. */
  | { type: "project-created"; id: string; actor: string }
  /** A project was deleted, or moved out of the space. */
  | { type: "project-deleted"; id: string }
  /** Screenshots or images of a project were uploaded, refiled or deleted. They have no revision of their own. */
  | { type: "assets"; project: string; kind: "shots" | "images" }
  /** A render was queued, started, drew pictures, or ended. */
  | ({ type: "job" } & JobEvent);

/** One follower of a space, such as an open stream. */
export interface Follower {
  /** An event of its space. */
  send(event: SpaceEvent): void;
  /** Sign-ins may have ended: a session signed out, a token revoked, an account removed. Whether its own holds is for it to check. */
  recheck?(): void;
  /** The server stops. */
  end?(): void;
}

export function createEventBus(options: { log?: (message: string) => void } = {}) {
  const log = options.log ?? ((message: string) => console.warn(message));
  const spaces = new Map<string, Set<Follower>>();

  /** Calls every follower given. One that throws must not keep the event from the others, nor the change it tells of from being made. */
  function each(followers: Iterable<Follower>, call: (follower: Follower) => void): void {
    // A copy: a follower may stop following while it is called, such as a stream that finds its sign-in gone.
    for (const follower of [...followers]) {
      try {
        call(follower);
      } catch (error) {
        log(`Could not tell a follower of a change: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const everyone = () => [...spaces.values()].flatMap((followers) => [...followers]);

  return {
    /** Follows the events of a space until the function it returns is called. */
    follow(space: string, follower: Follower): () => void {
      let followers = spaces.get(space);
      if (!followers) spaces.set(space, (followers = new Set()));
      followers.add(follower);
      return () => {
        followers.delete(follower);
        if (followers.size === 0 && spaces.get(space) === followers) spaces.delete(space);
      };
    },

    /** Tells the followers of a space, and nobody else, that something in it changed. */
    publish(space: string, event: SpaceEvent): void {
      const followers = spaces.get(space);
      if (followers) each(followers, (follower) => follower.send(event));
    },

    /** How many follow a space now. */
    followers: (space: string): number => spaces.get(space)?.size ?? 0,

    /** Has every follower check its sign-in again, after one may have ended. */
    recheck(): void {
      each(everyone(), (follower) => follower.recheck?.());
    },

    /** Ends every follower, as the server stops: an open stream would keep it from closing. */
    endAll(): void {
      each(everyone(), (follower) => follower.end?.());
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;

/** The bus the server publishes on. */
export const events = createEventBus();

/** A render as its events carry it. */
export function jobEvent(job: RenderJob): SpaceEvent {
  const { id, project, name, state, done, total, createdAt, startedAt, finishedAt, files, error } = job;
  return { type: "job", id, project, name, state, done, total, createdAt, ...(startedAt ? { startedAt } : {}), ...(finishedAt ? { finishedAt } : {}), ...(files != null ? { files } : {}), ...(error ? { error } : {}) };
}
