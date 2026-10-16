import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

const home = await cliHome("update");
after(() => home.remove());

const OLD = { skill: "---\nname: appshots\n---\nOld skill\n", cli: "#!/usr/bin/env node\n// old command\n" };
const NEW = { skill: "---\nname: appshots\n---\nNew skill\n", cli: "#!/usr/bin/env node\n// new command\n" };
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** What the stand-in server hands out: the files, and what /skill.json says about them. */
const served = {
  skill: NEW.skill,
  cli: NEW.cli,
  hashes: /** @type {unknown} */ ({ skill: hash(NEW.skill), cli: hash(NEW.cli) }),
  status: 200,
  /** @type {Record<string, string>} The skill's reference files. A server from before them lists none. */
  references: {},
};
const server = await stubServer(({ url }) => {
  if (url === "/skill.md") return [200, served.skill];
  if (url === "/cli/appshots.mjs") return [200, served.cli];
  if (url === "/skill.json") return [served.status, served.hashes];
  const reference = url.match(/^\/skill\/([a-z0-9-]+\.md)$/)?.[1];
  if (reference && Object.hasOwn(served.references, reference)) return [200, served.references[reference]];
  return [404, "not found"];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;

const { latest, latestReferences, skillStatus, staleNotice, update } = await import("../../cli/src/update.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
const { LATEST_FILE } = await import("../../cli/src/config.mjs");
const skill = path.join(home.home, ".claude", "skills", "appshots");

beforeEach(() => {
  rmSync(skill, { recursive: true, force: true });
  mkdirSync(skill, { recursive: true });
  writeFileSync(path.join(skill, "SKILL.md"), OLD.skill);
  writeFileSync(path.join(skill, "appshots.mjs"), OLD.cli, { mode: 0o755 });
  Object.assign(served, { skill: NEW.skill, cli: NEW.cli, hashes: { skill: hash(NEW.skill), cli: hash(NEW.cli) }, status: 200, references: {} });
});

const installed = (name) => readFileSync(path.join(skill, name), "utf8");

const REFERENCES = { "start.md": "# Steps 1 to 5 in full\n\nNew start\n", "web.md": "# Step 6 F: a web app\n\nNew web\n" };

/** A server that lists the skill's reference files in /skill.json beside the two hashes, and serves them. */
function withReferences(references = REFERENCES) {
  served.references = { ...references };
  served.hashes = { skill: hash(NEW.skill), cli: hash(NEW.cli), references: Object.fromEntries(Object.entries(references).map(([name, text]) => [name, hash(text)])) };
}

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

test("a server without reference files has none to fetch, and its skill is up to date without them", async () => {
  assert.deepEqual(await latestReferences(server.url), {});
  writeFileSync(path.join(skill, "SKILL.md"), NEW.skill);
  writeFileSync(path.join(skill, "appshots.mjs"), NEW.cli);
  assert.equal(await skillStatus(), "up to date");
  assert.equal(existsSync(path.join(skill, "references")), false);
});

test("latestReferences returns each reference file the server lists, checked against its hash", async () => {
  withReferences();
  assert.deepEqual(await latestReferences(server.url), REFERENCES);
  served.references["web.md"] = `${REFERENCES["web.md"]}Changed on the way\n`;
  await assert.rejects(latestReferences(server.url), /\/skill\/web\.md does not match its hash/);
});

test("a listed name that is not a reference file's is neither fetched nor written", async () => {
  withReferences();
  served.hashes.references["../SKILL.md"] = hash(NEW.skill);
  served.hashes.references["notes.txt"] = hash("x");
  assert.deepEqual(Object.keys(await latestReferences(server.url)), ["start.md", "web.md"]);
  served.hashes.references = ["start.md"];
  assert.deepEqual(await latestReferences(server.url), {});
});

test("update installs the reference files beside the skill, and the skill counts as behind without them", async () => {
  withReferences();
  writeFileSync(path.join(skill, "SKILL.md"), NEW.skill);
  writeFileSync(path.join(skill, "appshots.mjs"), NEW.cli);
  assert.match(await skillStatus(), /the server has a newer one/);
  assert.match(await quietly(() => update()), /^Updated the skill's reference files start\.md, web\.md in .*\. SKILL\.md has not changed/m);
  assert.deepEqual(readdirSync(path.join(skill, "references")).sort(), ["start.md", "web.md"]);
  assert.equal(installed("references/start.md"), REFERENCES["start.md"]);
  assert.equal(await skillStatus(), "up to date");
  assert.match(await quietly(() => update()), /are up to date\./);
});

test("update replaces a changed reference file and keeps one the server no longer lists", async () => {
  withReferences();
  mkdirSync(path.join(skill, "references"));
  writeFileSync(path.join(skill, "references", "start.md"), "# Old start\n");
  writeFileSync(path.join(skill, "references", "gone.md"), "# Gone\n");
  await quietly(() => update());
  assert.equal(installed("references/start.md"), REFERENCES["start.md"]);
  assert.equal(installed("references/gone.md"), "# Gone\n");
});

test("update says SKILL.md changed only when it did", async () => {
  withReferences();
  writeFileSync(path.join(skill, "SKILL.md"), NEW.skill);
  writeFileSync(path.join(skill, "appshots.mjs"), NEW.cli);
  await quietly(() => update());

  // One reference file changed: the agent need not read SKILL.md again.
  withReferences({ ...REFERENCES, "web.md": `${REFERENCES["web.md"]}A new line\n` });
  const reference = await quietly(() => update());
  assert.match(reference, /^Updated the skill's reference file web\.md in /m);
  assert.doesNotMatch(reference, /Read SKILL\.md again/);

  // The command alone.
  writeFileSync(path.join(skill, "appshots.mjs"), OLD.cli);
  const command = await quietly(() => update());
  assert.match(command, /^Updated the appshots command in .*\. SKILL\.md has not changed\.$/m);

  // SKILL.md with the rest says so, as it always did.
  writeFileSync(path.join(skill, "SKILL.md"), OLD.skill);
  writeFileSync(path.join(skill, "references", "start.md"), "# Old start\n");
  assert.match(await quietly(() => update()), /^Updated the appshots skill and command in .*\. Read SKILL\.md again from the top: it has changed\.$/m);
});

/** What staleNotice prints, asking the server each time rather than going by what it remembered. */
async function notice() {
  rmSync(LATEST_FILE, { force: true });
  const lines = [];
  const error = console.error;
  console.error = (...parts) => void lines.push(parts.join(" "));
  try {
    await staleNotice();
  } finally {
    console.error = error;
  }
  return lines.join("\n");
}

test("check and the notice say to read SKILL.md again only when it is behind", async () => {
  withReferences();
  writeFileSync(path.join(skill, "SKILL.md"), NEW.skill);
  writeFileSync(path.join(skill, "appshots.mjs"), NEW.cli);
  await quietly(() => update());
  assert.equal(await skillStatus(), "up to date");
  assert.equal(await notice(), "");

  // A reference file alone: update, and go on with the SKILL.md already read.
  withReferences({ ...REFERENCES, "web.md": `${REFERENCES["web.md"]}A new line\n` });
  const status = await skillStatus();
  assert.match(status, /^the server has a newer one, with the same SKILL\.md\. Run 'appshots update' and go on\. SKILL\.md need not be read again; update names the reference files that changed\.$/);
  assert.match(await notice(), /^appshots: the server has newer reference files for the skill, with the same SKILL\.md\. Run 'appshots update' and go on\./);
  rmSync(path.join(skill, "references", "start.md"));
  assert.doesNotMatch(await skillStatus(), /read SKILL\.md again/);
  await quietly(() => update());

  // The command alone.
  writeFileSync(path.join(skill, "appshots.mjs"), OLD.cli);
  assert.equal(await skillStatus(), "the server has a newer one, with the same SKILL.md. Run 'appshots update' and go on. SKILL.md need not be read again.");
  assert.match(await notice(), /^appshots: the server has a newer command, with the same SKILL\.md\./);

  // SKILL.md, with or without the rest, says what it always said.
  writeFileSync(path.join(skill, "SKILL.md"), OLD.skill);
  assert.equal(await skillStatus(), "the server has a newer one. Run 'appshots update', then read SKILL.md again from the top before going on.");
  assert.equal(await notice(), "appshots: the server has a newer skill and command. Run 'appshots update', then read SKILL.md again from the top.");
  writeFileSync(path.join(skill, "appshots.mjs"), NEW.cli);
  assert.match(await skillStatus(), /then read SKILL\.md again from the top/);
});

test("a server from before /skill.json is compared file by file, and SKILL.md is told apart", async () => {
  served.status = 404;
  served.hashes = { error: "not found" };
  writeFileSync(path.join(skill, "SKILL.md"), NEW.skill);
  assert.match(await skillStatus(), /with the same SKILL\.md/);
  writeFileSync(path.join(skill, "SKILL.md"), OLD.skill);
  writeFileSync(path.join(skill, "appshots.mjs"), NEW.cli);
  assert.match(await skillStatus(), /then read SKILL\.md again from the top/);
  writeFileSync(path.join(skill, "SKILL.md"), NEW.skill);
  assert.equal(await skillStatus(), "up to date");
});

test("update with a reference file that does not match its hash changes nothing", async () => {
  withReferences();
  served.references["start.md"] = "# Injected\n";
  await assert.rejects(quietly(() => update()), (error) => error instanceof Failure && /\/skill\/start\.md does not match its hash/.test(error.message));
  assert.equal(installed("SKILL.md"), OLD.skill);
  assert.equal(installed("appshots.mjs"), OLD.cli);
  assert.equal(existsSync(path.join(skill, "references")), false);
});

test("update refuses an error page in place of a reference file", async () => {
  withReferences({ "start.md": "<html>Bad gateway</html>" });
  await assert.rejects(quietly(() => update()), (error) => error instanceof Failure && /not what an appShots server sends/.test(error.message));
  assert.equal(installed("SKILL.md"), OLD.skill);
});
