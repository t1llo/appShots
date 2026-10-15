import type { Feature } from "../../schema.ts";
import { esc, pick, rich } from "../parts/text.ts";
import { colorVars, featureShot, type Scene, shapeOf } from "./scene.ts";

/** The number of a step, written the way the language writes numbers. */
function stepNumber(step: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(step);
  } catch {
    return String(step);
  }
}

/** A steps slide: the features as numbered steps joined by a line, down a portrait canvas and across a wide one. */
export function stepsHtml(features: Feature[], scene: Scene): string {
  const { locale, fallback } = scene;
  if (!features.length) return "";
  const steps = features.map((feature, i) => {
    const detail = pick(feature.text, locale, fallback);
    const shot = featureShot(feature, scene);
    const picture = shot ? `<div class="sp-pic${shot.wide ? " land" : ""}" style="--ar:${shot.aspect}"><img src="${esc(shot.url)}" alt="" data-shot="${esc(shot.name)}"></div>` : "";
    const text = `<div class="sp-text"><div class="sp-title">${rich(pick(feature.title, locale, fallback))}</div>${detail ? `<div class="sp-detail">${rich(detail)}</div>` : ""}</div>`;
    const tone = colorVars(feature);
    return `<div class="sp-step"${tone ? ` style="${tone}"` : ""}><div class="sp-rail"><span class="sp-num">${esc(pick(feature.value, locale, fallback) || stepNumber(i + 1, locale))}</span></div>${text}${picture}</div>`;
  });
  const shape = shapeOf(scene.canvas);
  return `<div class="steps${shape === "tablet" ? " roomy" : ""}" data-size="--pz" data-grow="${shape === "phone" ? 1.5 : 2}" style="--pz:1"><div class="sp-list" style="--pn:${steps.length}">${steps.join("")}</div></div>`;
}
