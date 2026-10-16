import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { holdRender } from "../accounts.ts";
import type { LintWarning } from "../domain/lint.ts";
import type { Project } from "../schema.ts";
import { getProject, InputError, listImages, listShots, NotFoundError, projectDir, type Shot, shotsDir, type Space, UnavailableError } from "../store.ts";
import { commitOutputs, discardStaging, sweepStaging } from "../storage/outputs.ts";
import { projectKey } from "../storage/paths.ts";
import { PageStatusError } from "./capture.ts";
import { noteError, scheduler } from "./engine.ts";
import { Cancelled, draw, type RenderResult } from "./output.ts";
import { planRender, type RenderPlan, type RenderRequest } from "./plan.ts";

export type { RenderedCreative, RenderedFile, RenderedSheet, RenderResult } from "./output.ts";

export type RenderState = "queued" | "running" | "done" | "failed" | "cancelled";

/** One run of the renderer, as GET /api/renders and the Studio's render list show it. */
export interface RenderJob {
  id: string;
  /** The project's id and its name. */
  project: string;
  name: string;
  state: RenderState;
  /** Pictures drawn so far, and how many the run draws. Both are zero while it waits. */
  done: number;
  total: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** What a finished run wrote. */
  files?: number;
  warnings?: string[];
  /** The warnings about the copy and the logos, as data. */
  lint?: LintWarning[];
  /** Why a run stopped short. */
  error?: string;
}

/** The project as it was when its render was asked for. A run draws that, whatever is edited while it works. */
interface Frozen {
  project: Project;
  shots: Shot[];
}

interface Run {
  job: RenderJob;
  space: string;
  cancelled: boolean;
  frozen?: Frozen;
  /** What a finished run drew, for whoever asks after a run they did not wait for. */
  result?: RenderResult;
  /** Ends a run that has not had its turn yet, at once rather than when its turn would have come. */
  stop: () => void;
  /** Settles once the run has read the project and taken its place in the queue, or could not. */
  placed: Promise<void>;
  finished: Promise<RenderResult>;
}

const waiting = new Map<string, number>();
/** One running plus one queued per account, so nobody can fill the shared queue. */
const MAX_WAITING = 2;

/** Every run that waits or works, and the finished ones of the last hour: the newest eight of each account. */
const runs = new Map<string, Run>();
const KEPT_MS = 3600_000;
const KEPT_PER_SPACE = 8;

const ended = (run: Run) => run.job.finishedAt != null;

/** Set once the server shuts down: a render asked for from then on is refused, so the ones under way can finish. */
let closing = false;

const UNKNOWN = "No such render. Finished renders are listed for an hour, the newest eight at most.";

function forget(): void {
  const old = Date.now() - KEPT_MS;
  const kept = new Map<string, number>();
  // Newest first, so the cap drops the oldest finished runs of an account.
  for (const run of [...runs.values()].reverse()) {
    if (!ended(run)) continue;
    const count = (kept.get(run.space) ?? 0) + 1;
    kept.set(run.space, count);
    if (count > KEPT_PER_SPACE || Date.parse(run.job.finishedAt!) < old) runs.delete(run.job.id);
  }
}

/** The runs of one account, newest first. */
export function listRenders(space: Space): RenderJob[] {
  forget();
  return [...runs.values()]
    .filter((run) => run.space === space.id)
    .map((run) => run.job)
    .reverse();
}

function runOf(space: Space, job: string): Run {
  forget();
  const run = runs.get(job);
  if (!run || run.space !== space.id) throw new NotFoundError(UNKNOWN);
  return run;
}

export const getRender = (space: Space, job: string): RenderJob => runOf(space, job).job;

/** What a run drew, once it is done. Nothing before, nor for a run that failed or was cancelled. */
export const renderResult = (space: Space, job: string): RenderResult | undefined => runOf(space, job).result;

function cancel(run: Run): void {
  if (ended(run)) return;
  run.cancelled = true;
  // One still waiting has drawn nothing, and ends now. One that draws stops before its next picture.
  if (run.job.state === "queued") run.stop();
}

/**
 * Stops a run before its next picture. It keeps none of what it drew: the project's renders stay as they were before
 * it, and it uses no render. A run that is already putting its pictures in place finishes.
 */
export function cancelRender(space: Space, job: string): RenderJob {
  const run = runOf(space, job);
  cancel(run);
  return run.job;
}

/** Waits for runs to end, for up to `timeoutMs`. */
async function ending(live: Run[], timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.allSettled(live.map((run) => run.finished)), new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
  clearTimeout(timer);
}

/** Cancels every run that has not ended and waits up to `timeoutMs` for them to stop. */
export async function cancelAll(timeoutMs: number): Promise<void> {
  const live = [...runs.values()].filter((run) => !ended(run));
  for (const run of live) cancel(run);
  await ending(live, timeoutMs);
}

/**
 * Cancels the runs of an account, or of one of its projects, and waits for them to stop: a project or an account is
 * deleted once nothing draws for it any more. A browser that hangs on a page is waited for up to `timeoutMs`; what
 * such a run would put in place later finds the project gone, and is thrown away.
 */
export async function cancelRenders(space: Space, project?: string, timeoutMs = 15_000): Promise<void> {
  const live = [...runs.values()].filter((run) => run.space === space.id && !ended(run) && (project === undefined || run.job.project === project));
  for (const run of live) cancel(run);
  await ending(live, timeoutMs);
}

/**
 * Takes no more renders: one asked for from here on is refused, while the server shuts down. Resolves once the runs
 * asked for before are in the queue, so they get their turn like the ones that were there already.
 */
export async function closeRenders(): Promise<void> {
  closing = true;
  await Promise.all([...runs.values()].filter((run) => !ended(run)).map((run) => run.placed));
}

/** Runs that have not ended. */
export const liveRenders = () => [...runs.values()].filter((run) => !ended(run)).length;

/** What a page of a running render draws: the project as it was when the render was asked for. */
export function frozenFor(space: Space, job: unknown): Frozen | undefined {
  const run = typeof job === "string" ? runs.get(job) : undefined;
  return run && run.space === space.id ? run.frozen : undefined;
}

/**
 * Queues a render and returns at once with the run. Refuses when the account has two waiting already or no
 * renders left. `finished` settles when the run does, and somebody has to catch what it throws. `read` settles
 * once the run has read the project and its screenshots, so a change made after it is not drawn. `name` is what
 * the run is called until the project has been read. `signal` cancels the run, such as when whoever waits for it
 * goes away.
 */
export function startRender(space: Space, id: string, request: RenderRequest = {}, name = id, options: { signal?: AbortSignal } = {}): { job: RenderJob; finished: Promise<RenderResult>; read: Promise<void> } {
  if (closing) throw new UnavailableError("The server is shutting down. Try again in a minute.");
  const count = waiting.get(space.id) ?? 0;
  if (count >= MAX_WAITING) throw new InputError("Two renders are already under way for this account. Try again when one has finished.");
  const settle = holdRender(space.id);
  waiting.set(space.id, count + 1);

  const job: RenderJob = { id: randomBytes(8).toString("hex"), project: id, name, state: "queued", done: 0, total: 0, createdAt: new Date().toISOString() };
  // Read now, not when its turn comes, so the run draws what was there when it was asked for. A request that cannot
  // be drawn, such as one for a language the project does not have, fails here without waiting its turn.
  const loaded = getProject(space, id).then(async (project) => {
    const [shots, images] = await Promise.all([listShots(space, id, project.locales), listImages(space, id)]);
    job.name = project.name;
    return { project, shots, plan: planRender(project, shots, images, request) };
  });
  const run: Run = { job, space: space.id, cancelled: false, stop: () => {}, placed: Promise.resolve(), finished: undefined as never };
  const stopped = new Promise<never>((_resolve, reject) => {
    run.stop = () => reject(new Cancelled());
  });
  const scheduled = loaded.then(({ project, shots, plan }) => {
    if (run.cancelled) throw new Cancelled();
    return scheduler.schedule("render", space.id, async () => {
      if (run.cancelled) throw new Cancelled();
      run.frozen = { project, shots };
      job.state = "running";
      job.startedAt = new Date().toISOString();
      job.total = plan.total;
      return renderNow(run, space, plan);
    });
  });
  // A run stopped while it waits leaves its place in the queue behind, which comes to nothing when its turn comes.
  scheduled.catch(() => {});
  // After `scheduled` has asked for its place: callbacks on `loaded` run in the order they were added.
  run.placed = loaded.then(
    () => {},
    () => {},
  );
  run.finished = Promise.race([scheduled, stopped])
    .then(
      async (result) => {
        job.state = "done";
        job.files = result.files.length + result.creatives.length;
        job.warnings = result.warnings;
        job.lint = result.lint;
        run.result = result;
        await settle(true);
        return result;
      },
      async (error: unknown) => {
        job.state = run.cancelled ? "cancelled" : "failed";
        // Only what is meant for whoever asked; anything else is the server's own trouble and goes to its log.
        if (!run.cancelled) job.error = error instanceof InputError || error instanceof NotFoundError ? error.message : "The render stopped with an error on the server.";
        if (!(error instanceof InputError || error instanceof NotFoundError)) noteError(error);
        await settle(false);
        throw run.cancelled ? new Cancelled() : error;
      },
    )
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      run.frozen = undefined;
      const left = (waiting.get(space.id) ?? 1) - 1;
      if (left > 0) waiting.set(space.id, left);
      else waiting.delete(space.id);
    });
  runs.set(job.id, run);
  forget();
  if (options.signal?.aborted) cancel(run);
  else options.signal?.addEventListener("abort", () => cancel(run), { once: true });
  return { job, finished: run.finished, read: loaded.then(() => undefined, () => undefined) };
}

/** Renders and waits for it. `signal` cancels it, such as when whoever waits goes away: then it uses no render. */
export async function renderProject(space: Space, id: string, request: RenderRequest = {}, options: { signal?: AbortSignal } = {}): Promise<RenderResult> {
  return startRender(space, id, request, id, options).finished;
}

/** Screenshots the run was asked with that are gone from the disk since. */
async function missingShots(space: Space, id: string, shots: Shot[]): Promise<Shot[]> {
  const there = await Promise.all(shots.map((shot) => stat(path.join(shotsDir(space, id), shot.file)).then(() => true, () => false)));
  return shots.filter((_, i) => !there[i]);
}

function missingError(shots: Shot[]): InputError {
  const names = [...new Set(shots.map((shot) => `"${shot.name}"`))];
  return new InputError(
    `The screenshot${names.length === 1 ? "" : "s"} ${names.join(", ")} ${names.length === 1 ? "is" : "are"} not there any more. ${names.length === 1 ? "It was" : "They were"} deleted or replaced while the render waited: upload ${names.length === 1 ? "it" : "them"} again, then render once more.`,
  );
}

/** Whether the project is gone from the disk, deleted since its render was asked for. */
const deleted = (dir: string) => stat(path.join(dir, "project.json")).then(
  () => false,
  () => true,
);
const deletedError = () => new NotFoundError("The project was deleted while it rendered.");

async function renderNow(run: Run, space: Space, plan: RenderPlan): Promise<RenderResult> {
  const { project } = run.frozen!;
  const { id } = project;
  const dir = projectDir(space, id);
  // A screenshot deleted since the render was asked for cannot be drawn. Say which before drawing anything.
  const gone = await missingShots(space, id, plan.shots);
  if (gone.length) throw (await deleted(dir)) ? deletedError() : missingError(gone);
  const running = new Set([...runs.values()].filter((each) => !ended(each)).map((each) => each.job.id));
  await sweepStaging(dir, running);

  try {
    const { result, commit } = await draw(run, space, project, plan);
    // A cancel that came while the last pictures were encoded still counts: nothing has been put in place yet.
    if (run.cancelled) throw new Cancelled();
    if (!(await commitOutputs(projectKey(space, id), dir, commit))) throw deletedError();
    return result;
  } catch (error) {
    await discardStaging(dir, run.job.id);
    // A project deleted while it rendered stops the run wherever it was, such as on a page whose screenshots went
    // with it. That is the reason to give, not the error it happened to stop with.
    if (await deleted(dir)) throw deletedError();
    // A page the server could not make, most likely because a screenshot went missing on the way.
    if (error instanceof PageStatusError) {
      const missing = await missingShots(space, id, plan.shots);
      if (missing.length) throw missingError(missing);
    }
    throw error;
  }
}
