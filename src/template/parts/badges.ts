import type { Badge } from "../../schema.ts";
import { iconSvg } from "./icons.ts";
import { esc, pick, quoted, round } from "./text.ts";

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

export function starsHtml(value: number): string {
  return `<div class="stars" style="--fill:${round((value / 5) * 100)}%"><div class="s-bg">${STAR_ROW}</div><div class="s-fg">${STAR_ROW}</div></div>`;
}

/** The gradient gold badges fill their artwork with. */
export const DEFS = `<svg class="defs" aria-hidden="true"><defs><linearGradient id="b-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A0"/><stop offset=".45" stop-color="#EDBD54"/><stop offset="1" stop-color="#BB862C"/></linearGradient></defs></svg>`;

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
    const quote = quoted(title, locale);
    return `<div class="badge card review${tone}">${starsHtml(badge.stars ?? 5)}${quote ? `<div class="b-quote">${esc(quote)}</div>` : ""}${subHtml}</div>`;
  }
  const top = badge.stars !== undefined ? starsHtml(badge.stars) : badge.icon ? iconSvg(badge.icon) : badge.type === "stars" ? starsHtml(5) : "";
  const body = `<div class="b-body">${top}${titleHtml}${subHtml}</div>`;
  if (badge.type === "stars") return `<div class="badge plain${tone}">${body}</div>`;
  return `<div class="badge laurel${tone}">${laurelSvg("l")}${body}${laurelSvg("r")}</div>`;
}
