import type { PreviewDisplay } from "../domain/previews.ts";
import { type Background, type Logo, type Project, type Slide, slidesFor, type Text } from "../schema.ts";
import { findShot, InputError, type Shot, shotsDir, type Space, type StoredImage } from "../store.ts";
import { CSS } from "../template/css.ts";
import { type BackgroundDef, bodyFont, type EmphasisId, type FontId, FONTS, type LogoShape } from "../template/design.ts";
import { backgroundCss, backgroundLuminance, resolveBackground } from "../template/parts/background.ts";
import { logoHtml } from "../template/parts/images.ts";
import { esc, rich, round } from "../template/parts/text.ts";
import { fontsToLoad, pageHtml, themeVars } from "../template/shell.ts";
import { type CaptionStyle, type Disclosure, isSlideText, type LayerRequest, type TextRef } from "./request.ts";

/**
 * The pictures that go over and around an app preview, drawn by the browser from one page per language: a caption
 * for each scene, the intro and outro cards, the theme's background as a plate, and a touch ring. Each is an
 * artboard of its own on the page, captured on its own as a PNG.
 */

export type LayerKind = "plate" | "caption" | "intro-logo" | "intro-text" | "outro-logo" | "outro-text" | "touch";

/** Something worth knowing about a set that does not stop it: copy in another language, a caption shrunk to fit. */
export interface LayerWarning {
  locale: string | null;
  layer: string;
  kind: "fallback" | "fit" | "logo";
  detail: string;
}

/** Copy as it is drawn in one language, and the language it came from when that is another. */
export interface DrawnText {
  text: string;
  from?: string;
}

export interface LocaleCopy {
  captions: { id: string; position: "top" | "bottom"; text: DrawnText }[];
  intro: { headline: DrawnText | null; logo: boolean } | null;
  outro: { lines: DrawnText[]; logo: boolean; disclosure: DrawnText[] } | null;
}

/**
 * Everything the pages of a set draw, looked up from the project when the set was asked for. The set's id is a hash
 * of it, so it holds nothing that does not change the pictures.
 */
export interface Draft {
  projectId: string;
  size: [number, number];
  display: PreviewDisplay | null;
  captionStyle: CaptionStyle;
  style: { font: FontId; text: string; accent: string | null; emphasis: EmphasisId; background: BackgroundDef };
  logo: { image: StoredImage; shape: LogoShape } | null;
  plate: boolean;
  touch: boolean;
  locales: string[];
  copy: Record<string, LocaleCopy>;
  warnings: LayerWarning[];
}

export interface Artboard {
  id: string;
  kind: LayerKind;
  /** Null for a layer every language shares. */
  locale: string | null;
  width: number;
  height: number;
  /** The plate is the one picture without transparency. */
  opaque: boolean;
}

/**
 * Small print a preview has to show, by language. English stands in for a language without its own, with a warning:
 * the guide asks to check the wording before the preview goes out.
 */
export const DISCLOSURES: Record<Disclosure, Record<string, string>> = {
  iap: { en: "Offers in-app purchases." },
  subscription: { en: "Subscription required." },
  login: { en: "Requires an account." },
};

const FIELDS = { headline: "headline", eyebrow: "eyebrow", sub: "subheadline" } as const;

/** The copy a reference names: its own, or a slide's field in every language. `where` names it in an error. */
function referenced(ref: TextRef, slides: Slide[], device: string, where: string): Text {
  if (!isSlideText(ref)) return ref;
  const slide = slides[ref.slide - 1];
  if (!slide) throw new InputError(`${where}: the project has no slide ${ref.slide} for the ${device}. It has ${slides.length}.`);
  const field = ref.field ?? "headline";
  const text = slide[FIELDS[field]];
  if (!text || (typeof text === "object" && !Object.values(text).some(Boolean))) throw new InputError(`${where}: slide ${ref.slide} has no ${field}.`);
  return text;
}

/** The copy in one language, as the template picks it, and where it came from when that is not the language itself. */
function inLanguage(text: Text, locale: string, primary: string): DrawnText {
  if (typeof text === "string") return { text };
  const own = text[locale] || text[locale.split("-")[0]!];
  if (own) return { text: own };
  const from = [primary, ...Object.keys(text)].find((code) => text[code]);
  return { text: from ? text[from]! : "", ...(from ? { from } : {}) };
}

const LOGO_NAMES = [
  { name: "app-icon", shape: "app-icon" },
  { name: "icon", shape: "app-icon" },
  { name: "logo", shape: "plain" },
] as const;

/** The app's logo: the one a slide or an asset shows, or an image named for it. */
function findLogo(project: Project, slides: Slide[], images: StoredImage[]): Draft["logo"] {
  const set: (Logo | undefined)[] = [...slides.map((slide) => slide.logo), ...Object.values(project.creatives).map((creative) => creative?.logo)];
  for (const logo of set) {
    const image = logo && images.find((entry) => entry.name === logo.image);
    if (image) return { image, shape: logo.shape ?? "plain" };
  }
  for (const { name, shape } of LOGO_NAMES) {
    const image = images.find((entry) => entry.name === name);
    if (image) return { image, shape };
  }
  return null;
}

/** Looks up what a request draws: the copy in every language, the theme, the logo. Fails on a slide that is not there. */
export async function prepareDraft(space: Space, project: Project, shots: Shot[], images: StoredImage[], request: LayerRequest): Promise<Draft> {
  const slides = slidesFor(project, request.device);
  const primary = project.locales[0]!;
  const first = slides[0];
  const theme = project.theme;
  // The theme is the set's look. A project that leaves part of it to its slides takes the first slide's.
  const wanted: Background | undefined = theme.background ?? first?.background;
  const shot = findShot(shots, first?.screenshot, request.device, primary);
  const background = await resolveBackground(wanted, shotsDir(space, project.id), shot);
  const dark = backgroundLuminance(background) < 0.32;
  const accent = theme.accentColor ?? first?.accentColor ?? null;
  const style: Draft["style"] = {
    font: theme.font ?? first?.font ?? "inter",
    text: theme.textColor ?? first?.textColor ?? (dark ? "#FFFFFF" : "#0B0B0F"),
    accent,
    emphasis: theme.emphasis ?? first?.emphasis ?? "tint",
    background,
  };

  const warnings: LayerWarning[] = [];
  const wantsLogo = Boolean(request.intro?.logo || request.outro?.logo);
  const logo = wantsLogo ? findLogo(project, slides, images) : null;
  if (wantsLogo && !logo) {
    warnings.push({ locale: null, layer: request.intro?.logo ? "intro-logo" : "outro-logo", kind: "logo", detail: 'the project has no logo: set one on a slide, or upload an image named "logo" or "app-icon"' });
  }

  const device = request.device === "mac" ? "Mac" : request.device === "ipad" ? "iPad" : "iPhone";
  const captions = request.captions.map((entry) => ({ ...entry, text: referenced(entry.text, slides, device, `Caption "${entry.id}"`) }));
  const headline = request.intro?.headline === undefined ? undefined : referenced(request.intro.headline, slides, device, "The intro's headline");
  const lines = (request.outro?.lines ?? []).map((line, i) => referenced(line, slides, device, `Line ${i + 1} of the outro`));

  const copy: Record<string, LocaleCopy> = {};
  for (const locale of request.locales) {
    const drawn = (text: Text, layer: string) => {
      const result = inLanguage(text, locale, primary);
      if (result.from) warnings.push({ locale, layer, kind: "fallback", detail: `no ${locale} text, drawn in ${result.from}` });
      return result;
    };
    const english = locale.split("-")[0]!.toLowerCase() === "en";
    const disclosure = (request.outro?.disclosure ?? []).map((id) => {
      const own = DISCLOSURES[id][locale] ?? DISCLOSURES[id][locale.split("-")[0]!];
      if (!own && !english) warnings.push({ locale, layer: "outro-text", kind: "fallback", detail: `no ${locale} wording for the "${id}" notice, drawn in en` });
      return own ? { text: own } : { text: DISCLOSURES[id].en!, ...(english ? {} : { from: "en" }) };
    });
    copy[locale] = {
      captions: captions.map((entry) => ({ id: entry.id, position: entry.position, text: drawn(entry.text, `caption-${entry.id}`) })),
      intro: request.intro ? { headline: headline === undefined ? null : drawn(headline, "intro-text"), logo: request.intro.logo && logo != null } : null,
      outro: request.outro ? { lines: lines.map((line) => drawn(line, "outro-text")), logo: request.outro.logo && logo != null, disclosure } : null,
    };
  }

  return {
    projectId: project.id,
    size: request.size,
    display: request.display,
    captionStyle: request.captionStyle,
    style,
    logo,
    plate: request.plate,
    touch: request.touch,
    locales: request.locales,
    copy,
    warnings,
  };
}

/** The touch ring is square and about 9 % of the canvas's shorter side, an even number of pixels across. */
export const touchSize = (size: [number, number]) => Math.max(2, Math.round((Math.min(...size) * 0.09) / 2) * 2);

/**
 * The artboards of one language's page, in the order they are drawn. The layers every language shares, the plate and
 * the touch ring, are on the first language's page only.
 */
export function artboardsOf(draft: Draft, locale: string): Artboard[] {
  const [width, height] = draft.size;
  const copy = draft.copy[locale];
  if (!copy) return [];
  const full = (id: string, kind: LayerKind): Artboard => ({ id, kind, locale, width, height, opaque: false });
  const boards: Artboard[] = [];
  const shared = locale === draft.locales[0];
  if (shared && draft.plate) boards.push({ id: "plate", kind: "plate", locale: null, width, height, opaque: true });
  for (const caption of copy.captions) boards.push(full(`caption-${caption.id}`, "caption"));
  if (copy.intro?.logo) boards.push(full("intro-logo", "intro-logo"));
  if (copy.intro?.headline) boards.push(full("intro-text", "intro-text"));
  if (copy.outro?.logo) boards.push(full("outro-logo", "outro-logo"));
  if (copy.outro && (copy.outro.lines.length || copy.outro.disclosure.length)) boards.push(full("outro-text", "outro-text"));
  if (shared && draft.touch) {
    const side = touchSize(draft.size);
    boards.push({ id: "touch", kind: "touch", locale: null, width: side, height: side, opaque: false });
  }
  return boards;
}

/** Copy without its *emphasis* marks, as the manifest gives it for a video tool that sets its own type. */
export const plain = (text: string) => text.replace(/\*([^*\n]+)\*/g, "$1");

const VIDEO_CSS = `
html,body{background:transparent}
.boards{width:max-content}
.ab{position:relative;overflow:hidden;color:var(--text);font-family:var(--body);font-synthesis:none;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.ab .headline{line-height:1.12}
.ab[hidden]{display:none}
.hide{visibility:hidden}
.cap-board{display:flex;flex-direction:column;align-items:center;padding:var(--top) calc(var(--u)*7) var(--bottom)}
.cap-board.at-bottom{justify-content:flex-end}
.cap-box{max-width:min(100%,calc(var(--u)*120));text-align:center}
.ab .cap{font-size:calc(var(--u)*7*var(--ts)*var(--fs))}
.style-panel .cap-box{padding:calc(var(--u)*3.4) calc(var(--u)*5);border-radius:calc(var(--u)*5);box-shadow:0 calc(var(--u)*1) calc(var(--u)*4) rgba(0,0,0,.28)}
.style-band .cap-box{align-self:stretch;max-width:none;margin-inline:calc(var(--u)*-7);padding:calc(var(--u)*4) calc(var(--u)*7)}
.style-shadow .cap{text-shadow:0 calc(var(--u)*.3) calc(var(--u)*1.6) rgba(0,0,0,.55),0 0 calc(var(--u)*4) rgba(0,0,0,.35)}
.card-board{display:flex;align-items:center;justify-content:center;padding:var(--top) calc(var(--u)*8) var(--bottom)}
.card{display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*5);max-width:min(100%,calc(var(--u)*130));text-align:center}
.card .logo{margin:0;--ts:1}
.ab .card-title{font-size:calc(var(--u)*9.5*var(--ts)*var(--fs))}
.card-copy{display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*2.4);max-width:100%}
.ab .card-line{font-size:calc(var(--u)*6.4*var(--ts)*var(--fs))}
.card-line.small{font-family:var(--body);font-weight:600;font-size:calc(var(--u)*4.6*var(--ts));letter-spacing:-.01em;opacity:.85}
.card-print{margin-top:calc(var(--u)*2.4);font-size:calc(var(--u)*3.1*var(--ts));font-weight:500;line-height:1.3;opacity:.72;max-width:calc(var(--u)*80)}
.ring{position:absolute;border-radius:50%;background:rgba(255,255,255,.28)}
`;

/**
 * Runs in a layer page: waits for the fonts and the logo, then shrinks the copy of each artboard until it fits, and
 * reports where each layer drew in `body.dataset.layers`. A face that never loads, a logo that does not, or copy that
 * does not fit at half its size fails the page with "font:", "image:" or "fit:" and the name.
 */
const VIDEO_SCRIPT = `(async () => {
  const body = document.body;
  const fail = (reason) => {
    body.dataset.error = reason;
    body.dataset.ready = 'error';
  };
  const boards = document.querySelector('.boards');
  try {
    for (const font of JSON.parse(boards.dataset.fonts)) {
      if ((await document.fonts.load(font)).length === 0) return fail('font:' + (/'([^']+)'/.exec(font) || [font, font])[1]);
    }
    await document.fonts.ready;
  } catch (error) {
    return fail('font:' + (error instanceof Error ? error.message : String(error)));
  }
  for (const img of document.images) {
    try {
      await img.decode();
    } catch {
      return fail('image:' + (img.dataset.image || img.getAttribute('src')));
    }
  }
  const RUNGS = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5];
  const linesOf = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  // A word wider than the line overflows it. An emphasis marker's padding reaches a little past the copy and does not count.
  const overflows = (el) => el.scrollWidth > el.clientWidth + parseFloat(getComputedStyle(el).fontSize) * 0.2;
  const layers = {};
  for (const board of document.querySelectorAll('section[data-layer]')) {
    const blocks = [...board.querySelectorAll('[data-fit]')];
    const set = (i) => board.style.setProperty('--ts', String(RUNGS[i]));
    const fits = () =>
      board.scrollHeight <= board.clientHeight + 1 && blocks.every((el) => !overflows(el) && linesOf(el) <= Number(el.dataset.fit));
    // Copy that does not fit at the smallest size fails the page rather than leaving the video with a cut caption.
    let lo = 0;
    let hi = blocks.length ? RUNGS.length - 1 : 0;
    set(hi);
    if (!fits()) return fail('fit:' + board.dataset.layer);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      set(mid);
      if (fits()) hi = mid;
      else lo = mid + 1;
    }
    set(lo);
    const frame = board.getBoundingClientRect();
    const shown = (board.querySelector('[data-box]') || board).getBoundingClientRect();
    layers[board.dataset.layer] = {
      box: [Math.round(shown.left - frame.left), Math.round(shown.top - frame.top), Math.round(shown.width), Math.round(shown.height)],
      fit: RUNGS[lo],
      lines: blocks.length ? Math.max(...blocks.map(linesOf)) : 0,
    };
  }
  body.dataset.layers = JSON.stringify(layers);
  body.dataset.ready = '1';
})();`;

/** What a page reports of each artboard it fitted: where the drawn part is, at what share of its size, on how many lines. */
export type LayerReport = Record<string, { box: [number, number, number, number]; fit: number; lines: number }>;

/** The page that draws one language's artboards. */
export function layerPage(draft: Draft, locale: string, title: string): string {
  const [width, height] = draft.size;
  const copy = draft.copy[locale]!;
  const { style } = draft;
  const font = FONTS[style.font];
  const body = bodyFont(style.font);
  const unit = Math.min(width, height) / 100;
  // A tall phone keeps its captions clear of the Dynamic Island and the home indicator.
  const tall = height / width > 2;
  const top = round(height * (tall ? 0.1 : 0.06));
  const bottom = round(height * (tall ? 0.08 : 0.06));
  const vars = [`--u:${round(unit)}px`, "--ts:1", `--top:${top}px`, `--bottom:${bottom}px`, ...themeVars(font, body, style.text, style.accent ?? undefined)].join(";");
  const paint = backgroundCss(style.background);
  const em = `em-${style.emphasis}`;
  /** Copy set as a headline: emphasis as the slides draw it, and the rest stepping back when there is no accent to tint with. */
  const headline = (text: string, classes: string, lines: number) => {
    const html = rich(text);
    const twoTone = style.emphasis === "tint" && !style.accent && html.includes("<em>");
    return `<p class="headline ${classes}${twoTone ? " two-tone" : ""}" data-fit="${lines}">${html}</p>`;
  };
  const logo = (big: boolean) =>
    draft.logo ? logoHtml({ image: draft.logo.image.name, shape: draft.logo.shape, size: big ? "large" : "medium" }, [draft.logo.image], draft.projectId) : "";

  const boards = artboardsOf(draft, locale).map((board) => {
    const open = (classes: string, extra = "") => `<section class="ab ${classes}" data-layer="${esc(board.id)}" data-kind="${board.kind}" style="width:${board.width}px;height:${board.height}px${extra}">`;
    if (board.kind === "plate") {
      const noise = typeof style.background === "object" && style.background.noise ? `<div class="noise" style="opacity:${round(style.background.noise * 0.6)}"></div>` : "";
      return `${open("")}<div class="bg" style="${paint}"></div>${noise}</section>`;
    }
    if (board.kind === "touch") {
      const ring = board.width;
      const inset = round(ring * 0.08);
      const line = round(ring * 0.07);
      return `${open("")}<div class="ring" data-box style="inset:${inset}px;box-shadow:inset 0 0 0 ${line}px rgba(255,255,255,.92),0 0 ${inset}px rgba(0,0,0,.35)"></div></section>`;
    }
    if (board.kind === "caption") {
      const caption = copy.captions.find((entry) => `caption-${entry.id}` === board.id)!;
      const boxPaint = draft.captionStyle === "shadow" ? "" : ` style="${paint}"`;
      // Over the app itself there is no card to read on: white with a shadow reads on most screens.
      const ink = draft.captionStyle === "shadow" ? ";--text:#FFFFFF" : "";
      return `${open(`cap-board style-${draft.captionStyle} at-${caption.position} ${em}`, ink)}<div class="cap-box" data-box${boxPaint}>${headline(caption.text.text, "cap", 2)}</div></section>`;
    }
    // The intro and the outro are each one card cut into two layers, its logo and its copy, so the video can bring
    // them in one after the other: both artboards lay out the whole card and show their own part.
    const intro = board.kind.startsWith("intro");
    const showLogo = board.kind.endsWith("logo");
    const part = (shown: boolean) => (shown ? " data-box" : ' class="hide"');
    let card: string;
    if (intro) {
      const text = copy.intro!;
      card = [text.logo ? `<div${part(showLogo)}>${logo(true)}</div>` : "", text.headline ? `<div${part(!showLogo)}>${headline(text.headline.text, "card-title", 3)}</div>` : ""].join("");
    } else {
      const text = copy.outro!;
      const lines = text.lines.map((line, i) => headline(line.text, `card-line${i > 0 ? " small" : ""}`, 2)).join("");
      const print = text.disclosure.map((line) => `<p class="card-print" data-fit="2">${esc(line.text)}</p>`).join("");
      const copyHtml = lines || print ? `<div class="card-copy${showLogo ? " hide" : ""}"${showLogo ? "" : " data-box"}>${lines}${print}</div>` : "";
      card = [text.logo ? `<div${part(showLogo)}>${logo(false)}</div>` : "", copyHtml].join("");
    }
    return `${open(`card-board ${em}`)}<div class="card">${card}</div></section>`;
  });

  return pageHtml({
    title,
    locale,
    css: CSS + VIDEO_CSS,
    body: `<main class="boards" style="${vars}" data-fonts="${esc(fontsToLoad(font, body))}">
${boards.join("\n")}
</main>`,
    script: VIDEO_SCRIPT,
  });
}
