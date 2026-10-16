import { inflateSync } from "node:zlib";

/**
 * Whether a screenshot shows nothing yet: one colour from below the status bar to above the home indicator and
 * the toolbars, as an app shows it from its launch until its first screen is drawn. That can stay the same for
 * seconds, so two frames alike do not mean the screen is up. Null for a PNG this does not read: one of another
 * depth, an interlaced one, or one too small to be a screen.
 * @param {Buffer} png
 * @returns {boolean | null}
 */
export function blankScreen(png) {
  if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47 || png.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
  if (png[24] !== 8 || channels === 0 || png[28] !== 0 || Math.min(width, height) < 300) return null;
  const parts = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const kind = png.toString("latin1", at + 4, at + 8);
    if (kind === "IEND") break;
    if (kind === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  let data;
  try {
    data = inflateSync(Buffer.concat(parts));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (data.length < height * (stride + 1)) return null;
  const top = Math.round(height * 0.1);
  const bottom = Math.round(height * 0.88);
  let above = new Uint8Array(stride);
  /** @type {number[] | null} */
  let first = null;
  // Each row is stored as the difference from the pixels before it, so every row down to the last one looked at
  // is restored, while the comparison stops at the first pixel of another colour.
  for (let y = 0; y < bottom; y++) {
    const start = y * (stride + 1) + 1;
    const filter = data[start - 1];
    const row = new Uint8Array(data.subarray(start, start + stride));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = above[x];
      const corner = x >= channels ? above[x - channels] : 0;
      if (filter === 1) row[x] += left;
      else if (filter === 2) row[x] += up;
      else if (filter === 3) row[x] += (left + up) >> 1;
      else if (filter === 4) {
        const guess = left + up - corner;
        const [a, b, c] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - corner)];
        row[x] += a <= b && a <= c ? left : b <= c ? up : corner;
      }
    }
    above = row;
    if (y < top) continue;
    first ??= [row[0], row[1], row[2]];
    for (let x = 0; x < stride; x += channels) {
      if (Math.abs(row[x] - first[0]) > 2 || Math.abs(row[x + 1] - first[1]) > 2 || Math.abs(row[x + 2] - first[2]) > 2) return false;
    }
  }
  return true;
}
