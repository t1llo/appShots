import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// Agent tools other than the one the skill was written with read its front matter too, and some of them hold it to
// the Agent Skills format strictly: a skill whose description is too long, or is not YAML, is cut or not loaded.

const root = path.resolve(import.meta.dirname, "..", "..");
const skill = await readFile(path.join(root, "skill", "SKILL.md"), "utf8");
const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
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
