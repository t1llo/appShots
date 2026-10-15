import path from "node:path";
import { paletteFor } from "../../palette.ts";
import type { Background } from "../../schema.ts";
import type { Shot } from "../../store.ts";
import { BACKGROUNDS, type BackgroundDef } from "../design.ts";

export function luminance(hex: string): number {
  const raw = hex.slice(1);
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Black or white, whichever reads on the colour. */
export const inkOn = (hex: string) => (luminance(hex) > 0.4 ? "#0B0B0F" : "#FFFFFF");

/** The colours a background actually shows. A solid one paints only its first, whatever else it lists. */
const paintedColors = (def: BackgroundDef) => (def.type === "solid" ? def.colors.slice(0, 1) : def.colors);

export function backgroundLuminance(def: BackgroundDef): number {
  const values = paintedColors(def).map(luminance);
  if (def.type !== "mesh" || values.length === 1) return values.reduce((a, b) => a + b, 0) / values.length;
  // The base colour shows through between the blobs, so it carries half the weight.
  const blobs = values.slice(1);
  return values[0]! * 0.5 + (blobs.reduce((a, b) => a + b, 0) / blobs.length) * 0.5;
}

const MESH_SPOTS = ["12% 8%", "88% 22%", "72% 92%", "8% 78%"];

export function backgroundCss(def: BackgroundDef): string {
  const [base, ...rest] = paintedColors(def);
  if (rest.length === 0) return `background:${base}`;
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
