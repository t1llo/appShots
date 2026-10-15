// The JSON of a slide or an asset, to read and to edit as a whole.

import { useEffect, useRef, useState } from "react";
import { errorText } from "../api.ts";
import { Section } from "./section.tsx";

/**
 * Applies only what the server would take: a save sends all the slides, or all the assets, at once, so one it turns
 * down would hold back every later edit to them, wherever it is made.
 */
export function JsonSection({ kind, value, onApply, hint }: { kind: "slide" | "creative"; value: object; onApply: (parsed: object) => void; hint: string }) {
  const pretty = JSON.stringify(value, null, 2);
  const [text, setText] = useState(pretty);
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  // Follows the form, except while it is being typed in.
  useEffect(() => {
    if (document.activeElement === area.current) return;
    setText(pretty);
    setError("");
  }, [pretty]);
  const apply = async () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
      const { check } = await import("./check.ts");
      const checked = check(kind, parsed);
      if ("error" in checked) return setError(checked.error);
      setError("");
      onApply(checked.item);
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  return (
    <Section id="json" title="JSON" hint={hint}>
      <textarea className="code" rows={14} spellCheck={false} ref={area} value={text} onChange={(event) => setText(event.target.value)} />
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="actions">
        <button className="btn small" type="button" onClick={() => void apply()}>
          Apply
        </button>
      </div>
    </Section>
  );
}
