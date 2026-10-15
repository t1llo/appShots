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
