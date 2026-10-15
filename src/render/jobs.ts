import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { holdRender } from "../accounts.ts";
import type { Project } from "../schema.ts";
import { getProject, InputError, listImages, listShots, NotFoundError, projectDir, type Shot, shotsDir, type Space } from "../store.ts";
import { commitOutputs, discardStaging, sweepStaging } from "../storage/outputs.ts";
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
  finished: Promise<RenderResult>;
}

const waiting = new Map<string, number>();
/** One running plus one queued per account, so nobody can fill the shared queue. */
const MAX_WAITING = 2;

/** Every run that waits or works, and the finished ones of the last hour. */
const runs = new Map<string, Run>();
const KEPT_MS = 3600_000;
const KEPT_PER_SPACE = 8;

const ended = (run: Run) => run.job.finishedAt != null;

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

export function getRender(space: Space, job: string): RenderJob {
  const run = runs.get(job);
  if (!run || run.space !== space.id) throw new NotFoundError("No such render. A finished one is listed for an hour.");
  return run.job;
}

/**
 * Stops a run before its next picture. It keeps none of what it drew: the project's renders stay as they were before
 * it, and it uses no render. A run that is already putting its pictures in place finishes.
 */
export function cancelRender(space: Space, job: string): RenderJob {
  const run = runs.get(job);
  if (!run || run.space !== space.id) throw new NotFoundError("No such render. A finished one is listed for an hour.");
  if (!ended(run)) run.cancelled = true;
  return run.job;
}

/** Cancels every run that has not ended and waits up to `timeoutMs` for them to stop. */
export async function cancelAll(timeoutMs: number): Promise<void> {
  const live = [...runs.values()].filter((run) => !ended(run));
  for (const run of live) run.cancelled = true;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.allSettled(live.map((run) => run.finished)), new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
  clearTimeout(timer);
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
 * renders left. `finished` settles when the run does, and somebody has to catch what it throws. `name` is what
 * the run is called until the project has been read.
 */
export function startRender(space: Space, id: string, request: RenderRequest = {}, name = id): { job: RenderJob; finished: Promise<RenderResult> } {
  const count = waiting.get(space.id) ?? 0;
  if (count >= MAX_WAITING) throw new InputError("Two renders are already under way for this account. Try again when one has finished.");
  const settle = holdRender(space.id);
  waiting.set(space.id, count + 1);

  const job: RenderJob = { id: randomBytes(8).toString("hex"), project: id, name, state: "queued", done: 0, total: 0, createdAt: new Date().toISOString() };
  // Read now, not when its turn comes, so the run draws what was there when it was asked for. A request that cannot
  // be drawn, such as one for a language the project does not have, fails here without waiting its turn.
  const loaded = Promise.all([getProject(space, id), listShots(space, id), listImages(space, id)]).then(([project, shots, images]) => {
    job.name = project.name;
    return { project, shots, plan: planRender(project, shots, images, request) };
  });
  const run: Run = { job, space: space.id, cancelled: false, finished: undefined as never };
  run.finished = loaded
    .then(({ project, shots, plan }) =>
      scheduler.schedule("render", space.id, async () => {
        if (run.cancelled) throw new Cancelled();
        run.frozen = { project, shots };
        job.state = "running";
        job.startedAt = new Date().toISOString();
        job.total = plan.total;
        return renderNow(run, space, plan);
      }),
    )
    .then(
      async (result) => {
        job.state = "done";
        job.files = result.files.length + result.creatives.length;
        job.warnings = result.warnings;
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
  return { job, finished: run.finished };
}

/** Renders and waits for it. */
export async function renderProject(space: Space, id: string, request: RenderRequest = {}): Promise<RenderResult> {
  return startRender(space, id, request).finished;
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
    if (!(await commitOutputs(`${space.id}/${id}`, dir, commit))) throw deletedError();
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
