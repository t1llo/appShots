import { useRef, useState } from "react";
import { copyKeys, copyText } from "../clipboard.ts";

export function CopyBlock({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy");
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div className="copy">
      <pre ref={pre}>{text}</pre>
      <button
        className="btn small"
        type="button"
        onClick={async () => {
          const copied = await copyText(text, pre.current!);
          setLabel(copied ? "Copied" : `Press ${copyKeys}`);
          setTimeout(() => setLabel("Copy"), copied ? 1200 : 3000);
        }}
      >
        {label}
      </button>
    </div>
  );
}
