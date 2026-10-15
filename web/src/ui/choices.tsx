// Rows of choices that take the Tab key once and move with the arrow keys, as the system's own controls do.

import type { KeyboardEvent, ReactNode } from "react";
import { arrowMove } from "./keys.ts";

export interface Choice<T extends string> {
  id: T;
  text: ReactNode;
  title?: string;
}

/** Picks the choice the arrow keys, Home or End point at, and moves the focus along with it. */
function onArrows<T extends string>(choices: readonly Choice<T>[], value: T, onChange: (id: T) => void, axis: "row" | "both") {
  return (event: KeyboardEvent<HTMLElement>) => {
    const next = arrowMove(event.key, choices.findIndex((choice) => choice.id === value), choices.length, axis);
    if (next == null) return;
    event.preventDefault();
    onChange(choices[next].id);
    event.currentTarget.querySelectorAll<HTMLElement>("button")[next]?.focus();
  };
}

/** Only the choice that is on is reached with Tab, or the first while none is. */
const tabStop = <T extends string>(choices: readonly Choice<T>[], value: T, index: number) => (index === Math.max(0, choices.findIndex((choice) => choice.id === value)) ? 0 : -1);

/** A few choices side by side, one of them on. */
export function Segmented<T extends string>({ label, choices, value, onChange }: { label: string; choices: readonly Choice<T>[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={onArrows(choices, value, onChange, "both")}>
      {choices.map((choice, index) => (
        <button
          key={choice.id}
          className={choice.id === value ? "on" : ""}
          type="button"
          role="radio"
          aria-checked={choice.id === value}
          tabIndex={tabStop(choices, value, index)}
          title={choice.title}
          onClick={() => onChange(choice.id)}
        >
          {choice.text}
        </button>
      ))}
    </div>
  );
}

/** The tabs at the top of a panel. The left and right arrow keys open the one beside the open one. */
export function Tabs<T extends string>({ label, choices, value, onChange }: { label: string; choices: readonly Choice<T>[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onArrows(choices, value, onChange, "row")}>
      {choices.map((choice, index) => (
        <button
          key={choice.id}
          className={`tab${choice.id === value ? " on" : ""}`}
          type="button"
          role="tab"
          aria-selected={choice.id === value}
          tabIndex={tabStop(choices, value, index)}
          title={choice.title}
          onClick={() => onChange(choice.id)}
        >
          {choice.text}
        </button>
      ))}
    </div>
  );
}
