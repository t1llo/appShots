// A text that can differ by language.

import type { ChangeEvent } from "react";
import { readText, type Text, withText } from "../api.ts";
import { useScope } from "./scope.ts";

export function TextInput(props: { value: Text | undefined; onChange: (next: Text | undefined) => void; rows?: number; placeholder?: string }) {
  const { value, onChange, rows, placeholder } = props;
  const { locale, primary } = useScope();
  // Outside the first language, a plain string is shown the way an untranslated entry of a map is: as the
  // placeholder, so typing starts the translation instead of adding to the original.
  const own = typeof value === "string" && locale !== primary ? "" : readText(value, locale);
  const fallback = typeof value === "string" ? value : (value?.[primary] ?? "");
  const shared = {
    value: own,
    placeholder: fallback || placeholder || "",
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(withText(value, event.target.value, locale, primary)),
  };
  return rows ? <textarea rows={rows} {...shared} /> : <input type="text" {...shared} />;
}
