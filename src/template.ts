import path from "node:path";
import {
  BACKGROUNDS,
  type BackgroundDef,
  BRAND_COLORS,
  DEVICE_COLORS,
  type FeatureStyleId,
  type FontId,
  FONTS,
  ICON_ROW_SIZES,
  type IconId,
  LAYOUT_SHOTS,
  type LayoutId,
  type PointStyleId,
  SIDE_LAYOUTS,
} from "./design.ts";
import { ICONS } from "./icons.ts";
import { hasBakedIsland, paletteFor } from "./palette.ts";
import type { Background, Badge, DeviceStyle, Feature, IconRow, Project, Text } from "./schema.ts";
import { type DeviceKind, TARGETS, type TargetId } from "./sizes.ts";
import { findShot, type Shot, shotsDir, type Space } from "./store.ts";

export interface SlideContext {
  space: Space;
  project: Project;
  shots: Shot[];
  index: number;
  target: TargetId;
  locale: string;
}

type FrameKind = DeviceKind | "none";

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

function luminance(hex: string): number {
  const raw = hex.slice(1);
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function backgroundLuminance(def: BackgroundDef): number {
  const values = def.colors.map(luminance);
  if (def.type !== "mesh" || values.length === 1) return values.reduce((a, b) => a + b, 0) / values.length;
  // The base colour shows through between the blobs, so it carries half the weight.
  const blobs = values.slice(1);
  return values[0]! * 0.5 + (blobs.reduce((a, b) => a + b, 0) / blobs.length) * 0.5;
}

const MESH_SPOTS = ["12% 8%", "88% 22%", "72% 92%", "8% 78%"];

export function backgroundCss(def: BackgroundDef): string {
  const [base, ...rest] = def.colors;
  if (def.type === "solid" || rest.length === 0) return `background:${base}`;
  if (def.type === "gradient") return `background:linear-gradient(${def.angle ?? 165}deg,${def.colors.join(",")})`;
  const blobs = rest.map((color, i) => `radial-gradient(ellipse 85% 60% at ${MESH_SPOTS[i % MESH_SPOTS.length]},${color} 0,transparent 100%)`);
  return `background-color:${base};background-image:${blobs.join(",")}`;
}

export async function resolveBackground(background: Background | undefined, shotsPath: string, shot: Shot | undefined): Promise<BackgroundDef> {
  if (background === undefined) return BACKGROUNDS.midnight;
  if (typeof background === "object") return background;
  if (background.startsWith("#")) return { type: "solid", colors: [background] };
  if (background === "auto") {
    if (!shot) return BACKGROUNDS.midnight;
    return { type: "mesh", colors: await paletteFor(path.join(shotsPath, shot.file), shot.version) };
  }
  return BACKGROUNDS[background as keyof typeof BACKGROUNDS] ?? BACKGROUNDS.midnight;
}

// ---------------------------------------------------------------- badges

const f = (value: number) => value.toFixed(1);

/** One laurel branch, drawn as leaves fanning off a circular stem. The right branch is this one mirrored. */
function laurelSvg(side: "l" | "r"): string {
  const cx = 64;
  const cy = 52;
  const radius = 50;
  const point = (deg: number): [number, number] => [cx + radius * Math.cos((deg * Math.PI) / 180), cy + radius * Math.sin((deg * Math.PI) / 180)];
  const leaf = (bx: number, by: number, deg: number, length: number, width: number) => {
    const a = (deg * Math.PI) / 180;
    const tx = bx + length * Math.cos(a);
    const ty = by + length * Math.sin(a);
    const mx = (bx + tx) / 2;
    const my = (by + ty) / 2;
    const nx = -Math.sin(a) * width;
    const ny = Math.cos(a) * width;
    return `M${f(bx)} ${f(by)}Q${f(mx + nx)} ${f(my + ny)} ${f(tx)} ${f(ty)}Q${f(mx - nx)} ${f(my - ny)} ${f(bx)} ${f(by)}Z`;
  };
  const start = 112;
  const end = 250;
  const count = 9;
  let leaves = "";
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const theta = start + (end - start) * t;
    const [x, y] = point(theta);
    const tangent = theta + 90;
    const taper = 1 - 0.28 * t;
    leaves += leaf(x, y, tangent - 44, 18.5 * taper, 8.6 * taper);
    leaves += leaf(x, y, tangent + 36, 14.5 * taper, 6.8 * taper);
  }
  const [tipX, tipY] = point(end + 6);
  leaves += leaf(tipX, tipY, end + 96, 12, 5.6);
  const [sx, sy] = point(start - 8);
  const [ex, ey] = point(end + 6);
  const stem = `<path d="M${f(sx)} ${f(sy)}A${radius} ${radius} 0 0 1 ${f(ex)} ${f(ey)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  return `<svg class="wreath ${side}" viewBox="0 -3 64 106" aria-hidden="true">${stem}<path d="${leaves}" fill="currentColor"/></svg>`;
}

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? outer : inner;
    const a = ((-90 + k * 36) * Math.PI) / 180;
    points.push(`${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`);
  }
  return points.join(" ");
}

const STAR_ROW = `<svg viewBox="0 0 124 24" aria-hidden="true">${[0, 1, 2, 3, 4]
  .map((i) => `<polygon points="${starPoints(12 + i * 25, 12.6, 10, 4.5)}" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`)
  .join("")}</svg>`;

function starsHtml(value: number): string {
  return `<div class="stars" style="--fill:${round((value / 5) * 100)}%"><div class="s-bg">${STAR_ROW}</div><div class="s-fg">${STAR_ROW}</div></div>`;
}

const iconSvg = (id: IconId, className = "icon") => `<svg class="${className}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${ICONS[id]}</svg>`;

/** Gradients the badges and feature cards fill their artwork with. They sit inside the canvas so they see its colours. */
export const DEFS = `<svg class="defs" aria-hidden="true"><defs><linearGradient id="b-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A0"/><stop offset=".45" stop-color="#EDBD54"/><stop offset="1" stop-color="#BB862C"/></linearGradient><linearGradient id="f-tint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:color-mix(in srgb,var(--accent) 60%,var(--text))"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient></defs></svg>`;

/** A slide's row of icons and brand logos. It stays on one line: the icons shrink until all of them fit between the margins. */
function iconRowHtml(row: IconRow, canvas: { width: number }, unit: number, dark: boolean, locale: string, fallback: string): string {
  const style = row.style ?? "tiles";
  const tone = row.tone ?? "brand";
  const count = row.icons.length;
  const gap = style === "plain" ? 0.46 : 0.24;
  const size = Math.min(ICON_ROW_SIZES[row.size ?? "medium"], (canvas.width / unit - 18) / (count + (count - 1) * gap));
  const items = row.icons.map((id) => {
    const brand = tone === "brand" ? BRAND_COLORS[id] : undefined;
    if (!brand) return `<span class="ir-item">${iconSvg(id)}</span>`;
    if (style === "plain") {
      // A mark as dark or as light as the background would vanish, so there it takes the text colour.
      const ink = brand.ink ?? brand.fill[0]!;
      const lost = dark ? luminance(ink) < 0.1 : luminance(ink) > 0.8;
      return `<span class="ir-item"${lost ? ' style="color:var(--text)"' : ` style="color:${ink}"`}>${iconSvg(id)}</span>`;
    }
    const fill = brand.fill.length > 1 ? `linear-gradient(45deg,${brand.fill.join(",")})` : brand.fill[0];
    return `<span class="ir-item brand" style="background:${fill};color:${brand.mark}">${iconSvg(id)}</span>`;
  });
  const label = pick(row.label, locale, fallback);
  const classes = `icon-row ir-${style} tone-${tone} ${row.position === "top" ? "top" : "bottom"}`;
  return `<div class="${classes}" style="--i:calc(var(--u)*${round(size)});--ig:${gap}">${label ? `<div class="ir-label">${esc(label)}</div>` : ""}<div class="ir-items">${items.join("")}</div></div>`;
}

export function badgeHtml(badge: Badge, locale: string, fallback: string): string {
  const title = pick(badge.title, locale, fallback);
  const subtitle = pick(badge.subtitle, locale, fallback);
  const titleHtml = title ? `<div class="b-title">${esc(title)}</div>` : "";
  const subHtml = subtitle ? `<div class="b-sub">${esc(subtitle)}</div>` : "";
  const tone = badge.tone === "gold" ? " gold" : "";

  if (badge.type === "pill") {
    return `<div class="badge pill${tone}">${badge.icon ? iconSvg(badge.icon) : ""}<span>${esc(title || subtitle)}</span></div>`;
  }
  if (badge.type === "icon") {
    return `<div class="badge with-icon${tone}">${iconSvg(badge.icon ?? "trophy")}<div class="b-body">${titleHtml}${subHtml}</div></div>`;
  }
  if (badge.type === "rating") {
    // Without a star count the score fills the row itself, the way the store draws it.
    const score = Number.parseFloat(title.replace(",", "."));
    const stars = badge.stars ?? (score >= 0 && score <= 5 ? score : 5);
    return `<div class="badge card rating${tone}">${titleHtml}<div class="b-body">${starsHtml(stars)}${subHtml}</div></div>`;
  }
  if (badge.type === "review") {
    const quote = title && !/^["'“”„«»‹‘]/.test(title) ? `“${title}”` : title;
    return `<div class="badge card review${tone}">${starsHtml(badge.stars ?? 5)}${quote ? `<div class="b-quote">${esc(quote)}</div>` : ""}${subHtml}</div>`;
  }
  const top = badge.stars !== undefined ? starsHtml(badge.stars) : badge.icon ? iconSvg(badge.icon) : badge.type === "stars" ? starsHtml(5) : "";
  const body = `<div class="b-body">${top}${titleHtml}${subHtml}</div>`;
  if (badge.type === "stars") return `<div class="badge plain${tone}">${body}</div>`;
  return `<div class="badge laurel${tone}">${laurelSvg("l")}${body}${laurelSvg("r")}</div>`;
}

// ---------------------------------------------------------------- feature cards

/** Where one card sits in the grid, as CSS grid lines. */
interface Cell {
  column: string;
  row: string;
  kind?: "hero" | "wide" | "tall";
}

const cell = (column: number, span: number, row: number, rows = 1, kind?: Cell["kind"]): Cell => ({ column: `${column}/span ${span}`, row: `${row}/span ${rows}`, kind });

/** Row heights of the bento grid, per unit of column width. */
const BENTO = { hero: 0.92, row: 0.74, wide: 0.5 };

/** Two columns: a hero across the top, then a tall card beside two stacked ones, the tall one changing sides each time. */
function bentoCells(count: number): { cells: Cell[]; rows: number[] } {
  const cells = [cell(1, 2, 1, 1, "hero")];
  const rows = [BENTO.hero];
  let left = count - 1;
  let tall = 1;
  while (left > 0) {
    const row = rows.length + 1;
    if (left === 1) {
      cells.push(cell(1, 2, row, 1, "wide"));
      rows.push(BENTO.wide);
      left -= 1;
    } else if (left === 2) {
      cells.push(cell(1, 1, row), cell(2, 1, row));
      rows.push(BENTO.row);
      left -= 2;
    } else {
      const other = 3 - tall;
      cells.push(cell(tall, 1, row, 2, "tall"), cell(other, 1, row), cell(other, 1, row + 1));
      rows.push(BENTO.row, BENTO.row);
      left -= 3;
      tall = other;
    }
  }
  return { cells, rows };
}

/** Even cards in rows; the cards of a last, shorter row widen to fill it. */
function gridCells(count: number, columns: number): { cells: Cell[]; rows: number } {
  const rest = count % columns;
  const cells = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns) + 1;
    if (i < count - rest) return cell((i % columns) * 6 + 1, 6, row);
    const span = (columns * 6) / rest;
    return cell((i - (count - rest)) * span + 1, span, row, 1, "wide");
  });
  return { cells, rows: Math.ceil(count / columns) };
}

/** The cards of a features slide, and the height they would like to have. They give some of it up when the copy needs the room. */
function featuresHtml(features: Feature[], style: FeatureStyleId, canvas: { width: number; height: number }, unit: number, locale: string, fallback: string, alone: boolean) {
  const count = features.length;
  const inner = canvas.width - unit * 14;
  let gap = unit * 2.4;
  let tracks = 1;
  let cells: Cell[];
  let rows: number[];
  let stretch = 1.3;
  // A tablet canvas is wide enough for three tiles in a row, and for larger rows.
  const tablet = canvas.width / canvas.height > 0.6;
  // Type is sized for a card as wide as half a phone canvas, and follows the card from there.
  let column = unit * 41.8;
  if (style === "bento") {
    const bento = bentoCells(count);
    column = (inner - gap) / 2;
    cells = bento.cells;
    rows = bento.rows.map((factor) => factor * column);
    tracks = 2;
    stretch = 1.4;
  } else if (style === "grid") {
    const columns = tablet ? 3 : 2;
    const grid = gridCells(count, columns);
    column = (inner - gap * (columns - 1)) / columns;
    cells = grid.cells;
    rows = Array.from({ length: grid.rows }, () => column * 0.8);
    tracks = columns * 6;
  } else {
    if (style === "list") gap = unit * 1.2;
    const size = tablet ? 1.15 : 1;
    column *= size * size;
    cells = features.map((_, i) => cell(1, 1, i + 1));
    rows = features.map(() => unit * (style === "cards" ? 19 : 15.5) * size);
  }

  // A few cards may grow to carry the slide; many keep their size and give way in the page if they must.
  const gaps = gap * (rows.length - 1);
  const natural = rows.reduce((sum, row) => sum + row, 0);
  const grow = Math.min(stretch, Math.max(1, (canvas.height * (alone ? 0.7 : 0.56) - gaps) / natural));
  const height = natural * grow + gaps + (alone ? 0 : unit * 6.5);
  const scale = Math.min(1.7, Math.sqrt(column / (unit * 41.8)) * Math.min(1.3, grow));

  const tiles = features.map((feature, i) => {
    const { column, row, kind } = cells[i]!;
    const title = pick(feature.title, locale, fallback);
    const detail = pick(feature.text, locale, fallback);
    const value = pick(feature.value, locale, fallback);
    const lead = value ? `<div class="f-lead"><span class="f-value">${esc(value)}</span></div>` : feature.icon ? `<div class="f-lead">${iconSvg(feature.icon, "f-icon")}</div>` : "";
    const text = `<div class="f-text"><div class="f-title">${rich(title)}</div>${detail ? `<div class="f-detail">${rich(detail)}</div>` : ""}</div>`;
    return `<div class="f-tile${kind ? ` ${kind}` : ""}${tracks === 1 ? " row" : ""}" style="grid-column:${column};grid-row:${row}">${lead}${text}</div>`;
  });
  const grid = [`--fz:${round(scale)}`, `gap:${round(gap)}px`, `grid-template-columns:repeat(${tracks},minmax(0,1fr))`, `grid-template-rows:${rows.map((row) => `minmax(0,${round(row)}fr)`).join(" ")}`];
  return `<div class="features fs-${style}${alone ? " alone" : ""}" style="flex-basis:${round(height)}px"><div class="f-grid" style="${grid.join(";")}">${tiles.join("")}</div></div>`;
}

/** The feature points a slide shows with its copy: a short list above, below or beside the device. */
function pointsHtml(features: Feature[], style: PointStyleId, wide: boolean, locale: string, fallback: string): string {
  const columns = style === "grid" && wide && features.length > 1 ? 2 : 1;
  const items = features.map((feature) => {
    const title = pick(feature.title, locale, fallback);
    const detail = style === "chips" ? "" : pick(feature.text, locale, fallback);
    const value = pick(feature.value, locale, fallback);
    const lead = value ? `<span class="p-lead"><span class="p-value">${esc(value)}</span></span>` : feature.icon ? `<span class="p-lead">${iconSvg(feature.icon)}</span>` : "";
    return `<div class="point">${lead}<div class="p-text"><div class="p-title">${rich(title)}</div>${detail ? `<div class="p-detail">${rich(detail)}</div>` : ""}</div></div>`;
  });
  return `<div class="points ps-${style === "grid" ? "cards" : style}${columns > 1 ? " two" : ""}" style="--pc:${columns}">${items.join("")}</div>`;
}

// ---------------------------------------------------------------- devices

/** Frame geometry as fractions of the device width, measured off the real hardware. */
const FRAMES: Record<DeviceKind, { outer: number; band: number; bezel: number; inner: number; aspect: [number, number]; bare: number }> = {
  iphone: { outer: 0.165, band: 0.011, bezel: 0.023, inner: 0.131, aspect: [1320, 2868], bare: 0.085 },
  ipad: { outer: 0.058, band: 0.006, bezel: 0.034, inner: 0.024, aspect: [2064, 2752], bare: 0.03 },
};

/** Device width as a fraction of canvas width, by target device then by the frame drawn on it. */
const BASE_WIDTH: Record<DeviceKind, Record<DeviceKind, number>> = {
  iphone: { iphone: 0.86, ipad: 0.92 },
  ipad: { ipad: 0.84, iphone: 0.5 },
};

const LAYOUT_WIDTH: Record<LayoutId, number> = {
  "device-bottom": 1,
  "device-top": 1,
  "device-center": 1,
  tilted: 1.04,
  closeup: 1.42,
  floating: 0.92,
  duo: 0.7,
  "side-by-side": 0.52,
  trio: 0.6,
  "device-right": 0.7,
  "device-left": 0.7,
  hero: 0.9,
  features: 1,
};

/** Share of the canvas height the copy block may take before the text starts shrinking. */
const COPY_MAX: Record<LayoutId, number> = {
  features: 0.3,
  "device-bottom": 0.34,
  "device-top": 0.34,
  "device-center": 0.36,
  tilted: 0.34,
  closeup: 0.34,
  floating: 0.36,
  duo: 0.32,
  "side-by-side": 0.32,
  trio: 0.32,
  "device-right": 0.84,
  "device-left": 0.84,
  hero: 0.48,
};

const SHADOWS = {
  none: "none",
  soft: "0 calc(var(--dw)*.045) calc(var(--dw)*.1) rgba(0,0,0,.28),0 calc(var(--dw)*.012) calc(var(--dw)*.026) rgba(0,0,0,.2)",
  strong: "0 calc(var(--dw)*.07) calc(var(--dw)*.14) rgba(0,0,0,.5),0 calc(var(--dw)*.02) calc(var(--dw)*.04) rgba(0,0,0,.32)",
};

interface DeviceOptions {
  shot: Shot | undefined;
  /** Name asked for, shown in the placeholder when nothing is uploaded under it yet. */
  wanted: string | undefined;
  url: string | undefined;
  style: DeviceStyle;
  targetDevice: DeviceKind;
  width: number;
  /** Exact device width in pixels, for layouts that place devices themselves. Replaces the width derived from the canvas. */
  pixels?: number;
  canvas: { width: number; height: number };
  fit: "width" | "contain";
  /** False when the screenshot already shows the Dynamic Island. */
  island: boolean;
  extraCss?: string;
  defaults?: Partial<DeviceStyle>;
}

/** Which frame a screenshot gets, and how tall the device comes out per unit of its width. */
export function deviceShape(shot: Shot | undefined, style: DeviceStyle, fallback: DeviceKind) {
  const kind: DeviceKind = style.frame === "iphone" || style.frame === "ipad" ? style.frame : (shot?.device ?? fallback);
  const frame: FrameKind = style.frame === "none" ? "none" : kind;
  const geometry = FRAMES[kind];

  // Follow the screenshot's own proportions so nothing gets cropped, within what the frame can plausibly hold.
  let [aw, ah] = geometry.aspect;
  if (shot && shot.height > shot.width) {
    const ratio = shot.width / shot.height;
    const [lo, hi] = kind === "iphone" ? [0.44, 0.58] : [0.66, 0.78];
    if (ratio >= lo && ratio <= hi) [aw, ah] = [shot.width, shot.height];
  }
  const rim = frame === "none" ? 0 : (geometry.band + geometry.bezel) * 2;
  return { kind, frame, geometry, aspect: `${aw}/${ah}`, ratio: (1 - rim) * (ah / aw) + rim };
}

export function deviceHtml(options: DeviceOptions): string {
  const { shot, style, canvas } = options;
  const merged = { ...options.defaults, ...style };
  const { kind, frame, geometry, aspect } = deviceShape(shot, merged, options.targetDevice);

  const dw = round(options.pixels ?? canvas.width * BASE_WIDTH[options.targetDevice][kind] * options.width * (options.fit === "width" ? (merged.scale ?? 1) : 1));
  const transforms: string[] = [];
  if (merged.offsetX || merged.offsetY) {
    transforms.push(`translate(${round(((merged.offsetX ?? 0) / 100) * canvas.width)}px,${round(((merged.offsetY ?? 0) / 100) * canvas.height)}px)`);
  }
  if (merged.perspective === "left" || merged.perspective === "right") {
    const sign = merged.perspective === "left" ? 1 : -1;
    transforms.push(`perspective(${round(dw * 3.4)}px) rotateY(${sign * 22}deg) rotateX(7deg) rotateZ(${-sign * 3}deg)`);
  }
  if (merged.rotate) transforms.push(`rotate(${merged.rotate}deg)`);

  const colors = DEVICE_COLORS[merged.color ?? "black"];
  const vars = [
    `--dw:${dw}px`,
    `--ar:${aspect}`,
    `--ro:${geometry.outer}`,
    `--band:${geometry.band}`,
    `--bez:${geometry.bezel}`,
    `--ri:${frame === "none" ? geometry.bare : geometry.inner}`,
    `--shadow:${SHADOWS[merged.shadow ?? "soft"]}`,
    ...colors.map((color, i) => `--f${i + 1}:${color}`),
    transforms.length ? `transform:${transforms.join(" ")}` : "",
    options.extraCss ?? "",
  ].filter(Boolean);

  const screen = options.url
    ? `<img src="${esc(options.url)}" alt="">`
    : `<div class="placeholder"><span>${options.wanted ? `Upload a screenshot named<br><b>${esc(options.wanted)}</b>` : "No screenshot"}</span></div>`;
  const island = frame === "iphone" && options.island ? '<div class="island"></div>' : "";
  const attrs = `class="device ${frame}" data-fit="${options.fit}" data-scale="${merged.scale ?? 1}" style="${vars.join(";")}"`;

  if (frame === "none") return `<div ${attrs}><div class="screen bare">${screen}</div></div>`;
  const buttons =
    frame === "iphone"
      ? '<i class="btn l" style="top:17.5%;height:3.2%"></i><i class="btn l" style="top:24.5%;height:6.2%"></i><i class="btn l" style="top:32.5%;height:6.2%"></i><i class="btn r" style="top:28%;height:10%"></i>'
      : "";
  return `<div ${attrs}>${buttons}<div class="frame"><div class="bezel"><div class="screen">${screen}${island}</div></div></div></div>`;
}

// ---------------------------------------------------------------- page

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#000;overflow:hidden}
.canvas{position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;color:var(--text);font-family:var(--body);font-synthesis:none;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.bg,.noise{position:absolute;inset:0}
.noise{background-image:${NOISE};mix-blend-mode:overlay}
.copy{position:relative;z-index:2;flex:none;width:100%;padding:calc(var(--u)*12.5) calc(var(--u)*7) 0;display:flex;flex-direction:column;align-items:center;text-align:center}
.align-left .copy{align-items:flex-start;text-align:left;padding-left:calc(var(--u)*8);padding-right:calc(var(--u)*8)}
.eyebrow{font-size:calc(var(--u)*3.1*var(--ts));font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:calc(var(--u)*2.6)}
.eyebrow.muted{color:var(--text);opacity:.7}
.headline{max-width:100%;font-family:var(--font);font-size:calc(var(--u)*9.6*var(--ts)*var(--fs));font-weight:var(--hw);line-height:1.05;letter-spacing:var(--track);text-wrap:balance}
.headline em{font-style:normal;color:var(--accent)}
.headline.two-tone{color:color-mix(in srgb,var(--text) 58%,transparent)}
.headline.two-tone em{color:var(--text)}
.sub{font-size:calc(var(--u)*4.3*var(--ts));font-weight:500;line-height:1.27;letter-spacing:-.01em;opacity:.8;margin-top:calc(var(--u)*2.9);max-width:calc(var(--u)*82);text-wrap:balance}
.stage{position:relative;z-index:1;flex:1 1 0;min-height:0;width:100%;display:flex;justify-content:center;align-items:flex-start;padding-top:calc(var(--u)*6.5)}
.stage.fits{align-items:center;padding-bottom:calc(var(--u)*6.5)}
.layout-device-top{flex-direction:column-reverse}
.layout-device-top .copy{padding-top:0;padding-bottom:calc(var(--u)*11.5)}
.layout-device-top .stage{align-items:flex-end;padding:0 0 calc(var(--u)*6.5)}
.layout-device-top .stage.fits{align-items:center;padding-top:calc(var(--u)*6.5)}
.layout-device-center .stage,.layout-floating .stage{align-items:center;padding:calc(var(--u)*5.5) 0 calc(var(--u)*9)}
.stage.multi{display:block}
.stage.multi .device{position:absolute;left:50%}
.no-device{justify-content:center}
.no-device .copy{padding-top:0;padding-bottom:0}
.defs{position:absolute;width:0;height:0}
.dark{--card:color-mix(in srgb,#fff 9%,transparent);--card-line:rgba(255,255,255,.13);--card-shadow:0 0 0 transparent}
.light{--card:rgba(255,255,255,.66);--card-line:rgba(255,255,255,.7);--card-shadow:0 calc(var(--u)*.9) calc(var(--u)*3.2) rgba(20,20,40,.08)}
.layout-features{justify-content:center;padding:calc(var(--u)*11) 0}
.layout-features .copy{padding-top:0}
.features{position:relative;z-index:1;flex:0 1 auto;min-height:0;width:100%;display:flex;justify-content:center;padding:calc(var(--u)*6.5) calc(var(--u)*7) 0}
.features.alone{padding-top:0}
.align-left .features{padding-left:calc(var(--u)*8);padding-right:calc(var(--u)*8)}
.f-grid{--f:calc(var(--u)*var(--fz));flex:1;min-width:0;min-height:0;display:grid}
.fs-cards .f-grid,.fs-list .f-grid{max-width:calc(var(--u)*98)}
.fs-list .f-grid{flex:0 1 auto}
.align-left .features{justify-content:flex-start}
.f-tile{position:relative;overflow:hidden;min-width:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:calc(var(--f)*2.3);padding:calc(var(--f)*3.2);border-radius:calc(var(--u)*4.4);background:var(--card);box-shadow:inset 0 0 0 calc(var(--u)*.14) var(--card-line),var(--card-shadow)}
.f-tile.hero{gap:calc(var(--f)*3);background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 30%,transparent),color-mix(in srgb,var(--accent) 7%,transparent) 72%),var(--card)}
.align-left .f-tile{align-items:flex-start;justify-content:space-between;text-align:left}
.f-tile.row{flex-direction:row;align-items:center;justify-content:center;text-align:left;gap:calc(var(--f)*3.2)}
.align-left .f-tile.row,.fs-cards .f-tile,.fs-list .f-tile{justify-content:flex-start}
.f-lead{flex:none;display:flex;align-items:center;justify-content:center;line-height:0}
.f-icon{display:block;height:calc(var(--f)*10.4);width:auto;fill:url(#f-tint)}
.f-value{font-family:var(--font);font-size:calc(var(--f)*10.6*var(--fs));font-weight:var(--hw);line-height:.95;letter-spacing:-.04em;white-space:nowrap;color:transparent;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 60%,var(--text)),var(--accent));-webkit-background-clip:text;background-clip:text}
.f-text{min-width:0;display:flex;flex-direction:column;gap:calc(var(--f)*.9)}
.f-title{font-family:var(--font);font-size:calc(var(--f)*4.1*var(--fs));font-weight:var(--hw);line-height:1.08;letter-spacing:var(--track);text-wrap:balance}
.f-title em{font-style:normal;color:var(--accent)}
.f-detail{font-size:calc(var(--f)*2.7);font-weight:500;line-height:1.26;letter-spacing:-.005em;opacity:.72;text-wrap:balance}
.f-tile.hero .f-icon{height:calc(var(--f)*15)}
.f-tile.hero .f-value{font-size:calc(var(--f)*17*var(--fs))}
.f-tile.hero .f-title{font-size:calc(var(--f)*5.8*var(--fs))}
.f-tile.hero .f-detail{font-size:calc(var(--f)*3.2)}
.f-tile.tall .f-icon{height:calc(var(--f)*13)}
.f-tile.tall .f-value{font-size:calc(var(--f)*13.5*var(--fs))}
.f-tile.tall .f-title{font-size:calc(var(--f)*4.5*var(--fs))}
.fs-cards .f-tile{padding:calc(var(--f)*2.6) calc(var(--f)*3.2);border-radius:calc(var(--u)*4)}
.fs-cards .f-lead{min-width:calc(var(--f)*11.6);height:calc(var(--f)*11.6);padding:0 calc(var(--f)*2);border-radius:calc(var(--f)*3.1);background:color-mix(in srgb,var(--accent) 17%,transparent)}
.fs-cards .f-icon{height:calc(var(--f)*6.4)}
.fs-cards .f-value{font-size:calc(var(--f)*4.8*var(--fs))}
.fs-cards .f-title,.fs-list .f-title{font-size:calc(var(--f)*3.9*var(--fs))}
.fs-cards .f-detail,.fs-list .f-detail{font-size:calc(var(--f)*2.75)}
.fs-list .f-tile{overflow:visible;padding:0;border-radius:0;background:none;box-shadow:none;gap:calc(var(--f)*3.6)}
.fs-list .f-lead{min-width:calc(var(--f)*10)}
.fs-list .f-icon{height:calc(var(--f)*9.4)}
.fs-list .f-value{font-size:calc(var(--f)*6.2*var(--fs))}
.device{position:relative;flex:none;width:var(--dw);transform-origin:50% 35%}
.frame{position:relative;z-index:1;border-radius:calc(var(--dw)*var(--ro));padding:calc(var(--dw)*var(--band));background:linear-gradient(135deg,var(--f1),var(--f2) 28%,var(--f3) 62%,var(--f4));box-shadow:var(--shadow)}
.frame::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 calc(var(--dw)*.0018) rgba(255,255,255,.3),inset 0 0 calc(var(--dw)*.006) rgba(0,0,0,.45);pointer-events:none}
.bezel{background:#000;border-radius:calc(var(--dw)*(var(--ro) - var(--band)));padding:calc(var(--dw)*var(--bez))}
.screen{position:relative;overflow:hidden;background:#101012;border-radius:calc(var(--dw)*var(--ri));aspect-ratio:var(--ar)}
.screen.bare{box-shadow:var(--shadow),0 0 0 calc(var(--dw)*.0015) rgba(255,255,255,.14)}
.screen img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;background:linear-gradient(160deg,#2a2a31,#17171b);color:rgba(255,255,255,.55);font:500 calc(var(--dw)*.045)/1.35 var(--body)}
.placeholder b{color:#fff;font-weight:700}
.island{position:absolute;left:50%;top:calc(var(--dw)*.029);width:calc(var(--dw)*.266);height:calc(var(--dw)*.082);margin-left:calc(var(--dw)*-.133);border-radius:999px;background:#000}
.btn{position:absolute;width:calc(var(--dw)*.014);background:linear-gradient(90deg,var(--f2),var(--f3));border-radius:calc(var(--dw)*.004)}
.btn.l{left:calc(var(--dw)*-.006)}
.btn.r{right:calc(var(--dw)*-.006)}
.points{--p:calc(var(--u)*var(--ts));display:grid;grid-template-columns:repeat(var(--pc),minmax(0,1fr));gap:calc(var(--p)*3) calc(var(--p)*2);max-width:100%;margin-top:calc(var(--u)*5.5);text-align:left}
.points.two{width:100%}
.point{display:flex;align-items:center;gap:calc(var(--p)*2.6);min-width:0}
.p-lead{flex:none;display:grid;place-items:center;min-width:calc(var(--p)*8);height:calc(var(--p)*8);padding:0 calc(var(--p)*1.4);border-radius:calc(var(--p)*2.3);background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.p-lead .icon{display:block;height:calc(var(--p)*4.5);width:auto}
.p-value{font-family:var(--font);font-size:calc(var(--p)*3.2*var(--fs));font-weight:var(--hw);line-height:1;letter-spacing:-.03em;white-space:nowrap}
.p-text{min-width:0;display:flex;flex-direction:column;gap:calc(var(--p)*.6)}
.p-title{font-family:var(--font);font-size:calc(var(--p)*4*var(--fs));font-weight:var(--hw);line-height:1.1;letter-spacing:var(--track)}
.p-title em{font-style:normal;color:var(--accent)}
.p-detail{font-size:calc(var(--p)*3);font-weight:500;line-height:1.26;letter-spacing:-.005em;opacity:.74}
.ps-cards{gap:calc(var(--p)*1.7)}
.ps-cards .point{padding:calc(var(--p)*2.1) calc(var(--p)*2.8) calc(var(--p)*2.1) calc(var(--p)*2.1);border-radius:calc(var(--p)*3.4);background:var(--card);box-shadow:inset 0 0 0 calc(var(--u)*.14) var(--card-line),var(--card-shadow)}
.ps-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:calc(var(--p)*1.6)}
.align-left .ps-chips{justify-content:flex-start}
.ps-chips .point{gap:calc(var(--p)*1.3);padding:calc(var(--p)*1.5) calc(var(--p)*2.8) calc(var(--p)*1.5) calc(var(--p)*2.1);border-radius:999px;background:color-mix(in srgb,var(--text) 12%,transparent);box-shadow:inset 0 0 0 calc(var(--u)*.14) color-mix(in srgb,var(--text) 18%,transparent)}
.ps-chips .p-lead{min-width:0;height:auto;padding:0;border-radius:0;background:none}
.ps-chips .p-lead .icon{height:calc(var(--p)*3.7)}
.ps-chips .p-title{font-size:calc(var(--p)*3.2*var(--fs));white-space:nowrap}
.side{flex-direction:row;align-items:center}
.side.layout-device-left{flex-direction:row-reverse}
.side .copy{flex:0 0 56%;width:auto;padding:0 0 0 calc(var(--u)*8)}
.side.layout-device-left .copy{padding:0 calc(var(--u)*7) 0 calc(var(--u)*1)}
.side .headline{font-size:calc(var(--u)*8.2*var(--ts)*var(--fs))}
.side .stage,.side .stage.fits{flex:1 1 0;width:auto;min-width:0;align-self:stretch;align-items:center;justify-content:flex-start;padding:0 0 0 calc(var(--u)*5)}
.side.layout-device-left .stage,.side.layout-device-left .stage.fits{justify-content:flex-end;padding:0 calc(var(--u)*5) 0 0}
.icon-row{display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*2.4);max-width:100%}
.align-left .icon-row{align-items:flex-start}
.icon-row.top{margin-bottom:calc(var(--u)*5.5)}
.icon-row.bottom{margin-top:calc(var(--u)*5.5)}
.ir-label{font-size:calc(var(--u)*2.7);font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.62}
.ir-items{display:flex;align-items:center;gap:calc(var(--i)*var(--ig))}
.ir-item{flex:none;display:grid;place-items:center;width:var(--i);height:var(--i);border-radius:calc(var(--i)*.235);background:color-mix(in srgb,var(--text) 11%,transparent);color:var(--accent);box-shadow:inset 0 0 0 calc(var(--i)*.012) color-mix(in srgb,var(--text) 14%,transparent)}
.ir-item .icon{display:block;width:58%;height:58%}
.ir-item.brand{box-shadow:0 calc(var(--i)*.07) calc(var(--i)*.18) rgba(0,0,0,.24),inset 0 0 0 calc(var(--i)*.012) rgba(128,128,128,.28)}
.ir-circles .ir-item{border-radius:50%}
.ir-circles .ir-item .icon{width:54%;height:54%}
.ir-plain .ir-item{width:auto;background:none;box-shadow:none}
.ir-plain .ir-item .icon{width:auto;height:100%}
.tone-text .ir-item{color:var(--text)}
.badges{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;max-width:100%;gap:calc(var(--u)*3) calc(var(--u)*5*var(--bs))}
.align-left .badges{justify-content:flex-start}
.badges.top{margin-bottom:calc(var(--u)*5.5)}
.badges.bottom{margin-top:calc(var(--u)*6)}
.badge{--b:calc(var(--u)*var(--bs));display:flex;align-items:center;color:var(--text)}
.badge.laurel{gap:calc(var(--b)*.6)}
.wreath{flex:none;height:calc(var(--b)*15.5);width:auto;opacity:.92}
.wreath.r{transform:scaleX(-1)}
.b-body{display:flex;flex-direction:column;align-items:center;text-align:center;gap:calc(var(--b)*.75)}
.b-title{font-family:var(--font);font-size:calc(var(--b)*5.6);font-weight:var(--hw);line-height:1;letter-spacing:-.03em;white-space:nowrap}
.b-sub{font-size:calc(var(--b)*2.1);font-weight:700;line-height:1.15;letter-spacing:.09em;text-transform:uppercase;opacity:.82;white-space:nowrap}
.stars{position:relative;display:block;height:calc(var(--b)*2.9);line-height:0}
.stars svg{display:block;height:100%;width:auto;max-width:none}
.s-bg{height:100%;opacity:.28}
.s-fg{position:absolute;left:0;top:0;height:100%;width:var(--fill);overflow:hidden;color:var(--star)}
.b-body>.icon{height:calc(var(--b)*4.2);width:auto;color:var(--star)}
.badge.with-icon{gap:calc(var(--b)*1.8)}
.badge.with-icon>.icon{flex:none;height:calc(var(--b)*8.5);width:auto;color:var(--star)}
.badge.with-icon .b-body{align-items:flex-start;text-align:left}
.badge.with-icon .b-title{font-size:calc(var(--b)*4.4)}
.badge.pill{gap:calc(var(--b)*1.1);padding:calc(var(--b)*1.5) calc(var(--b)*3.2);border-radius:999px;background:color-mix(in srgb,var(--text) 13%,transparent);box-shadow:inset 0 0 0 calc(var(--b)*.14) color-mix(in srgb,var(--text) 20%,transparent);font-size:calc(var(--b)*2.9);font-weight:700;letter-spacing:-.005em;white-space:nowrap}
.badge.pill .icon{height:calc(var(--b)*3.2);width:auto;color:var(--star)}
.badge.card{padding:calc(var(--b)*2.5) calc(var(--b)*3.3);border-radius:calc(var(--b)*3.6);background:var(--card);box-shadow:inset 0 0 0 calc(var(--b)*.14) var(--card-line),var(--card-shadow)}
.badge.rating{gap:calc(var(--b)*2.3)}
.badge.rating .b-title{font-size:calc(var(--b)*8.4);letter-spacing:-.04em}
.badge.rating .b-body{align-items:flex-start;text-align:left;gap:calc(var(--b)*1)}
.badge.rating .stars{height:calc(var(--b)*3.1)}
.badge.review{flex-direction:column;align-items:flex-start;text-align:left;gap:calc(var(--b)*1.5);max-width:calc(var(--b)*46)}
.badge.review .stars{height:calc(var(--b)*2.8)}
.b-quote{font-family:var(--font);font-size:calc(var(--b)*3.5);font-weight:600;line-height:1.22;letter-spacing:-.012em;text-wrap:pretty}
.badge.review .b-sub{opacity:.62}
.badge.gold .wreath{opacity:1;color:#D9A845}
.badge.gold .wreath path[fill=currentColor],.badge.gold .icon{fill:url(#b-gold)}
.badge.gold .s-fg polygon{fill:url(#b-gold);stroke:url(#b-gold)}
`;

/** Runs in the page: waits for fonts and images, then shrinks badges and copy until they fit. */
export const FIT_SCRIPT = `(async () => {
  const canvas = document.querySelector('.canvas');
  const set = (name, value) => canvas.style.setProperty(name, String(value));
  try {
    await Promise.all(JSON.parse(canvas.dataset.fonts).map((font) => document.fonts.load(font)));
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  } catch {}
  const u = parseFloat(getComputedStyle(canvas).getPropertyValue('--u'));
  const copy = canvas.querySelector('.copy');
  const stage = canvas.querySelector('.stage');

  const badges = canvas.querySelector('.badges');
  let bs = parseFloat(canvas.style.getPropertyValue('--bs'));
  if (badges) {
    const wrapped = () => {
      const kids = badges.children;
      const last = kids[kids.length - 1];
      return badges.scrollWidth > badges.clientWidth + 1 || (kids.length > 1 && last.offsetTop > kids[0].offsetTop + kids[0].offsetHeight / 2);
    };
    while (wrapped() && bs > 0.5) set('--bs', (bs -= 0.04));
  }

  if (copy) {
    const headline = copy.querySelector('.headline');
    const max = parseFloat(canvas.dataset.copyMax) * canvas.clientHeight;
    let ts = parseFloat(canvas.style.getPropertyValue('--ts'));
    const floor = ts * 0.5;
    const tooBig = () => copy.offsetHeight > max || (headline && headline.scrollWidth > headline.clientWidth + 1);
    // Where the copy has a fixed box to stay in, the badges shrink in step with the text instead of holding their size.
    const together = badges && canvas.dataset.shrink === 'together';
    while (tooBig() && ts > floor) {
      set('--ts', (ts -= 0.025));
      if (together && bs > 0.4) set('--bs', (bs -= 0.02));
    }
  }

  const grid = canvas.querySelector('.f-grid');
  if (grid) {
    const tiles = [...grid.querySelectorAll('.f-tile')];
    // A card much wider than it is tall reads better with its icon beside the text.
    for (const tile of tiles) {
      if (!tile.classList.contains('row') && tile.clientWidth > tile.clientHeight * (tile.classList.contains('hero') ? 2.7 : 2.05)) tile.classList.add('row');
    }
    let fz = parseFloat(grid.style.getPropertyValue('--fz'));
    const spills = () => tiles.some((tile) => tile.scrollHeight > tile.clientHeight + 1 || tile.scrollWidth > tile.clientWidth + 1);
    while (spills() && fz > 0.45) grid.style.setProperty('--fz', (fz -= 0.03));
  }

  if (stage) {
    const style = getComputedStyle(stage);
    const room = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    for (const device of stage.querySelectorAll('.device')) {
      const width = parseFloat(device.style.getPropertyValue('--dw'));
      if (device.dataset.fit === 'contain') {
        const perWidth = device.offsetHeight / width;
        device.style.setProperty('--dw', Math.min(width, room / perWidth) * parseFloat(device.dataset.scale) + 'px');
      } else if (!stage.classList.contains('multi') && room - device.offsetHeight > u * 4) {
        // A device that fits whole would leave a dead band at the edge it was meant to bleed off.
        stage.classList.add('fits');
      }
    }
    if (stage.classList.contains('multi')) {
      // Devices that all end above the bottom edge sit in the middle of the room under the copy, not against it.
      const devices = [...stage.querySelectorAll('.device')];
      const spare = stage.clientHeight - Math.max(...devices.map((device) => device.offsetTop + device.offsetHeight)) - Math.min(...devices.map((device) => device.offsetTop));
      if (spare > u * 4) for (const device of devices) device.style.top = device.offsetTop + spare / 2 + 'px';
    }
  }
  document.body.dataset.ready = '1';
})();`;

export async function slideHtml(ctx: SlideContext): Promise<string> {
  const { project, shots, locale } = ctx;
  const shotsPath = shotsDir(ctx.space, project.id);
  const slide = project.slides[ctx.index];
  if (!slide) throw new Error(`Slide ${ctx.index + 1} does not exist`);
  const target = TARGETS[ctx.target];
  const fallback = project.locales[0] ?? "en";
  const theme = project.theme;
  const layout: LayoutId = slide.layout ?? "device-bottom";

  const shot = findShot(shots, slide.screenshot, target.device);
  const shot2 = findShot(shots, slide.screenshot2, target.device);
  const shot3 = findShot(shots, slide.screenshot3, target.device);
  const shotUrl = (s: Shot | undefined) => (s ? `/files/${project.id}/shots/${s.file}?v=${s.version}` : undefined);
  const needsIsland = async (s: Shot | undefined) =>
    !s || s.device !== "iphone" || !(await hasBakedIsland(path.join(shotsPath, s.file), s.version, s.width));

  const background = await resolveBackground(slide.background ?? theme.background, shotsPath, shot);
  const dark = backgroundLuminance(background) < 0.32;
  const textColor = slide.textColor ?? theme.textColor ?? (dark ? "#FFFFFF" : "#0B0B0F");
  const accent = slide.accentColor ?? theme.accentColor;
  const fontId: FontId = slide.font ?? theme.font ?? "inter";
  const font = FONTS[fontId];
  // A display serif makes poor small print, so pair it with a neutral body face.
  const body = fontId === "instrument-serif" ? FONTS.inter : font;
  const hasDevice = [slide.screenshot, slide.screenshot2, slide.screenshot3].slice(0, LAYOUT_SHOTS[layout]).some(Boolean);
  // A column beside the device reads from its left edge whatever the set's alignment is.
  const side = hasDevice && SIDE_LAYOUTS.includes(layout);
  const align = side ? "left" : (slide.align ?? theme.align ?? "center");
  const textScale = slide.textScale ?? theme.textScale ?? 1;
  const deviceStyle: DeviceStyle = { ...theme.device, ...slide.device };

  const eyebrow = pick(slide.eyebrow, locale, fallback);
  const headline = pick(slide.headline, locale, fallback);
  const sub = pick(slide.subheadline, locale, fallback);
  const badges = slide.badges ?? [];
  const badgePosition = slide.badgePosition ?? (layout === "hero" ? "top" : "bottom");
  // The features layout shows them as its cards. Any other slide lists them with the copy.
  const features = layout === "features" ? (slide.features ?? []) : [];
  const points = layout === "features" ? [] : (slide.features ?? []);
  const cardStyle: FeatureStyleId = slide.featureStyle === "chips" ? "list" : (slide.featureStyle ?? "bento");
  const pointStyle: PointStyleId = !slide.featureStyle || slide.featureStyle === "bento" ? "list" : slide.featureStyle;

  const unit = Math.min(target.width, target.height / 2) / 100;
  const canvas = { width: target.width, height: target.height };

  const badgesHtml = badges.length
    ? `<div class="badges ${badgePosition}">${badges.map((badge) => badgeHtml(badge, locale, fallback)).join("")}</div>`
    : "";
  const headlineHtml = rich(headline);
  const twoTone = !accent && headlineHtml.includes("<em>");
  // The copy column of a side layout is 56% of the canvas with one margin; the row is sized for what that leaves.
  const rowHtml = slide.iconRow ? iconRowHtml(slide.iconRow, side ? { width: canvas.width * 0.56 + unit * 9 } : canvas, unit, dark, locale, fallback) : "";
  const rowOnTop = slide.iconRow?.position === "top";
  const copyParts = [
    badgePosition === "top" ? badgesHtml : "",
    rowOnTop ? rowHtml : "",
    eyebrow ? `<div class="eyebrow${accent ? "" : " muted"}">${esc(eyebrow)}</div>` : "",
    headline ? `<h1 class="headline${twoTone ? " two-tone" : ""}">${headlineHtml}</h1>` : "",
    sub ? `<p class="sub">${rich(sub)}</p>` : "",
    points.length ? pointsHtml(points, pointStyle, !side, locale, fallback) : "",
    rowOnTop ? "" : rowHtml,
    badgePosition === "bottom" ? badgesHtml : "",
  ].join("");
  const copyHtml = copyParts ? `<div class="copy">${copyParts}</div>` : "";

  let stageHtml = "";
  if (hasDevice) {
    const common = { style: deviceStyle, targetDevice: target.device, canvas, width: LAYOUT_WIDTH[layout] };
    const gap = unit * 6.5;
    /** One device of a layout that places several: its centre in device widths from the middle, how far down it starts, and what is in front. */
    const placed = async (s: Shot | undefined, wanted: string | undefined, x: number, top: number, z: number, rotate: number) => {
      // Phones are drawn small on an iPad canvas; a group of them has the room to be larger.
      const boost = target.device === "ipad" && deviceShape(s, deviceStyle, target.device).kind === "iphone" ? 1.45 : 1;
      const extraCss = `margin-left:calc(var(--dw)*${round(x - 0.5)});top:${round(gap + top * unit)}px;z-index:${z}`;
      return deviceHtml({ ...common, width: common.width * boost, shot: s, wanted, url: shotUrl(s), island: await needsIsland(s), fit: "width", defaults: { rotate }, extraCss });
    };
    if (layout === "duo") {
      const place = (x: number, top: number, z: number) => `margin-left:calc(var(--dw)*-.5 + ${round(x * canvas.width)}px);top:${round(top)}px;z-index:${z}`;
      stageHtml =
        deviceHtml({ ...common, shot: shot2, wanted: slide.screenshot2, url: shotUrl(shot2), island: await needsIsland(shot2), fit: "width", defaults: { rotate: -6 }, extraCss: place(-0.19, gap + unit * 10, 1) }) +
        deviceHtml({ ...common, shot, wanted: slide.screenshot, url: shotUrl(shot), island: await needsIsland(shot), fit: "width", defaults: { rotate: 5 }, extraCss: place(0.17, gap, 2) });
    } else if (layout === "side-by-side") {
      stageHtml = (await placed(shot, slide.screenshot, -0.53, 0, 2, 0)) + (await placed(shot2, slide.screenshot2, 0.53, 9, 1, 0));
    } else if (layout === "trio") {
      stageHtml =
        (await placed(shot2, slide.screenshot2, -0.5, 11, 1, -7)) + (await placed(shot3, slide.screenshot3, 0.5, 11, 1, 7)) + (await placed(shot, slide.screenshot, 0, 0, 2, 0));
    } else {
      // A phone beside the copy on an iPad canvas has the room to be larger, like a group of them has.
      const boost = side && target.device === "ipad" && deviceShape(shot, deviceStyle, target.device).kind === "iphone" ? 1.45 : 1;
      stageHtml = deviceHtml({
        ...common,
        width: common.width * boost,
        shot,
        wanted: slide.screenshot,
        url: shotUrl(shot),
        island: await needsIsland(shot),
        fit: layout === "device-center" || layout === "floating" ? "contain" : "width",
        defaults: layout === "tilted" ? { rotate: -8, offsetX: 5 } : layout === "floating" ? { perspective: "left", shadow: "strong" } : undefined,
      });
    }
    stageHtml = `<div class="stage${LAYOUT_SHOTS[layout] > 1 ? " multi" : ""}">${stageHtml}</div>`;
  } else if (features.length) {
    stageHtml = featuresHtml(features, cardStyle, canvas, unit, locale, fallback, !copyHtml);
  }

  const filled = hasDevice || features.length > 0;
  // Badges on a slide with nothing but copy have the room to be the picture.
  const badgeScale = (layout === "hero" ? 1.3 : 1.1) * (badges.length >= 3 ? 0.78 : 1) * (filled ? 1 : 1.3);
  const classes = ["canvas", `layout-${layout}`, `align-${align}`, dark ? "dark" : "light", side ? "side" : "", filled ? "" : "no-device"].filter(Boolean).join(" ");
  // Feature points need room of their own: each row lets the copy take a little more of the slide before the text shrinks.
  const pointRows = pointStyle === "chips" ? Math.ceil(points.length / 2) * 0.6 : pointStyle === "grid" && !side ? Math.ceil(points.length / 2) : points.length;
  const copyMax = !filled ? 0.92 : side ? COPY_MAX[layout] : Math.min(0.6, COPY_MAX[layout] + (points.length ? 0.03 + pointRows * 0.045 : 0));
  const vars = [
    `width:${target.width}px`,
    `height:${target.height}px`,
    `--u:${round(unit)}px`,
    // The copy column on a tablet canvas is as wide as a whole phone slide, so its type grows with it.
    `--ts:${round(textScale * (side && target.width / target.height > 0.6 ? 1.3 : 1))}`,
    `--bs:${round(badgeScale)}`,
    `--fs:${font.scale}`,
    `--hw:${font.weight}`,
    `--track:${font.tracking}`,
    `--text:${textColor}`,
    `--accent:${accent ?? textColor}`,
    `--star:${accent ?? "#FFB61E"}`,
    `--font:'${font.family}','Inter Variable',system-ui,sans-serif`,
    `--body:'${body.family}','Inter Variable',system-ui,sans-serif`,
  ].join(";");
  const fonts = JSON.stringify([`${font.weight} 40px '${font.family}'`, `500 40px '${body.family}'`, `700 40px '${body.family}'`]);
  const noise = typeof background === "object" && background.noise ? `<div class="noise" style="opacity:${round(background.noise * 0.6)}"></div>` : "";

  return `<!doctype html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<title>${esc(project.name)} · ${ctx.index + 1}</title>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>${CSS}</style>
</head>
<body>
<div class="${classes}" style="${vars}" data-copy-max="${round(copyMax)}" data-fonts="${esc(fonts)}">
<div class="bg" style="${backgroundCss(background)}"></div>${noise}${DEFS}
${copyHtml}
${stageHtml}
</div>
<script>${FIT_SCRIPT}</script>
</body>
</html>`;
}
