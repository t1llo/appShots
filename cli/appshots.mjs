#!/usr/bin/env node
// Mac-side companion to an appShots server: builds the app in the current folder and runs it in a
// simulator, captures screenshots from a simulator or a connected iPhone/iPad, uploads them, and pulls the
// rendered store screenshots back down. There are three ways to the screenshots: `appshots upload` takes
// the ones that exist already, `appshots shoot` captures while a person opens each screen, and
// `appshots run` and `appshots launch` start the app on a given screen and capture it in one go.
// `appshots check` reports what is there to work with, `appshots setup` installs the appshots skill for a
// coding agent and connects that agent to the server, `appshots update` brings that skill up to date, and
// `appshots call` reaches the server's tools for agents that have no MCP.
// No dependencies, so it runs straight from a checkout: `node cli/appshots.mjs` or `npm link`.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const CONFIG_FILE = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "appshots", "config.json");
// Where agents look for the skill. Claude Code has a folder of its own; Codex, OpenCode, Pi and most others
// read the shared Agent Skills folder. The CLI goes next to the skill, so the skill finds it without a PATH.
const CLAUDE_SKILL = path.join(homedir(), ".claude", "skills", "appshots");
const SHARED_SKILL = path.join(homedir(), ".agents", "skills", "appshots");
const AGENTS = {
  claude: { name: "Claude Code", dir: CLAUDE_SKILL, start: "type /appshots" },
  codex: { name: "Codex", dir: SHARED_SKILL, start: "type $appshots" },
  opencode: { name: "OpenCode", dir: SHARED_SKILL, start: "ask it for your App Store screenshots" },
  pi: { name: "Pi", dir: SHARED_SKILL, start: "type /skill:appshots" },
  other: { name: "your agent", dir: SHARED_SKILL, start: "tell it: Read ~/.agents/skills/appshots/SKILL.md and follow it" },
};
// Build logs go here, and with --fresh the builds themselves, one folder per project.
const BUILD_CACHE = path.join(homedir(), "Library", "Caches", "appshots", "build");
const BOOLEAN_FLAGS = new Set(["clean", "render", "help", "ipad", "dark", "light", "fresh", "image"]);

const HELP = `appshots: run an app in a simulator, capture its screens and sync them with an appShots server

  appshots setup <url> [--agent <agent>] Everything in one go: save the token, install the appshots skill
                                         and this CLI, connect the agent. Agents: claude (the default),
                                         codex, opencode, pi, other. --token <token> skips the question
  appshots login <url>                   Save the server URL and token only (asks for the token)
  appshots update                        Bring the installed skill and this CLI up to date with the
                                         server's. Needs no token and leaves the agent's connection alone
  appshots check                         Report what is there: the server, whether the skill is current,
                                         Xcode, the project in this folder, simulators, the apps installed
                                         on them, and devices. Each line says what to do next
  appshots projects                      List projects on the server
  appshots run [options] [-- <args>]     Build the app in this folder and launch it in a simulator
      --scheme <name>                      Scheme to build (only when the choice is not obvious)
      --project <path>                     Workspace or project to build (only when there are several)
      --fresh                              Build in a folder of its own instead of reusing Xcode's build
      --ipad                               On the 13-inch iPad Pro instead of the iPhone Pro Max
      --sim <name|udid>                    On this simulator instead; it is booted if need be
      --dark, --light                      Set the simulator's appearance before launching
      --lang <code>                        Launch in this language, such as de or pt-BR
      --capture <name>                     Then take the screenshot as well, as capture --clean does
      --to <project>                       Upload that screenshot to this project. It is --to here and
                                           on launch, because run's --project is the Xcode one
      --wait <seconds>                     Time the app gets to settle before --capture (default: 2)
      -- <launch arguments>                Handed to the app as they are, such as: -- -appshots stats
  appshots launch <bundle id> [options] [-- <launch arguments>]
                                         Start an installed app again without building, to switch screen
                                         or language. Options as for run: --sim, --dark, --light, --lang,
                                         --capture, --to, --wait. That makes one screen one command:
                                         appshots launch <bundle id> --capture stats --to <project> -- -appshots stats
  appshots simctl <arguments...>         Run xcrun simctl with the right Xcode: openurl, ui, privacy, push
  appshots devices                       List booted simulators and connected devices
  appshots capture [options]             Take a screenshot
      --name <name>                        Screenshot name slides refer to (default: timestamp)
      --sim [name|udid]                    From a booted simulator (the default source)
      --device [name|udid]                 From a connected, unlocked iPhone or iPad (Xcode 27+)
      --clean                              Simulator only: show 9:41, full battery and signal
      --project <id>                       Upload it to this project straight away (--to works too)
      --out <dir>                          Where to save the PNG (default: ./raw-shots)
  appshots shoot <project> <names...>    For a person at the Terminal: names each screen in turn, waits
                                         for Return while you open it, then captures and uploads it.
                                         Options as for capture: --sim, --device, --clean, --out
  appshots upload <project> <files or folders...>
                                         Upload screenshots that exist already. A folder stands for the
                                         PNG and JPEG files in it. The name is the file name, or --name
                                         for a single file
      --image                              They are not screenshots but a logo or other artwork for the
                                           slides: PNG, SVG, JPEG or WebP, transparency kept
  appshots pull <project> [--out <dir>]  Download the rendered screenshots and header and search
                                         results assets (--render renders first)
  appshots open [project]                Open the Studio in the browser
  appshots tools [tool]                  List the server's tools, or one tool's arguments
  appshots call <tool> [arguments]       Call one. Arguments are JSON: inline, @file.json, or - for stdin
                                         (--out <dir> is where returned pictures are saved)

Server and token come from APPSHOTS_URL / APPSHOTS_TOKEN, or from 'appshots setup' or 'appshots login'.
The token is a personal one from Connect in the Studio.`;

/** What fail() throws instead of exiting while attempt() is running. */
class Failure extends Error {}
let attempting = false;

function fail(message) {
  if (attempting) throw new Failure(message);
  console.error(`appshots: ${message}`);
  process.exit(1);
}

/** Runs work that may fail() and returns { value } or { problem }. For 'appshots check', which reports and goes on. */
function attempt(work) {
  attempting = true;
  try {
    return { value: work() };
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    return { problem: error.message };
  } finally {
    attempting = false;
  }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  // What follows a lone -- belongs to the app being launched and is handed on as it is.
  const end = argv.indexOf("--");
  const own = end === -1 ? argv : argv.slice(0, end);
  const passthrough = end === -1 ? [] : argv.slice(end + 1);
  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = own[i + 1];
    if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags, passthrough };
}

const slugify = (value) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "shot";

// ---------------------------------------------------------------- server

/** The saved server and token with the environment on top; the URL is empty when setup has not been run. */
function readConfig() {
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

function loadConfig() {
  const config = readConfig();
  if (!config.url) fail("No server configured. Run the setup command from Connect in the Studio, or 'appshots login <url>'.");
  return config;
}

/** The Server line of 'appshots check': asks the server whether it takes the token, without failing. */
async function serverStatus() {
  const { value: config, problem } = attempt(readConfig);
  if (problem) return problem;
  if (!config.url) return "not set up. Run the setup command from Connect in the Studio.";
  let response;
  try {
    response = await fetch(`${config.url}/api/projects`, {
      headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    return `${config.url} cannot be reached (${error.cause?.message || error.cause?.code || error.message}). Is the server running, and is that its address?`;
  }
  if (response.status === 401) return `${config.url} ${config.token ? "did not accept the saved token" : "asks for a token"}. Create one under Connect in the Studio and run the setup command it shows.`;
  if (!response.ok) return `${config.url} answered ${response.status}. Is that the address of an appShots server?`;
  return `${config.url}, ${config.token ? "signed in" : "no sign-in needed"}`;
}

async function request(config, method, route, { body, headers } = {}) {
  let response;
  try {
    response = await fetch(config.url + route, {
      method,
      body,
      headers: { ...(config.token ? { authorization: `Bearer ${config.token}` } : {}), ...headers },
    });
  } catch (error) {
    fail(`Cannot reach ${config.url}: ${error.cause?.message ?? error.message}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    let message = detail;
    try {
      message = JSON.parse(detail).error ?? detail;
    } catch {}
    fail(`${method} ${route} failed (${response.status}): ${message}`);
  }
  return response;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    // Swallow the echo so the token does not end up in the terminal scrollback.
    rl._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function login(url) {
  if (!url) fail("Usage: appshots login <url>");
  if (!/^https?:\/\//.test(url)) fail("The URL must start with http:// or https://");
  const config = { url: url.replace(/\/+$/, ""), token: process.env.APPSHOTS_TOKEN ?? (await promptHidden("Token (from Connect in the Studio; leave empty if the server has no sign-in): ")) };
  await request(config, "GET", "/api/projects");
  saveConfig(config);
  console.log(`Logged in to ${config.url}. Saved to ${CONFIG_FILE}`);
}

function saveConfig(config) {
  mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

// ---------------------------------------------------------------- setup

const tilde = (file) => (file.startsWith(homedir() + path.sep) ? `~${file.slice(homedir().length)}` : file);

function exists(file) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes `appshots` a command, if there is an obvious place of the user's own that is already on the PATH:
 * ~/.local/bin, ~/bin, or wherever Claude Code itself sits. Returns the command's path, or null.
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

/** Runs an agent's own command, so that agent's config file is written the way it wants it. */
function agentRun(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  return { ok: result.status === 0, detail: `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() || result.error?.message || `${bin} ${args[0]} failed` };
}

// Each returns { ok, detail } for the agent's MCP connection, saved for every folder.
const CONNECT = {
  claude(server, token) {
    // An entry left in this folder would win over the one for every folder, so both go first.
    for (const scope of ["local", "user"]) agentRun("claude", ["mcp", "remove", "appshots", "--scope", scope]);
    return agentRun("claude", ["mcp", "add", "--transport", "http", "--scope", "user", "appshots", `${server}/mcp`, ...(token ? ["--header", `Authorization: Bearer ${token}`] : [])]);
  },
  codex(server, token) {
    // Adding replaces an older entry of the same name.
    const added = agentRun("codex", ["mcp", "add", "appshots", "--url", `${server}/mcp`]);
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

/** The folders on this Mac that hold an installed copy of the skill. */
const installedSkills = () => [CLAUDE_SKILL, SHARED_SKILL].filter((dir) => existsSync(path.join(dir, "SKILL.md")));

/** The skill and the CLI as the server hands them out now. Both are public files, so no token goes along. */
async function latest(server) {
  const get = async (route, start) => {
    const response = await fetch(`${server}${route}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${route} answered ${response.status}`);
    const text = await response.text();
    // A proxy's error page must not end up as the skill or as a command.
    if (!text.startsWith(start)) throw new Error(`${route} is not what an appShots server sends`);
    return text;
  };
  return { "SKILL.md": await get("/skill.md", "---"), "appshots.mjs": await get("/cli/appshots.mjs", "#!/usr/bin/env node") };
}

/** The Skill line of 'appshots check'. Nothing to say when there is no server to compare with. */
async function skillStatus() {
  const { value: config } = attempt(readConfig);
  if (!config?.url) return null;
  const dirs = installedSkills();
  if (dirs.length === 0) return "not installed on this Mac. The setup command from Connect in the Studio installs it.";
  const now = await latest(config.url).catch(() => null);
  if (!now) return null;
  const current = dirs.every((dir) => Object.entries(now).every(([name, text]) => existsSync(path.join(dir, name)) && readFileSync(path.join(dir, name), "utf8") === text));
  return current ? "up to date" : "the server has a newer one. Run 'appshots update', then read SKILL.md again from the top before going on.";
}

/**
 * Brings every installed copy of the skill, and the CLI next to it, up to date with the server's. A deploy
 * changes what the server hands out; this is how a Mac that was set up before gets it without a new token.
 */
async function update() {
  const { url } = loadConfig();
  const dirs = installedSkills();
  if (dirs.length === 0) fail("The appshots skill is not installed on this Mac. Run the setup command from Connect in the Studio.");
  let now;
  try {
    now = await latest(url);
  } catch (error) {
    fail(`Cannot get the skill from ${url}: ${error.cause?.message ?? error.message}`);
  }
  let changed = 0;
  for (const dir of dirs) {
    for (const [name, text] of Object.entries(now)) {
      const file = path.join(dir, name);
      if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
      writeFileSync(file, text);
      changed++;
    }
    chmodSync(path.join(dir, "appshots.mjs"), 0o755);
  }
  const where = dirs.map(tilde).join(" and ");
  console.log(changed ? `Updated the appshots skill and command in ${where}. Read SKILL.md again from the top: it has changed.` : `The appshots skill and command in ${where} are up to date.`);
}

async function setup(url, flags) {
  if (!url || !/^https?:\/\//.test(url)) fail("Usage: appshots setup <url> [--agent claude|codex|opencode|pi|other] [--token <token>]");
  const id = typeof flags.agent === "string" ? flags.agent.toLowerCase() : "claude";
  const agent = AGENTS[id];
  if (!agent) fail(`Unknown agent "${flags.agent}". Use one of: ${Object.keys(AGENTS).join(", ")}.`);
  const server = url.replace(/\/+$/, "");
  const done = (text) => console.log(`  ✓ ${text}`);
  const open = (text) => console.log(`  ! ${text}`);
  console.log(`Setting up appShots for ${server}${id === "other" ? "" : ` and ${agent.name}`}`);

  // 1. The token, checked against the server before anything is written.
  let token = typeof flags.token === "string" ? flags.token : (process.env.APPSHOTS_TOKEN ?? "");
  if (/[<>]/.test(token)) fail("That is the placeholder, not a token. Open Connect in the Studio, create a token, and copy the command it shows then.");
  let check;
  try {
    const signIn = (await (await fetch(`${server}/auth/config`)).json().catch(() => ({}))).signIn !== false;
    if (!token && signIn) token = await promptHidden("Token (from Connect in the Studio): ");
    check = await fetch(`${server}/api/projects`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  } catch (error) {
    fail(`Cannot reach ${server}: ${error.cause?.message ?? error.message}`);
  }
  if (check.status === 401) fail(`${server} did not accept that token. Create a new one under Connect in the Studio and use the command it shows.`);
  if (!check.ok) fail(`${server} answered ${check.status}. Is that the address of an appShots server?`);
  saveConfig({ url: server, token });
  done(`Signed in to ${server}`);

  // 2. This file next to the skill, and on the PATH where that is easy. A copy set up for another agent
  // earlier is brought up to date as well, so the two never drift apart.
  const dirs = [agent.dir, ...[CLAUDE_SKILL, SHARED_SKILL].filter((dir) => dir !== agent.dir && existsSync(path.join(dir, "SKILL.md")))];
  const self = realpathSync(fileURLToPath(import.meta.url));
  for (const dir of dirs) {
    const copy = path.join(dir, "appshots.mjs");
    mkdirSync(dir, { recursive: true });
    if (!existsSync(copy) || realpathSync(copy) !== self) copyFileSync(self, copy);
    chmodSync(copy, 0o755);
  }
  const cli = path.join(agent.dir, "appshots.mjs");
  const command = linkOntoPath(cli);
  done(command ? `Command installed: appshots (${tilde(command)})` : `Command installed: node ${tilde(cli)}`);

  // 3. The skill, with this server's address in it.
  const skill = await fetch(`${server}/skill.md`).catch(() => null);
  if (skill?.ok) {
    const text = await skill.text();
    for (const dir of dirs) writeFileSync(path.join(dir, "SKILL.md"), text);
    done(`Skill installed: ${tilde(agent.dir)}`);
  } else {
    open("This server has no appshots skill to install.");
  }

  // 4. The agent's connection to the server's MCP tools. Where there is none, the skill uses `appshots call`.
  let connected = true;
  if (CONNECT[id]) {
    // Each of these agents has a command named like its id.
    if (spawnSync(id, ["--version"], { stdio: "ignore" }).error) {
      connected = false;
      open(`${agent.name} was not found, so it is not connected yet. Install it and run this again.`);
    } else {
      const result = CONNECT[id](server, token);
      connected = result.ok;
      if (connected) done(`${agent.name} connected to the server (MCP server "appshots")`);
      // Whatever the agent printed may repeat the command it was given.
      else open(`${agent.name} could not be connected: ${token ? result.detail.replaceAll(token, "<your token>") : result.detail}`);
    }
  } else if (id === "pi") {
    done("Pi has no MCP, so the skill reaches the server through the appshots command");
  }

  console.log("");
  if (connected && skill?.ok) console.log(`Ready. Open ${agent.name} in your app's folder, start a new session and ${agent.start}`);
  else console.log("Not finished: see the lines marked ! above.");
  if (id === "other") console.log(`If your agent speaks MCP, you can also add the server there: ${server}/mcp, an HTTP server${token ? ' with the header "Authorization: Bearer <your token>"' : ""}.`);
  if (!command) console.log(`To type 'appshots' yourself, add this to ~/.zshrc: alias appshots='node ${tilde(cli)}'`);
}

// ---------------------------------------------------------------- Xcode

/** Picks full Xcode when xcode-select points at the Command Line Tools, which lack simctl and devicectl. */
function xcodeEnv() {
  if (process.env.DEVELOPER_DIR) return process.env;
  let selected = "";
  try {
    selected = execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim();
  } catch {}
  const bundled = "/Applications/Xcode.app/Contents/Developer";
  if (!selected.includes(".app/") && existsSync(bundled)) return { ...process.env, DEVELOPER_DIR: bundled };
  return process.env;
}

function xcrun(args, options) {
  if (process.platform !== "darwin") fail("This needs a Mac with Xcode. Use 'appshots upload' for existing screenshots.");
  const result = spawnSync("xcrun", args, { encoding: "utf8", env: xcodeEnv(), ...options });
  if (result.error) fail(`Could not run xcrun: ${result.error.message}`);
  return result;
}

function xcodebuild(args, options) {
  if (process.platform !== "darwin") fail("Building an app needs a Mac with Xcode.");
  // The build settings of a large workspace run to many megabytes.
  const result = spawnSync("xcodebuild", args, { encoding: "utf8", env: xcodeEnv(), maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) fail(`Could not run xcodebuild: ${result.error.message}`);
  return result;
}

function bootedSimulators() {
  const result = xcrun(["simctl", "list", "devices", "booted", "--json"]);
  if (result.status !== 0) fail(`simctl failed. Is Xcode installed?\n${result.stderr.trim()}`);
  return Object.values(JSON.parse(result.stdout).devices)
    .flat()
    .filter((device) => device.state === "Booted")
    .map((device) => ({ name: device.name, udid: device.udid }));
}

function connectedDevices() {
  const dir = mkdtempSync(path.join(tmpdir(), "appshots-"));
  const file = path.join(dir, "devices.json");
  try {
    const result = xcrun(["devicectl", "list", "devices", "--json-output", file]);
    if (result.status !== 0) fail(`devicectl failed. Physical devices need Xcode 15 or newer.\n${result.stderr.trim()}`);
    return JSON.parse(readFileSync(file, "utf8"))
      .result.devices.filter((device) => device.hardwareProperties?.reality !== "simulated")
      .filter((device) => device.connectionProperties?.tunnelState !== "unavailable")
      .map((device) => ({
        name: device.deviceProperties?.name ?? "Unnamed device",
        udid: device.hardwareProperties?.udid ?? device.identifier,
        model: device.hardwareProperties?.marketingName ?? device.hardwareProperties?.productType ?? "",
        transport: device.connectionProperties?.transportType ?? "",
      }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function choose(candidates, query, kind, flag) {
  const describe = (list) => list.map((item) => `  ${item.name}  (${item.udid})`).join("\n");
  if (typeof query === "string") {
    const needle = query.toLowerCase();
    // An exact name wins, so "iPhone 17" still works while "iPhone 17 Pro" is booted too.
    const exact = candidates.filter((item) => item.udid.toLowerCase() === needle || item.name.toLowerCase() === needle);
    if (exact.length === 1) return exact[0];
    const matches = candidates.filter((item) => item.name.toLowerCase().includes(needle));
    if (matches.length === 1) return matches[0];
    fail(matches.length === 0 ? `No ${kind} matches "${query}". Available:\n${describe(candidates) || "  (none)"}` : `"${query}" matches several:\n${describe(matches)}`);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) fail(kind === "simulator" ? "No simulator is booted. Start your app in one with 'appshots run' first, or capture from a device with --device." : "No iPhone or iPad is connected. Plug it in, unlock it and trust this Mac.");
  fail(`Several ${kind}s are available; pick one with ${flag} <name>:\n${describe(candidates)}`);
}

function capture(flags) {
  const name = typeof flags.name === "string" ? slugify(flags.name) : `shot-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : "raw-shots");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}.png`);

  if (flags.device) {
    const device = choose(connectedDevices(), flags.device, "device", "--device");
    const result = xcrun(["devicectl", "device", "capture", "screenshot", "--device", device.udid, "--destination", file]);
    if (result.status !== 0) {
      const output = `${result.stderr}${result.stdout}`.trim();
      const hint = /capture|Unknown|unexpected/i.test(output) && !/locked/i.test(output) ? "\nCapturing from a physical device needs Xcode 27 or newer, and the device unlocked." : "";
      fail(`Could not capture ${device.name}:\n${output}${hint}`);
    }
    console.log(`Captured ${device.name} -> ${file}`);
  } else {
    const simulator = choose(bootedSimulators(), flags.sim, "simulator", "--sim");
    if (flags.clean) {
      xcrun(["simctl", "status_bar", simulator.udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--wifiBars", "3", "--cellularBars", "4"]);
      // Give SpringBoard a moment to redraw before the frame is grabbed.
      spawnSync("sleep", ["0.7"]);
    }
    const result = xcrun(["simctl", "io", simulator.udid, "screenshot", file]);
    if (flags.clean) xcrun(["simctl", "status_bar", simulator.udid, "clear"]);
    if (result.status !== 0) fail(`Could not capture ${simulator.name}:\n${result.stderr.trim()}`);
    console.log(`Captured ${simulator.name} -> ${file}`);
  }
  return { name, file };
}

// ---------------------------------------------------------------- build and run

/** Every iPhone and iPad simulator that can be booted, with the model it stands for and its iOS version. */
function availableSimulators() {
  const result = xcrun(["simctl", "list", "--json"]);
  if (result.status !== 0) fail(`simctl failed. Is Xcode installed?\n${result.stderr.trim()}`);
  const list = JSON.parse(result.stdout);
  const models = new Map(list.devicetypes.map((type) => [type.identifier, type]));
  return list.runtimes
    .filter((runtime) => runtime.isAvailable && runtime.name.startsWith("iOS"))
    .flatMap((runtime) =>
      (list.devices[runtime.identifier] ?? [])
        .filter((device) => device.isAvailable)
        .map((device) => {
          // The name is the user's to choose, so the model is read from the device type.
          const model = models.get(device.deviceTypeIdentifier);
          return { name: device.name, udid: device.udid, booted: device.state === "Booted", model: model?.name ?? device.name, family: model?.productFamily ?? "", os: runtime.version };
        }),
    );
}

/**
 * The simulator 'appshots run' uses when none is named: the Pro Max, which is the 6.9-inch size the store
 * asks for, or the 13-inch iPad Pro, on the newest iOS and of the newest model. Null when there is no
 * simulator of that family at all; `fallback` says that another model had to do.
 */
function recommendedSimulator(simulators, ipad) {
  const wanted = ipad ? [/^iPad Pro 13-inch/, /13-inch|12\.9-inch/, /^iPad Pro/] : [/Pro Max/, /Plus/];
  const rank = (sim) => {
    const at = wanted.findIndex((pattern) => pattern.test(sim.model));
    return at === -1 ? wanted.length : at;
  };
  // The 18 in "iPhone 18 Pro Max", the 5 in "iPad Pro 13-inch (M5)".
  const number = (sim) => Number(sim.model.replace(/[\d.]+-inch/, "").match(/\d+/)?.[0] ?? 0);
  const [best] = simulators
    .filter((sim) => sim.family === (ipad ? "iPad" : "iPhone"))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.os.localeCompare(a.os, undefined, { numeric: true }) ||
        number(b) - number(a) ||
        // One that still has its model's name before one somebody set up for a purpose of their own.
        (b.name === b.model) - (a.name === a.model) ||
        b.booted - a.booted ||
        a.name.localeCompare(b.name),
    );
  return best ? { ...best, fallback: rank(best) > 0 } : null;
}

const simulatorLabel = (sim) => `${sim.name}${sim.name === sim.model ? "" : `, an ${sim.model}`}, iOS ${sim.os}`;
const storeModel = (ipad) => (ipad ? "13-inch iPad Pro" : "iPhone Pro Max");

function runSimulator(flags) {
  const simulators = availableSimulators();
  if (typeof flags.sim === "string") return choose(simulators, flags.sim, "simulator", "--sim");
  const simulator = recommendedSimulator(simulators, Boolean(flags.ipad));
  if (!simulator) fail(`No ${flags.ipad ? "iPad" : "iPhone"} simulator is installed. Add an iOS simulator in Xcode under Settings > Components.`);
  return simulator;
}

function boot(simulator) {
  if (!simulator.booted) xcrun(["simctl", "boot", simulator.udid]);
  // Waits until it is ready, also when someone else has only just started it.
  const result = xcrun(["simctl", "bootstatus", simulator.udid, "-b"]);
  if (result.status !== 0) fail(`Could not boot ${simulator.name}:\n${`${result.stderr}${result.stdout}`.trim()}`);
  // The window is there for the user to watch; everything works without it.
  if (process.env.APPSHOTS_NO_WINDOW !== "1") spawnSync("open", ["-a", "Simulator"]);
}

/**
 * Xcode workspaces or projects in the first of these folders that has any. A workspace goes before a
 * project: it wraps the project together with what it depends on, such as CocoaPods.
 */
function xcodeProjects(dirs) {
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(dir).sort();
    } catch {}
    for (const extension of [".xcworkspace", ".xcodeproj"]) {
      const found = names.filter((name) => name.endsWith(extension) && !name.startsWith("."));
      if (found.length > 0) return found.map((name) => path.join(dir, name));
    }
  }
  return [];
}

// This folder, or ./ios, where React Native and Flutter keep theirs.
const projectDirs = () => [process.cwd(), path.join(process.cwd(), "ios")];
const fromHere = (file) => path.relative(process.cwd(), file) || ".";
const container = (project) => [project.endsWith(".xcworkspace") ? "-workspace" : "-project", project];

function findXcodeProject(given) {
  if (typeof given === "string" && /\.(xcworkspace|xcodeproj)\/?$/.test(given)) {
    if (!existsSync(given)) fail(`No such workspace or project: ${given}`);
    return path.resolve(given);
  }
  const found = xcodeProjects(typeof given === "string" ? [path.resolve(given)] : projectDirs());
  if (found.length === 1) return found[0];
  if (found.length > 1) fail(`Several workspaces or projects are here; pick one with --project <path>:\n${found.map((file) => `  ${fromHere(file)}`).join("\n")}`);
  fail(
    typeof given === "string"
      ? `No Xcode workspace or project in ${given}. For run, --project is the workspace or project to build; the project a screenshot goes to is --to <project>.`
      : "No Xcode workspace or project in this folder or in ./ios. Run this in your app's folder, or point at it with --project <path>.",
  );
}

/** What xcodebuild wrote about a failure, without the timestamped log lines it mixes in. */
const complaint = (result) => result.stderr.split("\n").filter((line) => line.trim() && !/^\d{4}-\d\d-\d\d /.test(line)).join("\n");

function schemesOf(project) {
  const result = xcodebuild(["-list", "-json", ...container(project)]);
  if (result.status !== 0) fail(`xcodebuild could not list the schemes of ${path.basename(project)}:\n${complaint(result)}`);
  const list = JSON.parse(result.stdout.slice(result.stdout.search(/^\{/m)));
  // A workspace lists a name once for every project that has a scheme called that.
  return [...new Set((list.workspace ?? list.project)?.schemes ?? [])];
}

/** The scheme that needs no asking: the only one, or the one named like the workspace or project. */
function obviousScheme(project, schemes) {
  if (schemes.length === 1) return schemes[0];
  const name = path.parse(project).name.toLowerCase();
  return schemes.find((scheme) => scheme.toLowerCase() === name) ?? null;
}

function pickScheme(project, given) {
  const schemes = schemesOf(project);
  const list = schemes.map((scheme) => `  ${scheme}`).join("\n");
  if (schemes.length === 0) fail(`${path.basename(project)} has no scheme. Open it in Xcode and share one under Product > Scheme > Manage Schemes.`);
  if (typeof given === "string") {
    if (!schemes.includes(given)) fail(`${path.basename(project)} has no scheme "${given}". Its schemes:\n${list}`);
    return given;
  }
  const scheme = obviousScheme(project, schemes);
  if (!scheme) fail(`${path.basename(project)} has several schemes; pick the app's with --scheme <name>:\n${list}`);
  return scheme;
}

/**
 * Builds the scheme for the simulator and returns the app it made. The build goes into Xcode's own build
 * folder, so what the user has just run from Xcode is compiled already, Swift packages included. With
 * `fresh` it goes into a folder of ours instead, the same one every time, apart from Xcode's.
 */
function build(project, scheme, simulator, fresh) {
  const name = `${slugify(path.parse(project).name)}-${createHash("sha256").update(project).digest("hex").slice(0, 8)}`;
  const log = path.join(BUILD_CACHE, `${name}.log`);
  const target = [...container(project), "-scheme", scheme, "-configuration", "Debug", "-destination", `platform=iOS Simulator,id=${simulator.udid}`, ...(fresh ? ["-derivedDataPath", path.join(BUILD_CACHE, name)] : [])];
  mkdirSync(BUILD_CACHE, { recursive: true });
  const started = Date.now();
  // Straight into the log: xcodebuild writes far more than anyone wants to read while it works.
  const output = openSync(log, "w");
  const result = xcodebuild([...target, "build"], { stdio: ["ignore", output, output] });
  closeSync(output);
  if (result.status !== 0) {
    const text = readFileSync(log, "utf8");
    // A build folder takes one build at a time, and Xcode holds it while it builds.
    if (/database is locked|unable to attach DB/.test(text)) fail(`Xcode is building ${scheme} right now and holds its build folder. Wait for that build to finish and run this again, or pass --fresh for a build kept apart from Xcode's.`);
    const lines = text.split("\n").map((line) => line.trimEnd()).filter(Boolean);
    // Swift repeats each error, indented, under the line of code it is about, and xcodebuild once more in its summary.
    const mentions = lines.filter((line) => line.includes("error:"));
    const flush = mentions.filter((line) => !/^\s/.test(line));
    const errors = [...new Set(flush.length > 0 ? flush : mentions)];
    const shown = errors.length > 0 ? errors.slice(0, 30) : lines.slice(-30);
    fail(`The build of ${scheme} failed:\n${shown.join("\n")}${errors.length > 30 ? `\n(and ${errors.length - 30} more errors)` : ""}\nFull log: ${log}`);
  }

  const settings = xcodebuild([...target, "-showBuildSettings", "-json"]);
  if (settings.status !== 0) fail(`Could not read the build settings of ${scheme}:\n${complaint(settings)}`);
  let targets = [];
  try {
    targets = JSON.parse(settings.stdout.slice(settings.stdout.search(/^\[/m)));
  } catch {}
  // A scheme may build extensions, frameworks or a watch app as well; the iOS app is the one to install.
  const apps = targets.map((entry) => entry.buildSettings).filter((entry) => entry.PRODUCT_TYPE === "com.apple.product-type.application" && entry.PLATFORM_NAME === "iphonesimulator");
  const app = apps.find((entry) => entry.TARGET_NAME === scheme) ?? apps[0];
  if (!app) fail(`The scheme ${scheme} builds no iOS app. Pick the app's scheme with --scheme <name>.`);
  const file = path.join(app.TARGET_BUILD_DIR, app.WRAPPER_NAME);
  if (!existsSync(file)) fail(`The build succeeded, but there is no app at ${file}. Full log: ${log}`);
  console.log(`Built ${app.WRAPPER_NAME} in ${Math.round((Date.now() - started) / 1000)} s`);
  return { file, bundleId: app.PRODUCT_BUNDLE_IDENTIFIER };
}

/**
 * What the options of run and launch ask for once the app is installed: appearance, language, the arguments
 * after --, and the screenshot to take. Checked here, before anything slow starts.
 */
function launchPlan(flags, launchArguments) {
  if (flags.dark && flags.light) fail("Use --dark or --light, not both.");
  if (flags.lang !== undefined && typeof flags.lang !== "string") fail("--lang needs a language code, such as de or pt-BR.");
  if (flags.capture !== undefined && typeof flags.capture !== "string") fail("--capture needs the name of the screenshot, as in: --capture stats");
  if (flags.to !== undefined && typeof flags.to !== "string") fail("--to needs the id of a project. 'appshots projects' lists them.");
  if (flags.to && !flags.capture) fail("--to says where a screenshot goes, so it needs --capture <name> as well.");
  const wait = flags.wait === undefined ? 2 : typeof flags.wait === "string" ? Number(flags.wait) : NaN;
  if (!(wait >= 0 && wait <= 600)) fail("--wait needs a number of seconds, as in: --wait 5");
  const language = typeof flags.lang === "string" ? ["-AppleLanguages", `(${flags.lang})`, "-AppleLocale", flags.lang.replaceAll("-", "_")] : [];
  return {
    appearance: flags.dark ? "dark" : flags.light ? "light" : null,
    launchArguments: [...launchArguments, ...language],
    capture: flags.capture,
    wait,
    out: flags.out,
    to: flags.to,
    // Read now, so a missing setup is said before the build and not after it.
    config: flags.to ? loadConfig() : null,
  };
}

async function startApp(simulator, bundleId, plan) {
  // One that is still running would come to the front with the arguments it was started with.
  xcrun(["simctl", "terminate", simulator.udid, bundleId]);
  if (plan.appearance) {
    const result = xcrun(["simctl", "ui", simulator.udid, "appearance", plan.appearance]);
    if (result.status !== 0) fail(`Could not set ${simulator.name} to ${plan.appearance}:\n${result.stderr.trim()}`);
  }
  const result = xcrun(["simctl", "launch", simulator.udid, bundleId, ...plan.launchArguments]);
  if (result.status !== 0) fail(`Could not launch ${bundleId} on ${simulator.name}. Is it installed there? 'appshots run' builds and installs it.\n${result.stderr.trim()}`);
  console.log(`Running ${bundleId} on ${simulator.name} (${simulator.udid})`);
  // capture and launch find the only booted simulator by themselves; among several they have to be told which.
  const which = bootedSimulators().length > 1 ? ` --sim ${simulator.udid}` : "";
  if (!plan.capture) return console.log(`Next: appshots capture --name <name> --project <project> --clean${which}`);

  // The launch animation, the first data arriving: the screen has to come to rest first.
  spawnSync("sleep", [String(plan.wait)]);
  const shot = capture({ name: plan.capture, out: plan.out, sim: simulator.udid, clean: true });
  if (plan.config) await upload(plan.config, plan.to, shot.file, shot.name);
  console.log(`Next: appshots launch ${bundleId} --capture <name> --to ${plan.to ?? "<project>"}${which} -- <launch arguments>`);
}

async function run(flags, launchArguments) {
  const plan = launchPlan(flags, launchArguments);
  const project = findXcodeProject(flags.project);
  const scheme = pickScheme(project, flags.scheme);
  const simulator = runSimulator(flags);
  const note = simulator.fallback ? `. No ${storeModel(flags.ipad)} is installed, which is the size the store asks for` : "";
  console.log(`Building ${scheme} from ${fromHere(project)} for ${simulatorLabel(simulator)}${note}`);
  boot(simulator);
  const app = build(project, scheme, simulator, Boolean(flags.fresh));
  const installed = xcrun(["simctl", "install", simulator.udid, app.file]);
  if (installed.status !== 0) fail(`Could not install ${path.basename(app.file)} on ${simulator.name}:\n${installed.stderr.trim()}`);
  await startApp(simulator, app.bundleId, plan);
}

async function launch(bundleId, flags, launchArguments) {
  // An easy slip after capture, where --project is the place to upload to; here it would do nothing at all.
  if (flags.project !== undefined) fail("launch has no --project. The project a screenshot goes to is --to <project>, together with --capture <name>.");
  const plan = launchPlan(flags, launchArguments);
  await startApp(choose(bootedSimulators(), flags.sim, "simulator", "--sim"), bundleId, plan);
}

/** The apps the user put on a simulator, as opposed to the ones iOS comes with. Null when it does not say. */
function installedApps(udid) {
  // A simulator that is busy can take its time over this, and 'appshots check' is meant to be quick.
  const list = spawnSync("xcrun", ["simctl", "listapps", udid], { encoding: "utf8", env: xcodeEnv(), maxBuffer: 16 * 1024 * 1024, timeout: 4000 });
  // simctl prints a property list in the old text form, which plutil turns into JSON.
  const json = list.status === 0 ? spawnSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: list.stdout, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }) : null;
  if (json?.status !== 0) return null;
  return Object.values(JSON.parse(json.stdout))
    .filter((app) => app.ApplicationType === "User" && app.CFBundleIdentifier && !app.CFBundleIdentifier.endsWith(".xctrunner"))
    .map((app) => ({ name: app.CFBundleDisplayName ?? app.CFBundleName ?? app.CFBundleIdentifier, bundleId: app.CFBundleIdentifier }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- commands

async function upload(config, project, file, name) {
  const response = await request(config, "PUT", `/api/projects/${project}/shots/${name}`, {
    body: readFileSync(file),
    headers: { "content-type": "application/octet-stream" },
  });
  const shot = await response.json();
  console.log(`Uploaded ${shot.name} (${shot.device}, ${shot.width}x${shot.height}) to ${project}`);
  return shot;
}

/** Uploads a logo or other artwork, which slides place by its name. */
async function uploadImage(config, project, file, name) {
  const response = await request(config, "PUT", `/api/projects/${project}/images/${name}`, {
    body: readFileSync(file),
    headers: { "content-type": "application/octet-stream" },
  });
  const image = await response.json();
  console.log(`Uploaded image ${image.name} (${image.width}x${image.height}) to ${project}`);
  return image;
}

/** A file stands for itself, a folder for the PNG and JPEG files directly inside it, in the order of their names. */
function picturesIn(source, kinds = /\.(png|jpe?g)$/i) {
  if (!existsSync(source)) fail(`No such file or folder: ${source}`);
  if (!statSync(source).isDirectory()) return [source];
  const files = readdirSync(source)
    .filter((name) => kinds.test(name) && !name.startsWith("."))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(source, name))
    .filter((file) => statSync(file).isFile());
  if (files.length === 0) fail(`No image files in ${source}. Only the files directly inside a folder count, not those in its subfolders.`);
  return files;
}

async function uploadAll(config, project, sources, flags) {
  const files = sources.flatMap((source) => picturesIn(source, flags.image ? /\.(png|jpe?g|svg|webp)$/i : undefined));
  if (typeof flags.name === "string" && files.length > 1) fail("--name only works with a single file.");
  if (flags.image) {
    const names = new Set();
    for (const file of files) names.add((await uploadImage(config, project, file, slugify(typeof flags.name === "string" ? flags.name : path.parse(file).name))).name);
    console.log(`${names.size} ${names.size === 1 ? "image" : "images"} uploaded to ${project}. Slides place them by name, as "logo" or in "images".`);
    return;
  }
  // The server tells an iPhone from an iPad screenshot, so one name can stand for one of each.
  const sent = new Map();
  for (const file of files) {
    const shot = await upload(config, project, file, slugify(typeof flags.name === "string" ? flags.name : path.parse(file).name));
    const earlier = sent.get(`${shot.name} ${shot.device}`);
    if (earlier) console.log(`  ! ${path.basename(file)} replaced ${path.basename(earlier)}: both come out as "${shot.name}". Rename one and upload it again.`);
    sent.set(`${shot.name} ${shot.device}`, file);
  }
  console.log(`${sent.size} ${sent.size === 1 ? "screenshot" : "screenshots"} uploaded to ${project}`);
}

/**
 * For a person at the Terminal: names the screens one after the other, waits for a key while they open each,
 * then captures and uploads it.
 */
async function shoot(project, names, flags) {
  if (!process.stdin.isTTY) fail("'appshots shoot' is for a person at the Terminal: it waits for a key before each screenshot. An agent takes them with 'appshots capture'.");
  const config = loadConfig();
  await request(config, "GET", `/api/projects/${project}`);
  // Settled once and up front, so a missing or unclear source is said before the first screen, not after it.
  const source = flags.device ? { device: choose(connectedDevices(), flags.device, "device", "--device").udid } : { sim: choose(bootedSimulators(), flags.sim, "simulator", "--sim").udid };
  const taken = [];
  const skipped = [];
  let answer = null;
  process.stdin.setRawMode(true);
  // A key pressed while a screenshot is on its way is not an answer to the next question, so it is dropped.
  process.stdin.on("data", (data) => answer?.(data.toString().toLowerCase()[0]));
  let at = 0;
  for (; at < names.length; at++) {
    process.stdout.write(`${at + 1}/${names.length} ${names[at]}: open that screen, then press Return (s skips, q stops) `);
    let key;
    // Return takes it, s skips, q, Ctrl-C and Ctrl-D stop; any other key is a slip of the finger.
    while (!["\r", "\n", "s", "q", "\u0003", "\u0004"].includes(key)) key = await new Promise((resolve) => (answer = resolve));
    answer = null;
    process.stdout.write("\n");
    if (key === "s") {
      skipped.push(names[at]);
      continue;
    }
    if (key !== "\r" && key !== "\n") break;
    const shot = capture({ ...flags, ...source, name: names[at] });
    await upload(config, project, shot.file, shot.name);
    taken.push(shot.name);
  }
  process.stdin.setRawMode(false);
  process.stdin.pause();
  console.log(taken.length > 0 ? `Taken ${taken.length} of ${names.length} for ${project}: ${taken.join(", ")}` : `Nothing taken for ${project}.`);
  if (skipped.length > 0) console.log(`Skipped: ${skipped.join(", ")}`);
  if (at < names.length) console.log(`Stopped before: ${names.slice(at).join(", ")}`);
}
async function pull(config, project, flags) {
  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : path.join("store-screenshots", project));
  const response = await request(config, "GET", `/api/projects/${project}/export.zip${flags.render ? "?render=1" : ""}`);
  const dir = mkdtempSync(path.join(tmpdir(), "appshots-"));
  const zip = path.join(dir, "export.zip");
  try {
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    mkdirSync(outDir, { recursive: true });
    const result = spawnSync("unzip", ["-o", "-q", zip, "-d", outDir], { encoding: "utf8" });
    if (result.status !== 0) fail(`Could not unpack the download: ${(result.stderr || result.error?.message || "").trim()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`Screenshots are in ${outDir}`);
}

/** One call to the server's MCP endpoint, which answers each request by itself and in plain JSON. */
async function rpc(config, method, params) {
  const response = await request(config, "POST", "/mcp", {
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  });
  const reply = await response.json();
  if (reply.error) fail(reply.error.message ?? "The server refused the call.");
  return reply.result;
}

async function tools(config, name) {
  const list = (await rpc(config, "tools/list")).tools;
  if (name) {
    const tool = list.find((entry) => entry.name === name);
    if (!tool) fail(`No tool "${name}". Run 'appshots tools' for the list.`);
    console.log(`${tool.name}: ${tool.description}\n\nArguments, as a JSON Schema:\n${JSON.stringify(tool.inputSchema, null, 2)}`);
    return;
  }
  console.log(`Tools of the appShots server at ${config.url}. Call one with:  appshots call <tool> '<arguments as JSON>'`);
  console.log("Start with get_design_guide. 'appshots tools <tool>' prints one tool's arguments in full; a ? marks an optional one.\n");
  for (const tool of list) {
    const required = new Set(tool.inputSchema?.required ?? []);
    const args = Object.keys(tool.inputSchema?.properties ?? {}).map((key) => (required.has(key) ? key : `${key}?`));
    console.log(`${tool.name}${args.length ? `  { ${args.join(", ")} }` : ""}\n  ${tool.description}\n`);
  }
}

async function call(config, name, input, flags) {
  if (!name) fail("Usage: appshots call <tool> ['<arguments as JSON>' | @file.json | -]");
  let source = input ?? "{}";
  if (source === "-") {
    source = readFileSync(0, "utf8");
  } else if (source.startsWith("@")) {
    if (!existsSync(source.slice(1))) fail(`No such file: ${source.slice(1)}`);
    source = readFileSync(source.slice(1), "utf8");
  }
  let args;
  try {
    args = JSON.parse(source);
  } catch (error) {
    fail(`The arguments are not valid JSON: ${error.message}`);
  }
  const result = await rpc(config, "tools/call", { name, arguments: args });
  // An agent without MCP cannot be handed a picture, so pictures become files it can open.
  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : path.join(tmpdir(), "appshots"));
  let pictures = 0;
  for (const part of result.content ?? []) {
    if (part.type === "text") {
      (result.isError ? console.error : console.log)(part.text);
    } else if (part.type === "image") {
      mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, `${name}-${++pictures}.${part.mimeType === "image/png" ? "png" : "jpg"}`);
      writeFileSync(file, Buffer.from(part.data, "base64"));
      console.log(`Picture saved, open it to look: ${file}`);
    }
  }
  if (result.isError) process.exit(1);
}

/**
 * One report of what there is to work with, so an agent sees it in a single call. Nothing missing makes it
 * fail: each line says what is there, or what to do about it.
 */
async function check() {
  console.log(`Server: ${await serverStatus()}`);
  const skill = await skillStatus();
  if (skill) console.log(`Skill: ${skill}`);

  const version = process.platform === "darwin" ? spawnSync("xcodebuild", ["-version"], { encoding: "utf8", env: xcodeEnv() }) : null;
  const xcode = version?.status === 0;
  if (xcode) {
    const dir = xcodeEnv().DEVELOPER_DIR ?? execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim();
    console.log(`Xcode: ${dir.replace(/\/Contents\/Developer\/?$/, "")}, version ${version.stdout.match(/Xcode (\S+)/)?.[1] ?? "unknown"}`);
  } else if (version) {
    console.log("Xcode: not found. Install Xcode from the App Store; the Command Line Tools alone cannot build an app or run a simulator.");
  } else {
    console.log("Xcode: this is not a Mac. Building and capturing need one; 'appshots upload' takes screenshots you already have.");
  }

  const projects = xcodeProjects(projectDirs());
  if (projects.length === 0) {
    console.log("Project: none in this folder. Run 'appshots run' in your app's folder, the one with the .xcworkspace or .xcodeproj, or give it --project <path>.");
  } else if (projects.length > 1) {
    console.log(`Project: several in this folder, so 'appshots run' needs --project <path>: ${projects.map(fromHere).join(", ")}`);
  } else {
    const [project] = projects;
    const schemes = xcode ? attempt(() => schemesOf(project)) : { problem: "Its schemes cannot be read without Xcode." };
    const scheme = schemes.value && obviousScheme(project, schemes.value);
    if (schemes.problem) console.log(`Project: ${fromHere(project)}. ${schemes.problem.replace(/\s+/g, " ")}`);
    else if (schemes.value.length === 0) console.log(`Project: ${fromHere(project)}, no scheme. Open it in Xcode and share one under Product > Scheme > Manage Schemes.`);
    else if (schemes.value.length === 1) console.log(`Project: ${fromHere(project)}, scheme ${scheme}`);
    else console.log(`Project: ${fromHere(project)}, schemes ${schemes.value.join(", ")}. ${scheme ? `'appshots run' builds ${scheme}` : "Name the app's with 'appshots run --scheme <name>'"}`);
  }

  const simulators = xcode ? attempt(availableSimulators) : { problem: "unknown without Xcode" };
  if (simulators.problem) {
    console.log(`Simulators: ${simulators.problem.split("\n")[0]}`);
  } else {
    console.log("Simulators:");
    const recommended = new Set();
    for (const ipad of [false, true]) {
      const simulator = recommendedSimulator(simulators.value, ipad);
      const command = `'appshots run${ipad ? " --ipad" : ""}'`;
      if (!simulator) {
        console.log(`  ${ipad ? "iPad" : "iPhone"}: none. Add an iOS simulator in Xcode under Settings > Components.`);
        continue;
      }
      recommended.add(simulator.udid);
      const state = simulator.booted ? "booted" : `not booted, ${command} boots it`;
      const note = simulator.fallback ? `. No ${storeModel(ipad)} is installed, which is the size the store asks for` : "";
      console.log(`  ${ipad ? "iPad" : "iPhone"}: ${simulatorLabel(simulator)}, ${state}  (${simulator.udid})${note}`);
    }
    for (const simulator of simulators.value.filter((sim) => sim.booted && !recommended.has(sim.udid))) {
      console.log(`  Also booted: ${simulatorLabel(simulator)}  (${simulator.udid})`);
    }

    // What is installed already needs no build. The simulators 'appshots run' uses come first.
    const booted = simulators.value.filter((sim) => sim.booted).sort((a, b) => recommended.has(b.udid) - recommended.has(a.udid));
    const which = booted.length > 1 ? " --sim <simulator>" : "";
    if (booted.length === 0) {
      console.log("Apps: no simulator is booted. 'appshots run' boots one, then builds and installs the app in this folder.");
    } else {
      console.log(`Apps: these are installed and start without a build, with 'appshots launch <bundle id>${which}'`);
      // Each simulator is a question to simctl, and a long list helps nobody.
      for (const simulator of booted.slice(0, 6)) {
        const apps = installedApps(simulator.udid);
        const more = apps?.length > 8 ? `, and ${apps.length - 8} more` : "";
        const list = apps?.slice(0, 8).map((app) => `${app.name} (${app.bundleId})`).join(", ");
        if (!apps) console.log(`  ${simulator.name}: it is busy and did not answer. 'appshots simctl listapps ${simulator.udid}' asks again`);
        else console.log(`  ${simulator.name}: ${list ? `${list}${more}` : "none of your own. 'appshots run' builds and installs the app in this folder"}`);
      }
      if (booted.length > 6) console.log(`  ${booted.length - 6} more booted simulators are not listed.`);
    }
  }

  const devices = xcode ? attempt(connectedDevices) : { problem: "unknown without Xcode" };
  if (devices.problem) {
    console.log(`Devices: ${devices.problem.split("\n")[0]}`);
  } else if (devices.value.length === 0) {
    console.log("Devices: none connected. To capture from an iPhone or iPad, plug it in, unlock it and trust this Mac.");
  } else {
    console.log("Devices:");
    for (const device of devices.value) console.log(`  ${device.name}  ${device.model}  ${device.transport}  (${device.udid})`);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  // simctl's arguments are its own, --help among them.
  if (command === "simctl") process.exit(xcrun(["simctl", ...rest], { stdio: "inherit" }).status ?? 1);
  const { positional, flags, passthrough } = parseArgs(rest);
  if (!command || command === "help" || command === "--help" || flags.help) return console.log(HELP);

  switch (command) {
    case "setup":
      return setup(positional[0], flags);
    case "login":
      return login(positional[0]);
    case "update":
      return update();
    case "check":
      return check();
    case "run":
      if (positional.length > 0) fail("Usage: appshots run [options] [-- <launch arguments>]. What the app is to get goes after a lone --, as in: appshots run -- -appshots stats");
      return run(flags, passthrough);
    case "launch":
      if (positional.length !== 1) fail("Usage: appshots launch <bundle id> [--sim <name|udid>] [--dark|--light] [--lang <code>] [--capture <name>] [--to <project>] [-- <launch arguments>]");
      return launch(positional[0], flags, passthrough);
    case "devices": {
      const simulators = bootedSimulators();
      const devices = connectedDevices();
      console.log("Booted simulators:");
      console.log(simulators.map((s) => `  ${s.name}  (${s.udid})`).join("\n") || "  (none)");
      console.log("Connected devices:");
      console.log(devices.map((d) => `  ${d.name}  ${d.model}  ${d.transport}  (${d.udid})`).join("\n") || "  (none)");
      return;
    }
    case "capture": {
      // run and launch call it --to, so that is taken here as well.
      const project = typeof flags.to === "string" ? flags.to : flags.project;
      const config = typeof project === "string" ? loadConfig() : null;
      const shot = capture(flags);
      if (config) await upload(config, project, shot.file, shot.name);
      return;
    }
    case "shoot": {
      const [project, ...names] = positional;
      if (!project || names.length === 0) fail("Usage: appshots shoot <project> <names...> [--sim <name>] [--device <name>] [--clean] [--out <dir>]");
      return shoot(project, names, flags);
    }
    case "upload": {
      const [project, ...sources] = positional;
      if (!project || sources.length === 0) fail("Usage: appshots upload <project> <files or folders...> [--name <name>] [--image]");
      return uploadAll(loadConfig(), project, sources, flags);
    }
    case "pull":
      if (!positional[0]) fail("Usage: appshots pull <project> [--out <dir>] [--render]");
      return pull(loadConfig(), positional[0], flags);
    case "projects": {
      const projects = await (await request(loadConfig(), "GET", "/api/projects")).json();
      console.log(projects.map((p) => `${p.id}  ${p.name}  (${p.slides} slides)`).join("\n") || "No projects yet.");
      return;
    }
    case "open": {
      const config = loadConfig();
      spawnSync("open", [positional[0] ? `${config.url}/#/${positional[0]}` : config.url]);
      return;
    }
    case "tools":
      return tools(loadConfig(), positional[0]);
    case "call":
      return call(loadConfig(), positional[0], positional[1], flags);
    default:
      fail(`Unknown command "${command}". Run 'appshots help'.`);
  }
}

await main();
