import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

// A server that wants a sign-in, and a run of the command with nobody at a terminal to type the token.
const home = await cliHome("setup");
after(() => home.remove());
const SKILL = "---\nname: appshots\n---\nRead references/start.md\n";
const CLI = "#!/usr/bin/env node\n// the command\n";
const START = "# Steps 1 to 5 in full\n";
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const server = await stubServer(({ url, headers }) => {
  if (url === "/auth/config") return [200, { signIn: true }];
  if (url === "/api/projects") return headers.authorization === "Bearer good-token" ? [200, { projects: [] }] : [401, { error: "Sign in first" }];
  if (url === "/skill.md") return [200, SKILL];
  if (url === "/cli/appshots.mjs") return [200, CLI];
  if (url === "/skill.json") return [200, { skill: hash(SKILL), cli: hash(CLI), references: { "start.md": hash(START) } }];
  if (url === "/skill/start.md") return [200, START];
  return [404, "not found"];
});
after(() => server.close());

const { login, setup } = await import("../../cli/src/setup.mjs");
const { CONFIG_FILE, SHARED_SKILL } = await import("../../cli/src/config.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");

test("without a terminal, setup says how to pass the token instead of waiting for one", { skip: process.stdin.isTTY && "stdin is a terminal" }, async () => {
  const started = Date.now();
  await assert.rejects(quietly(() => setup(server.url, { agent: "other" })), (error) => error instanceof Failure && /APPSHOTS_TOKEN=<token> or --token <token>/.test(error.message));
  assert.ok(Date.now() - started < 5000);
  assert.equal(existsSync(CONFIG_FILE), false);
});

test("a token that is refused is said so, and nothing is saved", async () => {
  await assert.rejects(quietly(() => login(server.url, { token: "old-token" })), Failure);
  assert.equal(existsSync(CONFIG_FILE), false);
});

test("login with --token saves the server and the token", async () => {
  await quietly(() => login(`${server.url}/`, { token: "good-token" }));
  assert.equal(existsSync(CONFIG_FILE), true);
});

test("setup installs the skill with its reference files beside it", async () => {
  // An empty PATH, so that setup links the command into nothing outside this test's home.
  const pathBefore = process.env.PATH;
  process.env.PATH = "";
  try {
    const printed = await quietly(() => setup(server.url, { agent: "other", token: "good-token" }));
    assert.match(printed, /Skill installed: /);
  } finally {
    process.env.PATH = pathBefore;
  }
  assert.equal(readFileSync(path.join(SHARED_SKILL, "SKILL.md"), "utf8"), SKILL);
  assert.equal(readFileSync(path.join(SHARED_SKILL, "references", "start.md"), "utf8"), START);
});
