import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "./api.mjs";
import { AGENTS, CLAUDE_SKILL, CONFIG_FILE, SHARED_SKILL, exists, saveConfig, tilde } from "./config.mjs";
import { fail } from "./fail.mjs";
import { run } from "./proc.mjs";
import { promptHidden } from "./prompt.mjs";
import { latest, plainHttp, writeAtomic } from "./update.mjs";

/** The file of this command as it is installed: the built one, also when this runs from the sources in cli/src. */
function selfFile() {
  const here = fileURLToPath(import.meta.url);
  return realpathSync(path.basename(path.dirname(here)) === "src" ? path.join(here, "..", "..", "appshots.mjs") : here);
}

/**
 * Whether the server asks for a token at all. One that cannot be asked is taken to.
 * @param {string} server
 */
async function asksForToken(server) {
  const settings = await fetch(`${server}/auth/config`, { signal: AbortSignal.timeout(15000) })
    .then((response) => response.json())
    .catch(() => ({}));
  return settings.signIn !== false;
}

/**
 * @param {string | undefined} url
 * @param {Record<string, string | true>} flags
 */
export async function login(url, flags) {
  if (!url) fail("Usage: appshots login <url> [--token <token>]");
  if (!/^https?:\/\//.test(url)) fail("The URL must start with http:// or https://");
  const server = url.replace(/\/+$/, "");
  const warning = plainHttp(server);
  if (warning) console.error(`appshots: ${warning}`);
  let token = typeof flags.token === "string" ? flags.token : process.env.APPSHOTS_TOKEN;
  token ??= (await asksForToken(server)) ? await promptHidden("Token (from Connect in the Studio; leave empty if the server has no sign-in): ") : "";
  const config = { url: server, token };
  await request(config, "GET", "/api/projects");
  saveConfig(config);
  console.log(`Logged in to ${config.url}. Saved to ${CONFIG_FILE}`);
}

/**
 * Makes `appshots` a command, if there is an obvious place of the user's own that is already on the PATH:
 * ~/.local/bin, ~/bin, or wherever Claude Code itself sits. Returns the command's path, or null.
 * @param {string} target
 */
function linkOntoPath(target) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const theirs = dirs.map((dir) => path.join(dir, "appshots")).find(existsSync);
  // Already a command: ours from an earlier setup, or their own, such as `npm link` in a checkout.
  if (theirs) return theirs;
  const claude = dirs.map((dir) => path.join(dir, "claude")).find(existsSync);
  for (const dir of [path.join(homedir(), ".local", "bin"), path.join(homedir(), "bin"), ...(claude ? [path.dirname(claude)] : [])]) {
    if (!dirs.includes(dir)) continue;
    const link = path.join(dir, "appshots");
    try {
      // What is left here can only be a link that points nowhere any more.
      if (exists(link)) rmSync(link);
      symlinkSync(target, link);
      return link;
    } catch {}
  }
  return null;
}

/**
 * Runs an agent's own command, so that agent's config file is written the way it wants it.
 * @param {string} bin
 * @param {string[]} args
 */
async function agentRun(bin, args) {
  const result = await run(bin, args, { timeout: 60000 });
  const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() || result.error?.message || (result.timedOut ? `${bin} ${args[0]} did not finish within a minute` : `${bin} ${args[0]} failed`);
  return { ok: result.status === 0, detail };
}

/** Each returns { ok, detail } for the agent's MCP connection, saved for every folder. */
const CONNECT = {
  async claude(server, token) {
    // An entry left in this folder would win over the one for every folder, so both go first.
    for (const scope of ["local", "user"]) await agentRun("claude", ["mcp", "remove", "appshots", "--scope", scope]);
    return agentRun("claude", ["mcp", "add", "--transport", "http", "--scope", "user", "appshots", `${server}/mcp`, ...(token ? ["--header", `Authorization: Bearer ${token}`] : [])]);
  },
  async codex(server, token) {
    // Adding replaces an older entry of the same name.
    const added = await agentRun("codex", ["mcp", "add", "appshots", "--url", `${server}/mcp`]);
    if (!added.ok || !token) return added;
    // `codex mcp add` takes no header, so the token goes into the table it has just written.
    const file = path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "config.toml");
    const header = `http_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }`;
    const table = /^\[mcp_servers\.appshots\][ \t]*$/m;
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (!table.test(text)) return { ok: false, detail: `the token could not be added. Put this line under [mcp_servers.appshots] in ${tilde(file)}:\n      http_headers = { Authorization = "Bearer <your token>" }` };
    writeFileSync(file, text.replace(table, (line) => `${line}\n${header}`));
    return added;
  },
  opencode(server, token) {
    return agentRun("opencode", ["mcp", "add", "--global", "--url", `${server}/mcp`, ...(token ? ["--header", `Authorization=Bearer ${token}`] : []), "appshots"]);
  },
};

/**
 * @param {string | undefined} url
 * @param {Record<string, string | true>} flags
 */
export async function setup(url, flags) {
  if (!url || !/^https?:\/\//.test(url)) fail("Usage: appshots setup <url> [--agent claude|codex|opencode|pi|other] [--token <token>]");
  const id = typeof flags.agent === "string" ? flags.agent.toLowerCase() : "claude";
  const agent = AGENTS[id];
  if (!agent) fail(`Unknown agent "${flags.agent}". Use one of: ${Object.keys(AGENTS).join(", ")}.`);
  const server = url.replace(/\/+$/, "");
  const done = (text) => console.log(`  ✓ ${text}`);
  const open = (text) => console.log(`  ! ${text}`);
  console.log(`Setting up appShots for ${server}${id === "other" ? "" : ` and ${agent.name}`}`);
  const warning = plainHttp(server);
  if (warning) open(warning);

  // 1. The token, checked against the server before anything is written.
  let token = typeof flags.token === "string" ? flags.token : (process.env.APPSHOTS_TOKEN ?? "");
  if (/[<>]/.test(token)) fail("That is the placeholder, not a token. Open Connect in the Studio, create a token, and copy the command it shows then.");
  let check;
  try {
    if (!token && (await asksForToken(server))) token = await promptHidden("Token (from Connect in the Studio): ");
    check = await fetch(`${server}/api/projects`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    if (!(error instanceof TypeError || error?.name === "TimeoutError")) throw error;
    fail(`Cannot reach ${server}: ${error.cause?.message ?? error.message}`);
  }
  if (check.status === 401) fail(`${server} did not accept that token. Create a new one under Connect in the Studio and use the command it shows.`);
  if (!check.ok) fail(`${server} answered ${check.status}. Is that the address of an appShots server?`);
  saveConfig({ url: server, token });
  done(`Signed in to ${server}`);

  // 2. This file next to the skill, and on the PATH where that is easy. A copy set up for another agent
  // earlier is brought up to date as well, so the two never drift apart.
  const dirs = [agent.dir, ...[CLAUDE_SKILL, SHARED_SKILL].filter((dir) => dir !== agent.dir && existsSync(path.join(dir, "SKILL.md")))];
  const self = selfFile();
  for (const dir of dirs) {
    const copy = path.join(dir, "appshots.mjs");
    mkdirSync(dir, { recursive: true });
    if (!existsSync(copy) || realpathSync(copy) !== self) copyFileSync(self, copy);
    chmodSync(copy, 0o755);
  }
  const cli = path.join(agent.dir, "appshots.mjs");
  const command = linkOntoPath(cli);
  done(command ? `Command installed: appshots (${tilde(command)})` : `Command installed: node ${tilde(cli)}`);

  // 3. The skill, with this server's address in it, checked as 'appshots update' checks it.
  let skill = null;
  try {
    skill = (await latest(server))["SKILL.md"];
  } catch (error) {
    open(`This server has no appshots skill to install (${error.cause?.message ?? error.message}).`);
  }
  if (skill) {
    for (const dir of dirs) writeAtomic(path.join(dir, "SKILL.md"), skill);
    done(`Skill installed: ${tilde(agent.dir)}`);
  }

  // 4. The agent's connection to the server's MCP tools. Where there is none, the skill uses `appshots call`.
  let connected = true;
  if (CONNECT[id]) {
    // Each of these agents has a command named like its id.
    if ((await run(id, ["--version"], { stdio: "ignore" })).error) {
      connected = false;
      open(`${agent.name} was not found, so it is not connected yet. Install it and run this again.`);
    } else {
      const result = await CONNECT[id](server, token);
      connected = result.ok;
      if (connected) done(`${agent.name} connected to the server (MCP server "appshots")`);
      // Whatever the agent printed may repeat the command it was given.
      else open(`${agent.name} could not be connected: ${token ? result.detail.replaceAll(token, "<your token>") : result.detail}`);
    }
  } else if (id === "pi") {
    done("Pi has no MCP, so the skill reaches the server through the appshots command");
  }

  console.log("");
  if (connected && skill) console.log(`Ready. Open ${agent.name} in your app's folder, start a new session and ${agent.start}`);
  else console.log("Not finished: see the lines marked ! above.");
  if (id === "other") console.log(`If your agent speaks MCP, you can also add the server there: ${server}/mcp, an HTTP server${token ? ' with the header "Authorization: Bearer <your token>"' : ""}.`);
  if (!command) console.log(`To type 'appshots' yourself, add this to ~/.zshrc: alias appshots='node ${tilde(cli)}'`);
}
