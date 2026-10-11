// Light or dark. With nothing chosen the pages follow the system; a choice is kept in this browser.
// The <head> of both pages applies a kept choice before the first paint (see index.html and home.html).

export type Appearance = "system" | "light" | "dark";

const KEY = "appshots.theme";

export function readAppearance(): Appearance {
  try {
    const kept = localStorage.getItem(KEY);
    return kept === "light" || kept === "dark" ? kept : "system";
  } catch {
    return "system";
  }
}

export function setAppearance(next: Appearance): void {
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {}
}

/** What is on screen right now, whichever way it was decided. */
export function shownAppearance(): "light" | "dark" {
  const chosen = readAppearance();
  if (chosen !== "system") return chosen;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
