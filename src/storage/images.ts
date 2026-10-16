import sharp, { type Metadata, type SharpOptions } from "sharp";
import { InputError, TooLargeError } from "../domain/errors.ts";

// How the server reads the pictures people upload and the ones it keeps. Every screenshot and image goes through
// here, so the limits below hold for all of them.

// libvips keeps the last 20 files it read open. A screenshot deleted or replaced meanwhile would keep its space on the
// disk until the cache let go of it, and nothing here reads one file often enough to gain from keeping it open.
sharp.cache({ files: 0 });

/**
 * The most pixels an upload may have. A screenshot of a 6K display, the largest Apple makes, has about 20 million.
 * Decoding takes 4 bytes a pixel, so this also caps the memory one upload can take.
 */
export const MAX_PIXELS = 40_000_000;
/** The longest side an upload may have. A 6K display's is 6016 pixels. */
export const MAX_SIDE = 10_000;

/** Opens a picture with the pixel limit in force: one whose header understates its size still cannot decode more. */
export function openImage(input: Buffer | string, options: SharpOptions = {}) {
  return sharp(input, { limitInputPixels: MAX_PIXELS, ...options });
}

/** Refuses a picture of this size before anything of it is decoded. */
export function checkPixels(width: number, height: number): void {
  if (width * height <= MAX_PIXELS && Math.max(width, height) <= MAX_SIDE) return;
  throw new TooLargeError(`The picture is ${width}×${height} pixels, more than any screen has. Upload one of at most ${MAX_PIXELS / 1_000_000} million pixels and ${MAX_SIDE} pixels a side.`);
}

/**
 * What an upload is, from its header alone: nothing of the picture is decoded yet. `refusal` is what the caller is
 * told when it is no picture at all.
 */
export async function readHeader(data: Buffer, refusal: string): Promise<Metadata> {
  try {
    // Unlimited for the header only, so a picture that is too large can be told how large it is.
    return await sharp(data, { limitInputPixels: false }).metadata();
  } catch {
    throw new InputError(refusal);
  }
}

/** What to throw for an error from decoding an upload: sharp's own when a picture is larger than its header said. */
export function decodeError(error: unknown, refusal: string): InputError {
  if (error instanceof InputError) return error;
  if (error instanceof Error && /pixel limit/i.test(error.message)) return new TooLargeError(`The picture has more than ${MAX_PIXELS / 1_000_000} million pixels, more than any screen has.`);
  return new InputError(refusal);
}
