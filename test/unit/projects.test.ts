import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import { ConflictError, DamagedError, NotFoundError } from "../../src/domain/errors.ts";
import { countProjects, createProjectRepository } from "../../src/storage/projects.ts";
import { sweepProjects } from "../../src/storage/migrate.ts";
import { historyDir, projectDir, projectFile, type Space } from "../../src/storage/paths.ts";
import { tmpData } from "../helpers/tmp-data.ts";

const data = await tmpData("projects");
after(() => data.remove());
const { space } = data;
const logged: string[] = [];
const projects = createProjectRepository({ log: (message) => logged.push(message) });

const stored = async (id: string) => JSON.parse(await readFile(projectFile(space, id), "utf8"));
const history = async (id: string) => (await readdir(historyDir(space, id))).sort((a, b) => parseInt(a) - parseInt(b));

describe("changes", () => {
  test("100 changes at once each land, one revision apiece", async () => {
    const { project } = await projects.create(space, { name: "Counter", slides: [{ layout: "statement", headline: "0" }] });
    await Promise.all(
      Array.from({ length: 100 }, () => projects.mutate(space, project.id, (current) => ({ ...current, slides: [{ ...current.slides[0]!, headline: String(Number(current.slides[0]!.headline) + 1) }] }))),
    );
    const read = await projects.get(space, project.id);
    assert.equal(read.project.slides[0]!.headline, "100");
    assert.equal(read.revision, 101);
    // The last 50 versions are kept, the current one among them, and nothing half written is left.
    const kept = await history(project.id);
    assert.equal(kept.length, 50);
    assert.equal(kept.at(-1), "101-api.json");
    assert.deepEqual((await readdir(projectDir(space, project.id))).sort(), [".history", "project.json"]);
  });

  test("a change made on an older revision is refused and saves nothing", async () => {
    const { project } = await projects.create(space, { name: "Stale" });
    await projects.mutate(space, project.id, (current) => ({ ...current, name: "Fresh" }), { ifRevision: 1 });
    await assert.rejects(
      projects.mutate(space, project.id, (current) => ({ ...current, name: "Lost" }), { ifRevision: 1 }),
      (error: unknown) => error instanceof ConflictError && error.revision === 2 && error.status === 409 && /revision 1 .* revision 2 now/.test(error.message),
    );
    assert.equal((await projects.get(space, project.id)).project.name, "Fresh");
    assert.equal((await stored(project.id)).revision, 2);
  });

  test("a change that throws writes nothing", async () => {
    const { project } = await projects.create(space, { name: "Refused" });
    await assert.rejects(
      projects.mutate(space, project.id, () => {
        throw new Error("no");
      }),
      /no/,
    );
    assert.equal((await projects.get(space, project.id)).revision, 1);
  });

  test("screenshots are filed under the new first language only once it is saved", async () => {
    const { project } = await projects.create(space, { name: "Languages", locales: ["en", "de"] });
    const shots = path.join(projectDir(space, project.id), "shots");
    await mkdir(shots);
    await writeFile(path.join(shots, "home.iphone.png"), "en");
    await writeFile(path.join(shots, "home.iphone.de.png"), "de");
    // Refused by the schema: nothing is saved, so nothing moves.
    await assert.rejects(projects.mutate(space, project.id, (current) => ({ ...current, locales: ["de", "DE"] })));
    assert.deepEqual((await readdir(shots)).sort(), ["home.iphone.de.png", "home.iphone.png"]);
    await projects.mutate(space, project.id, (current) => ({ ...current, locales: ["de", "en"] }));
    assert.equal(await readFile(path.join(shots, "home.iphone.png"), "utf8"), "de");
    assert.equal(await readFile(path.join(shots, "home.iphone.en.png"), "utf8"), "en");
  });

  test("two projects created at once under one name get an id each", async () => {
    const made = await Promise.all(Array.from({ length: 5 }, () => projects.create(space, { name: "Twin" })));
    assert.deepEqual(made.map((each) => each.project.id).sort(), ["twin", "twin-2", "twin-3", "twin-4", "twin-5"]);
    for (const { project } of made) assert.equal((await stored(project.id)).id, project.id);
  });

  test("a quota counts the damaged projects and holds when they are made at once", async () => {
    const limited: Space = { id: "limited", root: path.join(data.dir, "users", "limited"), limits: { projects: 3, shots: 100 } };
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => projects.create(limited, { name: `Quota ${i}` })));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
    assert.equal(await countProjects(limited), 3);
    // A damaged one still takes its place until it is deleted.
    await writeFile(projectFile(limited, "quota-0"), "");
    await assert.rejects(projects.create(limited, { name: "One More" }), /limited to 3 projects/);
    await projects.tombstone(limited, "quota-0");
    await projects.remove(limited, "quota-0");
    assert.equal((await projects.create(limited, { name: "One More" })).project.id, "one-more");
  });
});

describe("reading what is on disk", () => {
  test("a project written before revisions is read as revision 0 and kept as it was on the next write", async () => {
    const id = "older";
    await mkdir(projectDir(space, id), { recursive: true });
    const written = {
      id,
      name: "Older",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      locales: ["en", "EN", "de"],
      theme: { font: 42, accentColor: "#112233" },
      slides: [{ layout: "statement", headline: "Kept" }],
      fromLater: { kept: true },
    };
    await writeFile(projectFile(space, id), JSON.stringify(written));
    const read = await projects.get(space, id);
    assert.equal(read.revision, 0);
    assert.equal(read.project.schemaVersion, 1);
    assert.deepEqual(read.project.locales, ["en", "de"]);
    assert.equal(read.project.theme.accentColor, "#112233");
    assert.equal(read.project.theme.font, undefined);
    assert.match(read.warnings[0]!, /theme\.font/);
    assert.ok(logged.some((line) => line.includes("main/older") && line.includes("theme.font")));
    // Nothing is written by reading.
    assert.deepEqual(JSON.parse(await readFile(projectFile(space, id), "utf8")), written);

    await projects.mutate(space, id, (current) => ({ ...current, name: "Older Changed" }), { actor: "mcp" });
    const now = await stored(id);
    assert.equal(now.revision, 1);
    assert.equal(now.schemaVersion, 1);
    assert.deepEqual(now.fromLater, { kept: true });
    assert.deepEqual(await history(id), ["0-unknown.json", "1-mcp.json"]);
    assert.deepEqual(JSON.parse(await readFile(path.join(historyDir(space, id), "0-unknown.json"), "utf8")), written);
  });

  test("a damaged project.json is listed with what is wrong, refused without the parser's words, and can be deleted", async () => {
    const { project } = await projects.create(space, { name: "Damaged" });
    await writeFile(projectFile(space, project.id), '{"id": "damaged",');
    const entry = (await projects.list(space)).find((each) => "damaged" in each && each.id === project.id);
    assert.deepEqual(entry && "damaged" in entry ? entry.damaged : null, "project.json is not valid JSON");
    await assert.rejects(projects.get(space, project.id), (error: unknown) => error instanceof DamagedError && !/JSON|position/.test(error.message) && /damaged/.test(error.message));
    await assert.rejects(projects.mutate(space, project.id, (current) => current), DamagedError);
    await projects.tombstone(space, project.id);
    await projects.remove(space, project.id);
    await assert.rejects(stat(projectDir(space, project.id)));
    await assert.rejects(projects.remove(space, project.id), NotFoundError);
  });

  test("a folder without a project.json is listed, so it can be deleted", async () => {
    await mkdir(path.join(space.root, "projects", "ghost"), { recursive: true });
    const entry = (await projects.list(space)).find((each) => "damaged" in each && each.id === "ghost");
    assert.equal(entry && "damaged" in entry ? entry.damaged : null, "project.json is missing");
    await projects.tombstone(space, "ghost");
    await projects.remove(space, "ghost");
  });

  test("the sweep before start removes what cut-short writes left and names the damaged projects", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "appshots-test-sweep-"));
    try {
      const main: Space = { id: "main", root: dir };
      const user: Space = { id: "someone", root: path.join(dir, "users", "someone") };
      const sweep = createProjectRepository({ log: () => {} });
      const { project } = await sweep.create(main, { name: "Swept" });
      const other = await sweep.create(user, { name: "Theirs" });
      const leftovers = [
        path.join(projectDir(main, project.id), "project.json.0b6f6c1e-8a37-4c1a-9a51-2f0e5d9c1b11.tmp"),
        path.join(historyDir(main, project.id), "2-api.json.0b6f6c1e-8a37-4c1a-9a51-2f0e5d9c1b11.tmp"),
        path.join(projectDir(user, other.project.id), "project.json.12345.tmp"),
      ];
      const anHourAgo = new Date(Date.now() - 3_600_000);
      for (const file of leftovers) {
        await writeFile(file, "{");
        await utimes(file, anHourAgo, anHourAgo);
      }
      // Just written: another process on the same data may be about to rename it into place.
      const underWay = path.join(historyDir(main, project.id), "3-api.json.5d1c0a4e-2b7f-4e8a-9c3d-6f1e2a7b8c90.tmp");
      await writeFile(underWay, "{");
      await writeFile(projectFile(user, other.project.id), "");
      const lines: string[] = [];
      const result = await sweepProjects(dir, (line) => lines.push(line));
      assert.equal(result.removed, 3);
      assert.deepEqual(result.damaged, [path.join("users", "someone", "projects", "theirs")]);
      assert.deepEqual((await readdir(projectDir(main, project.id))).sort(), [".history", "project.json"]);
      assert.deepEqual((await readdir(historyDir(main, project.id))).sort(), ["1-api.json", path.basename(underWay)]);
      assert.ok(lines.some((line) => line.includes("is empty")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("history", () => {
  test("revisions are listed newest first, and a restore is a new revision", async () => {
    const { project } = await projects.create(space, { name: "Undo" }, { actor: "studio" });
    await projects.mutate(space, project.id, (current) => ({ ...current, name: "Undo Two" }), { actor: "mcp" });
    await projects.mutate(space, project.id, (current) => ({ ...current, name: "Undo Three" }));
    const listed = await projects.revisions(space, project.id);
    assert.equal(listed.revision, 3);
    assert.deepEqual(
      listed.revisions.map((row) => [row.revision, row.actor]),
      [
        [3, "api"],
        [2, "mcp"],
        [1, "studio"],
      ],
    );
    for (const row of listed.revisions) assert.ok(row.size > 0 && !Number.isNaN(Date.parse(row.time)));

    const restored = await projects.restore(space, project.id, 1, { actor: "studio" });
    assert.equal(restored.revision, 4);
    assert.equal(restored.project.name, "Undo");
    assert.equal(restored.project.createdAt, project.createdAt);
    assert.equal((await stored(project.id)).revision, 4);
    await assert.rejects(projects.restore(space, project.id, 9), (error: unknown) => error instanceof NotFoundError && /keeps no revision 9\. Its history holds revisions 1 to 4\./.test(error.message));
    await assert.rejects(projects.restore(space, project.id, 2, { ifRevision: 3 }), ConflictError);
  });

  test("a damaged project is restored from the newest version its history keeps", async () => {
    const { project } = await projects.create(space, { name: "Rescued" });
    await projects.mutate(space, project.id, (current) => ({ ...current, name: "Rescued Work" }));
    await writeFile(projectFile(space, project.id), "not json");
    assert.equal((await projects.revisions(space, project.id)).revision, null);
    const restored = await projects.restore(space, project.id, 2);
    assert.equal(restored.revision, 3);
    assert.equal((await projects.get(space, project.id)).project.name, "Rescued Work");
  });

  test("only the last versions are kept", async () => {
    const short = createProjectRepository({ keepHistory: 3, log: () => {} });
    const { project } = await short.create(space, { name: "Short" });
    for (let i = 0; i < 5; i++) await short.mutate(space, project.id, (current) => ({ ...current, name: `Short ${i}` }));
    assert.deepEqual(await history(project.id), ["4-api.json", "5-api.json", "6-api.json"]);
  });

  test("a project written by the release before revisions continues after the newest kept one", async () => {
    const { project } = await projects.create(space, { name: "Rolled" });
    await projects.mutate(space, project.id, (current) => ({ ...current, name: "Rolled Two" }));
    // As that release saves it: the fields it does not know are gone.
    const { revision: _revision, schemaVersion: _version, ...older } = await stored(project.id);
    await writeFile(projectFile(space, project.id), JSON.stringify({ ...older, name: "Rolled Back" }));
    const read = await projects.get(space, project.id);
    assert.equal(read.revision, 3);
    await projects.mutate(space, project.id, (current) => ({ ...current, name: "Rolled Forward" }));
    assert.deepEqual(await history(project.id), ["1-api.json", "2-api.json", "3-unknown.json", "4-api.json"]);
  });
});

// Rolling back to the release before this storage must find every project as it left it. That release's code is
// taken from its tag and run against the same data directory.
const TAG = "pre-overhaul-2026-10-14";
const root = path.resolve(import.meta.dirname, "..", "..");
const tagged = (() => {
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${TAG}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("rollback", { skip: tagged ? false : `the tag ${TAG} is not in this checkout` }, () => {
  test("the release before reads, lists and changes what this one wrote, and this one reads it back", async () => {
    const old = await mkdtemp(path.join(os.tmpdir(), "appshots-test-rollback-"));
    try {
      const archive = execFileSync("git", ["archive", "--format=tar", TAG, "src"], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
      execFileSync("tar", ["-x", "-C", old], { input: archive });
      await writeFile(path.join(old, "package.json"), JSON.stringify({ type: "module" }));
      await symlink(path.join(root, "node_modules"), path.join(old, "node_modules"), "dir");
      const before = await import(pathToFileURL(path.join(old, "src", "store.ts")).href);

      const { project } = await projects.create(space, {
        name: "Round Trip",
        locales: ["en", "de"],
        slides: [{ layout: "statement", headline: "One" }],
        deviceSlides: { ipad: [{ layout: "statement", headline: "iPad" }] },
      });
      await projects.mutate(space, project.id, (current) => ({ ...current, theme: { font: "inter" } }));

      const read = await before.getProject(space, project.id);
      assert.equal(read.name, "Round Trip");
      assert.equal(read.theme.font, "inter");
      assert.deepEqual(read.locales, ["en", "de"]);
      assert.ok((await before.listProjects(space)).some((each: { id: string }) => each.id === project.id));
      await before.updateProject(space, project.id, { name: "Changed Before" });

      const back = await projects.get(space, project.id);
      assert.equal(back.project.name, "Changed Before");
      assert.equal(back.project.theme.font, "inter");
      assert.equal(back.revision, 3);
      assert.deepEqual(back.warnings, []);
      await projects.mutate(space, project.id, (current) => ({ ...current, name: "Changed After" }));
      assert.equal((await before.getProject(space, project.id)).name, "Changed After");
      await before.deleteProject(space, project.id);
      await assert.rejects(projects.get(space, project.id), NotFoundError);
    } finally {
      await rm(old, { recursive: true, force: true });
    }
  });
});
