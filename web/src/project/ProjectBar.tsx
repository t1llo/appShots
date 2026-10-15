// The bar over every page of a project, and what it says about the project's saving: how far it got, what failed,
// and where someone else changed the same thing.

import "./project.css";
import { Link } from "@tanstack/react-router";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { label } from "../api.ts";
import { HIDDEN } from "../renders.tsx";
import type { Path } from "../state/draft.ts";
import { type ProjectStore, useDraft } from "../state/useDraft.ts";
import { Icon } from "../ui/index.ts";

export const UPLOAD = "M8 10.6V2.8M4.9 5.7L8 2.6l3.1 3.1M2.8 10.4v2.8h10.4v-2.8";
const UNDO = "M5.2 3.6 2.6 6.2l2.6 2.6M3 6.2h6.4a3.6 3.6 0 0 1 0 7.2H7.2";
const REDO = "M10.8 3.6l2.6 2.6-2.6 2.6M13 6.2H6.6a3.6 3.6 0 0 0 0 7.2h2.2";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const keys = (key: string, shift = false) => (MAC ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`);

export type ProjectView = "slides" | "assets" | "mockups";

/** The parts of a project: what it makes for the store, what it is made of, and the devices alone. */
export function ViewSwitch({ id, view }: { id: string; view: ProjectView }) {
  const params = { projectId: id };
  const current = (name: ProjectView) => ({ className: view === name ? "on" : "", "aria-current": view === name ? ("page" as const) : undefined });
  return (
    <nav className="view-tabs" aria-label="Parts of this project">
      <Link {...current("slides")} to="/$projectId" params={params} search={{}} title="The slides, the store's header images and the banners">
        Slides
      </Link>
      <Link {...current("assets")} to="/$projectId" params={params} search={{ view: "assets" }} title="The screenshots, logos and images the project is made of">
        Assets
      </Link>
      <Link {...current("mockups")} to="/$projectId/mockups" params={params} title="The devices alone, on a transparent background">
        Mockups
      </Link>
    </nav>
  );
}

/** The bar over every page of a project: its name, its parts, and on the right what the page puts there. */
export function ProjectBar(props: { id: string; name: string; view: ProjectView; onRename?: (name: string) => void; field?: RefObject<HTMLInputElement | null>; children?: ReactNode }) {
  const { id, name, view, onRename, field, children } = props;
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? name;
  return (
    <header className="bar">
      {onRename ? (
        <input
          className="bar-title"
          ref={field}
          type="text"
          maxLength={80}
          placeholder="Untitled"
          aria-label="Project name"
          title="Click to rename"
          spellCheck={false}
          style={{ width: `${Math.min(30, Math.max(5, shown.length + 2))}ch` }}
          value={shown}
          onChange={(event) => {
            setTyped(event.target.value);
            const next = event.target.value.trim();
            if (next) onRename(next);
          }}
          onKeyDown={(event) => (event.key === "Enter" || event.key === "Escape") && event.currentTarget.blur()}
          onBlur={() => setTyped(null)}
        />
      ) : (
        <span className="bar-title still">{name}</span>
      )}
      <ViewSwitch id={id} view={view} />
      <span className="spacer" />
      {children}
    </header>
  );
}

/** Undo and redo for the project's edits, which the keys do as well. */
export function UndoButtons({ store }: { store: ProjectStore }) {
  const canUndo = useDraft(store, (state) => state.canUndo);
  const canRedo = useDraft(store, (state) => state.canRedo);
  return (
    <span className="undo-buttons">
      <button className="icon-btn plain" type="button" disabled={!canUndo} title={`Undo (${keys("Z")})`} aria-label="Undo" onClick={() => store.undo()}>
        <Icon path={UNDO} />
      </button>
      <button className="icon-btn plain" type="button" disabled={!canRedo} title={`Redo (${keys("Z", true)})`} aria-label="Redo" onClick={() => store.redo()}>
        <Icon path={REDO} />
      </button>
    </span>
  );
}

/**
 * How the saving goes, or what the page is busy with, such as an upload, which stays up until it is done. Only a
 * failure is read out: hearing "Saving" after every word typed is no help.
 */
export function SaveStatus({ store, task }: { store: ProjectStore; task?: string }) {
  const save = useDraft(store, (state) => state.save);
  const [justSaved, setJustSaved] = useState(false);
  const was = useRef(save.kind);
  useEffect(() => {
    const before = was.current;
    was.current = save.kind;
    if (save.kind !== "saved" || before === "saved") return setJustSaved(false);
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [save.kind]);

  const error = save.kind === "failed" || save.kind === "retrying" || save.kind === "gone" ? save : null;
  const text =
    save.kind === "gone"
      ? "This project was deleted elsewhere."
      : error
        ? `Not saved: ${error.error}${save.kind === "retrying" ? ". Trying again…" : ""}`
        : task || (save.kind === "waiting" || save.kind === "saving" ? "Saving…" : justSaved ? "Saved" : "");
  return (
    <>
      <span className={`status${error ? " error" : ""}`}>{text}</span>
      {error && save.kind !== "gone" ? (
        <button className="btn small quiet" type="button" onClick={() => store.retry()}>
          {save.kind === "retrying" ? "Try now" : "Try again"}
        </button>
      ) : null}
      <span role="alert" style={HIDDEN}>
        {error ? text : ""}
      </span>
    </>
  );
}

/** "slides", 2, "headline" as a person says it: Slide 3 › Headline. */
function where(path: Path): string {
  const words: string[] = [];
  for (const [at, part] of path.entries()) {
    if (typeof part === "number") words[words.length - 1] = `${(words.at(-1) ?? "Item").replace(/s$/, "")} ${part + 1}`;
    else words.push(at === 0 && part === "deviceSlides" ? "Own slides" : label(part.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()));
  }
  return words.join(" › ");
}

/** Says where someone else changed what was changed here too, and lets either version win. */
export function ConflictBar({ store }: { store: ProjectStore }) {
  const conflicts = useDraft(store, (state) => state.conflicts);
  if (conflicts.length === 0) return null;
  const places = [...new Set(conflicts.map((conflict) => where(conflict.path)))];
  return (
    <div className="callout conflict" role="alert">
      <div className="callout-text">
        <b>This project was changed elsewhere while you edited the same {places.length === 1 ? "part" : "parts"}.</b>
        <span>
          {places.slice(0, 4).join(", ")}
          {places.length > 4 ? ` and ${places.length - 4} more` : ""}. Yours is kept for now.
        </span>
      </div>
      <div className="callout-actions">
        <button className="btn small quiet" type="button" title="Put the other version in place of yours. Undo brings yours back." onClick={() => store.keep("theirs")}>
          Use theirs
        </button>
        <button className="btn small" type="button" onClick={() => store.keep("mine")}>
          Keep mine
        </button>
      </div>
    </div>
  );
}
