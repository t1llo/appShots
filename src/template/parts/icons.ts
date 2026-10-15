import { ICONS } from "../../icons.ts";
import type { IconRow } from "../../schema.ts";
import { BRAND_COLORS, ICON_ROW_SIZES, type IconId } from "../design.ts";
import { luminance } from "./background.ts";
import { esc, type Ids, pick, round } from "./text.ts";

export const iconSvg = (id: IconId, className = "icon") => `<svg class="${className}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${ICONS[id]}</svg>`;

/** An icon shaded from the text colour to the colour of what it stands on. It carries its own gradient, so every card can have its own colour. */
export function tintedIcon(id: IconId, className: string, ids: Ids): string {
  const key = `tint-${ids.next("tint")}`;
  const gradient = `<linearGradient id="${key}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:color-mix(in srgb,var(--c) 60%,var(--text))"/><stop offset="1" style="stop-color:var(--c)"/></linearGradient>`;
  return `<svg class="${className}" viewBox="0 0 256 256" style="--g:url(#${key})" aria-hidden="true">${gradient}${ICONS[id]}</svg>`;
}

/** A slide's row of icons and brand logos. It stays on one line: the icons shrink until all of them fit between the margins. */
export function iconRowHtml(row: IconRow, canvas: { width: number }, unit: number, dark: boolean, locale: string, fallback: string): string {
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
