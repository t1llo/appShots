import type { Feature } from "../../schema.ts";
import { tintedIcon } from "../parts/icons.ts";
import { esc, pick, rich, round } from "../parts/text.ts";
import { colorVars, type Scene, shapeOf } from "./scene.ts";

/** The figure of a stat slide starts at a size its length allows, in canvas units. The page then fits it to the room there is. */
const STAT_SIZE = { most: 54, least: 18, perGlyph: 0.6 };

/** A stat slide: the first feature as one giant figure, the others as a row of smaller figures under it. */
export function statHtml(features: Feature[], scene: Scene): string {
  const { locale, fallback } = scene;
  const figure = (feature: Feature, name: string) => {
    const value = pick(feature.value, locale, fallback);
    const detail = pick(feature.text, locale, fallback);
    const lead = value ? `<div class="st-value">${esc(value)}</div>` : feature.icon ? tintedIcon(feature.icon, "st-icon", scene.ids) : "";
    const tone = colorVars(feature);
    return `<div class="${name}"${tone ? ` style="${tone}"` : ""}>${lead}<div class="st-title">${rich(pick(feature.title, locale, fallback))}</div>${detail ? `<div class="st-detail">${rich(detail)}</div>` : ""}</div>`;
  };
  const [main, ...rest] = features;
  if (!main) return "";
  const glyphs = [...pick(main.value, locale, fallback)].length || 2;
  const shape = shapeOf(scene.canvas);
  const room = scene.canvas.width / scene.unit - 14;
  const size = Math.max(STAT_SIZE.least, Math.min(STAT_SIZE.most * (shape === "tablet" ? 1.4 : 1), room / (glyphs * STAT_SIZE.perGlyph)));
  const row = rest.length ? `<div class="st-row" style="--sc:${Math.min(rest.length, rest.length === 4 ? 2 : 3)}">${rest.map((feature) => figure(feature, "st-item")).join("")}</div>` : "";
  return `<div class="stat" data-size="--sz" data-grow="${shape === "phone" ? 1.4 : 1.85}" style="--sz:1;--sv:${round(size)}">${figure(main, "st-main")}${row}</div>`;
}
