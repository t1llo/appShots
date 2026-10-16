import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { tmpData } from "../helpers/tmp-data.ts";

// What an export sends: the rendered files as they were when the download began, whatever a render or a sweep does to
// out/ meanwhile, and nothing left behind once it is sent.

const data = await tmpData("exports");
after(() => data.remove());
process.env.DATA_DIR = data.dir;
const { takeExport } = await import("../../src/services/exports.ts");
const { sweepStaging } = await import("../../src/storage/outputs.ts");
const { createProject, outDir, projectDir } = await import("../../src/store.ts");
const { space } = data;

async function rendered(name: string, files: Record<string, string>): Promise<string> {
  const { id } = await createProject(space, { name, locales: ["en"], targets: ["iphone-6.9"], slides: [{ layout: "statement", headline: { en: "One" } }] });
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(outDir(space, id), file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  return id;
}

const staging = () => readdir(path.join(data.dir, "projects", ".staging")).catch(() => [] as string[]);

test("an export keeps the files it listed, though out/ changes or goes before they are sent", async () => {
  const id = await rendered("Kept", { "en/iphone-6.9/01.png": "first", "en/iphone-6.9/02.png": "second" });
  const taken = await takeExport(space, id);
  try {
    assert.deepEqual(
      taken.entries.map((entry) => entry.name),
      ["README.txt", "en/iphone-6.9/01.png", "en/iphone-6.9/02.png"],
    );
    // A render puts its files in place by renaming them over the old ones, as here.
    const later = path.join(data.dir, "later.png");
    await writeFile(later, "a later render");
    await rename(later, path.join(outDir(space, id), "en/iphone-6.9/01.png"));
    await rm(outDir(space, id), { recursive: true });
    const [, first, second] = taken.entries;
    assert.equal(await readFile(first!.file!, "utf8"), "first");
    assert.equal(await readFile(second!.file!, "utf8"), "second");
    assert.deepEqual([first!.size, second!.size], [5, 6]);
    // A sweep after a render leaves an export that is being sent alone.
    await sweepStaging(projectDir(space, id), new Set());
    assert.equal((await staging()).filter((name) => name.startsWith("export-")).length, 1);
  } finally {
    await taken.release();
  }
  assert.deepEqual(await staging(), []);
});

test("a project with nothing rendered has nothing to export, and leaves no staging folder", async () => {
  const id = await rendered("Empty", {});
  await assert.rejects(takeExport(space, id), /Nothing has been rendered yet/);
  assert.deepEqual(await staging(), []);
});
