import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { type Commit, commitOutputs, discardStaging, listSets, readManifest, type StagedSet, stagingDir, sweepStaging } from "../../src/storage/outputs.ts";
import { isTargetId, TARGETS } from "../../src/sizes.ts";
import { tmpData } from "../helpers/tmp-data.ts";

// How a finished render's pictures get into out/: all at once, and with what they make out of date taken away.

const data = await tmpData("outputs");
after(() => data.remove());

let projects = 0;
/** A project folder with a project.json in the given languages. */
async function projectFolder(locales = ["en"]): Promise<string> {
  const dir = path.join(data.dir, "projects", `p${++projects}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "project.json"), JSON.stringify({ locales }));
  return dir;
}

/** Writes files with the given contents, by path inside `root`. */
async function put(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
}

/** Every file under a folder, with its contents. */
async function contents(root: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])) {
    if (entry.isFile()) {
      const full = path.join(entry.parentPath, entry.name);
      found[path.relative(root, full)] = await readFile(full, "utf8");
    }
  }
  return found;
}

const deviceOf = (target: string) => (isTargetId(target) ? TARGETS[target].device : undefined);

function set(locale: string, target: string, files: string[], fields: Partial<StagedSet> = {}): StagedSet {
  return { locale, target, device: deviceOf(target)!, files, full: true, count: files.length, design: "design-a", ...fields };
}

const commit = (job: string, sets: StagedSet[], fields: Partial<Commit> = {}): Commit => ({ job, sets, creatives: [], remove: [], deviceOf, ...fields });

test("a finished run replaces its sets and records them", async () => {
  const dir = await projectFolder();
  await put(path.join(dir, "out"), { "en/iphone-6.9/01.png": "old 1", "en/iphone-6.9/02.png": "old 2", "en/iphone-6.9/03.png": "old 3" });
  await put(stagingDir(dir, "job1"), { "en/iphone-6.9/01.png": "new 1", "en/iphone-6.9/02.png": "new 2", "en/iphone-6.9/sheet.jpg": "sheet" });
  assert.equal(await commitOutputs("main/p", dir, commit("job1", [set("en", "iphone-6.9", ["01.png", "02.png"])])), true);

  assert.deepEqual(await contents(path.join(dir, "out")), { "en/iphone-6.9/01.png": "new 1", "en/iphone-6.9/02.png": "new 2", "en/iphone-6.9/sheet.jpg": "sheet" });
  assert.deepEqual((await readdir(dir)).sort(), ["out", "outputs.json", "project.json"]);
  const manifest = await readManifest(dir);
  assert.deepEqual(
    manifest.sets.map(({ locale, target, files, design, job }) => ({ locale, target, files, design, job })),
    [{ locale: "en", target: "iphone-6.9", files: ["01.png", "02.png"], design: "design-a", job: "job1" }],
  );
  const [listed] = await listSets(dir);
  assert.deepEqual(listed!.files, ["01.png", "02.png"]);
  assert.ok(listed!.version >= manifest.sets[0]!.renderedAt);
});

test("a run that is thrown away leaves out/ as it was", async () => {
  const dir = await projectFolder();
  await put(path.join(dir, "out"), { "en/iphone-6.9/01.png": "old 1" });
  await put(stagingDir(dir, "job1"), { "en/iphone-6.9/01.png": "half drawn" });
  await discardStaging(dir, "job1");
  assert.deepEqual(await contents(path.join(dir, "out")), { "en/iphone-6.9/01.png": "old 1" });
  assert.deepEqual((await readdir(dir)).sort(), ["out", "project.json"]);
});

test("a run of some slides keeps the others, but none the set no longer has", async () => {
  const dir = await projectFolder();
  await put(path.join(dir, "out"), { "en/iphone-6.9/01.png": "old 1", "en/iphone-6.9/02.png": "old 2", "en/iphone-6.9/03.png": "old 3", "en/iphone-6.9/sheet.jpg": "old sheet" });
  await put(stagingDir(dir, "job1"), { "en/iphone-6.9/01.png": "new 1" });
  const sheet = async (files: string[]) => Buffer.from(`sheet of ${files.map((file) => path.basename(file)).join(" ")}`);
  await commitOutputs("main/p", dir, commit("job1", [set("en", "iphone-6.9", ["01.png"], { full: false, count: 2, sheet })]));
  assert.deepEqual(await contents(path.join(dir, "out")), { "en/iphone-6.9/01.png": "new 1", "en/iphone-6.9/02.png": "old 2", "en/iphone-6.9/sheet.jpg": "sheet of 01.png 02.png" });
  assert.deepEqual((await readManifest(dir)).sets[0]!.files, ["01.png", "02.png"]);
});

test("other sizes of the device drawn from another design are taken away", async () => {
  const dir = await projectFolder();
  await put(stagingDir(dir, "job1"), { "en/iphone-6.9/01.png": "a", "en/iphone-6.5/01.png": "a", "en/iphone-6.1/01.png": "a", "en/ipad-13/01.png": "a" });
  await commitOutputs("main/p", dir, commit("job1", ["iphone-6.9", "iphone-6.5", "iphone-6.1", "ipad-13"].map((target) => set("en", target, ["01.png"]))));
  // A size from before outputs.json was kept has no design on record, and stays.
  await put(path.join(dir, "out"), { "en/iphone-5.5/01.png": "unknown" });

  // The iPhone design changes, and only the 6.9" and 6.1" sizes are drawn again.
  await put(stagingDir(dir, "job2"), { "en/iphone-6.9/01.png": "b", "en/iphone-6.1/01.png": "b" });
  await commitOutputs("main/p", dir, commit("job2", ["iphone-6.9", "iphone-6.1"].map((target) => set("en", target, ["01.png"], { design: "design-b" }))));
  assert.deepEqual(await contents(path.join(dir, "out")), { "en/iphone-6.9/01.png": "b", "en/iphone-6.1/01.png": "b", "en/ipad-13/01.png": "a", "en/iphone-5.5/01.png": "unknown" });
  assert.deepEqual((await listSets(dir)).map((each) => each.target), ["ipad-13", "iphone-5.5", "iphone-6.1", "iphone-6.9"]);
  assert.deepEqual((await readManifest(dir)).sets.map((each) => each.target).sort(), ["ipad-13", "iphone-6.1", "iphone-6.9"]);
});

test("slides a set has lost go from the sizes the run did not draw as well", async () => {
  const dir = await projectFolder(["en", "de"]);
  const three = (text: string) => ({ "01.png": `${text} 1`, "02.png": `${text} 2`, "03.png": `${text} 3`, "sheet.jpg": `${text} sheet` });
  const layout = (prefix: string, files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([name, text]) => [`${prefix}/${name}`, text]));
  await put(path.join(dir, "out"), { ...layout("en/iphone-6.9", three("phone")), ...layout("en/ipad-13", three("pad")), ...layout("de/ipad-13", three("pad de")), "en/mac-2880/03.png": "mac 3" });
  await put(stagingDir(dir, "job1"), { "en/ipad-13/01.png": "a" });
  await commitOutputs("main/p", dir, commit("job1", [set("en", "ipad-13", ["01.png"], { full: false, count: 3 })]));
  // The set is cut to two slides and only the first iPhone slide is drawn again: no size keeps slide 3, and an
  // iPad set that is cut keeps no sheet of the slides it had. A size left with no slide at all goes.
  await put(stagingDir(dir, "job2"), { "en/iphone-6.9/01.png": "new phone 1" });
  await commitOutputs("main/p", dir, commit("job2", [set("en", "iphone-6.9", ["01.png"], { full: false, count: 2 })], { counts: { iphone: 2, ipad: 2, mac: 2, duo: 2 } }));
  assert.deepEqual(await contents(path.join(dir, "out")), {
    "en/iphone-6.9/01.png": "new phone 1",
    "en/iphone-6.9/02.png": "phone 2",
    "en/ipad-13/01.png": "a",
    "en/ipad-13/02.png": "pad 2",
    "de/ipad-13/01.png": "pad de 1",
    "de/ipad-13/02.png": "pad de 2",
  });
  assert.deepEqual(
    (await readManifest(dir)).sets.map((each) => `${each.locale}/${each.target} ${each.files.join(" ")}`).sort(),
    ["en/ipad-13 01.png 02.png", "en/iphone-6.9 01.png 02.png"],
  );
  assert.deepEqual((await listSets(dir)).map((each) => `${each.locale}/${each.target} ${each.files.join(" ")}`), ["de/ipad-13 01.png 02.png", "en/ipad-13 01.png 02.png", "en/iphone-6.9 01.png 02.png"]);
});

test("languages the project no longer has are taken away, and old sizes on a render of everything", async () => {
  const dir = await projectFolder(["en", "de-DE"]);
  await put(path.join(dir, "out"), { "fr/iphone-6.9/01.png": "fr", "de-de/iphone-6.9/01.png": "de", "en/iphone-6.5/01.png": "old size", "en/notes/readme.txt": "not a size" });
  await put(stagingDir(dir, "job1"), { "en/iphone-6.9/01.png": "en" });
  await commitOutputs("main/p", dir, commit("job1", [set("en", "iphone-6.9", ["01.png"])], { cleanup: { locales: ["en", "de-DE"], targets: ["iphone-6.9"] } }));
  assert.deepEqual(await contents(path.join(dir, "out")), { "de-de/iphone-6.9/01.png": "de", "en/iphone-6.9/01.png": "en", "en/notes/readme.txt": "not a size" });
});

test("a language taken out of the project while it rendered is neither put in place nor kept", async () => {
  const dir = await projectFolder(["en"]);
  await put(path.join(dir, "out"), { "en/iphone-6.9/01.png": "old en", "fr/iphone-6.9/01.png": "old fr", "fr/iphone-6.5/01.png": "old fr" });
  await put(stagingDir(dir, "job1"), { "en/iphone-6.9/01.png": "new en", "fr/iphone-6.9/01.png": "new fr", "fr/creatives/header.png": "new fr header" });
  const committed = await commitOutputs(
    "main/p",
    dir,
    commit("job1", [set("en", "iphone-6.9", ["01.png"]), set("fr", "iphone-6.9", ["01.png"])], { creatives: [{ locale: "fr", placement: "header", path: "fr/creatives/header.png" }] }),
  );
  assert.equal(committed, true);
  assert.deepEqual(await contents(path.join(dir, "out")), { "en/iphone-6.9/01.png": "new en" });
  assert.deepEqual((await readManifest(dir)).sets.map((each) => `${each.locale}/${each.target} ${each.job}`), ["en/iphone-6.9 job1"]);
  assert.deepEqual((await readdir(dir)).sort(), ["out", "outputs.json", "project.json"]);
});

test("a language the project no longer has is not listed, before a render takes it away", async () => {
  const dir = await projectFolder(["en", "de-DE"]);
  await put(path.join(dir, "out"), { "en/iphone-6.9/01.png": "en", "de-de/iphone-6.9/01.png": "de", "fr/iphone-6.9/01.png": "fr" });
  assert.deepEqual((await listSets(dir)).map((each) => each.locale), ["de-de", "en"]);
});

test("assets are moved into place, and the ones the project dropped are removed", async () => {
  const dir = await projectFolder();
  await put(path.join(dir, "out"), { "en/creatives/header.png": "old header", "en/creatives/search.png": "old search" });
  await put(stagingDir(dir, "job1"), { "en/creatives/header.png": "new header" });
  await commitOutputs("main/p", dir, commit("job1", [], { creatives: [{ locale: "en", placement: "header", path: "en/creatives/header.png" }], remove: [{ locale: "en", placement: "search", path: "en/creatives/search.png" }] }));
  assert.deepEqual(await contents(path.join(dir, "out")), { "en/creatives/header.png": "new header" });
  assert.deepEqual((await readManifest(dir)).creatives.map((each) => each.placement), ["header"]);
});

test("a project deleted while it rendered is not brought back", async () => {
  const dir = await projectFolder();
  await put(stagingDir(dir, "job1"), { "en/iphone-6.9/01.png": "new" });
  await rm(path.join(dir, "project.json"));
  assert.equal(await commitOutputs("main/p", dir, commit("job1", [set("en", "iphone-6.9", ["01.png"])])), false);
  await assert.rejects(readdir(dir));
});

test("staging folders no run is using are swept away", async () => {
  const dir = await projectFolder();
  await put(stagingDir(dir, "gone"), { "en/iphone-6.9/01.png": "left over" });
  await put(stagingDir(dir, "running"), { "en/iphone-6.9/01.png": "drawing" });
  await sweepStaging(dir, new Set(["running"]));
  assert.deepEqual(await readdir(path.join(dir, ".staging")), ["running"]);
});

test("a manifest that cannot be read counts as none", async () => {
  const dir = await projectFolder();
  await put(path.join(dir, "out"), { "en/iphone-6.9/01.png": "one" });
  await writeFile(path.join(dir, "outputs.json"), "{ not json");
  assert.deepEqual(await readManifest(dir), { version: 1, sets: [], creatives: [] });
  assert.deepEqual((await listSets(dir)).map((each) => each.files), [["01.png"]]);
});
