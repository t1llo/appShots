import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

const home = await cliHome("update");
after(() => home.remove());

const OLD = { skill: "---\nname: appshots\n---\nOld skill\n", cli: "#!/usr/bin/env node\n// old command\n" };
const NEW = { skill: "---\nname: appshots\n---\nNew skill\n", cli: "#!/usr/bin/env node\n// new command\n" };
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** What the stand-in server hands out: the files, and what /skill.json says about them. */
const served = { skill: NEW.skill, cli: NEW.cli, hashes: /** @type {unknown} */ ({ skill: hash(NEW.skill), cli: hash(NEW.cli) }), status: 200 };
const server = await stubServer(({ url }) => {
  if (url === "/skill.md") return [200, served.skill];
  if (url === "/cli/appshots.mjs") return [200, served.cli];
  if (url === "/skill.json") return [served.status, served.hashes];
  return [404, "not found"];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;

const { latest, update } = await import("../../cli/src/update.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
const skill = path.join(home.home, ".claude", "skills", "appshots");

beforeEach(() => {
  mkdirSync(skill, { recursive: true });
  writeFileSync(path.join(skill, "SKILL.md"), OLD.skill);
  writeFileSync(path.join(skill, "appshots.mjs"), OLD.cli, { mode: 0o755 });
  Object.assign(served, { skill: NEW.skill, cli: NEW.cli, hashes: { skill: hash(NEW.skill), cli: hash(NEW.cli) }, status: 200 });
});

const installed = (name) => readFileSync(path.join(skill, name), "utf8");

test("latest returns the files when they match /skill.json", async () => {
  assert.deepEqual(await latest(server.url), { "SKILL.md": NEW.skill, "appshots.mjs": NEW.cli });
});

test("latest refuses a command that does not match its hash", async () => {
  served.cli = `${NEW.cli}// changed on the way\n`;
  await assert.rejects(latest(server.url), /\/cli\/appshots\.mjs does not match its hash/);
});

test("latest refuses an error page in place of the command", async () => {
  served.cli = "<html>Bad gateway</html>";
  await assert.rejects(latest(server.url), /not what an appShots server sends/);
});

test("a server from before /skill.json is taken at its word", async () => {
  served.status = 404;
  served.hashes = { error: "not found" };
  assert.equal((await latest(server.url))["appshots.mjs"], NEW.cli);
});

test("update replaces both files, keeps the old command beside the new one and leaves it executable", async () => {
  const printed = await quietly(() => update());
  assert.match(printed, /^Updated the appshots skill and command in /m);
  assert.equal(installed("SKILL.md"), NEW.skill);
  assert.equal(installed("appshots.mjs"), NEW.cli);
  assert.equal(installed("appshots.mjs.bak"), OLD.cli);
  assert.equal(statSync(path.join(skill, "appshots.mjs")).mode & 0o777, 0o755);
});

test("update with a hash that does not match changes nothing", async () => {
  served.skill = `${NEW.skill}Injected\n`;
  await assert.rejects(quietly(() => update()), (error) => error instanceof Failure && /does not match its hash/.test(error.message));
  assert.equal(installed("SKILL.md"), OLD.skill);
  assert.equal(installed("appshots.mjs"), OLD.cli);
});

test("update with nothing new says so", async () => {
  writeFileSync(path.join(skill, "SKILL.md"), NEW.skill);
  writeFileSync(path.join(skill, "appshots.mjs"), NEW.cli);
  assert.match(await quietly(() => update()), /are up to date\./);
});
