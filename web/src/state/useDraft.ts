// The open project as the Studio's pages see it. Each project has one draft store, shared by its slides, assets and
// mockups pages, which saves through the API and goes on saving while the user moves from page to page.

import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { ApiError, type Detail, detailQuery, type DeviceKind, errorText, type Project, projectsQuery, revisionOf, saveProject, type TargetId } from "../api.ts";
import { openProject } from "../dialogs.tsx";
import { type DraftState, DraftStore, type Remote, SaveError } from "./draft.ts";
import { writeQuery } from "./sequence.ts";

/** The part of a project the Studio edits and sends back. */
export type ProjectDoc = Pick<Project, "name" | "locales" | "theme" | "slides" | "deviceSlides" | "creatives" | "mockups"> & { targets: TargetId[] | null };
export type ProjectStore = DraftStore<ProjectDoc>;

export const docOf = (project: Project): ProjectDoc => ({
  name: project.name,
  locales: project.locales,
  targets: project.targets ?? null,
  theme: project.theme,
  slides: project.slides,
  deviceSlides: project.deviceSlides ?? {},
  creatives: project.creatives ?? {},
  mockups: project.mockups ?? {},
});

export const remoteOf = (detail: Detail): Remote<ProjectDoc> => ({ doc: docOf(detail.project), revision: revisionOf(detail), updatedAt: detail.project.updatedAt });

/**
 * Changes the project's draft. A key an editor deletes, such as the export sizes picked, is put back as the empty
 * value the server takes for it, since a key left out of a save is a key the server leaves as it was.
 */
export function change(store: ProjectStore, recipe: (doc: ProjectDoc) => void, now = false): void {
  store.edit((doc) => {
    recipe(doc);
    doc.targets ??= null;
    doc.deviceSlides ??= {};
    doc.creatives ??= {};
    doc.mockups ??= {};
  }, now);
}

/** The project as the server has it now, which a refused save carries: its whole detail, or the project with its revision beside it. */
function remoteIn(body: unknown): Remote<ProjectDoc> | undefined {
  const { project, revision } = (body ?? {}) as { project?: unknown; revision?: unknown };
  const detail = (typeof project === "object" && project !== null && "project" in project ? project : { project, revision }) as Detail;
  return typeof detail.project === "object" && detail.project !== null && "slides" in detail.project ? remoteOf(detail) : undefined;
}

async function send(queryClient: QueryClient, id: string, changes: Partial<ProjectDoc>, revision: number | null, keepalive: boolean): Promise<Remote<ProjectDoc>> {
  let detail: Detail;
  try {
    detail = await saveProject(id, changes, revision, keepalive);
  } catch (error) {
    if (!(error instanceof ApiError)) throw new SaveError(errorText(error));
    if (error.status === 409) void queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
    throw new SaveError(error.message, error.status, error.status === 409 ? remoteIn(error.body) : undefined);
  }
  writeQuery(queryClient, detailQuery(id).queryKey, detail);
  renamed(queryClient, detail.project);
  return remoteOf(detail);
}

/** Puts a project's name and sets into the sidebar's list without waiting for its next poll. */
export function renamed(queryClient: QueryClient, project: Pick<Project, "id" | "name"> & Partial<Project>): void {
  writeQuery(queryClient, projectsQuery.queryKey, (list) =>
    list?.map((entry) =>
      entry.id !== project.id
        ? entry
        : {
            ...entry,
            name: project.name,
            ...(project.slides ? { slides: project.slides.length } : {}),
            ...(project.deviceSlides ? { ownSets: Object.keys(project.deviceSlides) as DeviceKind[] } : {}),
            ...(project.locales ? { locales: project.locales } : {}),
            ...(project.updatedAt ? { updatedAt: project.updatedAt } : {}),
          },
    ),
  );
}

// A project deleted and made again under its name is another project, so the stores go by when it was created too.
const stores = new Map<string, ProjectStore>();
const keyOf = (project: Project) => `${project.id}@${project.createdAt}`;

/** The draft store of a project, made from the detail the first time it is opened and kept while the Studio is open. */
export function projectDraft(queryClient: QueryClient, detail: Detail): ProjectStore {
  const key = keyOf(detail.project);
  let store = stores.get(key);
  if (!store) {
    const id = detail.project.id;
    store = new DraftStore<ProjectDoc>({ initial: remoteOf(detail), send: (changes, revision, keepalive) => send(queryClient, id, changes, revision, keepalive) });
    stores.set(key, store);
    watchLeaving();
  }
  return store;
}

/** Drops the store of a project that is gone, so nothing tries to save it again. */
export function forgetDraft(id: string): void {
  for (const [key, store] of stores) {
    if (!key.startsWith(`${id}@`)) continue;
    void store.pause();
    stores.delete(key);
  }
}

let watching = false;
/**
 * Leaving the Studio sends what is not saved yet, in a request that outlives the page, and asks first where that
 * may not be enough. Hiding the tab saves at once, since a phone can close a tab in the background without asking.
 */
function watchLeaving(): void {
  if (watching) return;
  watching = true;
  window.addEventListener("beforeunload", (event) => {
    let warn = false;
    for (const store of stores.values()) if (store.unload() === "warn") warn = true;
    if (warn) event.preventDefault();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) for (const store of stores.values()) void store.flush();
  });
}

const whole = <D,>(state: DraftState<D>) => state;

/** The store's state, or a part of it, which re-renders the component when it changes. */
export function useDraft<T = DraftState<ProjectDoc>>(store: ProjectStore, select: (state: DraftState<ProjectDoc>) => T = whole as (state: DraftState<ProjectDoc>) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

/** Where the browser's own undo is the one meant: the project name while it is typed, dialogs, searches, the JSON panel. */
const OWN_UNDO = ".bar-title, dialog, [role='dialog'], textarea.code, [aria-label^='Search']";

/** ⌘Z and ⇧⌘Z (Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y elsewhere) undo and redo edits of the project. */
export function useUndoKeys(store: ProjectStore): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.shiftKey);
      if (key !== "z" && !redo) return;
      if (event.target instanceof Element && event.target.closest(OWN_UNDO)) return;
      event.preventDefault();
      if (redo) store.redo();
      else store.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

/** Lets the rename and delete dialogs reach the open project: a rename goes through its draft, a delete stops its saving first. */
export function useOpenProject(store: ProjectStore, id: string, rename: (name: string) => void): void {
  useEffect(() => {
    openProject.id = id;
    openProject.rename = rename;
    openProject.quiesce = async () => {
      await store.pause();
      return () => store.resume();
    };
    return () => void (openProject.id = null);
  });
}
