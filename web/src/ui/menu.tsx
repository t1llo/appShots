import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
