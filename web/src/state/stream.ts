// The Studio hears of what changes on the server over one stream of events, GET /api/events, and asks for things
// again on a clock only to catch what the stream may have missed, or in its place where there is no stream: a server
// from before it, a proxy that holds it back, or one tab too many. This is the part without React or the browser:
// when the stream counts as working and when it is tried again, what each event asks for again, and what the clock
// asks for when.

/** A render as the stream tells of it: the fields the list of renders shows. */
export interface JobUpdate {
  id: string;
  project: string;
  name: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  files?: number;
  error?: string;
}

/** What GET /api/events sends, besides `ready`. */
export type LiveEvent =
  | { type: "project"; id: string; revision: number; actor: string }
  | { type: "project-created"; id: string; actor: string }
  | { type: "project-deleted"; id: string }
  | { type: "assets"; project: string; kind: "shots" | "images" }
  | { type: "job"; job: JobUpdate };

export const EVENT_TYPES = ["project", "project-created", "project-deleted", "assets", "job"] as const;

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

/** An event as the stream sent it, or null for one this Studio does not know or that is not whole. */
export function parseEvent(type: string, data: unknown): LiveEvent | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(String(data));
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  if (type === "project") return isText(body.id) && typeof body.revision === "number" ? { type, id: body.id, revision: body.revision, actor: String(body.actor ?? "") } : null;
  if (type === "project-created") return isText(body.id) ? { type, id: body.id, actor: String(body.actor ?? "") } : null;
  if (type === "project-deleted") return isText(body.id) ? { type, id: body.id } : null;
  if (type === "assets") return isText(body.project) && (body.kind === "shots" || body.kind === "images") ? { type, project: body.project, kind: body.kind } : null;
  if (type === "job") return isText(body.id) && isText(body.project) && isText(body.state) && typeof body.done === "number" ? { type, job: body as unknown as JobUpdate } : null;
  return null;
}

// ---------------------------------------------------------------- what an event asks for

/** What the Studio holds, as far as deciding what to ask for again goes. */
export interface Known {
  /** The revision of the project's detail it holds: undefined when it holds none, null from a server that counts none. */
  revision(id: string): number | null | undefined;
  /** The render as its list of renders has it. */
  job(id: string): { state: string } | undefined;
  /** Projects it leaves alone for now, such as one it is deleting itself. */
  hushed(id: string): boolean;
}

/** What to ask the server for again, gathered over a few events. */
export interface Wants {
  projects: boolean;
  renders: boolean;
  /** Projects whose detail is asked for again. */
  details: Set<string>;
  /** Projects whose list of revisions is asked for again. */
  revisions: Set<string>;
  /** Renders under way whose progress is put in the list as it is, without asking. */
  jobs: Map<string, JobUpdate>;
}

export const noWants = (): Wants => ({ projects: false, renders: false, details: new Set(), revisions: new Set(), jobs: new Map() });

const working = (state: string) => state === "queued" || state === "running";

/**
 * Adds what an event asks for to `wants`. Only what it names is asked for, and nothing the Studio holds already:
 * a project's change it saved itself is in its hands at that revision by the time the event is looked at.
 */
export function want(event: LiveEvent, known: Known, wants: Wants = noWants()): Wants {
  switch (event.type) {
    case "project": {
      if (known.hushed(event.id)) break;
      const held = known.revision(event.id);
      if (typeof held === "number" && held >= event.revision) break;
      wants.projects = true;
      wants.revisions.add(event.id);
      if (held !== undefined) wants.details.add(event.id);
      break;
    }
    case "project-created":
      wants.projects = true;
      break;
    case "project-deleted":
      if (known.hushed(event.id)) break;
      wants.projects = true;
      // Its page, if it is open, learns that it is gone and closes.
      if (known.revision(event.id) !== undefined) wants.details.add(event.id);
      break;
    case "assets":
      if (!known.hushed(event.project) && known.revision(event.project) !== undefined) wants.details.add(event.project);
      break;
    case "job": {
      const held = known.job(event.job.id);
      // A render the list shows working goes on there as it is told. One that is new or has ended is asked for: the
      // list then has its warnings and the renders left, and says that it ended.
      if (held && working(held.state) && working(event.job.state)) wants.jobs.set(event.job.id, event.job);
      else {
        wants.jobs.delete(event.job.id);
        wants.renders = true;
      }
      break;
    }
  }
  return wants;
}

// ---------------------------------------------------------------- the clock

/** How often the clock asks for everything shown while the stream works, in ticks of a second. */
export const SLOW_TICKS = 30;

/**
 * What the clock, which ticks once a second, asks for again on this tick. Without a working stream it is what the
 * Studio did before there was one: the renders every second while one works, even with the tab in the background,
 * so the ZIP is ready when the user comes back, and every five seconds otherwise; the projects and the open project
 * every three seconds, while the tab is looked at. With the stream, every half minute while the tab is looked at.
 */
export function dueOn(tick: number, now: { live: boolean; seen: boolean; rendering: boolean }): { renders: boolean; projects: boolean } {
  if (now.live) {
    const due = now.seen && tick % SLOW_TICKS === 0;
    return { renders: due, projects: due };
  }
  return { renders: now.rendering || (now.seen && tick % 5 === 0), projects: now.seen && tick % 3 === 0 };
}

// ---------------------------------------------------------------- the stream

/** The part of EventSource the link uses, so that a test can stand in for it. */
export interface Source {
  /** 0 while it connects, 1 while it is open, 2 once it has given up, as EventSource counts. */
  readonly readyState: number;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** off: not wanted, such as in a tab nobody looks at. connecting: opened, not ready yet. live: working. down: waits to be tried again. */
export type LinkState = "off" | "connecting" | "live" | "down";

/** How long `ready` may take to come before the stream counts as not working. */
export const READY_MS = 10_000;
/** A stream that keeps dropping is tried again by the link, with a pause that grows, instead of by the browser. */
const DROPS = 3;

/** How long to wait before trying a stream again that failed `failures` times in a row: 5 s, doubled each time, up to 5 min. */
export const backoff = (failures: number): number => Math.min(300_000, 5000 * 2 ** Math.max(0, failures - 1));

export interface LinkOptions {
  connect(): Source;
  onEvent(event: LiveEvent): void;
  /**
   * The stream works after a time it did not: what changed meanwhile went unheard, so what is shown is asked for
   * again. Not for the first stream of all, opened as the Studio asks for what it shows.
   */
  onResync(): void;
  onState?(state: LinkState): void;
  timers?: Timers;
}

/** One stream of events, opened again when it drops, and given up on for a while when it does not work. */
export class LiveLink {
  readonly #options: LinkOptions;
  readonly #timers: Timers;
  #source: Source | null = null;
  #state: LinkState = "off";
  /** Times in a row the stream did not work, which the pause before the next try grows with. */
  #failures = 0;
  /** Drops of the open stream since it was last ready, which the browser opens again by itself. */
  #drops = 0;
  /** Whether changes may have gone unheard since the stream was last ready: it dropped, failed or was stopped. */
  #missed = false;
  #timer: unknown = null;

  constructor(options: LinkOptions) {
    this.#options = options;
    this.#timers = options.timers ?? { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  }

  get state(): LinkState {
    return this.#state;
  }

  /** Opens the stream, unless it is open or waits to be tried again already. */
  start(): void {
    if (this.#state === "off") this.#open();
  }

  /** Closes the stream and stops trying it. */
  stop(): void {
    this.#close();
    if (this.#state !== "off") this.#missed = true;
    this.#set("off");
  }

  #set(state: LinkState): void {
    if (state === this.#state) return;
    this.#state = state;
    this.#options.onState?.(state);
  }

  #wait(run: () => void, ms: number): void {
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = this.#timers.set(() => {
      this.#timer = null;
      run();
    }, ms);
  }

  #close(): void {
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
    this.#source?.close();
    this.#source = null;
  }

  #open(): void {
    this.#close();
    this.#drops = 0;
    const source = this.#options.connect();
    this.#source = source;
    this.#set("connecting");
    const mine = (run: () => void) => () => {
      if (this.#source === source) run();
    };
    source.addEventListener("ready", mine(() => this.#ready()));
    source.addEventListener("error", mine(() => this.#error(source)));
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, ({ data }) => {
        if (this.#source !== source) return;
        const event = parseEvent(type, data);
        if (event) this.#options.onEvent(event);
      });
    }
    this.#wait(() => this.#fail(), READY_MS);
  }

  #ready(): void {
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
    this.#failures = 0;
    this.#drops = 0;
    this.#set("live");
    if (this.#missed) this.#options.onResync();
    this.#missed = false;
  }

  #error(source: Source): void {
    this.#missed = true;
    // Given up on by the browser, such as for a 404 from an older server, a 401 or a 429: tried again later.
    if (source.readyState === 2 || ++this.#drops >= DROPS) return this.#fail();
    // Dropped and being opened again by the browser. Until it is ready, nothing is heard, and the clock asks instead.
    this.#set("down");
    this.#wait(() => this.#fail(), READY_MS);
  }

  #fail(): void {
    this.#missed = true;
    this.#close();
    this.#failures++;
    this.#set("down");
    this.#wait(() => this.#open(), backoff(this.#failures));
  }
}
