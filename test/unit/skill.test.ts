import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// SKILL.md is what an agent reads first, on any model. It stays short enough for a small one, and each step's full
// text lives in a reference file it names. These check that the two never drift apart.

const root = path.resolve(import.meta.dirname, "..", "..");
const core = await readFile(path.join(root, "skill", "SKILL.md"), "utf8");
const dir = path.join(root, "skill", "references");
const names = (await readdir(dir)).sort();
const references = new Map(await Promise.all(names.map(async (name) => [name, await readFile(path.join(dir, name), "utf8")] as const)));

/** The `name.md` files a text sends the reader to. */
const named = (text: string) => [...new Set([...text.matchAll(/`([a-z0-9-]+\.md)`/g)].map((match) => match[1]!))].sort();

// Agent tools other than the one the skill was written with read its front matter too, and some of them hold it to
// the Agent Skills format strictly: a skill whose description is too long, or is not YAML, is cut or not loaded.
const front = /^---\n([\s\S]*?)\n---\n/.exec(core)?.[1] ?? "";
const field = (name: string) => new RegExp(`^${name}: (.*)$`, "m").exec(front)?.[1];

test("the skill's front matter keeps to the Agent Skills format", () => {
  assert.deepEqual(front.split("\n").map((line) => line.split(":")[0]), ["name", "description"]);
  assert.match(field("name") ?? "", /^[a-z0-9-]{1,64}$/);
  const description = field("description") ?? "";
  assert.ok(description.length > 0 && description.length <= 1024, `the description is ${description.length} characters`);
  // Unquoted, so a colon followed by a space or a hash after one would end the value for a strict YAML reader.
  assert.doesNotMatch(description, /: | #|^["'&*!|>%@`{[]/);
});

test("the skill's description names what it makes", () => {
  for (const word of ["App Store screenshots", "device mockups", "banner", "app preview video", "App Store Connect"]) assert.ok(field("description")?.includes(word), word);
});

test("SKILL.md stays within 12 KB, with its frontmatter in front", () => {
  assert.ok(Buffer.byteLength(core) <= 12_000, `SKILL.md is ${Buffer.byteLength(core)} bytes`);
  assert.match(core, /^---\nname: appshots\ndescription: .+\n---\n/);
});

test("every reference file is named in SKILL.md, and every file it names is there", () => {
  assert.ok(names.length >= 5, `found only ${names.join(", ")}`);
  assert.deepEqual(named(core), names);
});

test("each reference file has a name the server serves, starts with a heading, and names only files that exist", () => {
  for (const [name, text] of references) {
    assert.match(name, /^[a-z0-9-]+\.md$/);
    assert.ok(text.startsWith("# "), name);
    assert.deepEqual(
      named(text).filter((other) => !references.has(other) && other !== "SKILL.md"),
      [],
      name,
    );
  }
});

test("SKILL.md says how to get a reference file that is missing, and keeps the rules that hold on every step", () => {
  assert.ok(core.includes("appshots update"));
  assert.ok(core.includes("curl -fsS {{SERVER}}/skill/"));
  assert.ok(core.includes("check_project"));
  assert.ok(core.includes("`appshots video guide`"));
  assert.ok(core.includes("**The key file is not yours to read.**"));
});

test("no reference file says the skill makes no videos, now that it does", () => {
  for (const [name, text] of [["SKILL.md", core] as const, ...references]) assert.doesNotMatch(text, /does not make one|makes still images/, name);
});
