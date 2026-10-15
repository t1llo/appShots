import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fail } from "./fail.mjs";

export const CONFIG_FILE = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "appshots", "config.json");
// What the server last said its skill and command are, so that asking again can wait.
export const LATEST_FILE = path.join(path.dirname(CONFIG_FILE), "latest.json");
// Where agents look for the skill. Claude Code has a folder of its own; Codex, OpenCode, Pi and most others
// read the shared Agent Skills folder. The CLI goes next to the skill, so the skill finds it without a PATH.
export const CLAUDE_SKILL = path.join(homedir(), ".claude", "skills", "appshots");
export const SHARED_SKILL = path.join(homedir(), ".agents", "skills", "appshots");
export const AGENTS = {
  claude: { name: "Claude Code", dir: CLAUDE_SKILL, start: "type /appshots" },
  codex: { name: "Codex", dir: SHARED_SKILL, start: "type $appshots" },
  opencode: { name: "OpenCode", dir: SHARED_SKILL, start: "ask it for your App Store screenshots" },
  pi: { name: "Pi", dir: SHARED_SKILL, start: "type /skill:appshots" },
  other: { name: "your agent", dir: SHARED_SKILL, start: "tell it: Read ~/.agents/skills/appshots/SKILL.md and follow it" },
};
// Build logs go here, and with --fresh the builds themselves, one folder per project.
export const BUILD_CACHE = path.join(homedir(), "Library", "Caches", "appshots", "build");

/**
 * @typedef {{ url: string, token: string }} Config
 */

/**
 * The saved server and token with the environment on top; the URL is empty when setup has not been run.
 * @returns {Config}
 */
export function readConfig() {
  let saved = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      saved = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    } catch {
      fail(`${CONFIG_FILE} is not valid JSON. Run 'appshots login <url>' again.`);
    }
  }
  const url = (process.env.APPSHOTS_URL ?? saved.url ?? "").replace(/\/+$/, "");
  const token = process.env.APPSHOTS_TOKEN ?? saved.token ?? "";
  return { url, token };
}

/** @returns {Config} */
export function loadConfig() {
  const config = readConfig();
  if (!config.url) fail("No server configured. Run the setup command from Connect in the Studio, or 'appshots login <url>'.");
  return config;
}

/** @param {Config} config */
export function saveConfig(config) {
  mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

/** @param {string} file */
export const tilde = (file) => (file.startsWith(homedir() + path.sep) ? `~${file.slice(homedir().length)}` : file);

/** Whether anything is there, a link that points nowhere included. */
export function exists(file) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}
