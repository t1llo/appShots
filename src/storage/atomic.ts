import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";

/**
 * Replaces a file all at once: the data goes into a temporary file next to it, reaches the disk, and is then renamed
 * over the old one. A reader sees the old file or the new one, never half of either, and a crash midway leaves the
 * old one as it was. Every write has a temporary file of its own, because two writes sharing one would mix their
 * bytes and rename the mixture into place.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array, options: { mode?: number } = {}): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, "w", options.mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
