// Notes at the bottom of the window that go away by themselves.

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface ToastAction {
  text: string;
  run: () => void;
}

interface Toast {
  id: number;
  message: string;
  kind: "" | "error" | "warn";
  action?: ToastAction;
}

let toasts: Toast[] = [];
let nextToast = 0;
/** The modal dialogs that are open, the top one last. */
let hosts: HTMLElement[] = [];
const watchers = new Set<() => void>();

function notifyAll() {
  for (const notify of watchers) notify();
}

function setToasts(next: Toast[]) {
  toasts = next;
  notifyAll();
}

const watch = (notify: () => void) => {
  watchers.add(notify);
  return () => void watchers.delete(notify);
};

/**
 * Draws the toasts inside a modal dialog while it is open. A modal lies over the rest of the page and makes it
 * inert, so a note about what the dialog did would otherwise sit under its backdrop. Hands back how to stop.
 */
export function hostToasts(dialog: HTMLElement): () => void {
  hosts = [...hosts, dialog];
  notifyAll();
  return () => {
    hosts = hosts.filter((entry) => entry !== dialog);
    notifyAll();
  };
}

/** Shows a note for a few seconds. With an `action` it carries a button, which also puts the note away. */
export function toast(message: string, kind: Toast["kind"] = "", ms = 4000, action?: ToastAction) {
  const id = ++nextToast;
  setToasts([...toasts, { id, message, kind, action }]);
  setTimeout(() => setToasts(toasts.filter((entry) => entry.id !== id)), ms);
}

export function Toasts() {
  const list = useSyncExternalStore(watch, () => toasts);
  const host = useSyncExternalStore(watch, () => hosts.at(-1) ?? null);
  const box = (
    <div className="toasts" aria-live="polite">
      {list.map((entry) => (
        <div key={entry.id} className={`toast ${entry.kind}`}>
          {entry.message}
          {entry.action ? (
            <button
              className="toast-action"
              type="button"
              onClick={() => {
                entry.action!.run();
                setToasts(toasts.filter((other) => other.id !== entry.id));
              }}
            >
              {entry.action.text}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
  return host ? createPortal(box, host) : box;
}
