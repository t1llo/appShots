#!/usr/bin/env node
// Mac-side companion to an appShots server: captures screenshots from a simulator or a connected
// iPhone/iPad, uploads them, and pulls the rendered store screenshots back down. `appshots setup` also
// installs the appshots skill for a coding agent and connects that agent to the server, and `appshots call`
// reaches the server's tools for agents that have no MCP.
// No dependencies, so it runs straight from a checkout: `node cli/appshots.mjs` or `npm link`.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const BOOLEAN_FLAGS = new Set(["clean", "render", "help"]);

const HELP = `appshots: capture app screenshots and sync them with an appShots server

  appshots setup <url> [--agent <agent>] Everything in one go: save the token, install the appshots skill
                                         and this CLI, connect the agent. Agents: claude (the default),
                                         codex, opencode, pi, other. --token <token> skips the question
  appshots login <url>                   Save the server URL and token only (asks for the token)
  appshots projects                      List projects on the server
  appshots devices                       List booted simulators and connected devices
  appshots capture [options]             Take a screenshot
      --name <name>                        Screenshot name slides refer to (default: timestamp)
      --sim [name|udid]                    From a booted simulator (the default source)
      --device [name|udid]                 From a connected, unlocked iPhone or iPad (Xcode 27+)
      --clean                              Simulator only: show 9:41, full battery and signal
      --project <id>                       Upload it to this project straight away
      --out <dir>                          Where to save the PNG (default: ./raw-shots)
  appshots upload <project> <files...>   Upload existing screenshots (name = file name, or --name)
  appshots pull <project> [--out <dir>]  Download the rendered screenshots and header and search
                                         results assets (--render renders first)
  appshots open [project]                Open the Studio in the browser
  appshots tools [tool]                  List the server's tools, or one tool's arguments
  appshots call <tool> [arguments]       Call one. Arguments are JSON: inline, @file.json, or - for stdin
                                         (--out <dir> is where returned pictures are saved)

Server and token come from APPSHOTS_URL / APPSHOTS_TOKEN, or from 'appshots setup' or 'appshots login'.
The token is a personal one from Connect in the Studio.`;

function fail(message) {
  console.error(`appshots: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
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

function loadConfig() {
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
  if (!url) fail("No server configured. Run the setup command from Connect in the Studio, or 'appshots login <url>'.");
  return { url, token };
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

function xcrun(args) {
  if (process.platform !== "darwin") fail("Capturing needs a Mac with Xcode. Use 'appshots upload' for existing screenshots.");
  const result = spawnSync("xcrun", args, { encoding: "utf8", env: xcodeEnv() });
  if (result.error) fail(`Could not run xcrun: ${result.error.message}`);
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
  if (candidates.length === 0) fail(kind === "simulator" ? "No simulator is booted. Run your app in one first, or use --device." : "No iPhone or iPad is connected. Plug it in, unlock it and trust this Mac.");
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

// ---------------------------------------------------------------- commands

async function upload(config, project, file, name) {
  const response = await request(config, "PUT", `/api/projects/${project}/shots/${name}`, {
    body: readFileSync(file),
    headers: { "content-type": "application/octet-stream" },
  });
  const shot = await response.json();
  console.log(`Uploaded ${shot.name} (${shot.device}, ${shot.width}x${shot.height}) to ${project}`);
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

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === "help" || command === "--help" || flags.help) return console.log(HELP);

  switch (command) {
    case "setup":
      return setup(positional[0], flags);
    case "login":
      return login(positional[0]);
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
      const config = typeof flags.project === "string" ? loadConfig() : null;
      const shot = capture(flags);
      if (config) await upload(config, flags.project, shot.file, shot.name);
      return;
    }
    case "upload": {
      const [project, ...files] = positional;
      if (!project || files.length === 0) fail("Usage: appshots upload <project> <files...> [--name <name>]");
      if (typeof flags.name === "string" && files.length > 1) fail("--name only works with a single file.");
      const config = loadConfig();
      for (const file of files) {
        if (!existsSync(file)) fail(`No such file: ${file}`);
        await upload(config, project, file, slugify(typeof flags.name === "string" ? flags.name : path.parse(file).name));
      }
      return;
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
