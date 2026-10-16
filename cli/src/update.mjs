import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { attempt, fail } from "./fail.mjs";
import { CLAUDE_SKILL, LATEST_FILE, SHARED_SKILL, loadConfig, readConfig, tilde } from "./config.mjs";

/** The folders on this Mac that hold an installed copy of the skill. */
export const installedSkills = () => [CLAUDE_SKILL, SHARED_SKILL].filter((dir) => existsSync(path.join(dir, "SKILL.md")));

/** How the skill's reference files are named. Nothing else is ever written into their folder. */
const REFERENCE = /^[a-z0-9-]+\.md$/;

/**
 * Where a copy of the skill keeps its reference files: each step in full, which SKILL.md sends the agent to.
 * @param {string} dir
 */
export const referencesOf = (dir) => path.join(dir, "references");

/**
 * What /skill.json gives for a file: the start of its SHA-256.
 * @param {string} text
 */
export const stamp = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * The address of a server that is plain http and not on this Mac: what it hands out could be changed on the way.
 * @param {string} url
 * @returns {string | null} A warning, or null when there is nothing to warn about.
 */
export function plainHttp(url) {
  let address;
  try {
    address = new URL(url);
  } catch {
    return null;
  }
  if (address.protocol !== "http:" || /^(localhost|127(\.\d+){3}|\[::1\])$/.test(address.hostname) || address.hostname.endsWith(".localhost")) return null;
  return `${url} is plain http, so what it sends could be changed on the way. Use its https address if it has one.`;
}

/**
 * One of the public files a server hands out. A proxy's error page must not end up as the skill or as a command,
 * so it has to start the way the file does.
 * @param {string} server
 * @param {string} route
 * @param {string} start
 */
async function download(server, route, start) {
  const response = await fetch(`${server}${route}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${route} answered ${response.status}`);
  const text = await response.text();
  if (!text.startsWith(start)) throw new Error(`${route} is not what an appShots server sends`);
  return text;
}

/**
 * The hashes of the skill, the command and the skill's reference files the server hands out now. Null for a server
 * from before /skill.json, and no references for one from before they were split out of SKILL.md.
 * @param {string} server
 * @param {number} [ms]
 * @returns {Promise<{ skill: string, cli: string, references: Record<string, string> } | null>}
 */
export async function serverHashes(server, ms = 15000) {
  const response = await fetch(`${server}/skill.json`, { signal: AbortSignal.timeout(ms) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`/skill.json answered ${response.status}`);
  // An older server may answer with its web app for any address it does not know.
  const hashes = await response.json().catch(() => null);
  if (typeof hashes?.skill !== "string" || typeof hashes?.cli !== "string") return null;
  const listed = hashes.references !== null && typeof hashes.references === "object" && !Array.isArray(hashes.references) ? hashes.references : {};
  const references = Object.fromEntries(Object.entries(listed).filter(([name, hash]) => REFERENCE.test(name) && typeof hash === "string"));
  return { skill: hashes.skill, cli: hashes.cli, references };
}

/**
 * The skill and the CLI as the server hands them out now. Both are public files, so no token goes along. Each is
 * checked against the hash /skill.json gives for it, so that only what the server meant is ever installed.
 * @param {string} server
 */
export async function latest(server) {
  const [skill, cli, hashes] = await Promise.all([download(server, "/skill.md", "---"), download(server, "/cli/appshots.mjs", "#!/usr/bin/env node"), serverHashes(server)]);
  for (const [route, text, hash] of [["/skill.md", skill, hashes?.skill], ["/cli/appshots.mjs", cli, hashes?.cli]]) {
    // A deploy between the two requests is the likely cause, so asking again a moment later sorts it out.
    if (hash && stamp(text) !== hash) throw new Error(`${route} does not match its hash in /skill.json. Run it again in a minute`);
  }
  return { "SKILL.md": skill, "appshots.mjs": cli };
}

/**
 * The skill's reference files as the server hands them out now, by name, each checked against its hash in
 * /skill.json as `latest` checks the skill. None from a server that lists none.
 * @param {string} server
 * @returns {Promise<Record<string, string>>}
 */
export async function latestReferences(server) {
  const hashes = await serverHashes(server);
  const listed = Object.entries(hashes?.references ?? {});
  const texts = await Promise.all(listed.map(([name]) => download(server, `/skill/${name}`, "# ")));
  return Object.fromEntries(
    listed.map(([name, hash], index) => {
      if (stamp(texts[index]) !== hash) throw new Error(`/skill/${name} does not match its hash in /skill.json. Run it again in a minute`);
      return [name, texts[index]];
    }),
  );
}

/**
 * Writes the reference files into a copy of the skill. One the server no longer lists stays: SKILL.md names only
 * the ones it uses, so it does no harm, and it may be one the user keeps.
 * @param {string} dir
 * @param {Record<string, string>} references
 * @returns {string[]} The names of the files that changed.
 */
export function installReferences(dir, references) {
  const changed = [];
  for (const [name, text] of Object.entries(references)) {
    if (!REFERENCE.test(name)) continue;
    const file = path.join(referencesOf(dir), name);
    if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
    mkdirSync(referencesOf(dir), { recursive: true });
    writeAtomic(file, text);
    changed.push(name);
  }
  return changed;
}

/**
 * Whether a copy of the skill has every reference file the server lists, as the server has it.
 * @param {string} dir
 * @param {Record<string, string>} hashes
 */
const hasReferences = (dir, hashes) =>
  Object.entries(hashes).every(([name, hash]) => {
    if (!REFERENCE.test(name)) return true;
    const file = path.join(referencesOf(dir), name);
    return existsSync(file) && stamp(readFileSync(file, "utf8")) === hash;
  });

/**
 * Writes a file whole or not at all: a command that stops half way through leaves the old one in place.
 * @param {string} file
 * @param {string} text
 * @param {number} [mode]
 */
export function writeAtomic(file, text, mode) {
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, text, mode === undefined ? undefined : { mode });
    if (mode !== undefined) chmodSync(temporary, mode);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Which of the installed copies' files are behind the server's: SKILL.md, appshots.mjs, and "references" when a
 * reference file the server lists is missing or different in one of them.
 * @param {string[]} dirs
 * @param {{ skill: string, cli: string, references: Record<string, string> }} hashes
 * @returns {Set<string>}
 */
function behind(dirs, hashes) {
  const same = (name, hash) => dirs.every((dir) => existsSync(path.join(dir, name)) && stamp(readFileSync(path.join(dir, name), "utf8")) === hash);
  const parts = new Set();
  if (!same("SKILL.md", hashes.skill)) parts.add("SKILL.md");
  if (!same("appshots.mjs", hashes.cli)) parts.add("appshots.mjs");
  if (!dirs.every((dir) => hasReferences(dir, hashes.references))) parts.add("references");
  return parts;
}

/**
 * What to do about copies that are behind when SKILL.md is not among them. Reading it again would cost a small
 * agent its whole core for nothing; update names the reference files that changed, as it says when it is done.
 * @param {Set<string>} parts
 */
const goOn = (parts) => `Run 'appshots update' and go on. SKILL.md need not be read again${parts.has("references") ? "; update names the reference files that changed." : "."}`;

/** The Skill line of 'appshots check'. Nothing to say when there is no server to compare with. */
export async function skillStatus() {
  const { value: config } = await attempt(readConfig);
  if (!config?.url) return null;
  const dirs = installedSkills();
  if (dirs.length === 0) return "not installed on this Mac. The setup command from Connect in the Studio installs it.";
  // Two hashes say as much as the two files, and are quicker to fetch.
  const hashes = await serverHashes(config.url).catch(() => undefined);
  if (hashes === undefined) return null;
  let parts;
  if (hashes) {
    parts = behind(dirs, hashes);
  } else {
    const now = await latest(config.url).catch(() => null);
    if (!now) return null;
    const read = (dir, name) => (existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : null);
    parts = new Set(Object.keys(now).filter((name) => dirs.some((dir) => read(dir, name) !== now[name])));
  }
  if (parts.size === 0) return "up to date";
  // The skill acts on "the server has a newer one", so every line that wants an update starts with it.
  if (parts.has("SKILL.md")) return "the server has a newer one. Run 'appshots update', then read SKILL.md again from the top before going on.";
  return `the server has a newer one, with the same SKILL.md. ${goOn(parts)}`;
}

/**
 * Says so when the server has a newer skill or command than this Mac. It asks at most twice a day, for two
 * hashes instead of the files, and never gets in the way: a server that does not answer means no notice.
 */
export async function staleNotice() {
  const { value: config } = await attempt(readConfig);
  const dirs = installedSkills();
  if (!config?.url || dirs.length === 0) return;
  let known = {};
  try {
    known = JSON.parse(readFileSync(LATEST_FILE, "utf8"));
  } catch {}
  if (known.url !== config.url || !(Date.now() - known.at < 12 * 3600 * 1000)) {
    try {
      const now = await serverHashes(config.url, 3000);
      // A server from before this file existed has nothing to compare with.
      if (!now) return;
      known = { url: config.url, at: Date.now(), skill: now.skill, cli: now.cli, references: now.references };
      mkdirSync(path.dirname(LATEST_FILE), { recursive: true });
      writeFileSync(LATEST_FILE, `${JSON.stringify(known)}\n`);
    } catch {
      return;
    }
  }
  if (typeof known.skill !== "string" || typeof known.cli !== "string") return;
  // What an older copy of this command remembered has no references, and nothing to compare them with.
  const references = known.references !== null && typeof known.references === "object" ? known.references : {};
  const parts = behind(dirs, { skill: known.skill, cli: known.cli, references });
  if (parts.size === 0) return;
  if (parts.has("SKILL.md")) {
    console.error("appshots: the server has a newer skill and command. Run 'appshots update', then read SKILL.md again from the top.");
    return;
  }
  const what = [parts.has("appshots.mjs") ? "a newer command" : "", parts.has("references") ? "newer reference files for the skill" : ""].filter(Boolean).join(" and ");
  console.error(`appshots: the server has ${what}, with the same SKILL.md. ${goOn(parts)}`);
}

/**
 * Brings every installed copy of the skill, and the CLI next to it, up to date with the server's. A deploy
 * changes what the server hands out; this is how a Mac that was set up before gets it without a new token.
 */
export async function update() {
  const { url } = loadConfig();
  const dirs = installedSkills();
  if (dirs.length === 0) fail("The appshots skill is not installed on this Mac. Run the setup command from Connect in the Studio.");
  const warning = plainHttp(url);
  if (warning) console.error(`appshots: ${warning}`);
  let now;
  let references;
  try {
    // All of it is fetched and checked before anything is written, so a refused file changes nothing.
    [now, references] = await Promise.all([latest(url), latestReferences(url)]);
  } catch (error) {
    fail(`Cannot get the skill from ${url}: ${error.cause?.message ?? error.message}`);
  }
  /** @type {Set<string>} */
  const changed = new Set();
  /** @type {Set<string>} */
  const changedReferences = new Set();
  for (const dir of dirs) {
    for (const name of installReferences(dir, references)) changedReferences.add(name);
    for (const [name, text] of Object.entries(now)) {
      const file = path.join(dir, name);
      if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
      // The command that was there stays beside the new one, so it can be put back by hand.
      if (name === "appshots.mjs" && existsSync(file)) copyFileSync(file, `${file}.bak`);
      writeAtomic(file, text, name === "appshots.mjs" ? 0o755 : undefined);
      changed.add(name);
    }
    chmodSync(path.join(dir, "appshots.mjs"), 0o755);
  }
  // What was remembered about the server is older than what has just been fetched.
  rmSync(LATEST_FILE, { force: true });
  console.log(updated(dirs.map(tilde).join(" and "), changed, [...changedReferences].sort()));
}

/**
 * What update says it did. The agent reads SKILL.md again from the top only when that changed; a reference file
 * is read when a step names it, so a changed one needs reading again only if it was read before.
 * @param {string} where
 * @param {Set<string>} changed SKILL.md and appshots.mjs, the ones of them that changed.
 * @param {string[]} references The reference files that changed.
 */
function updated(where, changed, references) {
  if (changed.has("SKILL.md")) return `Updated the appshots skill and command in ${where}. Read SKILL.md again from the top: it has changed.`;
  if (!changed.size && !references.length) return `The appshots skill and command in ${where} are up to date.`;
  const one = references.length === 1;
  const files = one ? `the skill's reference file ${references[0]}` : `the skill's reference files ${references.join(", ")}`;
  const what = [changed.size ? "the appshots command" : "", references.length ? files : ""].filter(Boolean).join(" and ");
  const again = !references.length ? "." : one ? "; read that file again where a step names it." : "; read those files again where a step names them.";
  return `Updated ${what} in ${where}. SKILL.md has not changed${again}`;
}
