// The folding parts the panel is divided into.

import { type ReactNode, useState } from "react";

/** Which sections were opened or closed by hand. That survives switching between slides and assets. */
const openSections: Record<string, boolean> = {};

/**
 * One part of the panel under a heading that folds it away. A part that holds something starts open, an empty one
 * closed, and one that was opened or closed by hand stays that way.
 */
export function Section(props: { id: string; title: string; hint?: ReactNode; count?: number; open?: boolean; actions?: ReactNode; children: ReactNode }) {
  const { id, title, hint, count, actions, children } = props;
  const [open, setOpen] = useState(openSections[id] ?? props.open ?? false);
  return (
    <details className="section" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          openSections[id] = !open;
          setOpen(!open);
        }}
      >
        <span className="section-title">{title}</span>
        {count ? <span className="count">{count}</span> : null}
      </summary>
      {open ? (
        <div className="stack">
          {hint || actions ? (
            <div className="section-note">
              <span className="hint">{hint}</span>
              {actions}
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </details>
  );
}
