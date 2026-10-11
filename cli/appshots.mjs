#!/usr/bin/env node
// Mac-side companion to an appShots server: captures screenshots from a simulator or a connected
// iPhone/iPad, uploads them, and pulls the rendered store screenshots back down. `appshots setup` also
// installs the /appshots skill for Claude Code and connects Claude Code to the server.
// No dependencies, so it runs straight from a checkout: `node cli/appshots.mjs` or `npm link`.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const CONFIG_FILE = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "appshots", "config.json");
// Where Claude Code looks for the skill. The CLI lives next to it, so the skill finds it without a PATH.
const SKILL_DIR = path.join(homedir(), ".claude", "skills", "appshots");
const BOOLEAN_FLAGS = new Set(["clean", "render", "help"]);

const HELP = `appshots: capture app screenshots and sync them with an appShots server

  appshots setup <url> [--token <token>] Everything in one go: save the token, install the /appshots
                                         skill and this CLI for Claude Code, connect Claude Code
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

async function setup(url, flags) {
  if (!url || !/^https?:\/\//.test(url)) fail("Usage: appshots setup <url> [--token <token>]");
  const server = url.replace(/\/+$/, "");
  const done = (text) => console.log(`  ✓ ${text}`);
  const open = (text) => console.log(`  ! ${text}`);
  console.log(`Setting up appShots for ${server}`);

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

  // 2. This file next to the skill, and on the PATH where that is easy.
  const cli = path.join(SKILL_DIR, "appshots.mjs");
  const self = realpathSync(fileURLToPath(import.meta.url));
  mkdirSync(SKILL_DIR, { recursive: true });
  if (!existsSync(cli) || realpathSync(cli) !== self) copyFileSync(self, cli);
  chmodSync(cli, 0o755);
  const command = linkOntoPath(cli);
  done(command ? `Capture tool installed: appshots (${tilde(command)})` : `Capture tool installed: node ${tilde(cli)}`);

  // 3. The skill, with this server's address in it.
  const skill = await fetch(`${server}/skill.md`).catch(() => null);
  if (skill?.ok) {
    writeFileSync(path.join(SKILL_DIR, "SKILL.md"), await skill.text());
    done("Skill installed: /appshots in Claude Code");
  } else {
    open("This server has no /appshots skill to install.");
  }

  // 4. Claude Code, for every folder. An entry left in this folder would win over it, so that one goes first.
  let connected = false;
  if (spawnSync("claude", ["--version"], { stdio: "ignore" }).error) {
    open("Claude Code was not found, so it is not connected yet. Install it (https://claude.com/claude-code) and run this again.");
  } else {
    for (const scope of ["local", "user"]) spawnSync("claude", ["mcp", "remove", "appshots", "--scope", scope], { stdio: "ignore" });
    const added = spawnSync("claude", ["mcp", "add", "--transport", "http", "--scope", "user", "appshots", `${server}/mcp`, ...(token ? ["--header", `Authorization: Bearer ${token}`] : [])], { encoding: "utf8" });
    connected = added.status === 0;
    if (connected) done("Claude Code connected to the server (MCP server \"appshots\")");
    else open(`Claude Code could not be connected: ${`${added.stderr}${added.stdout}`.trim() || "claude mcp add failed"}`);
  }

  console.log("");
  if (connected && skill?.ok) console.log("Ready. Open Claude Code in your app's folder, start a new session and type /appshots");
  else console.log("Not finished: see the lines marked ! above.");
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
    default:
      fail(`Unknown command "${command}". Run 'appshots help'.`);
  }
}

await main();
