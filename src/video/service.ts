import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { holdRender } from "../accounts.ts";
import { noteError, scheduler } from "../render/engine.ts";
import type { RenderJob } from "../render/jobs.ts";
import { Cancelled } from "../render/output.ts";
import { getProject, InputError, listImages, listShots, NotFoundError, type Space, UnavailableError } from "../store.ts";
import { artboardsOf, type Draft, type LayerWarning, plain, prepareDraft } from "./cards.ts";
import { browserCapturer, type PageCapturer } from "./pages.ts";
import { normaliseRequest, type VideoLayersBody } from "./request.ts";
import { commitSet, discardStaging, KEPT_SETS, type Layer, layerPath, type Manifest, readSet, sweepStaging, touchSet, videoStaging } from "./store.ts";

/**
 * Drawing the layers of an app preview: one run per set, queued with the renders and paid like one. A set is named
 * by a hash of everything it draws, so asking for the same layers again answers with the set that is there and costs
 * nothing. A run that fails, is cancelled or loses every caller waiting on it keeps nothing and costs nothing.
 */

/** Goes into every set's hash: a change to how layers are drawn makes every set new. */
export const LAYERS_VERSION = 1;

/** A run, as GET /api/renders/:job shows it: a render's fields and the set it draws. */
export interface VideoJob extends RenderJob {
  set: string;
}

/** What a request for layers is answered with. `charged` says whether this request used a render. */
export type LayersAnswer = Manifest & { charged: boolean };

interface Run {
  job: VideoJob;
  space: string;
  draft: Draft;
  controller: AbortController;
  finished: Promise<LayersAnswer>;
  /** The requests that started or joined it and have not left. It stops when the last one leaves. */
  callers: number;
}

/** A run being drawn, as a request that started or joined it holds it. */
export interface Started {
  job: VideoJob;
  finished: Promise<LayersAnswer>;
  /** Whether this request started the run, and so is the one charged for it. */
  started: boolean;
  /**
   * Says this request went away before its answer. The run stops once every request that started or joined it has
   * left; one in the background never leaves, as it wants the set whether or not anyone else waits for it.
   */
  leave: () => void;
}

export interface VideoServiceDeps {
  capturer: PageCapturer;
  /** Sets a render aside and returns how to settle it, as accounts.ts does. */
  hold?: (spaceId: string) => (used: boolean) => Promise<void>;
  /** Runs the work when it is the account's turn in the render lane. */
  schedule?: <T>(space: string, work: () => Promise<T>) => Promise<T>;
}

/** One running plus one queued per account, as for renders. */
const MAX_WAITING = 2;
const KEPT_MS = 3600_000;
const KEPT_PER_SPACE = 8;
/** The fit under which a caption is reported as shrunk. */
const SHRUNK = 0.7;

const ended = (run: Run) => run.job.finishedAt != null;

export function setHash(draft: Draft): string {
  const { warnings: _, ...drawn } = draft;
  return createHash("sha256").update(JSON.stringify({ version: LAYERS_VERSION, drawn })).digest("hex").slice(0, 16);
}

export function createVideoService(deps: VideoServiceDeps) {
  let capturer = deps.capturer;
  const hold = deps.hold ?? holdRender;
  const schedule = deps.schedule ?? (<T>(space: string, work: () => Promise<T>) => scheduler.schedule("render", space, work));
  const runs = new Map<string, Run>();
  const waiting = new Map<string, number>();
  /** Set once the server shuts down: no run starts from then on, so the ones under way can finish. */
  let closing = false;

  function forget(): void {
    const old = Date.now() - KEPT_MS;
    const kept = new Map<string, number>();
    for (const run of [...runs.values()].reverse()) {
      if (!ended(run)) continue;
      const count = (kept.get(run.space) ?? 0) + 1;
      kept.set(run.space, count);
      if (count > KEPT_PER_SPACE || Date.parse(run.job.finishedAt!) < old) runs.delete(run.job.id);
    }
  }

  /** Counts one more request waiting on the run, and hands it the way to leave it, once. */
  function join(run: Run): () => void {
    run.callers++;
    let gone = false;
    return () => {
      if (gone) return;
      gone = true;
      if (--run.callers === 0 && !ended(run)) run.controller.abort();
    };
  }

  /** Cancels the runs that match and have not ended, and waits up to `timeoutMs` for them to stop. */
  async function stop(match: (run: Run) => boolean, timeoutMs: number): Promise<void> {
    const live = [...runs.values()].filter((run) => !ended(run) && match(run));
    for (const run of live) run.controller.abort();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(live.map((run) => run.finished)), new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
    clearTimeout(timer);
  }

  const own = (space: Space, job: string) => {
    const run = runs.get(job);
    return run && run.space === space.id ? run : undefined;
  };

  /** Draws every language's page and puts the set in place. */
  async function draw(run: Run, space: Space, set: string): Promise<Manifest> {
    const { draft, job, controller } = run;
    const staging = videoStaging(space, job.id);
    await sweepStaging(space, new Set([job.id, ...[...runs.values()].filter((each) => !ended(each)).map((each) => each.job.id)]));
    await rm(staging, { recursive: true, force: true });
    const layers: Layer[] = [];
    const warnings: LayerWarning[] = [...draft.warnings];
    try {
      for (const locale of draft.locales) {
        const artboards = artboardsOf(draft, locale);
        if (!artboards.length) continue;
        if (controller.signal.aborted) throw new Cancelled();
        const where = `The video layers in ${locale}`;
        const query = new URLSearchParams({ job: job.id, locale });
        const { pictures, report } = await capturer.capture({ space, path: `/render/${draft.projectId}/video?${query}`, where, artboards, signal: controller.signal });
        if (pictures.length !== artboards.length) throw new Error(`${where}: ${pictures.length} pictures came back for ${artboards.length} layers.`);
        const copy = draft.copy[locale]!;
        for (const [i, board] of artboards.entries()) {
          const layer: Layer = { id: board.id, locale: board.locale, kind: board.kind, file: "", width: board.width, height: board.height };
          layer.file = `/files/${draft.projectId}/video/${set}/${layerPath(layer)}`;
          const drawn = report[board.id];
          if (drawn) layer.box = drawn.box;
          const texts =
            board.kind === "caption"
              ? [copy.captions.find((entry) => `caption-${entry.id}` === board.id)!.text]
              : board.kind === "intro-text"
                ? [copy.intro!.headline!]
                : board.kind === "outro-text"
                  ? [...copy.outro!.lines, ...copy.outro!.disclosure]
                  : [];
          if (texts.length) {
            layer.text = texts.map((text) => plain(text.text)).join("\n");
            layer.fallback = texts.some((text) => text.from != null);
            layer.fit = drawn?.fit ?? 1;
            if (layer.fit < SHRUNK) warnings.push({ locale, layer: board.id, kind: "fit", detail: `shrunk to ${Math.round(layer.fit * 100)} %` });
          }
          await mkdir(path.dirname(path.join(staging, layerPath(layer))), { recursive: true });
          await writeFile(path.join(staging, layerPath(layer)), pictures[i]!);
          layers.push(layer);
        }
        job.done += artboards.length;
      }
      const manifest: Manifest = {
        set,
        size: draft.size,
        display: draft.display,
        locales: draft.locales,
        warnings,
        layers,
        zip: `/api/projects/${draft.projectId}/video-layers/${set}/layers.zip`,
      };
      await mkdir(staging, { recursive: true });
      await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      // A cancel that came while the last page was drawn still counts: nothing is in place yet.
      if (controller.signal.aborted) throw new Cancelled();
      if (!(await commitSet(space, draft.projectId, staging, set))) throw new NotFoundError("The project was deleted while its video layers were drawn.");
      return manifest;
    } catch (error) {
      await discardStaging(space, staging);
      throw error;
    }
  }

  return {
    /** Draws with this from now on. The tests swap in a capturer that needs no browser. */
    useCapturer(next: PageCapturer): void {
      capturer = next;
    },

    /**
     * Answers with the set when it exists, or starts drawing it. Refuses a request the project cannot answer (a
     * language it does not have, a slide it does not have) before anything is queued or held.
     */
    async start(space: Space, id: string, body: VideoLayersBody): Promise<{ done: LayersAnswer } | Started> {
      const project = await getProject(space, id);
      const [shots, images] = await Promise.all([listShots(space, id), listImages(space, id)]);
      const draft = await prepareDraft(space, project, shots, images, normaliseRequest(project, body));
      const set = setHash(draft);
      const there = await readSet(space, id, set);
      if (there) {
        await touchSet(space, id, set);
        return { done: { ...there, charged: false } };
      }
      // The same layers asked for again while they are drawn: one run draws them, and only it is charged.
      const same = [...runs.values()].find((run) => run.space === space.id && !ended(run) && run.job.project === id && run.job.set === set);
      if (same) return { job: same.job, finished: same.finished.then((answer) => ({ ...answer, charged: false })), started: false, leave: join(same) };

      const total = draft.locales.reduce((sum, locale) => sum + artboardsOf(draft, locale).length, 0);
      if (total === 0) throw new InputError("Nothing to draw: ask for captions, an intro or outro, the plate or the touch ring.");
      if (closing) throw new UnavailableError("The server is shutting down. Try again in a minute.");
      const count = waiting.get(space.id) ?? 0;
      if (count >= MAX_WAITING) throw new InputError("Two runs are already under way for this account. Try again when one has finished.");
      const settle = hold(space.id);
      waiting.set(space.id, count + 1);
      forget();

      const job: VideoJob = { id: randomBytes(8).toString("hex"), project: id, name: project.name, state: "queued", done: 0, total, createdAt: new Date().toISOString(), set };
      const run: Run = { job, space: space.id, draft, controller: new AbortController(), finished: undefined as never, callers: 0 };
      const scheduled = schedule(space.id, async () => {
        if (run.controller.signal.aborted) throw new Cancelled();
        job.state = "running";
        job.startedAt = new Date().toISOString();
        return draw(run, space, set);
      });
      // A run stopped while it waits ends at once, as a render does, rather than when its turn would have come: a
      // project is deleted only once nothing waits to draw for it. Its place in the queue comes to nothing.
      scheduled.catch(() => {});
      const stopped = new Promise<never>((_resolve, reject) => {
        const end = () => {
          if (job.state === "queued") reject(new Cancelled());
        };
        run.controller.signal.addEventListener("abort", end, { once: true });
      });
      run.finished = Promise.race([scheduled, stopped])
        .then(
          async (manifest) => {
            job.state = "done";
            job.files = manifest.layers.length;
            job.warnings = manifest.warnings.map((warning) => `${warning.locale ?? "every language"}, ${warning.layer}: ${warning.detail}`);
            await settle(true);
            return { ...manifest, charged: true };
          },
          async (error: unknown) => {
            const cancelled = run.controller.signal.aborted;
            job.state = cancelled ? "cancelled" : "failed";
            const told = error instanceof InputError || error instanceof NotFoundError;
            if (!cancelled) job.error = told ? error.message : "The video layers stopped with an error on the server.";
            if (!told) noteError(error);
            await settle(false);
            throw cancelled ? new Cancelled() : error;
          },
        )
        .finally(() => {
          job.finishedAt = new Date().toISOString();
          const left = (waiting.get(space.id) ?? 1) - 1;
          if (left > 0) waiting.set(space.id, left);
          else waiting.delete(space.id);
        });
      runs.set(job.id, run);
      return { job, finished: run.finished, started: true, leave: join(run) };
    },

    /** A run of the account, or undefined when the job is none of its video runs. */
    getJob(space: Space, job: string): VideoJob | undefined {
      forget();
      return own(space, job)?.job;
    },

    /** Stops a run before its next layer; it keeps nothing and costs nothing. Undefined when the job is not one. */
    cancel(space: Space, job: string): VideoJob | undefined {
      const run = own(space, job);
      if (run && !ended(run)) run.controller.abort();
      return run?.job;
    },

    /**
     * Cancels the runs of an account, or of one of its projects, and waits for them to stop, as for renders: a
     * project or an account is deleted or moved once nothing draws for it any more, so no run puts its layers, or
     * the folder it stages them in, back where they were.
     */
    cancelRuns(space: Space, project?: string, timeoutMs = 15_000): Promise<void> {
      return stop((run) => run.space === space.id && (project === undefined || run.job.project === project), timeoutMs);
    },

    /** Starts no more runs, while the server shuts down. A set that is there already is still answered. */
    close(): void {
      closing = true;
    },

    /** Cancels every run that has not ended and waits up to `timeoutMs` for them to stop. */
    cancelAll(timeoutMs: number): Promise<void> {
      return stop(() => true, timeoutMs);
    },

    /** What the page of a running set draws. */
    draftFor(space: Space, job: string): Draft | undefined {
      const run = own(space, job);
      return run && !ended(run) ? run.draft : undefined;
    },

    /** A set of the project, as GET answers it. */
    async getSet(space: Space, id: string, set: string): Promise<LayersAnswer> {
      await getProject(space, id);
      const manifest = await readSet(space, id, set);
      if (!manifest) throw new NotFoundError(`This project has no set of video layers "${set}". The newest ${KEPT_SETS} are kept: ask for the layers again to draw it anew.`);
      return { ...manifest, charged: false };
    },
  };
}

export type VideoService = ReturnType<typeof createVideoService>;

/** The server's own, drawing with the browser. */
export const videoService = createVideoService({ capturer: browserCapturer });
