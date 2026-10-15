/**
 * The languages a store page can have, by the codes App Store Connect knows them by. The Studio offers the same
 * list (web/src/languages.tsx).
 */
export const ASC_LOCALES = [
  "ar-SA", "bn-BD", "ca", "zh-Hans", "zh-Hant", "hr", "cs", "da", "nl-NL", "en-AU", "en-CA", "en-GB", "en-US", "fi", "fr-FR", "fr-CA", "de-DE", "el", "gu-IN", "he",
  "hi", "hu", "id", "it", "ja", "kn-IN", "ko", "ms", "ml-IN", "mr-IN", "no", "or-IN", "pl", "pt-BR", "pt-PT", "pa-IN", "ro", "ru", "sk", "sl-SI", "es-MX", "es-ES",
  "sv", "ta-IN", "te-IN", "th", "tr", "uk", "ur-PK", "vi",
];

// The code a language goes by there when App Store Connect has it only with a region or a script: a project
// that says "de" means the German page, which is de-DE.
const REGIONS = {
  en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES", pt: "pt-BR", nl: "nl-NL", zh: "zh-Hans", ar: "ar-SA", bn: "bn-BD", gu: "gu-IN", kn: "kn-IN",
  ml: "ml-IN", mr: "mr-IN", or: "or-IN", pa: "pa-IN", ta: "ta-IN", te: "te-IN", sl: "sl-SI", ur: "ur-PK",
};

// Other codes for the same languages, as browsers and older systems write them.
const ALIASES = { "zh-cn": "zh-Hans", "zh-sg": "zh-Hans", "zh-tw": "zh-Hant", "zh-hk": "zh-Hant", "zh-mo": "zh-Hant", "es-419": "es-MX", "es-us": "es-MX", nb: "no", nn: "no", iw: "he", in: "id" };

/** @param {string} a @param {string} b */
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * The code App Store Connect has for a language a project names, or null when it has none: de is de-DE, de-AT
 * is de-DE as well, zh-TW is zh-Hant, ja-JP is ja.
 * @param {string} code
 * @returns {string | null}
 */
export function ascLocale(code) {
  const lower = code.toLowerCase();
  const exact = ASC_LOCALES.find((entry) => same(entry, lower));
  if (exact) return exact;
  if (lower in ALIASES) return ALIASES[lower];
  // zh-Hant-TW: the language and script App Store Connect goes by, with a region after them.
  const longer = ASC_LOCALES.filter((entry) => entry.includes("-") && lower.startsWith(`${entry.toLowerCase()}-`)).sort((a, b) => b.length - a.length)[0];
  if (longer) return longer;
  const bare = lower.split("-")[0];
  return ALIASES[bare] ?? REGIONS[bare] ?? ASC_LOCALES.find((entry) => same(entry, bare)) ?? null;
}

/**
 * Whether two codes mean one language: the same code, or the same language where one of them names no region.
 * @param {string} a
 * @param {string} b
 */
export const sameLanguage = (a, b) => same(a, b) || ((!a.includes("-") || !b.includes("-")) && a.toLowerCase().split("-")[0] === b.toLowerCase().split("-")[0]);

/**
 * @typedef {object} StoreLocale
 * @property {string | null} code The language of the store page, or the one it would be added as; null when App
 *   Store Connect has no such language.
 * @property {boolean} listed Whether the store page has it already.
 * @property {string[]} [others] The other languages of the page it could have been, when there was a choice.
 */

/**
 * The language of the store page a folder or a text is for. `to` is the one the user named; otherwise the same
 * code, the only one of the same language, the app's primary language among several (en for an app made in
 * en-US with an en-GB page as well), or the code App Store Connect has for it.
 * @param {string} code
 * @param {string[]} listed The languages the store page has.
 * @param {{ primary?: string, to?: string }} [options]
 * @returns {StoreLocale}
 */
export function storeLocale(code, listed, { primary, to } = {}) {
  const find = (wanted) => listed.find((entry) => same(entry, wanted));
  if (to) {
    const there = find(to);
    return there ? { code: there, listed: true } : { code: ascLocale(to), listed: false };
  }
  const exact = find(code);
  if (exact) return { code: exact, listed: true };
  const close = listed.filter((entry) => sameLanguage(entry, code));
  if (close.length === 1) return { code: close[0], listed: true };
  const canonical = ascLocale(code);
  if (close.length > 1) {
    const chosen = close.find((entry) => primary && same(entry, primary)) ?? close.find((entry) => canonical && same(entry, canonical));
    if (chosen) return { code: chosen, listed: true, others: close.filter((entry) => entry !== chosen) };
    return { code: null, listed: false, others: close };
  }
  const there = canonical ? find(canonical) : undefined;
  if (there) return { code: there, listed: true };
  return { code: canonical, listed: false };
}
