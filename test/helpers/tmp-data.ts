import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Space } from "../../src/store.ts";

export interface TmpData {
  /** An empty data directory of its own, under the system's temporary folder: never the repository's data/. */
  dir: string;
  /** The server's own space in it, as store.ts takes it. */
  space: Space;
  remove(): Promise<void>;
}

/** A throwaway DATA_DIR for one test file. Remove it in `after`, or leave it to the system's temporary folder. */
export async function tmpData(label = "data"): Promise<TmpData> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `appshots-test-${label}-`));
  return {
    dir,
    space: { id: "main", root: dir },
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
