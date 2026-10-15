import type { Logo, PlacedImage } from "../../schema.ts";
import type { Shot, StoredImage } from "../../store.ts";
import { LOGO_SIZES } from "../design.ts";
import { esc, round } from "./text.ts";

export const imageUrl = (projectId: string, image: StoredImage) => `/files/${projectId}/images/${image.file}?v=${image.version}`;

export const shotUrl = (projectId: string, shot: Shot) => `/files/${projectId}/shots/${shot.file}?v=${shot.version}`;

/** A wordmark is held to this width, in canvas units, however tall the logo was asked to be. */
const LOGO_MAX_WIDTH = 58;

/** The logo at the top of the copy. A name nothing was uploaded under leaves it out. */
export function logoHtml(logo: Logo | undefined, images: StoredImage[], projectId: string): string {
  if (!logo) return "";
  const image = images.find((entry) => entry.name === logo.image);
  if (!image) return "";
  const shape = logo.shape ?? "plain";
  const aspect = shape === "plain" ? image.width / image.height : 1;
  const height = Math.min(LOGO_SIZES[logo.size ?? "medium"], LOGO_MAX_WIDTH / aspect);
  const box = `width:calc(var(--u)*${round(height * aspect)}*var(--ts));height:calc(var(--u)*${round(height)}*var(--ts))`;
  return `<div class="logo logo-${shape}" style="${box}"><img src="${esc(imageUrl(projectId, image))}" alt="" data-image="${esc(image.name)}"></div>`;
}

/** The images a slide places freely, on one of its two layers: over everything, or between the background and the rest. */
export function placedHtml(placed: PlacedImage[], layer: "front" | "behind", images: StoredImage[], projectId: string): string {
  const items = placed
    .filter((entry) => (entry.layer ?? "front") === layer)
    .flatMap((entry) => {
      const image = images.find((candidate) => candidate.name === entry.image);
      if (!image) return [];
      const style = [
        `left:${round(entry.x ?? 50)}%`,
        `top:${round(entry.y ?? 50)}%`,
        `width:${round(entry.size ?? 30)}%`,
        `transform:translate(-50%,-50%) rotate(${round(entry.rotate ?? 0)}deg)${entry.flip ? " scaleX(-1)" : ""}`,
        entry.opacity == null ? "" : `opacity:${round(entry.opacity)}`,
      ];
      const shadow = entry.shadow && entry.shadow !== "none" ? ` class="shadow-${entry.shadow}"` : "";
      return [`<img${shadow} src="${esc(imageUrl(projectId, image))}" style="${style.filter(Boolean).join(";")}" alt="" data-image="${esc(image.name)}">`];
    });
  return items.length ? `<div class="art ${layer}">${items.join("")}</div>` : "";
}
