// The document the Studio edits, kept apart from React and the network so it can be tested on its own.
//
// `base` is the copy the server last confirmed, with its revision where the server keeps one, and `draft` is what
// the Studio shows. An edit changes the draft and saves after a pause. A save sends only the top-level keys that
// differ from the base, with the base's revision, so the server can refuse it when someone else wrote in between.
// A refused save, and every newer copy that arrives, is merged three ways against the base: per key, per list
// index, down to single fields. Where both sides changed the same field, the local value stays and the conflict is
// reported, so nothing is dropped without a word either way.

export type Path = (string | number)[];

/** A field both sides changed: the draft keeps its own value, and this is the one it kept out. */
export interface Conflict {
  path: Path;
  theirs: unknown;
}

/** A copy of the document as the server has it. A server that keeps no revisions is told apart by its updatedAt. */
export interface Remote<D> {
  doc: D;
  revision: number | null;
  updatedAt: string;
}

export type SaveState =
  | { kind: "saved" }
  /** Edits wait for a pause in typing. */
  | { kind: "waiting" }
  | { kind: "saving" }
  /** The server could not be reached or had a fault, and the save is tried again at `retryAt`. */
  | { kind: "retrying"; error: string; retryAt: number }
  /** The server refused the edits, and they stay unsaved until the next edit or retry(). */
  | { kind: "failed"; error: string }
  /** The project no longer exists. */
  | { kind: "gone"; error: string };

export interface DraftState<D> {
  draft: D;
  base: Remote<D>;
  save: SaveState;
  conflicts: Conflict[];
  canUndo: boolean;
  canRedo: boolean;
}

/** How a save fails: with the HTTP status where the server answered, and on a 409 with the copy it has now. */
export class SaveError<D = unknown> extends Error {
  readonly status: number | undefined;
  readonly remote: Remote<D> | undefined;
  constructor(message: string, status?: number, remote?: Remote<D>) {
    super(message);
    this.status = status;
    this.remote = remote;
  }
}

export interface DraftOptions<D> {
  initial: Remote<D>;
  /** Sends the changed keys, with the revision they were made on where there is one, and answers with the server's new copy. */
  send: (changes: Partial<D>, revision: number | null, keepalive: boolean) => Promise<Remote<D>>;
  /** How long an edit waits before it is saved: after a pause, and while typing goes on. */
  wait?: { first: number; typing: number };
  /** How long a failed save waits before each new try. The last one repeats. */
  retry?: number[];
  schedule?: (run: () => void, ms: number) => () => void;
  clock?: () => number;
}

/** Edits closer together than this are typing: they are saved after the pause and undone as one step. */
const TYPING_MS = 600;
const UNDO_LIMIT = 100;
/** Browsers refuse a keepalive request whose body is over 64 KiB. */
const KEEPALIVE_LIMIT = 60_000;
/** Refusals in a row that are merged and sent again at once, before the store backs off like any failure. */
const REFUSALS = 5;

interface Step<D> {
  before: D;
  after: D;
  /** Typing goes on into the same step until it pauses. */
  open: boolean;
}

type Waiter = (saved: boolean) => void;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const definedKeys = (value: Record<string, unknown>) => Object.keys(value).filter((key) => value[key] !== undefined);

/** Whether two JSON values are equal. Key order and keys set to undefined do not count, as they do not in JSON. */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const left = definedKeys(a);
  return left.length === definedKeys(b).length && left.every((key) => same(a[key], b[key]));
}

/**
 * `next`, with every part that equals the same part of `prev` replaced by prev's. Unchanged slides keep their
 * identity across an edit, so what draws one slide can tell that it has nothing to do.
 */
export function share<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let changed = prev.length !== next.length;
    const out = next.map((item, index) => {
      const kept = share(prev[index], item);
      if (kept !== prev[index]) changed = true;
      return kept;
    });
    return (changed ? out : prev) as T;
  }
  if (isRecord(prev) && isRecord(next)) {
    const out: Record<string, unknown> = {};
    for (const key of definedKeys(next)) out[key] = share(prev[key], next[key]);
    const keys = Object.keys(out);
    const changed = keys.length !== definedKeys(prev).length || keys.some((key) => out[key] !== prev[key]);
    return (changed ? out : prev) as T;
  }
  return next;
}

/**
 * Merges what two sides made of `base`. Objects merge key by key. Lists merge index by index while each side kept
 * the length or only added at the end; an insert, a removal or a move cannot be lined up by index, so it is a
 * conflict of the whole list. A conflict keeps `ours` and is added to `conflicts`.
 */
export function merge3(base: unknown, ours: unknown, theirs: unknown, path: Path = [], conflicts: Conflict[] = []): unknown {
  if (same(ours, theirs) || same(base, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (isRecord(base) && isRecord(ours) && isRecord(theirs)) {
    const merged: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
      const value = merge3(base[key], ours[key], theirs[key], [...path, key], conflicts);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) {
    const length = base.length;
    const linedUp = (list: unknown[]) => list.length === length || (list.length > length && base.every((item, index) => same(item, list[index])));
    if (linedUp(ours) && linedUp(theirs)) {
      const merged = base.map((item, index) => merge3(item, ours[index], theirs[index], [...path, index], conflicts));
      const added = ours.slice(length);
      for (const item of theirs.slice(length)) if (!added.some((other) => same(other, item))) added.push(item);
      return [...merged, ...added];
    }
  }
  conflicts.push({ path, theirs });
  return ours;
}

/** Sets the value at a path, or removes it for undefined. A path that no longer leads anywhere is left alone. */
function setAt(root: unknown, path: Path, value: unknown): void {
  let owner = root;
  for (const key of path.slice(0, -1)) {
    owner = (owner as Record<string | number, unknown> | null)?.[key];
    if (typeof owner !== "object" || owner === null) return;
  }
  const last = path.at(-1);
  if (last === undefined || typeof owner !== "object" || owner === null) return;
  if (value === undefined && !Array.isArray(owner)) delete (owner as Record<string, unknown>)[last];
  else (owner as Record<string | number, unknown>)[last] = value;
}

const newer = (a: Remote<unknown>, b: Remote<unknown>) => (a.revision != null && b.revision != null ? a.revision > b.revision : a.updatedAt > b.updatedAt);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Failures that may pass by themselves: no answer at all, a fault of the server, a timeout, too many requests. */
const passing = (status: number | undefined) => status === undefined || status >= 500 || status === 408 || status === 429;

export class DraftStore<D extends object> {
  #state: DraftState<D>;
  readonly #listeners = new Set<() => void>();
  readonly #send: DraftOptions<D>["send"];
  readonly #wait: { first: number; typing: number };
  readonly #retry: number[];
  readonly #schedule: (run: () => void, ms: number) => () => void;
  readonly #clock: () => number;
  #undo: Step<D>[] = [];
  #redo: Step<D>[] = [];
  #lastEdit = -Infinity;
  #cancelTimer: (() => void) | null = null;
  /** The keys of the save under way. */
  #inflight: Partial<D> | null = null;
  /** The newest copy that arrived while a save was under way. It is merged once that save has answered. */
  #held: Remote<D> | null = null;
  #failures = 0;
  #refusals = 0;
  #paused = false;
  #waiters: Waiter[] = [];

  constructor(options: DraftOptions<D>) {
    this.#send = options.send;
    this.#wait = options.wait ?? { first: 150, typing: 350 };
    this.#retry = options.retry ?? [1000, 2000, 5000, 10_000, 30_000];
    this.#schedule =
      options.schedule ??
      ((run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      });
    this.#clock = options.clock ?? (() => Date.now());
    this.#state = { draft: options.initial.doc, base: options.initial, save: { kind: "saved" }, conflicts: [], canUndo: false, canRedo: false };
  }

  getState = (): DraftState<D> => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  /** Whether the draft holds edits the server has not confirmed yet. */
  get dirty(): boolean {
    return this.#changes() != null || this.#inflight != null;
  }

  /**
   * Changes the draft and saves it once the edits pause. `now` saves at once and makes a step of its own, for the
   * edits that add, move or remove things, whose previews have nothing to show until the server has them.
   */
  edit(recipe: (doc: D) => void, now = false): void {
    const before = this.#state.draft;
    const next = structuredClone(before);
    recipe(next);
    const draft = share(before, next);
    if (draft === before) return;
    const at = this.#clock();
    const typing = !now && at - this.#lastEdit < TYPING_MS;
    this.#lastEdit = now ? -Infinity : at;
    const last = this.#undo.at(-1);
    if (typing && last?.open) last.after = draft;
    else {
      this.#undo.push({ before, after: draft, open: !now });
      if (this.#undo.length > UNDO_LIMIT) this.#undo.shift();
    }
    this.#redo = [];
    this.#set({ draft });
    this.#queue(now ? 0 : typing ? this.#wait.typing : this.#wait.first);
  }

  /**
   * Takes back the last step. What changed since in the same places, by a later edit or by someone else, stays as
   * it is: the step is merged back out rather than the whole document put back.
   */
  undo(): void {
    this.#step(this.#undo, this.#redo, (step) => [step.after, step.before]);
  }

  redo(): void {
    this.#step(this.#redo, this.#undo, (step) => [step.before, step.after]);
  }

  #step(from: Step<D>[], to: Step<D>[], direction: (step: Step<D>) => [D, D]): void {
    const step = from.pop();
    if (!step) return;
    step.open = false;
    to.push(step);
    const [was, becomes] = direction(step);
    const { draft } = this.#state;
    this.#lastEdit = -Infinity;
    this.#set({ draft: share(draft, merge3(was, draft, becomes) as D) });
    this.#queue(this.#wait.first);
  }

  /** A copy of the project from elsewhere: a poll, another page. It is merged when it is newer than the base. */
  receive(remote: Remote<D>): void {
    if (this.#inflight) {
      if (!this.#held || newer(remote, this.#held)) this.#held = remote;
      return;
    }
    if (newer(remote, this.#state.base)) this.#merge(remote);
  }

  /** Saves now. Resolves true once the server has every edit made so far, false when the save fails. */
  flush(): Promise<boolean> {
    if (this.#paused || this.#state.save.kind === "gone") return Promise.resolve(false);
    if (!this.dirty) return Promise.resolve(true);
    const done = new Promise<boolean>((resolve) => this.#waiters.push(resolve));
    this.#saveNow();
    return done;
  }

  /** Tries a failed save again now. */
  retry(): void {
    if (this.dirty) this.#saveNow();
  }

  /** Settles the reported conflicts: the local values stay, or the other side's replace them as one undoable step. */
  keep(side: "mine" | "theirs"): void {
    const { conflicts } = this.#state;
    if (side === "theirs" && conflicts.length) this.edit((doc) => conflicts.forEach((conflict) => setAt(doc, conflict.path, structuredClone(conflict.theirs))), true);
    this.#set({ conflicts: [] });
  }

  /**
   * For a page that is closing: sends what is not saved yet in a request that outlives the page, and says whether
   * the browser should ask first. It should when a save is under way or failing, or the edits are too large to send so.
   */
  unload(): "clean" | "sent" | "warn" {
    if (this.#paused || this.#state.save.kind === "gone") return "clean";
    const changes = this.#changes();
    if (!changes) return this.#inflight ? "warn" : "clean";
    if (JSON.stringify(changes).length > KEEPALIVE_LIMIT) return "warn";
    if (this.#inflight) {
      // Sent beside the save under way, without its revision, which that save is about to move on.
      this.#send(changes, null, true).catch(() => {});
      return "warn";
    }
    const failing = this.#state.save.kind === "retrying" || this.#state.save.kind === "failed";
    this.#begin(changes, true);
    return failing ? "warn" : "sent";
  }

  /** Stops saving, for a project about to be deleted, and resolves once the save under way has answered. */
  async pause(): Promise<void> {
    this.#paused = true;
    this.#cancel();
    if (this.#inflight) await new Promise<boolean>((resolve) => this.#waiters.push(resolve));
  }

  resume(): void {
    this.#paused = false;
    if (this.dirty) this.#queue(0);
  }

  // ---------------------------------------------------------------- saving

  #set(next: Partial<DraftState<D>>): void {
    this.#state = { ...this.#state, ...next, canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0 };
    for (const listener of this.#listeners) listener();
  }

  /** The top-level keys whose draft differs from the base, or null when there are none. */
  #changes(): Partial<D> | null {
    const { draft, base } = this.#state;
    const local = draft as Record<string, unknown>;
    const server = base.doc as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(local), ...Object.keys(server)])) if (!same(local[key], server[key])) changes[key] = local[key];
    return Object.keys(changes).length ? (changes as Partial<D>) : null;
  }

  #cancel(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }

  #timer(ms: number): void {
    this.#cancel();
    this.#cancelTimer = this.#schedule(() => {
      this.#cancelTimer = null;
      this.#saveNow();
    }, ms);
  }

  #queue(ms: number): void {
    if (this.#paused || this.#state.save.kind === "gone") return;
    this.#timer(ms);
    if (!this.#inflight) this.#set({ save: { kind: "waiting" } });
  }

  #settle(saved: boolean): void {
    for (const resolve of this.#waiters.splice(0)) resolve(saved);
  }

  #saveNow(): void {
    this.#cancel();
    if (this.#state.save.kind === "gone") return this.#settle(false);
    if (this.#paused) return this.#settle(!this.dirty);
    // One save at a time. The one under way looks again when it has answered.
    if (this.#inflight) return;
    const changes = this.#changes();
    if (!changes) {
      this.#set({ save: { kind: "saved" } });
      return this.#settle(true);
    }
    this.#begin(changes, false);
  }

  #begin(changes: Partial<D>, keepalive: boolean): void {
    this.#cancel();
    this.#inflight = changes;
    this.#set({ save: { kind: "saving" } });
    this.#send(changes, this.#state.base.revision, keepalive).then(
      (remote) => this.#saved(changes, remote),
      (error: unknown) => this.#refused(error),
    );
  }

  #saved(sent: Partial<D>, remote: Remote<D>): void {
    this.#inflight = null;
    this.#failures = 0;
    this.#refusals = 0;
    const { draft, base } = this.#state;
    const local = draft as Record<string, unknown>;
    const ours = sent as Record<string, unknown>;
    const server = remote.doc as Record<string, unknown>;
    const conflicts: Conflict[] = [];
    const merged: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(local), ...Object.keys(server)])) {
      // What was sent comes back as the server stores it, which is taken over unless it was edited again meanwhile.
      // Anything else the answer carries was written by someone else, and is merged like any copy from elsewhere.
      const value = key in ours ? (same(local[key], ours[key]) ? server[key] : local[key]) : merge3((base.doc as Record<string, unknown>)[key], local[key], server[key], [key], conflicts);
      if (value !== undefined) merged[key] = value;
    }
    this.#set({ base: remote, draft: share(draft, merged as D), conflicts: this.#withConflicts(conflicts) });
    this.#answered();
  }

  #refused(error: unknown): void {
    this.#inflight = null;
    const { status, remote } = error instanceof SaveError ? (error as SaveError<D>) : { status: undefined, remote: undefined };
    const message = messageOf(error);
    if (status === 409 && remote) {
      // Someone else wrote first. Their copy is merged in, and the result goes out on their revision.
      this.#merge(remote);
      if (++this.#refusals < REFUSALS) return this.#answered();
    }
    if (this.#held) this.receive(this.#takeHeld());
    if (status === 404 || status === 410) {
      this.#set({ save: { kind: "gone", error: message } });
      return this.#settle(false);
    }
    if (passing(status) || status === 409) {
      const ms = this.#retry[Math.min(this.#failures++, this.#retry.length - 1)]!;
      this.#set({ save: { kind: "retrying", error: message, retryAt: this.#clock() + ms } });
      this.#settle(false);
      if (!this.#paused) this.#timer(ms);
      return;
    }
    this.#set({ save: { kind: "failed", error: message } });
    this.#settle(false);
  }

  /** After a save has answered: what arrived meanwhile is merged, and edits made meanwhile go out next. */
  #answered(): void {
    if (this.#held) this.receive(this.#takeHeld());
    if (this.#paused) return this.#settle(!this.dirty);
    // Typing that goes on waits for its pause; anything else still unsaved goes now.
    if (this.#cancelTimer) return this.#set({ save: { kind: "waiting" } });
    this.#saveNow();
  }

  #takeHeld(): Remote<D> {
    const held = this.#held!;
    this.#held = null;
    return held;
  }

  #merge(remote: Remote<D>): void {
    const { draft, base } = this.#state;
    const conflicts: Conflict[] = [];
    const merged = merge3(base.doc, draft, remote.doc, [], conflicts) as D;
    this.#set({ base: remote, draft: share(draft, merged), conflicts: this.#withConflicts(conflicts) });
  }

  /** The conflicts reported so far with new ones added. A field that conflicts again keeps only its newest. */
  #withConflicts(found: Conflict[]): Conflict[] {
    if (found.length === 0) return this.#state.conflicts;
    const key = (conflict: Conflict) => JSON.stringify(conflict.path);
    const fresh = new Set(found.map(key));
    return [...this.#state.conflicts.filter((conflict) => !fresh.has(key(conflict))), ...found];
  }
}
