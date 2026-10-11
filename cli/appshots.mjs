#!/usr/bin/env node
// Mac-side companion to an appShots server: captures screenshots from a simulator or a connected
// iPhone/iPad, uploads them, and pulls the rendered store screenshots back down.
// No dependencies, so it runs straight from a checkout: `node cli/appshots.mjs` or `npm link`.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";

const CONFIG_FILE = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "appshots", "config.json");
const BOOLEAN_FLAGS = new Set(["clean", "render", "help"]);

const HELP = `appshots: capture app screenshots and sync them with an appShots server

  appshots login <url>                   Save the server URL and token (asks for the token)
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
  appshots pull <project> [--out <dir>]  Download the rendered screenshots (--render renders first)
  appshots open [project]                Open the web gallery

Server and token come from APPSHOTS_URL / APPSHOTS_TOKEN, or from 'appshots login'.
The token is a personal one from Account in the web gallery, or the server's own token if you run it.`;

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
  if (!url) fail("No server configured. Run 'appshots login <url>' or set APPSHOTS_URL.");
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
  const config = { url: url.replace(/\/+$/, ""), token: process.env.APPSHOTS_TOKEN ?? (await promptHidden("Token (from Account in the gallery; leave empty if the server has none): ")) };
  await request(config, "GET", "/api/projects");
  mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
  console.log(`Logged in to ${config.url}. Saved to ${CONFIG_FILE}`);
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
