import type { Feature } from "../../schema.ts";
import type { PointStyleId } from "../design.ts";
import { iconSvg } from "./icons.ts";
import { esc, pick, rich } from "./text.ts";

/** The feature points a slide shows with its copy: a short list above, below or beside the device. */
export function pointsHtml(features: Feature[], style: PointStyleId, wide: boolean, locale: string, fallback: string): string {
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
