import type { Text } from "../../schema.ts";

export const esc = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function pick(text: Text | undefined, locale: string, fallback: string): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  return text[locale] ?? text[locale.split("-")[0]!] ?? text[fallback] ?? Object.values(text)[0] ?? "";
}

/** Escapes copy, then turns *emphasis* into accent spans and newlines into breaks. */
export function rich(value: string): string {
  return esc(value)
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/\r?\n/g, "<br>");
}

export const round = (value: number) => Math.round(value * 100) / 100;
export const round4 = (value: number) => Math.round(value * 10000) / 10000;

/** The quotation marks a language sets a quote in, by its language code. Any other takes the English ones. */
const QUOTES: Record<string, [string, string]> = {
  ar: ["«", "»"],
  fa: ["«", "»"],
  ur: ["«", "»"],
  de: ["„", "“"],
  fr: ["« ", " »"],
  ru: ["«", "»"],
  uk: ["«", "»"],
  ja: ["「", "」"],
};

/** A review's words in the quotation marks of the language, unless they come quoted already. */
export function quoted(said: string, locale: string): string {
  if (!said || /^["'“”„«»‹‘「]/.test(said)) return said;
  const [open, close] = QUOTES[locale.split("-")[0]!.toLowerCase()] ?? ["“", "”"];
  return `${open}${said}${close}`;
}

/** Languages written from right to left, by their language code. */
const RIGHT_TO_LEFT = new Set(["ar", "ckb", "dv", "fa", "he", "iw", "ps", "sd", "ug", "ur", "yi"]);

export const directionOf = (locale: string): "ltr" | "rtl" => (RIGHT_TO_LEFT.has(locale.split("-")[0]!.toLowerCase()) ? "rtl" : "ltr");

/** Numbers the ids a page gives its gradients and filters, so the same page always comes out the same. */
export interface Ids {
  next(prefix: string): number;
}

export function createIds(): Ids {
  const counts = new Map<string, number>();
  return {
    next(prefix) {
      const n = (counts.get(prefix) ?? 0) + 1;
      counts.set(prefix, n);
      return n;
    },
  };
}
