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

/**
 * Reports a number, or null when empty. While it is being typed only a number inside its range is reported, so
 * typing 1200 into a field that starts at 200 does not pass through 200; leaving the field or pressing Enter brings
 * a number outside the range into it, and anything else back to the last value.
 */
export function NumberInput(props: { value: number | undefined; onChange: (value: number | null) => void; min: number; max: number; step: number; placeholder?: string; label?: string }) {
  const { value, onChange, min, max, step, placeholder, label } = props;
  const shown = value == null ? "" : String(value);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const settle = (raw: string) => {
    const number = raw === "" ? Number.NaN : Number(raw);
    if (!Number.isFinite(number) || (number >= min && number <= max)) return setText(shown);
    const clamped = Math.min(max, Math.max(min, number));
    onChange(clamped);
    setText(String(clamped));
  };
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
      onBlur={(event) => {
        focused.current = false;
        settle(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") settle(event.currentTarget.value);
      }}
      onChange={(event) => {
        setText(event.target.value);
        // A half-typed number such as "1e" reads as empty, which is not the same as a field that was cleared.
        if (event.target.validity.badInput) return;
        if (event.target.value === "") return onChange(null);
        const number = Number(event.target.value);
        if (number >= min && number <= max) onChange(number);
      }}
    />
  );
}
