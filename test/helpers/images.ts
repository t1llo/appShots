import zlib from "node:zlib";
import sharp from "sharp";

// Made up for the tests, never copied from data/: a plain picture is all a contract needs.

/** An opaque PNG of one colour. 1320×2868 is an iPhone 6.9" screenshot, 2064×2752 an iPad 13" one. */
export function png(width: number, height: number, background = "#3B82F6"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

/** A small logo as SVG, which the server draws large enough to stay sharp. */
export const svgLogo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#F59E0B"/></svg>');

/** Width and height of a PNG the server sent. */
export async function sizeOf(data: ArrayBuffer | Buffer): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(Buffer.isBuffer(data) ? data : Buffer.from(data)).metadata();
  return { width, height };
}

/** A capture of a Mac window without its shadow: a white window with corners of `radius` on a see-through canvas, `margin` all round. */
export function macWindow(width: number, height: number, radius = 20, margin = 40): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${margin}" y="${margin}" width="${width - 2 * margin}" height="${height - 2 * margin}" rx="${radius}" fill="#FFFFFF"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A PNG chunk: its length, type, data and checksum. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * A decompression bomb: an RGBA PNG of a megabyte or two that is `width`×`height` see-through pixels, gigabytes
 * once decoded. Compressing that much takes long, so one row is compressed on its own and repeated, which makes an
 * ordinary deflate stream: each copy refers only to itself.
 */
export function bombPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rowBytes = 1 + width * 4;
  const row = zlib.deflateRawSync(Buffer.alloc(rowBytes), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  // Every byte is 0, so the checksum of all of them is 1, plus their count in its upper half.
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((((rowBytes * height) % 65521) << 16) | 1) >>> 0);
  const stream = Buffer.concat([Buffer.from([0x78, 0x01]), Buffer.concat(Array.from({ length: height }, () => row)), Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff]), adler]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", stream), chunk("IEND", Buffer.alloc(0))]);
}
