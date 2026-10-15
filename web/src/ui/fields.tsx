// The small controls every page and panel is made of.

import { type ReactNode, useEffect, useRef, useState } from "react";

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
