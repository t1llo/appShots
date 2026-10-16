// A project's history: the versions the server keeps of it, newest first, and a way back to any of them. A restore
// is a change like any other, made as a new version, so it can be taken back the same way.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { errorText, label, type Revision, revisionsQuery } from "../api.ts";
import { type ProjectStore, restoreRevision } from "../state/useDraft.ts";
import { ask, Dialog, Icon, toast } from "../ui/index.ts";

const CLOCK = "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.2l2.1 1.3";
const CLOSE = "M4 4l8 8M12 4l-8 8";

/** Subscribes to nothing, for a drawer without a draft to follow. */
const still = () => () => {};

/** Who made a version, as the server records it. */
const ACTORS: Record<string, string> = { studio: "In the Studio", mcp: "By an agent", api: "Through the API", unknown: "Before the history was kept" };

const at = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** When a version was made, as near as is useful: the time today and yesterday, the day before that. */
function when(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (Date.now() - date.getTime() < 60_000) return "Just now";
  if (days === 0) return `Today, ${at(iso)}`;
  if (days === 1) return `Yesterday, ${at(iso)}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(days > 300 ? { year: "numeric" } : {}) })}, ${at(iso)}`;
}

const size = (bytes: number) => (bytes < 1000 ? `${bytes} bytes` : `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} kB`);

/** The bar's button that opens the history. */
export function HistoryButton({ id, store }: { id: string; store: ProjectStore }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="icon-btn plain history-button" type="button" title="History: every version of this project, to go back to one" aria-label="History" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon path={CLOCK} />
      </button>
      {open ? <HistoryDrawer id={id} store={store} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The versions of a project at the side of the page. With the project open, a restore becomes its draft's new base,
 * and edits not saved yet are asked about first, since they give way to it. Without, as for a project whose file
 * cannot be read, the restore only brings the project back.
 */
export function HistoryDrawer({ id, store, onClose, onRestored }: { id: string; store?: ProjectStore; onClose: () => void; onRestored?: () => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({ ...revisionsQuery(id), staleTime: 0 });
  const [busy, setBusy] = useState<number | null>(null);
  // Every save makes a version, so the list follows the revision the draft stands on.
  const standing = useSyncExternalStore(store?.subscribe ?? still, () => store?.getState().base.revision ?? null);
  useEffect(() => {
    if (standing != null) void queryClient.invalidateQueries({ queryKey: revisionsQuery(id).queryKey });
  }, [standing]);

  const current = list.data?.revision ?? null;
  const restore = async (revision: number) => {
    setBusy(revision);
    try {
      const detail = await restoreRevision(queryClient, id, revision, store);
      toast(`Revision ${revision} is back, as revision ${detail.revision}.${store ? " Undo takes it back." : ""}`, "", 7000);
      onRestored?.();
    } finally {
      setBusy(null);
    }
  };
  const choose = (revision: number) => {
    const unsaved = store != null && (store.dirty || store.getState().conflicts.length > 0);
    if (unsaved) {
      return ask({
        title: `Restore revision ${revision}?`,
        text: "Some of your edits are not saved yet. They give way to this version, and Undo brings them back.",
        action: "Restore",
        running: "Restoring…",
        run: () => restore(revision),
      });
    }
    restore(revision).catch((error: unknown) => toast(errorText(error), "error", 8000));
  };

  return (
    <Dialog className="drawer" label="History" onClose={onClose}>
      <div className="drawer-head">
        <h1>History</h1>
        <button className="icon-btn plain" type="button" aria-label="Close" data-autofocus onClick={onClose}>
          <Icon path={CLOSE} />
        </button>
      </div>
      <p className="hint drawer-note">Every change makes a version, and the last 50 are kept. Restoring one makes it current again as a new version, so nothing in between is lost.</p>
      {list.error ? (
        <div className="callout list-error" role="alert">
          <div className="callout-text">
            <b>The history could not be loaded.</b>
            <span>{errorText(list.error)}</span>
          </div>
          <div className="callout-actions">
            <button className="btn small" type="button" onClick={() => void list.refetch()}>
              Try again
            </button>
          </div>
        </div>
      ) : !list.data ? (
        <p className="muted pad">Loading…</p>
      ) : list.data.revisions.length === 0 ? (
        <p className="muted pad">No versions kept yet.</p>
      ) : (
        <ol className="revisions" aria-busy={list.isFetching}>
          {list.data.revisions.map((entry) => (
            <RevisionRow key={entry.revision} entry={entry} current={entry.revision === current} busy={busy} onRestore={() => choose(entry.revision)} />
          ))}
        </ol>
      )}
    </Dialog>
  );
}

function RevisionRow({ entry, current, busy, onRestore }: { entry: Revision; current: boolean; busy: number | null; onRestore: () => void }) {
  return (
    <li className={`revision${current ? " current" : ""}`}>
      <div className="revision-main">
        <span className="revision-title">
          Revision {entry.revision}
          {current ? <span className="pill">Current</span> : null}
        </span>
        <span className="revision-sub" title={new Date(entry.time).toLocaleString()}>
          {when(entry.time)} · {ACTORS[entry.actor] ?? label(entry.actor)} · {size(entry.size)}
        </span>
      </div>
      {current ? null : (
        <button className="btn small" type="button" disabled={busy != null} aria-label={`Restore revision ${entry.revision}`} onClick={onRestore}>
          {busy === entry.revision ? "Restoring…" : "Restore"}
        </button>
      )}
    </li>
  );
}
