import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { projectSchema } from "../../src/schema.ts";
import { writeFileAtomic } from "../../src/storage/atomic.ts";
import { createProject, deleteProject, getProject, listProjects, listShots, projectDir, updateProject } from "../../src/store.ts";
import { tmpData } from "../helpers/tmp-data.ts";

const data = await tmpData("store");
after(() => data.remove());
const { space } = data;

test("writeFileAtomic replaces a file and leaves nothing beside it", async () => {
  const dir = path.join(data.dir, "atomic");
  await mkdir(dir);
  const file = path.join(dir, "state.json");
  await writeFileAtomic(file, "first");
  await writeFileAtomic(file, new TextEncoder().encode("second"));
  assert.equal(await readFile(file, "utf8"), "second");
  assert.deepEqual(await readdir(dir), ["state.json"]);
});

test("writeFileAtomic gives the file the mode asked for", { skip: process.platform === "win32" && "no POSIX modes" }, async () => {
  const file = path.join(data.dir, "secret.json");
  await writeFileAtomic(file, "{}", { mode: 0o600 });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("writeFileAtomic removes its temporary file when the rename fails", async () => {
  const dir = path.join(data.dir, "refused");
  // A folder that is not empty cannot be renamed over.
  await mkdir(path.join(dir, "target", "inside"), { recursive: true });
  await assert.rejects(writeFileAtomic(path.join(dir, "target"), "data"));
  assert.deepEqual(await readdir(dir), ["target"]);
});

test("writes that overlap leave one of them whole, never a mixture", async () => {
  const dir = path.join(data.dir, "overlap");
  await mkdir(dir);
  const file = path.join(dir, "big.txt");
  // Large enough that the writes take turns on the disk.
  const versions = Array.from({ length: 50 }, (_, i) => String.fromCharCode(65 + (i % 26)).repeat(200_000 + i));
  await Promise.all(versions.map((version) => writeFileAtomic(file, version)));
  assert.ok(versions.includes(await readFile(file, "utf8")));
  assert.deepEqual(await readdir(dir), ["big.txt"]);
});

test("50 parallel updates leave a project.json that parses (store-1)", async () => {
  const { id } = await createProject(space, { name: "Parallel" });
  await Promise.all(Array.from({ length: 50 }, (_, i) => updateProject(space, id, { name: `Parallel ${i}`, slides: [{ layout: "statement", headline: `Edit ${i}` }] })));
  const saved = projectSchema.parse(JSON.parse(await readFile(path.join(projectDir(space, id), "project.json"), "utf8")));
  // Whichever came last is there whole: its name and its slide belong together.
  assert.equal(saved.slides[0]!.headline, `Edit ${saved.name.split(" ")[1]}`);
  assert.deepEqual(await readdir(projectDir(space, id)), ["project.json"]);
});

test("parallel updates of different fields keep every one of them", { todo: "store-2" }, async () => {
  const { id } = await createProject(space, { name: "Lost Update" });
  await Promise.all([
    updateProject(space, id, { name: "Renamed" }),
    updateProject(space, id, { locales: ["en", "de"] }),
    updateProject(space, id, { theme: { font: "inter" } }),
    updateProject(space, id, { slides: [{ layout: "statement", headline: "Kept" }] }),
  ]);
  const project = await getProject(space, id);
  assert.equal(project.name, "Renamed");
  assert.deepEqual(project.locales, ["en", "de"]);
  assert.equal(project.theme.font, "inter");
  assert.equal(project.slides[0]?.headline, "Kept");
});

test("a damaged project.json can still be deleted", { todo: "store-3" }, async () => {
  const { id } = await createProject(space, { name: "Damaged" });
  await writeFile(path.join(projectDir(space, id), "project.json"), '{"id": "damaged",');
  await deleteProject(space, id);
  await assert.rejects(stat(projectDir(space, id)));
});

test("a damaged project.json is listed, not hidden", { todo: "store-3" }, async () => {
  const { id } = await createProject(space, { name: "Hidden" });
  await writeFile(path.join(projectDir(space, id), "project.json"), "");
  assert.ok((await listProjects(space)).some((project) => project.id === id));
});

test("one unreadable screenshot does not stop the project from loading", { todo: "store-5" }, async () => {
  const { id } = await createProject(space, { name: "Broken Shot" });
  await mkdir(path.join(projectDir(space, id), "shots"));
  await writeFile(path.join(projectDir(space, id), "shots", "broken.iphone.png"), "");
  assert.deepEqual(await listShots(space, id), []);
});

test("a project's languages are each listed once", { todo: "store-10" }, () => {
  const project = { id: "twice", name: "Twice", createdAt: "", updatedAt: "", theme: {}, slides: [] };
  assert.equal(projectSchema.safeParse({ ...project, locales: ["en", "en"] }).success, false);
  assert.equal(projectSchema.safeParse({ ...project, locales: ["en", "EN"] }).success, false);
  assert.equal(projectSchema.safeParse({ ...project, locales: ["en", "de"] }).success, true);
});
