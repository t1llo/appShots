import path from "node:path";
import { BACKGROUNDS, type BackgroundDef, DEVICE_COLORS, type FontId, FONTS, type IconId, type LayoutId } from "./design.ts";
import { hasBakedIsland, paletteFor } from "./palette.ts";
import type { Background, Badge, DeviceStyle, Project, Text } from "./schema.ts";
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

const ICONS: Record<IconId, string> = {
  trophy:
    '<path d="M7 3h10v4.6a5 5 0 0 1-10 0z"/><path d="M7 4.9H4.4v1.2a3.4 3.4 0 0 0 3.2 3.4M17 4.9h2.6v1.2a3.4 3.4 0 0 1-3.2 3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M11 12.2h2v4h-2z"/><path d="M8.3 16h7.4a1.3 1.3 0 0 1 1.3 1.3V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2.7A1.3 1.3 0 0 1 8.3 16z"/>',
  crown: '<path d="M2.6 7.4l4.9 3.9L12 4.2l4.5 7.1 4.9-3.9-1.7 9.4H4.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><rect x="4.3" y="18.4" width="15.4" height="2.4" rx="1.2"/>',
  medal:
    '<path d="M6.2 2h4.1l2.5 5.6-3.4 1.5z" opacity=".7"/><path d="M17.8 2h-4.1l-2.5 5.6 3.4 1.5z" opacity=".7"/><circle cx="12" cy="14.8" r="6.7"/><polygon points="' +
    starPoints(12, 14.9, 3.5, 1.5) +
    '" fill="var(--medal-star,rgba(0,0,0,.35))"/>',
  star: `<polygon points="${starPoints(12, 12.6, 10, 4.5)}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  heart: '<path d="M12 20.8S3.6 15.9 3.6 9.7A4.7 4.7 0 0 1 12 7a4.7 4.7 0 0 1 8.4 2.7c0 6.2-8.4 11.1-8.4 11.1z"/>',
  download: '<path d="M10.7 3h2.6v8.6l3-3 1.9 1.9L12 16.7l-6.2-6.2 1.9-1.9 3 3z"/><rect x="4" y="18.4" width="16" height="2.6" rx="1.3"/>',
  bolt: '<path d="M13.6 2L4.8 13.6h5.6L9.4 22l9.8-12.3h-5.9z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>',
  shield: '<path d="M12 2.2l8 3v6.1c0 5-3.3 9-8 10.6-4.7-1.600-8-5.600-8-10.600V5.200z"/>',
  check: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.500 14.300l-4.100-4.100 1.700-1.700 2.400 2.400 5.400-5.400 1.700 1.700z"/>',
};

const iconSvg = (id: IconId) => `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[id]}</svg>`;

export function badgeHtml(badge: Badge, locale: string, fallback: string): string {
  const title = pick(badge.title, locale, fallback);
  const subtitle = pick(badge.subtitle, locale, fallback);
  const titleHtml = title ? `<div class="b-title">${esc(title)}</div>` : "";
  const subHtml = subtitle ? `<div class="b-sub">${esc(subtitle)}</div>` : "";

  if (badge.type === "pill") {
    return `<div class="badge pill">${badge.icon ? iconSvg(badge.icon) : ""}<span>${esc(title || subtitle)}</span></div>`;
  }
  if (badge.type === "icon") {
    return `<div class="badge with-icon">${iconSvg(badge.icon ?? "trophy")}<div class="b-body">${titleHtml}${subHtml}</div></div>`;
  }
  const top = badge.stars !== undefined ? starsHtml(badge.stars) : badge.icon ? iconSvg(badge.icon) : badge.type === "stars" ? starsHtml(5) : "";
  const body = `<div class="b-body">${top}${titleHtml}${subHtml}</div>`;
  if (badge.type === "stars") return `<div class="badge plain">${body}</div>`;
  return `<div class="badge laurel">${laurelSvg("l")}${body}${laurelSvg("r")}</div>`;
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
  duo: 0.7,
  hero: 0.9,
};

/** Share of the canvas height the copy block may take before the text starts shrinking. */
const COPY_MAX: Record<LayoutId, number> = {
  "device-bottom": 0.34,
  "device-top": 0.34,
  "device-center": 0.36,
  tilted: 0.34,
  duo: 0.32,
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
.layout-device-center .stage{align-items:center;padding:calc(var(--u)*5.5) 0 calc(var(--u)*9)}
.layout-duo .stage{display:block}
.layout-duo .device{position:absolute;left:50%}
.no-device .copy{flex:1;justify-content:center;padding-top:0}
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

  if (stage) {
    const style = getComputedStyle(stage);
    const room = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    for (const device of stage.querySelectorAll('.device')) {
      const width = parseFloat(device.style.getPropertyValue('--dw'));
      if (device.dataset.fit === 'contain') {
        const perWidth = device.offsetHeight / width;
        device.style.setProperty('--dw', Math.min(width, room / perWidth) * parseFloat(device.dataset.scale) + 'px');
      } else if (!canvas.classList.contains('layout-duo') && room - device.offsetHeight > u * 4) {
        // A device that fits whole would leave a dead band at the edge it was meant to bleed off.
        stage.classList.add('fits');
      }
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
  const align = slide.align ?? theme.align ?? "center";
  const textScale = slide.textScale ?? theme.textScale ?? 1;
  const deviceStyle: DeviceStyle = { ...theme.device, ...slide.device };

  const eyebrow = pick(slide.eyebrow, locale, fallback);
  const headline = pick(slide.headline, locale, fallback);
  const sub = pick(slide.subheadline, locale, fallback);
  const badges = slide.badges ?? [];
  const badgePosition = slide.badgePosition ?? (layout === "hero" ? "top" : "bottom");
  const hasDevice = Boolean(slide.screenshot) || (layout === "duo" && Boolean(slide.screenshot2));

  const unit = Math.min(target.width, target.height / 2) / 100;
  const canvas = { width: target.width, height: target.height };
  const badgeScale = (layout === "hero" ? 1.25 : 1) * (badges.length >= 3 ? 0.78 : 1);

  const badgesHtml = badges.length
    ? `<div class="badges ${badgePosition}">${badges.map((badge) => badgeHtml(badge, locale, fallback)).join("")}</div>`
    : "";
  const headlineHtml = rich(headline);
  const twoTone = !accent && headlineHtml.includes("<em>");
  const copyParts = [
    badgePosition === "top" ? badgesHtml : "",
    eyebrow ? `<div class="eyebrow${accent ? "" : " muted"}">${esc(eyebrow)}</div>` : "",
    headline ? `<h1 class="headline${twoTone ? " two-tone" : ""}">${headlineHtml}</h1>` : "",
    sub ? `<p class="sub">${rich(sub)}</p>` : "",
    badgePosition === "bottom" ? badgesHtml : "",
  ].join("");
  const copyHtml = copyParts ? `<div class="copy">${copyParts}</div>` : "";

  let stageHtml = "";
  if (hasDevice) {
    const common = { style: deviceStyle, targetDevice: target.device, canvas, width: LAYOUT_WIDTH[layout] };
    if (layout === "duo") {
      const gap = unit * 6.5;
      const place = (x: number, top: number, z: number) => `margin-left:calc(var(--dw)*-.5 + ${round(x * canvas.width)}px);top:${round(top)}px;z-index:${z}`;
      stageHtml =
        deviceHtml({ ...common, shot: shot2, wanted: slide.screenshot2, url: shotUrl(shot2), island: await needsIsland(shot2), fit: "width", defaults: { rotate: -6 }, extraCss: place(-0.19, gap + unit * 10, 1) }) +
        deviceHtml({ ...common, shot, wanted: slide.screenshot, url: shotUrl(shot), island: await needsIsland(shot), fit: "width", defaults: { rotate: 5 }, extraCss: place(0.17, gap, 2) });
    } else {
      stageHtml = deviceHtml({
        ...common,
        shot,
        wanted: slide.screenshot,
        url: shotUrl(shot),
        island: await needsIsland(shot),
        fit: layout === "device-center" ? "contain" : "width",
        defaults: layout === "tilted" ? { rotate: -8, offsetX: 5 } : undefined,
      });
    }
    stageHtml = `<div class="stage">${stageHtml}</div>`;
  }

  const classes = ["canvas", `layout-${layout}`, `align-${align}`, dark ? "dark" : "light", hasDevice ? "" : "no-device"].filter(Boolean).join(" ");
  const vars = [
    `width:${target.width}px`,
    `height:${target.height}px`,
    `--u:${round(unit)}px`,
    `--ts:${textScale}`,
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
<div class="${classes}" style="${vars}" data-copy-max="${hasDevice ? COPY_MAX[layout] : 0.92}" data-fonts="${esc(fonts)}">
<div class="bg" style="${backgroundCss(background)}"></div>${noise}
${copyHtml}
${stageHtml}
</div>
<script>${FIT_SCRIPT}</script>
</body>
</html>`;
}
