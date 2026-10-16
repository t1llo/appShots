import { ICON_GROUPS, type IconId } from "../icons.ts";
import type { Creative, Slide, Text } from "../schema.ts";
import { DEVICE_LABELS, type DeviceKind, PLACEMENTS, type PlacementId, type TargetId } from "../sizes.ts";
import { type LayoutId, layoutDef } from "../template/layouts/index.ts";
import { pick } from "../template/parts/text.ts";

// What a set breaks of the rules App Review applies to store images, and how its copy came out once the pages had
// fitted it. Nothing here reads the disk or draws: the plan hands in the copy, and the render what its pages measured.
// A finding never stops a render. It is said once with the render's other warnings, and listed as data under `lint`.

export type LintRule =
  /** One of Apple's own recognitions, such as Editors' Choice. */
  | "apple-recognition"
  | "price"
  | "free"
  | "ranking"
  | "date"
  /** The Apple logo or the App Store's. */
  | "apple-artwork"
  /** Another platform or app store, such as Android or Google Play. */
  | "other-platform"
  | "third-party-logo"
  /** The copy was shrunk below SCALE_LIMIT of its designed size to fit. */
  | "headline-scaled"
  /** The copy does not fit even at the smallest size it is shrunk to. */
  | "copy-overflow"
  | "headline-lines"
  | "safe-area";

export interface LintWarning {
  rule: LintRule;
  /** The language it was found in. Left out for what is the same in every language, such as a logo. */
  locale?: string;
  /** The device whose own set the slide is in. Left out for a slide of the shared set. */
  ownSet?: DeviceKind;
  /** Zero-based, as a render's files count slides. */
  slide?: number;
  /** A header, search results or universal asset, or a banner. */
  placement?: PlacementId;
  /** What fitting found is about the device and the size the page was drawn for. */
  device?: DeviceKind;
  target?: TargetId;
  /** Where in the slide or asset, as a path of its fields: "headline", "badges[0].title", "iconRow". */
  field?: string;
  /** The words found, or the logos, by icon id and separated by commas. */
  match?: string;
  /** What was measured, and the limit it is past: the copy's share of its designed size, or the headline's lines. */
  value?: number;
  limit?: number;
  /** One sentence saying so. */
  text: string;
}

/** Below this share of its designed size, the copy reads smaller than the rest of the set. */
export const SCALE_LIMIT = 0.75;

/** The most lines a headline should take, so it reads at the size the store shows a slide. */
export function lineLimit(layout: LayoutId | undefined, placement: PlacementId | undefined): number {
  // Header and search results assets carry one short phrase.
  if (placement) return PLACEMENTS[placement].kind === "store" ? 2 : 3;
  // A statement is all headline, and a column beside a device is narrow.
  if (layout === "statement" || (layout && layoutDef(layout).side)) return 4;
  return 3;
}

// ---------------------------------------------------------------- the copy

/** A pattern that matches whole words only, in any script. */
const word = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "giu");
/** A pattern for a script without spaces between words, or one that carries its own edges. */
const raw = (source: string) => new RegExp(source, "giu");

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|januar|februar|märz|mai|juni|juli|oktober|dezember";
const SHORT_MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const YEAR = "(?:199\\d|20[0-3]\\d)";

/** The words each rule looks for. Kept narrow: a warning that is wrong half the time teaches people to ignore them all. */
const PHRASES: Partial<Record<LintRule, RegExp[]>> = {
  "apple-recognition": [
    word("editors?['’ʼ]?s?['’ʼ]?\\s+choice"),
    word("(?:app|game) of the day"),
    word("(?:(?:iphone|ipad|mac|apple watch|apple tv|apple arcade|vision pro)\\s+)?app of the year"),
    word("(?:iphone|ipad|mac|apple arcade)\\s+game of the year"),
    word("apple design awards?"),
    word("app store awards?"),
    word("featured (?:by|on|in) (?:apple|the app store)"),
    word("apps? we love"),
    word("app des (?:tages|jahres)|spiel des tages"),
    word("app(?:li)? du jour|jeu du jour|app de l['’]année"),
    word("app del día|juego del día|app del giorno|gioco del giorno"),
    word("app do dia|jogo do dia|app van de dag"),
  ],
  price: [
    raw("[$€£¥₹₩₽₺]\\s?\\d+(?:[.,]\\d+)?"),
    raw("(?<![\\p{L}\\p{N}.,])\\d+(?:[.,]\\d+)?\\s?[$€£¥₹₩₽₺]"),
    word("\\d+(?:[.,]\\d+)?\\s?(?:usd|eur|gbp|chf|jpy|cad|aud|sek|nok|dkk|pln|kr|zł)"),
    word("\\d{1,3}\\s?%\\s?(?:off|rabatt|de réduction|de descuento|di sconto|de desconto|korting)"),
    raw("(?<![\\p{L}\\p{N}])[-−–]\\s?\\d{1,3}\\s?%"),
    word("on sale|half[- ]price"),
  ],
  free: [
    // Not "ad-free", "feel free", "free time" or "free up space": those say nothing about the price.
    word("(?<![-‐]|(?:feel|set|break|go)\\s)free(?![-‐](?!to[-‐ ]play))(?!\\s+(?:of|from|up|yourself|your|time|space|form|hands?|flow|style|will|speech)(?![\\p{L}]))"),
    word("free[-‐ ]to[-‐ ]play"),
    word("kostenlos\\p{L}*|umsonst|gratis|gratuit\\p{L}*|grátis|darmow\\p{L}*|za darmo|bezpłatn\\p{L}*|бесплатн\\p{L}*|ücretsiz"),
    raw("無料|免费|免費|무료"),
  ],
  ranking: [
    raw("(?<![\\p{L}\\p{N}&])#\\s?\\d{1,3}(?!\\p{N})"),
    word("(?:no|nr|n[º°])\\.?\\s?1"),
    word("number one"),
    word("top[- ](?:rated|ranked|selling|grossing|charts?)"),
    word("best[- ]?(?:selling|seller|rated)|highest[- ]rated|chart[- ]topping|most (?:popular|downloaded)"),
    word("platz (?:1|eins)|meistgeladen\\p{L}*|bestbewertet\\p{L}*"),
  ],
  date: [
    word(`(?:in|of|since|from|until|by|seit|im|ab|bis|depuis|desde|dal|sinds|est\\.?|copyright|${MONTHS}|${SHORT_MONTHS})\\s+${YEAR}`),
    raw(`©\\s?${YEAR}(?!\\p{N})`),
    word(`${YEAR}\\s+(?:edition|update|release|version|ausgabe|édition|edición)`),
    word("\\d{1,2}[./-]\\d{1,2}[./-](?:\\d{4}|\\d{2})"),
    word("(?:19|20)\\d\\d-\\d{2}-\\d{2}"),
    word(`(?:${MONTHS}|${SHORT_MONTHS})\\.?\\s\\d{1,2}(?:st|nd|rd|th)?`),
    word(`\\d{1,2}(?:st|nd|rd|th|\\.)?\\s(?:of\\s)?(?:${MONTHS})`),
  ],
};

const TEXT_RULES = Object.keys(PHRASES) as LintRule[];

/** The words of a text as a page shows them: without the asterisks that mark words, and with its breaks as spaces. */
const plain = (text: string) => text.replace(/\*/g, "").replace(/\s+/g, " ").trim();

/** Every rule's finds in one text, each once. */
export function findPhrases(text: string): { rule: LintRule; match: string }[] {
  const said = plain(text);
  const found: { rule: LintRule; match: string }[] = [];
  for (const rule of TEXT_RULES) {
    const matches = new Set<string>();
    for (const pattern of PHRASES[rule]!) for (const match of said.matchAll(pattern)) matches.add(match[0].trim());
    // A price also reads as a figure; the shorter of two overlapping finds is part of the longer.
    for (const match of matches) if (![...matches].some((other) => other !== match && other.includes(match))) found.push({ rule, match });
  }
  return found;
}

/** The text fields of a slide or an asset, by the path of each. */
function texts(item: Slide | Creative): [string, Text | undefined][] {
  const fields: [string, Text | undefined][] = [
    ["eyebrow", item.eyebrow],
    ["headline", item.headline],
    ["subheadline", item.subheadline],
  ];
  for (const [i, badge] of (item.badges ?? []).entries()) fields.push([`badges[${i}].title`, badge.title], [`badges[${i}].subtitle`, badge.subtitle]);
  if ("features" in item) {
    for (const [i, feature] of (item.features ?? []).entries()) fields.push([`features[${i}].value`, feature.value], [`features[${i}].title`, feature.title], [`features[${i}].text`, feature.text]);
  }
  if ("iconRow" in item) fields.push(["iconRow.label", item.iconRow?.label]);
  return fields;
}

const BRANDS = new Set<IconId>(ICON_GROUPS.Brands);
const APPLE_ARTWORK = new Set<IconId>(["apple", "app-store"]);
const OTHER_PLATFORMS = new Set<IconId>(["android", "google-play", "windows", "steam"]);

const BRAND_NAMES: Partial<Record<IconId, string>> = {
  apple: "the Apple logo",
  "app-store": "the App Store logo",
  "apple-podcasts": "Apple Podcasts",
  github: "GitHub",
  "google-drive": "Google Drive",
  "google-play": "Google Play",
  linkedin: "LinkedIn",
  openai: "OpenAI",
  paypal: "PayPal",
  soundcloud: "SoundCloud",
  tiktok: "TikTok",
  wechat: "WeChat",
  whatsapp: "WhatsApp",
  youtube: "YouTube",
  x: "X",
};

const brandName = (id: string) => BRAND_NAMES[id as IconId] ?? id.replace(/(^|-)(\w)/g, (_, dash: string, letter: string) => `${dash ? " " : ""}${letter.toUpperCase()}`);

/** Where a finding is: a slide of the shared set or of a device's own, or an asset. */
export interface Place {
  ownSet?: DeviceKind;
  slide?: number;
  placement?: PlacementId;
}

type Finding = Omit<LintWarning, "text">;

/** The logos of a slide or an asset: Apple's and other platforms' anywhere, and a brand where it reads as an endorsement. */
function logoFindings(item: Slide | Creative, place: Place): Finding[] {
  const store = place.placement !== undefined;
  const found: Finding[] = [];
  const check = (field: string, icons: IconId[], endorses: boolean) => {
    const apple = icons.filter((id) => APPLE_ARTWORK.has(id));
    const platforms = icons.filter((id) => OTHER_PLATFORMS.has(id));
    const brands = icons.filter((id) => BRANDS.has(id) && !APPLE_ARTWORK.has(id) && !OTHER_PLATFORMS.has(id));
    if (apple.length) found.push({ rule: "apple-artwork", ...place, field, match: apple.join(",") });
    if (platforms.length) found.push({ rule: "other-platform", ...place, field, match: platforms.join(",") });
    if (brands.length && (endorses || store)) found.push({ rule: "third-party-logo", ...place, field, match: brands.join(",") });
  };
  // A row that says what it is, such as "Works with", is the honest use of a logo; one without a label reads as a partnership.
  if ("iconRow" in item && item.iconRow) check("iconRow", item.iconRow.icons, !item.iconRow.label);
  for (const [i, badge] of (item.badges ?? []).entries()) if (badge.icon) check(`badges[${i}].icon`, [badge.icon], true);
  if ("features" in item) for (const [i, feature] of (item.features ?? []).entries()) if (feature.icon) check(`features[${i}].icon`, [feature.icon], false);
  return found;
}

function copyFindings(item: Slide | Creative, place: Place, locales: string[], fallback: string): Finding[] {
  const found: Finding[] = [];
  for (const locale of locales) {
    for (const [field, text] of texts(item)) {
      for (const { rule, match } of findPhrases(pick(text, locale, fallback))) found.push({ rule, locale, ...place, field, match });
    }
  }
  return found;
}

/** What a slide's copy and logos break of the store's rules, in each of `locales`. `fallback` is the project's first language. */
export function lintSlide(slide: Slide, place: Place, locales: string[], fallback: string): LintWarning[] {
  return worded([...logoFindings(slide, place), ...copyFindings(slide, place, locales, fallback)]);
}

/** The same for a header, search results or universal asset. A banner is not a store image, so it has no such rules. */
export function lintCreative(creative: Creative, placement: PlacementId, locales: string[], fallback: string): LintWarning[] {
  if (PLACEMENTS[placement].kind !== "store") return [];
  return worded([...logoFindings(creative, { placement }), ...copyFindings(creative, { placement }, locales, fallback)]);
}

// ---------------------------------------------------------------- the fit

/** What a page measured once it had fitted its copy, as fit.ts reports it in `body.dataset.fit`. */
export interface PageFit {
  /** The copy's type as a share of its designed size: 1 where it was not shrunk. */
  scale: number;
  /** False when the copy does not fit even at the smallest size it is shrunk to. */
  fits: boolean;
  /** The lines the headline takes. 0 without one. */
  lines: number;
  /** Text runs outside the safe area of a store asset, or off the edge of a slide or a banner. */
  outside: boolean;
}

/** One page of a render and what it measured. */
export interface FitReport extends PageFit, Place {
  locale: string;
  device?: DeviceKind;
  target?: TargetId;
}

/** The measurements of a page, from what it put in `body.dataset.fit`; nothing when they cannot be read. */
export function readFit(value: unknown): PageFit | undefined {
  let fit: unknown;
  try {
    fit = typeof value === "string" ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
  if (fit === null || typeof fit !== "object") return undefined;
  const { scale, fits, lines, outside } = fit as Record<string, unknown>;
  if (typeof scale !== "number" || typeof fits !== "boolean" || typeof lines !== "number" || typeof outside !== "boolean") return undefined;
  return { scale, fits, lines, outside };
}

/**
 * What the pages of a render found about their copy. Sizes of one device show the same copy at nearly the same
 * proportions, so each language, slide and device is named once, with its worst size.
 */
export function lintFit(pages: { report: FitReport; layout?: LayoutId }[]): LintWarning[] {
  const worst = new Map<string, Finding>();
  const note = (finding: Finding, worse: (old: Finding) => boolean) => {
    const key = [finding.rule, finding.locale, finding.ownSet, finding.device, finding.slide, finding.placement].join("|");
    const old = worst.get(key);
    if (!old || worse(old)) worst.set(key, finding);
  };
  for (const { report, layout } of pages) {
    const { locale, ownSet, slide, placement, device, target } = report;
    const at = { locale, ...(ownSet ? { ownSet } : {}), ...(slide !== undefined ? { slide } : {}), ...(placement ? { placement } : {}), ...(device ? { device } : {}), ...(target ? { target } : {}) };
    if (!report.fits) note({ rule: "copy-overflow", ...at, field: "headline", value: report.scale }, () => false);
    else if (report.scale < SCALE_LIMIT) note({ rule: "headline-scaled", ...at, field: "headline", value: report.scale, limit: SCALE_LIMIT }, (old) => report.scale < old.value!);
    const limit = lineLimit(layout, placement);
    if (report.lines > limit) note({ rule: "headline-lines", ...at, field: "headline", value: report.lines, limit }, (old) => report.lines > old.value!);
    // Copy that does not fit spills anyway; that it also leaves the safe area says nothing more.
    if (report.outside && report.fits) note({ rule: "safe-area", ...at }, () => false);
  }
  return worded([...worst.values()]);
}

/** The smallest each language's copy was set, for a reader who cannot look at the pictures. */
export function fitSummary(reports: FitReport[]): string[] {
  const locales = [...new Set(reports.map((report) => report.locale))];
  if (locales.length === 0) return [];
  const width = Math.max(...locales.map((locale) => locale.length));
  const lines = ["How the copy fits, per language: the smallest it was set, as a share of its designed size."];
  for (const locale of locales) {
    const own = reports.filter((report) => report.locale === locale);
    const least = own.reduce((a, b) => (b.scale < a.scale ? b : a));
    const misses = own.filter((report) => !report.fits).length;
    const where = least.scale < 1 ? `  ${placeOf(least)}` : "";
    lines.push(`  ${locale.padEnd(width)}  ${percent(least.scale).padStart(4)}${where}${misses ? `, and ${misses} page${misses === 1 ? "" : "s"} where it does not fit` : ""}`);
  }
  return lines;
}

// ---------------------------------------------------------------- the words

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** A slide or an asset as a person names it: "Slide 3", "iPad slide 2", "Slide 3 on iPad", "Search results". */
function placeOf(finding: Place & { device?: DeviceKind }): string {
  if (finding.placement) return PLACEMENTS[finding.placement].label;
  const slide = `${finding.ownSet ? `${DEVICE_LABELS[finding.ownSet]} slide` : "Slide"} ${(finding.slide ?? 0) + 1}`;
  return finding.device && !finding.ownSet ? `${slide} on ${DEVICE_LABELS[finding.device]}` : slide;
}

/** A field as a person names it. */
function fieldOf(field: string | undefined): string {
  const item = /^(badges|features)\[(\d+)\]/.exec(field ?? "");
  if (item) return `${item[1] === "badges" ? "badge" : "feature"} ${Number(item[2]) + 1}`;
  if (field?.startsWith("iconRow")) return "the icon row";
  return `the ${field ?? "copy"}`;
}

/** "a", "a and b", "a, b and c". */
const and = (items: string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** The languages a group of findings holds, in brackets, unless it holds every one of the render's. */
const languagesOf = (findings: Finding[], all: string[] | undefined) => {
  const locales = [...new Set(findings.map((finding) => finding.locale).filter((locale) => locale !== undefined))];
  if (locales.length === 0 || (all && all.length > 0 && all.every((locale) => locales.includes(locale)))) return "";
  return ` (${locales.join(", ")})`;
};

/** The words found, each with the languages it was found in where they are not all of them. */
function wordsOf(findings: Finding[], all: string[] | undefined): string {
  const byMatch = new Map<string, Finding[]>();
  for (const finding of findings) byMatch.set(finding.match ?? "", [...(byMatch.get(finding.match ?? "") ?? []), finding]);
  return [...byMatch].map(([match, each]) => `"${match}"${byMatch.size > 1 ? languagesOf(each, all) : ""}`).join(", ");
}

/**
 * One sentence for a group of findings of one rule at one place. `all` is every language of the render: a group
 * found in each of them names none.
 */
function sentence(findings: Finding[], all?: string[]): string {
  const first = findings[0]!;
  const where = placeOf(first);
  const field = fieldOf(first.field);
  const langs = languagesOf(findings, all);
  const words = wordsOf(findings, all);
  const said = `${where}${langs}: ${field}`;
  const logos = and((first.match ?? "").split(",").filter(Boolean).map(brandName));
  const store = first.placement !== undefined;
  switch (first.rule) {
    case "apple-recognition":
      return `${said} names ${words}, one of Apple's own recognitions. App Review does not accept them in store images.`;
    case "price":
      return `${said} shows a price, ${words}. Prices differ by country and change, so store images show none.`;
    case "free":
      return `${said} says ${words}. Store images make no claim about the price: it goes out of date, and with in-app purchases App Review reads it as misleading.`;
    case "ranking":
      return `${said} claims a ranking, ${words}. App Review asks for proof of a ranking, and it goes out of date.`;
    case "date":
      return `${said} carries a date, ${words}, which makes the set look old once it has passed.`;
    case "apple-artwork":
      return `${said} shows ${logos}. Apple's artwork may not appear in store images.`;
    case "other-platform":
      return `${said} shows ${logos}. App Review rejects store images that show other platforms or app stores.`;
    case "third-party-logo":
      if (store) return `${said} shows ${logos}. Apple allows no other company's logo in header and search results assets.`;
      if (first.field === "iconRow")
        return `${said} shows ${logos} without a label. Logos are other companies' trademarks: show only services the app works with, and say so, such as with the label "Works with".`;
      return `${said} shows ${logos}, which reads as that company's endorsement.`;
    case "headline-scaled": {
      const values = findings.map((finding) => `${finding.locale} ${percent(finding.value!)}`).join(", ");
      return `${where}: the copy was set at ${values} of its size to fit. Shorten it there, or it reads smaller than the rest of the set.`;
    }
    case "copy-overflow":
      return `${where}${langs}: the copy does not fit even at half its size, so it runs into what is around it. Shorten it.`;
    case "headline-lines":
      return `${where}${langs}: the headline takes ${Math.max(...findings.map((finding) => finding.value!))} lines. Up to ${first.limit} read well at the size the store shows it.`;
    case "safe-area":
      return store
        ? `${where}${langs}: text runs outside the safe area, where some devices crop it away. Shorten it.`
        : `${where}${langs}: text runs off the edge of the picture. Shorten it.`;
  }
}

/** Findings with a sentence each. */
const worded = (findings: Finding[]): LintWarning[] => findings.map((finding) => ({ ...finding, text: sentence([finding]) }));

/**
 * The findings as the sentences of a render's `warnings`: one per rule and place, naming the languages it was found
 * in, so forty languages with one long headline make one warning and not forty.
 */
export function lintTexts(warnings: LintWarning[], locales: string[]): string[] {
  const groups = new Map<string, LintWarning[]>();
  for (const warning of warnings) {
    const key = [warning.rule, warning.ownSet, warning.device, warning.slide, warning.placement, warning.field].join("|");
    groups.set(key, [...(groups.get(key) ?? []), warning]);
  }
  return [...groups.values()].map((group) => sentence(group, locales));
}
