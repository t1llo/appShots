// Notes at the bottom of the window that go away by themselves.

import { useSyncExternalStore } from "react";

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
const watchers = new Set<() => void>();

function setToasts(next: Toast[]) {
  toasts = next;
  for (const notify of watchers) notify();
}

/** Shows a note for a few seconds. With an `action` it carries a button, which also puts the note away. */
export function toast(message: string, kind: Toast["kind"] = "", ms = 4000, action?: ToastAction) {
  const id = ++nextToast;
  setToasts([...toasts, { id, message, kind, action }]);
  setTimeout(() => setToasts(toasts.filter((entry) => entry.id !== id)), ms);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (notify) => {
      watchers.add(notify);
      return () => watchers.delete(notify);
    },
    () => toasts,
  );
  return (
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
}
