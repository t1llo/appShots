import sharp from "sharp";
import { renderSettings } from "../config.ts";
import type { Size } from "./capture.ts";

/**
 * The PNG App Store Connect wants from the browser's picture: without an alpha channel, which it rejects even when
 * fully opaque. Given a size, the picture is scaled to it: a size of the same proportions is the drawn one scaled,
 * so every size of a shape shows the identical design. Each size is encoded from the browser's picture, which is
 * what keeps the files byte for byte what they were when each was made from the last.
 */
export function opaquePng(picture: Buffer, size?: Size): Promise<Buffer> {
  const image = sharp(picture);
  if (size) image.resize(size.width, size.height, { fit: "fill" });
  return image.removeAlpha().png({ compressionLevel: renderSettings.pngLevel }).toBuffer();
}

const GAP = 28;
const SHEET_WIDTH = 2000;

/** How large each slide is shown on a contact sheet of `count` slides of a size. */
export function tileSize(size: Size, count: number): Size {
  const height = Math.round(Math.min(620, ((SHEET_WIDTH - GAP * (count + 1)) / count) * (size.height / size.width)));
  return { width: Math.round(height * (size.width / size.height)), height };
}

export interface Tile {
  data: Buffer;
  info: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
}

/** One slide shrunk for the contact sheet, from the browser's picture or from a slide file. */
export async function tileOf(picture: Buffer | string, tile: Size): Promise<Tile> {
  const { data, info } = await sharp(picture).removeAlpha().resize(tile.width, tile.height).raw().toBuffer({ resolveWithObject: true });
  return { data, info: { width: info.width, height: info.height, channels: info.channels } };
}

/** The slides of a set side by side in one strip, so the whole set can be judged at a glance. */
export function contactSheet(tiles: Tile[], tile: Size): Promise<Buffer> {
  return sharp({ create: { width: GAP + tiles.length * (tile.width + GAP), height: tile.height + GAP * 2, channels: 3, background: "#141416" } })
    .composite(tiles.map((each, i) => ({ input: each.data, raw: each.info, left: GAP + i * (tile.width + GAP), top: GAP })))
    .jpeg({ quality: 84 })
    .toBuffer();
}

/** The contact sheet of a set's slide files, for a set this run drew only some of. */
export async function contactSheetOf(files: string[], size: Size): Promise<Buffer> {
  const tile = tileSize(size, files.length);
  return contactSheet(await Promise.all(files.map((file) => tileOf(file, tile))), tile);
}
