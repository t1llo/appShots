// A text that can differ by language.

import type { ChangeEvent } from "react";
import { readText, type Text, withText } from "../api.ts";
import { useScope } from "./scope.ts";

export function TextInput(props: { value: Text | undefined; onChange: (next: Text | undefined) => void; rows?: number; placeholder?: string }) {
  const { value, onChange, rows, placeholder } = props;
  const { locale, primary } = useScope();
  const fallback = value && typeof value === "object" ? (value[primary] ?? "") : "";
  const shared = {
    value: readText(value, locale),
    placeholder: fallback || placeholder || "",
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(withText(value, event.target.value, locale, primary)),
  };
  return rows ? <textarea rows={rows} {...shared} /> : <input type="text" {...shared} />;
}
