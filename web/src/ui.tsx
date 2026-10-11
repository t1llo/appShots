import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------- toasts

interface Toast {
  id: number;
  message: string;
  kind: "" | "error" | "warn";
}

let toasts: Toast[] = [];
let nextToast = 0;
const watchers = new Set<() => void>();

function setToasts(next: Toast[]) {
  toasts = next;
  for (const notify of watchers) notify();
}

export function toast(message: string, kind: Toast["kind"] = "", ms = 4000) {
  const id = ++nextToast;
  setToasts([...toasts, { id, message, kind }]);
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
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- dialog

/** A modal that exists only while it is open. Put `data-autofocus` on the element that should take the focus. */
export function Dialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose}>
      {children}
    </dialog>
  );
}

// ---------------------------------------------------------------- controls

export function Icon({ path }: { path: string }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export type Option = readonly [id: string, text: string];

export function Select({ options, value, onChange, label }: { options: readonly Option[]; value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
      {options.map(([id, text]) => (
        <option key={id} value={id}>
          {text}
        </option>
      ))}
    </select>
  );
}

/** Reports a number clamped to its range, or null when empty. What is being typed is left alone until the field loses focus. */
export function NumberInput(props: { value: number | undefined; onChange: (value: number | null) => void; min: number; max: number; step: number; placeholder?: string; label?: string }) {
  const { value, onChange, min, max, step, placeholder, label } = props;
  const shown = value == null ? "" : String(value);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={label}
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(shown);
      }}
      onChange={(event) => {
        setText(event.target.value);
        const number = event.target.value === "" ? Number.NaN : Number(event.target.value);
        onChange(Number.isNaN(number) ? null : Math.min(max, Math.max(min, number)));
      }}
    />
  );
}

export interface MenuItem {
  text: string;
  danger?: boolean;
  run: () => void;
}

/** A "more" button that opens a small menu under itself. The menu is drawn over the page, so a scrolling list cannot clip it. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest(".menu") && !button.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [at]);
  return (
    <>
      <button
        ref={button}
        className="icon-btn plain more"
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={at != null}
        onClick={() => {
          const box = button.current!.getBoundingClientRect();
          setAt(at ? null : { left: box.left, top: box.bottom + 4 });
        }}
      >
        <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.2" />
        </svg>
      </button>
      {at
        ? createPortal(
            <div className="menu" role="menu" style={{ left: at.left, top: at.top }}>
              {items.map((item) => (
                <button
                  key={item.text}
                  className={`menu-item${item.danger ? " danger" : ""}`}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAt(null);
                    item.run();
                  }}
                >
                  {item.text}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy">
      <pre>{text}</pre>
      <button
        className="btn small"
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
