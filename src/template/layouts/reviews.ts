import type { Badge } from "../../schema.ts";
import { starsHtml } from "../parts/badges.ts";
import { esc, pick, quoted, round } from "../parts/text.ts";
import { type Scene, shapeOf } from "./scene.ts";

/** A reviews slide: the slide's review badges as a wall of quote cards. */
export function reviewsHtml(reviews: Badge[], scene: Scene): string {
  const { canvas, locale, fallback } = scene;
  const count = reviews.length;
  if (!count) return "";
  const shape = shapeOf(canvas);
  // One column of large cards on a portrait canvas, until there are too many to read at that size. A wide one sets them side by side.
  const columns = shape === "wide" ? Math.min(count, 3) : count > 3 ? 2 : 1;
  const size = shape === "phone" ? (columns === 1 ? 1.25 : 0.84) : shape === "tablet" ? (columns === 1 ? 1.5 : 1.2) : 1.1;
  // How wide the wall may be, in canvas units.
  const width = shape === "phone" ? 86 : shape === "tablet" ? (columns === 1 ? 108 : 134) : [96, 150, 204][columns - 1]!;
  const cards = reviews.map((review) => {
    const said = pick(review.title, locale, fallback);
    const by = pick(review.subtitle, locale, fallback);
    const quote = quoted(said, locale);
    return `<div class="rv-card${review.tone === "gold" ? " gold" : ""}">${starsHtml(review.stars ?? 5)}${quote ? `<div class="rv-quote">${esc(quote)}</div>` : ""}${by ? `<div class="rv-by">${esc(by)}</div>` : ""}</div>`;
  });
  return `<div class="reviews" data-size="--rz" data-grow="${round(size * (shape === "wide" ? 1.6 : 1.3))}" style="--rz:${size}"><div class="rv-wall" style="--rc:${columns};--rw:${width}">${cards.join("")}</div></div>`;
}
