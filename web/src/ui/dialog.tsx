import { type ReactNode, useEffect, useRef } from "react";

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
