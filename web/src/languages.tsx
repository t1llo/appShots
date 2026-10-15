// The languages of a project: the ones App Store Connect has, the switch beside the slides, and the list a project
// is set up with.

import { LOCALE } from "./api.ts";
import { Segmented, toast } from "./ui/index.ts";

/** The localisations of App Store Connect under the codes it uses itself, so an exported folder carries the name of the place it goes. */
export const STORE_LANGUAGES: [code: string, name: string][] = [
  ["ar-SA", "Arabic"],
  ["bn-BD", "Bengali"],
  ["ca", "Catalan"],
  ["zh-Hans", "Chinese (Simplified)"],
  ["zh-Hant", "Chinese (Traditional)"],
  ["hr", "Croatian"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["nl-NL", "Dutch"],
  ["en-AU", "English (Australia)"],
  ["en-CA", "English (Canada)"],
  ["en-GB", "English (U.K.)"],
  ["en-US", "English (U.S.)"],
  ["fi", "Finnish"],
  ["fr-FR", "French"],
  ["fr-CA", "French (Canada)"],
  ["de-DE", "German"],
  ["el", "Greek"],
  ["gu-IN", "Gujarati"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["hu", "Hungarian"],
  ["id", "Indonesian"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["kn-IN", "Kannada"],
  ["ko", "Korean"],
  ["ms", "Malay"],
  ["ml-IN", "Malayalam"],
  ["mr-IN", "Marathi"],
  ["no", "Norwegian"],
  ["or-IN", "Odia"],
  ["pl", "Polish"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["pt-PT", "Portuguese (Portugal)"],
  ["pa-IN", "Punjabi"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["sk", "Slovak"],
  ["sl-SI", "Slovenian"],
  ["es-MX", "Spanish (Mexico)"],
  ["es-ES", "Spanish (Spain)"],
  ["sv", "Swedish"],
  ["ta-IN", "Tamil"],
  ["te-IN", "Telugu"],
  ["th", "Thai"],
  ["tr", "Turkish"],
  ["uk", "Ukrainian"],
  ["ur-PK", "Urdu"],
  ["vi", "Vietnamese"],
];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
let browserNames: Intl.DisplayNames | null = null;

/** "German" for de-DE. A code App Store Connect does not have is named by the browser. */
export function languageName(code: string): string {
  const known = STORE_LANGUAGES.find(([other]) => same(other, code));
  if (known) return known[1];
  try {
    browserNames ??= new Intl.DisplayNames(["en"], { type: "language" });
    return browserNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** A menu of the languages a project does not have yet. Picking one adds it. */
export function AddLanguage({ taken, onAdd, text = "+ Language" }: { taken: string[]; onAdd: (code: string) => void; text?: string }) {
  const has = (code: string) => taken.some((other) => same(other, code));
  const add = (value: string) => {
    if (value !== "other") return onAdd(value);
    const typed = prompt("The language as a code, such as en-IE, de-CH or es-419:")?.trim();
    if (!typed) return;
    if (!LOCALE.test(typed)) return toast("A language is a code such as en-GB or pt-BR.", "error");
    if (has(typed)) return toast(`The project already has ${typed}.`);
    onAdd(typed);
  };
  return (
    <select className="add-language" aria-label="Add a language" title="Add a language" disabled={taken.length >= 40} value="" onChange={(event) => add(event.target.value)}>
      <option value="" disabled hidden>
        {text}
      </option>
      {STORE_LANGUAGES.filter(([code]) => !has(code)).map(([code, name]) => (
        <option key={code} value={code}>
          {name} · {code}
        </option>
      ))}
      <option value="other">Another code…</option>
    </select>
  );
}

/** Picks the language the page shows: its texts, and its own screenshots where it has them. */
export function LanguageSwitch({ locales, value, onChange, onAdd }: { locales: string[]; value: string; onChange: (code: string) => void; onAdd?: (code: string) => void }) {
  return (
    <div className="language-pick">
      {locales.length > 6 ? (
        <select aria-label="Language shown" title="The language shown" value={value} onChange={(event) => onChange(event.target.value)}>
          {locales.map((code) => (
            <option key={code} value={code}>
              {languageName(code)} · {code}
            </option>
          ))}
        </select>
      ) : (
        <Segmented label="Language shown" choices={locales.map((code) => ({ id: code, text: code, title: `Show the set in ${languageName(code)}` }))} value={value} onChange={onChange} />
      )}
      {onAdd ? <AddLanguage taken={locales} onAdd={onAdd} /> : null}
    </div>
  );
}

/** The languages of a project as a list. The first is the one the others fall back to. */
export function LanguageList({ locales, onChange }: { locales: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="languages">
      {locales.map((code, at) => {
        const name = languageName(code);
        return (
          <div key={code} className="language">
            <span className="language-name">{name}</span>
            <span className="dim">{code}</span>
            <span className="spacer" />
            {at === 0 ? (
              <span className="pill" title="Its texts and screenshots are what a language shows until it has its own.">
                First
              </span>
            ) : (
              <button className="btn small quiet" type="button" title={`Make ${name} the language the others fall back to`} onClick={() => onChange([code, ...locales.filter((other) => other !== code)])}>
                Make first
              </button>
            )}
            <button className="icon-btn" type="button" disabled={locales.length === 1} title={`Remove ${name}`} aria-label={`Remove ${name}`} onClick={() => onChange(locales.filter((other) => other !== code))}>
              ×
            </button>
          </div>
        );
      })}
      <AddLanguage taken={locales} onAdd={(code) => onChange([...locales, code])} text="+ Add a language" />
    </div>
  );
}
