// Renders run on the server and take a while. The Studio starts one and lets go of it: the list in the sidebar
// follows every render of the account, wherever it was started, and says when one is done.

import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, errorText, plural, type RenderJob, type Renders } from "./api.ts";
import { toast } from "./ui/index.ts";

export const rendersQuery = queryOptions({ queryKey: ["renders"], queryFn: () => api<Renders>("GET", "/renders") });

export const working = (job: RenderJob) => job.state === "queued" || job.state === "running";

/** The renders this tab started. Their ZIP downloads by itself when they are done. */
const mine = new Set<string>();

export function downloadZip(project: string): void {
  const link = document.createElement("a");
  link.href = `/api/projects/${project}/export.zip`;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

/** Asks the server to render a whole project, and returns as soon as the run is in the queue. */
export async function startRender(queryClient: QueryClient, project: string): Promise<void> {
  const { job, rendersLeft } = await api<{ job: RenderJob; rendersLeft: number | null }>("POST", `/projects/${project}/render`, { background: true });
  mine.add(job.id);
  queryClient.setQueryData(rendersQuery.queryKey, (current) => ({ jobs: [job, ...(current?.jobs ?? [])], rendersLeft }));
}

/**
 * The account's renders, asked for every second while one works. Otherwise now and then, so a render that an
 * agent starts through MCP shows up too, and not at all while nobody looks at the tab.
 */
export function useRenders() {
  return useQuery({
    ...rendersQuery,
    refetchInterval: (query) => (query.state.data?.jobs.some(working) ? 1000 : document.hidden ? false : 5000),
    // A render is meant to be left alone, so the tab has to keep asking while it is in the background.
    refetchIntervalInBackground: true,
  });
}

// ---------------------------------------------------------------- when a render ends

const canNotify = () => "Notification" in window;

/** What waits for the tab to be looked at again, and the title it had before a finished render was written into it. */
const whenSeen: (() => void)[] = [];
let plainTitle: string | null = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (plainTitle != null) document.title = plainTitle;
  plainTitle = null;
  for (const run of whenSeen.splice(0)) run();
});

function ended(queryClient: QueryClient, job: RenderJob): void {
  // The project's page lists what was rendered.
  void queryClient.invalidateQueries({ queryKey: ["project", job.project] });
  const own = mine.delete(job.id);
  if (job.state === "cancelled") return toast(`The render of ${job.name} was cancelled.`);
  if (job.state === "failed") return toast(`${job.name} was not rendered. ${job.error ?? ""}`, "error", 9000);

  const files = plural(job.files ?? 0, "file");
  const say = () => {
    if (job.warnings?.length) toast(job.warnings.join("\n"), "warn", 9000);
    if (!own) return toast(`${job.name} is rendered: ${files}.`, "", 9000, { text: "Download ZIP", run: () => downloadZip(job.project) });
    toast(`${job.name} is rendered: ${files}. The download starts now.`, "", 6000);
    downloadZip(job.project);
  };
  if (!document.hidden) return say();

  // Nobody is looking: mark the tab, send a notification if that was allowed, and do the rest when the tab is back.
  plainTitle ??= document.title;
  document.title = `✓ ${job.name} is rendered`;
  whenSeen.push(say);
  if (!canNotify() || Notification.permission !== "granted") return;
  try {
    const note = new Notification(`${job.name} is rendered`, { body: `${files}, ready to download in appShots.`, tag: job.id });
    note.onclick = () => {
      window.focus();
      note.close();
    };
  } catch {}
}

/** Says so when a render ends: a note, the download, and a notification when the tab is in the background. */
export function useRenderNotes(jobs: RenderJob[] | undefined): void {
  const queryClient = useQueryClient();
  const seen = useRef<Map<string, RenderJob> | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const before = seen.current;
    seen.current = new Map(jobs.map((job) => [job.id, job]));
    // What had ended before the Studio was opened is no news.
    if (!before) return;
    for (const job of jobs) {
      const was = before.get(job.id);
      if (!working(job) && (!was || working(was))) ended(queryClient, job);
    }
    for (const was of before.values()) {
      if (!working(was) || seen.current.has(was.id)) continue;
      mine.delete(was.id);
      toast(`The render of ${was.name} stopped because the server restarted. Start it again.`, "error", 9000);
    }
  }, [jobs]);
}

// ---------------------------------------------------------------- the list in the sidebar

const SHOWN_MS = 10 * 60_000;

function stateText(job: RenderJob): string {
  if (job.state === "queued") return "Waiting";
  if (job.state === "running") return job.total ? `${job.done} of ${job.total}` : "Starting";
  if (job.state === "done") return "Done";
  return job.state === "failed" ? "Failed" : "Cancelled";
}

function leftText(left: number): string {
  return left === 0 ? "None left" : `${left} left`;
}

/** The renders under way and the ones that just ended, with how many the account has left where they are counted. */
export function RenderList({ renders }: { renders: Renders }) {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<string[]>([]);
  const [permission, setPermission] = useState(() => (canNotify() ? Notification.permission : "denied"));
  const { rendersLeft: left } = renders;
  const shown = renders.jobs.filter((job) => !hidden.includes(job.id) && (working(job) || Date.now() - Date.parse(job.finishedAt ?? job.createdAt) < SHOWN_MS)).slice(0, 4);
  if (shown.length === 0 && left == null) return null;

  const cancel = async (job: RenderJob) => {
    try {
      await api("DELETE", `/renders/${job.id}`);
      await queryClient.invalidateQueries({ queryKey: rendersQuery.queryKey });
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  return (
    <div className="nav-group renders" aria-label="Renders">
      <div className="nav-label">
        Renders
        {left == null ? null : (
          <span className={`renders-left${left === 0 ? " none" : ""}`} title="Every export uses one render. The person who runs this server can give the account more.">
            {leftText(left)}
          </span>
        )}
      </div>
      {shown.map((job) => (
        <div key={job.id} className={`render ${job.state}`}>
          <div className="render-head">
            <Link className="render-name" to="/$projectId" params={{ projectId: job.project }} title={`Open ${job.name}`}>
              {job.name}
            </Link>
            <span className="render-state">{stateText(job)}</span>
            {working(job) ? (
              <button className="icon-btn plain" type="button" title="Cancel this render" aria-label={`Cancel the render of ${job.name}`} onClick={() => void cancel(job)}>
                ×
              </button>
            ) : (
              <button className="icon-btn plain" type="button" title="Hide" aria-label={`Hide the render of ${job.name}`} onClick={() => setHidden([...hidden, job.id])}>
                ×
              </button>
            )}
          </div>
          {working(job) ? (
            <div className="render-bar" role="progressbar" aria-label={`Rendering ${job.name}`} aria-valuemin={0} aria-valuemax={job.total || 1} aria-valuenow={job.done}>
              <i style={{ width: `${job.total ? Math.max(4, (job.done / job.total) * 100) : 4}%` }} />
            </div>
          ) : null}
          {job.state === "done" ? (
            <button className="render-link" type="button" onClick={() => downloadZip(job.project)}>
              Download ZIP
            </button>
          ) : null}
          {job.state === "failed" && job.error ? <div className="render-error">{job.error}</div> : null}
        </div>
      ))}
      {permission === "default" && shown.some(working) ? (
        <button className="render-link" type="button" title="A notification from your browser, for when this tab is in the background" onClick={async () => setPermission(await Notification.requestPermission())}>
          Notify me when it is done
        </button>
      ) : null}
    </div>
  );
}
