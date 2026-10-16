import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorText } from "../api.ts";
import { hostToasts, toast } from "./toast.tsx";

/**
 * A modal that exists only while it is open. Put `data-autofocus` on the element that should take the focus. When it
 * goes, the focus goes back to where it was before, which the browser does only for a dialog closed by its own steps,
 * not for one taken out of the page. `className` gives it another shape, such as a drawer at the side.
 */
export function Dialog({ onClose, className, label, children }: { onClose: () => void; className?: string; label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // The close event comes after the cleanup below has closed the dialog itself, so that one is not passed on.
  const live = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    const before = document.activeElement;
    live.current = true;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const unhost = hostToasts(dialog);
    return () => {
      live.current = false;
      unhost();
      if (dialog.open) dialog.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onClose={() => {
        if (live.current && !ref.current?.open) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

/**
 * Asks before doing something that is hard to take back. `run` does it and closes the dialog. A failure stays in the
 * dialog, next to the button that caused it, so it can be tried again or cancelled. Cancelling does not stop a run
 * that has started, so one that fails after the dialog has gone is told in a toast instead.
 */
export function Confirm(props: { title: ReactNode; children?: ReactNode; action: string; running: string; danger?: boolean; run: () => Promise<unknown>; onClose: () => void }) {
  const { title, children, action, running, danger, run, onClose } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (failure) {
      if (!shown.current) return toast(errorText(failure), "error");
      setError(errorText(failure));
      setBusy(false);
    }
  };

  return (
    <Dialog onClose={onClose}>
      <h1>{title}</h1>
      {children ? <p className="dialog-sub">{children}</p> : null}
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="foot">
        <button className="btn" type="button" data-autofocus onClick={onClose}>
          Cancel
        </button>
        <button className={danger ? "btn danger solid" : "btn primary"} type="button" disabled={busy} onClick={() => void go()}>
          {busy ? running : action}
        </button>
      </div>
    </Dialog>
  );
}

/** What `ask` asks: the Confirm dialog's title, line and button, and what is done on yes. */
export interface Question {
  title: string;
  text?: ReactNode;
  action: string;
  running: string;
  danger?: boolean;
  run: () => unknown;
}

let questions: (Question & { id: number })[] = [];
let nextQuestion = 0;
const askers = new Set<() => void>();

function setQuestions(next: typeof questions) {
  questions = next;
  for (const notify of askers) notify();
}

const watchQuestions = (notify: () => void) => {
  askers.add(notify);
  return () => void askers.delete(notify);
};

/**
 * Asks in a Confirm dialog before something is done that is hard to take back, from code that would otherwise have
 * stopped the page with the browser's own confirm(). `run` is done on yes; when it fails, the dialog says why.
 */
export function ask(question: Question): void {
  setQuestions([...questions, { ...question, id: ++nextQuestion }]);
}

/** Shows what `ask` asks, one question at a time, over whatever else is open. */
export function Questions() {
  const question = useSyncExternalStore(watchQuestions, () => questions[0]);
  if (!question) return null;
  const done = () => setQuestions(questions.filter((entry) => entry.id !== question.id));
  return (
    <Confirm
      key={question.id}
      title={question.title}
      action={question.action}
      running={question.running}
      danger={question.danger}
      onClose={done}
      run={async () => {
        await question.run();
        done();
      }}
    >
      {question.text}
    </Confirm>
  );
}
