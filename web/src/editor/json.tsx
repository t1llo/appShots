// The JSON of a slide or an asset, to read and to edit as a whole.

import { useEffect, useRef, useState } from "react";
import { errorText } from "../api.ts";
import { Section } from "./section.tsx";

export function JsonSection({ value, onApply, hint }: { value: object; onApply: (parsed: object) => void; hint: string }) {
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
  const apply = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
      setError("");
      onApply(parsed);
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  return (
    <Section id="json" title="JSON" hint={hint}>
      <textarea className="code" rows={14} spellCheck={false} ref={area} value={text} onChange={(event) => setText(event.target.value)} />
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="actions">
        <button className="btn small" type="button" onClick={apply}>
          Apply
        </button>
      </div>
    </Section>
  );
}
