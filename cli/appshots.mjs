#!/usr/bin/env node
// Mac-side companion to an appShots server: builds the app in the current folder and runs it in a
// simulator, captures screenshots from a simulator or a connected iPhone/iPad, uploads them, and pulls the
// rendered store screenshots back down, or puts them into App Store Connect. There are three ways to the screenshots: `appshots upload` takes
// the ones that exist already, `appshots shoot` captures while a person opens each screen, and
// `appshots run` and `appshots launch` start the app on a given screen and capture it in one go.
// An app that is not built with Xcode alone is started by its own toolkit and captured where it runs:
// in the simulator, in a window on this Mac (`capture --mac`), or as a page in a browser (`capture --web`).
// `appshots check` reports what is there to work with, `appshots setup` installs the appshots skill for a
// coding agent and connects that agent to the server, `appshots update` brings that skill up to date, and
// `appshots call` reaches the server's tools for agents that have no MCP.
// No dependencies, so it runs straight from a checkout: `node cli/appshots.mjs` or `npm link`.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONFIG_FILE = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "appshots", "config.json");
// What the server last said its skill and command are, so that asking again can wait.
const LATEST_FILE = path.join(path.dirname(CONFIG_FILE), "latest.json");
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
const BOOLEAN_FLAGS = new Set(["clean", "render", "help", "ipad", "duo", "dark", "light", "fresh", "image", "dry-run", "add-languages"]);

const HELP = `appshots: capture an app's screens and sync them with an appShots server.
An app is captured where it runs, whatever it is built with: in the iOS Simulator or on a plugged-in
iPhone or iPad ('appshots capture'), in a window on this Mac ('appshots capture --mac <app>'), or as a
web app in a browser ('appshots capture --web <address>'). 'appshots run' builds and starts an Xcode
project; an app made with Flutter, React Native, Expo, Capacitor, Tauri, Electron or a web framework is
started by that toolkit's own command, and 'appshots check' says which.

  appshots setup <url> [--agent <agent>] Everything in one go: save the token, install the appshots skill
                                         and this CLI, connect the agent. Agents: claude (the default),
                                         codex, opencode, pi, other. --token <token> skips the question
  appshots login <url>                   Save the server URL and token only (asks for the token)
  appshots update                        Bring the installed skill and this CLI up to date with the
                                         server's. Needs no token and leaves the agent's connection alone
  appshots check                         Report what is there: the server, whether the skill is current,
                                         the project in this folder and what it is made with, Xcode,
                                         simulators, the apps installed on them, and devices. Each line
                                         says what to do next
  appshots projects                      List projects on the server
  appshots run [options] [-- <args>]     Build the app in this folder and launch it in a simulator
      --scheme <name>                      Scheme to build (only when the choice is not obvious)
      --project <path>                     Workspace or project to build (only when there are several)
      --fresh                              Build in a folder of its own instead of reusing Xcode's build
      --ipad                               On the 13-inch iPad Pro instead of the iPhone Pro Max
      --duo                                On the iPhone Duo instead
      --sim <name|udid>                    On this simulator instead; it is booted if need be
      --dark, --light                      Set the simulator's appearance before launching
      --lang <code>                        Launch in this language, such as de or pt-BR. A screenshot
                                           taken with --capture is filed under it in the project
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
  appshots boot [--ipad|--duo|--sim <name|udid>]
                                         Boot the simulator the store sizes ask for and print its udid,
                                         for an app its own toolkit starts: flutter run -d <udid>,
                                         npx expo run:ios --device <udid>, npx cap run ios --target <udid>
  appshots simctl <arguments...>         Run xcrun simctl with the right Xcode: openurl, ui, privacy, push
  appshots devices                       List booted simulators and connected devices
  appshots capture [options]             Take a screenshot
      --name <name>                        Screenshot name slides refer to (default: timestamp)
      --sim [name|udid]                    From a booted simulator (the default source)
      --device [name|udid]                 From a connected, unlocked iPhone or iPad (Xcode 27+)
      --mac <app>                          From a Mac app running on this Mac: its frontmost window,
                                           without the shadow. A window is shown as a window, an app
                                           in full screen inside a MacBook. The terminal needs the
                                           Screen Recording permission in System Settings
      --web <address>                      From a web app: the page at this address, drawn by Chrome
                                           without a window, at the size of an iPhone. --as ipad,
                                           --as duo or --as mac draws it at that size. On a phone or
                                           tablet the top is left free for the status bar and the
                                           home indicator is drawn. With it:
        --dark, --light                      The colour scheme the page is asked for
        --wait <seconds>                     Time the page gets to settle once loaded (default: 1)
        --init <script|@file>                JavaScript run before the page's own on every load:
                                             sample data in localStorage, a fixed date
        --eval <script|@file>                JavaScript run in the loaded page before the picture:
                                             the click or scroll that brings up the screen
        --viewport <width>x<height>          The page's size in points instead of the device's
        --profile <dir>                      Keep cookies and storage in this folder between captures
      --clean                              Simulator only: show 9:41, full battery and signal
      --project <id>                       Upload it to this project straight away (--to works too)
      --as <iphone|duo|ipad|mac>           File it under this device. Only needed when the server
                                           cannot tell from the size; upload, run and launch take it too
      --lang <code>                        It shows the app in this language, one the project has.
                                           Left out, it is for the project's first language, which
                                           every other language shows until it has its own
      --out <dir>                          Where to save the PNG (default: ./raw-shots)
  appshots shoot <project> <names...>    For a person at the Terminal: names each screen in turn, waits
                                         for Return while you open it, then captures and uploads it.
                                         Options as for capture: --sim, --device, --mac, --clean, --out,
                                         --lang
  appshots upload <project> <files or folders...>
                                         Upload screenshots that exist already. A folder stands for the
                                         PNG and JPEG files in it. The name is the file name, or --name
                                         for a single file
      --lang <code>                        They show the app in this language, as for capture
      --image                              They are not screenshots but a logo or other artwork for the
                                           slides: PNG, SVG, JPEG or WebP, transparency kept
  appshots pull <project> [--out <dir>]  Download the rendered screenshots, the header and search
                                         results assets and the banners (--render renders first)
  appshots mockups <project> [options]   Download every screenshot inside its device with nothing behind
                                         it: one transparent PNG each, for a website or a README. Needs
                                         no slides and uses no render
      --out <dir>                          Where to put them (default: ./mockups/<project>)
      --lang <code>                        Only this language's. Left out: the first language's, and a
                                           folder per other language for the screenshots it has of its own
      --style <real|clay|outline|sketch>   How the device is drawn. This and the next ones are saved
      --color <colour>                     with the project, so the Studio's Mockups page shows the same:
      --shadow <none|soft|strong>          black, silver, natural, gold, blue or orange; a shadow under
      --rotate <degrees>                   the device; its tilt, such as -8; a 3D turn to the left or
      --perspective <none|left|right>      right; a clean status bar (none, cover or overlay) and the
      --status-bar <kind>, --time <9:41>   time it shows; and --frame none for the bare screenshot
      --width <pixels>                     Width of each PNG. auto, the default, shows the screenshot
                                           pixel for pixel
  appshots store <command>               Put a finished set into App Store Connect from this Mac, with an
                                         API key of your own. The key file stays where it is: only its
                                         path is saved, and neither goes to the appShots server. Nothing
                                         is ever submitted for review or released
      login --issuer <issuer id> --key-id <key id> --key <path to the .p8 file>
                                           Save the three and check them with Apple. A key with the
                                           role Marketing is enough. Without --key, AuthKey_<key id>.p8
                                           is looked for in ~/.appstoreconnect/private_keys
      apps                                 List the apps the key reaches, with their bundle ids
      push <project> --app <bundle id>     Upload the project's screenshots: each language into its
                                           language, each folder onto its display, in place of what is
                                           there. They go into the version being prepared
        --version <number>                   Create that version when none is being prepared
        --render                             Render first, as pull --render does
        --from <folder>                      Take the files of an earlier 'appshots pull' instead
        --lang <codes>                       Only these languages, such as de-DE,fr-FR
        --only <devices or folders>          Only these, such as iphone,ipad or iphone-6.9,ipad-13
        --add-languages                      Add a language the store page does not have yet
        --dry-run                            Change nothing and say what would be done
      text --app <bundle id>               Print the store page's texts per language as JSON: name,
                                           subtitle, description, keywords, promotionalText, whatsNew,
                                           supportUrl, marketingUrl
        --set '<JSON>' | @file.json | -      Write the ones given, in that same shape. Takes --version,
                                             --add-languages and --dry-run as push does
        --platform <ios|mac>                 Which version's texts, for an app that has both
  appshots open [project]                Open the Studio in the browser
  appshots tools [tool]                  List the server's tools, or one tool's arguments
  appshots call <tool> [arguments]       Call one. Arguments are JSON: inline, @file.json, or - for stdin
                                         (--out <dir> is where returned pictures are saved)

Server and token come from APPSHOTS_URL / APPSHOTS_TOKEN, or from 'appshots setup' or 'appshots login'.
The token is a personal one from Connect in the Studio. The App Store Connect key comes from
'appshots store login', or from ASC_ISSUER_ID, ASC_KEY_ID and ASC_KEY_PATH.`;

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

const stamp = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * Says so when the server has a newer skill or command than this Mac. It asks at most twice a day, for two
 * hashes instead of the files, and never gets in the way: a server that does not answer means no notice.
 */
async function staleNotice() {
  const { value: config } = attempt(readConfig);
  const dirs = installedSkills();
  if (!config?.url || dirs.length === 0) return;
  let known = {};
  try {
    known = JSON.parse(readFileSync(LATEST_FILE, "utf8"));
  } catch {}
  if (known.url !== config.url || !(Date.now() - known.at < 12 * 3600 * 1000)) {
    try {
      const response = await fetch(`${config.url}/skill.json`, { signal: AbortSignal.timeout(3000) });
      // A server from before this file existed has nothing to compare with.
      if (!response.ok) return;
      const now = await response.json();
      known = { url: config.url, at: Date.now(), skill: now.skill, cli: now.cli };
      mkdirSync(path.dirname(LATEST_FILE), { recursive: true });
      writeFileSync(LATEST_FILE, `${JSON.stringify(known)}\n`);
    } catch {
      return;
    }
  }
  if (typeof known.skill !== "string" || typeof known.cli !== "string") return;
  const same = (name, hash) => dirs.every((dir) => existsSync(path.join(dir, name)) && stamp(readFileSync(path.join(dir, name), "utf8")) === hash);
  if (same("SKILL.md", known.skill) && same("appshots.mjs", known.cli)) return;
  console.error("appshots: the server has a newer skill and command. Run 'appshots update', then read SKILL.md again from the top.");
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
  // What was remembered about the server is older than what has just been fetched.
  rmSync(LATEST_FILE, { force: true });
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
  if (process.platform !== "darwin") fail("This needs a Mac with Xcode. 'appshots capture --web <address>' takes a web app's pages anywhere, and 'appshots upload' takes screenshots you already have.");
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
  if (candidates.length === 0) fail(kind === "simulator" ? "No simulator is booted. Start your app in one with 'appshots run' first, or with 'appshots boot' and the project's own run command. A plugged-in device is --device, a window on this Mac --mac <app>, a web page --web <address>." : "No iPhone or iPad is connected. Plug it in, unlock it and trust this Mac.");
  fail(`Several ${kind}s are available; pick one with ${flag} <name>:\n${describe(candidates)}`);
}

/**
 * The windows apps show on this Mac, the frontmost first. Only what the system tells anyone: which app a window
 * belongs to and how large it is, not its title or what is in it.
 */
function macWindows() {
  if (process.platform !== "darwin") fail("--mac captures a window of an app running on this computer, which needs a Mac.");
  // 1 | 16: the windows on screen, without the desktop's. Layer 0 is where apps keep their ordinary windows.
  const script = `ObjC.import('CoreGraphics');
const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0)));
JSON.stringify(list.filter((w) => w.kCGWindowLayer === 0 && w.kCGWindowOwnerName && w.kCGWindowBounds).map((w) => ({ id: w.kCGWindowNumber, app: w.kCGWindowOwnerName, width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height })))`;
  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" });
  if (result.status !== 0) fail(`Could not list the windows on this Mac:\n${(result.stderr ?? "").trim()}`);
  // Smaller than this is a palette or a leftover, not the window to show.
  return JSON.parse(result.stdout).filter((window) => window.width >= 200 && window.height >= 150);
}

/** The frontmost window of the app called `query`. */
function macWindow(query) {
  const windows = macWindows();
  const apps = [...new Set(windows.map((window) => window.app))];
  const open = apps.length > 0 ? `Apps with a window open:\n${apps.map((app) => `  ${app}`).join("\n")}` : "No app has a window open.";
  if (typeof query !== "string") fail(`--mac needs the name of the app, as in: --mac Ledger\n${open}`);
  const needle = query.toLowerCase();
  const exact = apps.filter((app) => app.toLowerCase() === needle);
  const matches = exact.length > 0 ? exact : apps.filter((app) => app.toLowerCase().includes(needle));
  if (matches.length === 0) fail(`No app called "${query}" has a window open. Start it first, and bring it out of the Dock if it is minimised.\n${open}`);
  if (matches.length > 1) fail(`"${query}" matches several apps:\n${matches.map((app) => `  ${app}`).join("\n")}`);
  return windows.find((window) => window.app === matches[0]);
}

/** The name a capture goes by and the file it is saved as. Makes the folder. */
function shotTarget(flags) {
  const name = typeof flags.name === "string" ? slugify(flags.name) : `shot-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : "raw-shots");
  mkdirSync(outDir, { recursive: true });
  return { name, file: path.join(outDir, `${name}.png`) };
}

function capture(flags) {
  // Before the folder is made: a wrong name should leave nothing behind.
  const window = flags.mac ? macWindow(flags.mac) : null;
  const { name, file } = shotTarget(flags);

  if (window) {
    rmSync(file, { force: true });
    // -o leaves the window's shadow out, -x the camera sound.
    const result = spawnSync("screencapture", ["-x", "-o", "-l", String(window.id), file], { encoding: "utf8" });
    if (result.status !== 0 || !existsSync(file) || statSync(file).size === 0) {
      fail(`Could not capture the window of ${window.app}.${result.stderr ? `\n${result.stderr.trim()}` : ""}\nmacOS lets a program capture windows only with the Screen Recording permission: System Settings, Privacy & Security, Screen & System Audio Recording, switch on the terminal app this runs in, then start that app again.`);
    }
    console.log(`Captured ${window.app} -> ${file}`);
  } else if (flags.device) {
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

// ---------------------------------------------------------------- web pages

/**
 * The screens a web page is drawn at: the points and the scale of the device whose store size comes out of it.
 * `bar` is what the status bar takes at the top, `home` what the home indicator takes at the bottom, and
 * `pill` how wide that indicator is.
 */
const WEB_SCREENS = {
  iphone: { label: "an iPhone", width: 440, height: 956, scale: 3, bar: 62, home: 34, pill: 152, touch: true },
  duo: { label: "an iPhone Duo", width: 669, height: 951, scale: 3, bar: 39, home: 0, pill: 0, touch: true },
  ipad: { label: "an iPad", width: 1032, height: 1376, scale: 2, bar: 24, home: 20, pill: 320, touch: true },
  mac: { label: "a Mac", width: 1440, height: 900, scale: 2, bar: 0, home: 0, pill: 0, touch: false },
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `test` holds, for `ms` at most, and says whether it came to hold. */
async function until(test, ms) {
  for (const end = Date.now() + ms; !test(); await pause(50)) if (Date.now() > end) return false;
  return true;
}

/**
 * A Chromium browser that can draw a page without a window: Chrome, Chromium, Edge or Brave as installed, or
 * the Chromium that Playwright keeps for a project. Null when there is none.
 */
function findBrowser() {
  const given = process.env.APPSHOTS_BROWSER;
  if (given) return existsSync(given) ? { name: path.basename(given), file: given } : null;
  if (process.platform === "darwin") {
    for (const root of ["/Applications", path.join(homedir(), "Applications")]) {
      for (const name of ["Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser", "Google Chrome Canary"]) {
        const file = path.join(root, `${name}.app`, "Contents", "MacOS", name);
        if (existsSync(file)) return { name, file };
      }
    }
  } else if (process.platform === "win32") {
    for (const root of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
      for (const [name, program] of [["Google Chrome", "Google/Chrome/Application/chrome.exe"], ["Microsoft Edge", "Microsoft/Edge/Application/msedge.exe"], ["Brave Browser", "BraveSoftware/Brave-Browser/Application/brave.exe"]]) {
        const file = path.join(root, program);
        if (existsSync(file)) return { name, file };
      }
    }
  } else {
    const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]) {
      const file = dirs.map((dir) => path.join(dir, name)).find(existsSync);
      if (file) return { name, file };
    }
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(homedir(), process.platform === "darwin" ? "Library/Caches" : ".cache", "ms-playwright");
  const number = (entry) => Number(entry.split("-").pop());
  let kept = [];
  try {
    // The newest first, and the whole browser before the one that is only its engine.
    kept = readdirSync(cache).filter((entry) => /^chromium(_headless_shell)?-\d+$/.test(entry)).sort((a, b) => a.includes("_") - b.includes("_") || number(b) - number(a));
  } catch {}
  for (const entry of kept) {
    for (const folder of readdirSync(path.join(cache, entry))) {
      for (const binary of ["Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "Chromium.app/Contents/MacOS/Chromium", "chrome", "chrome-headless-shell", "headless_shell"]) {
        const file = path.join(cache, entry, folder, binary);
        if (existsSync(file) && statSync(file).isFile()) return { name: "Playwright's Chromium", file };
      }
    }
  }
  return null;
}

/**
 * Starts the browser without a window and hands `work` a way to talk to it: `send` for a command of the
 * DevTools protocol, `listen` for what the browser reports by itself. The talking goes over the two pipes that
 * --remote-debugging-pipe opens, each message JSON ended by a zero byte, so no port is opened and nothing has
 * to be installed. The browser gets a profile of its own, apart from the user's, and is gone when `work` is done.
 */
async function withBrowser(browser, profile, work) {
  const dir = profile ? path.resolve(profile) : mkdtempSync(path.join(tmpdir(), "appshots-web-"));
  mkdirSync(dir, { recursive: true });
  const options = [
    "--headless",
    "--remote-debugging-pipe",
    `--user-data-dir=${dir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    // Without these two a fresh profile asks for the login keychain.
    "--password-store=basic",
    "--use-mock-keychain",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-color-profile=srgb",
    "about:blank",
  ];
  const child = spawn(browser.file, options, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const [, , errors, input, output] = child.stdio;
  let said = "";
  errors.on("data", (data) => (said = `${said}${data}`.slice(-2000)));
  input.on("error", () => {});

  const waiting = new Map();
  const listeners = new Set();
  let gone = null;
  const leave = (reason) => {
    gone ??= reason;
    for (const { reject, timer } of waiting.values()) {
      clearTimeout(timer);
      reject(new Error(gone));
    }
    waiting.clear();
  };
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve(leave(`Could not start ${browser.name}: ${error.message}`)));
    child.once("exit", () => resolve(leave(`${browser.name} quit before it was done.${said.trim() ? `\n${said.trim().split("\n").slice(-5).join("\n")}` : ""}`)));
  });

  const parts = [];
  output.on("data", (chunk) => {
    let from = 0;
    for (let end = chunk.indexOf(0); end !== -1; end = chunk.indexOf(0, from)) {
      parts.push(chunk.subarray(from, end));
      from = end + 1;
      const message = JSON.parse(Buffer.concat(parts.splice(0)).toString("utf8"));
      const asked = waiting.get(message.id);
      if (asked) {
        waiting.delete(message.id);
        clearTimeout(asked.timer);
        if (message.error) asked.reject(new Error(`${asked.method}: ${message.error.message}`));
        else asked.resolve(message.result);
      } else if (message.method) {
        for (const listener of listeners) listener(message);
      }
    }
    if (from < chunk.length) parts.push(chunk.subarray(from));
  });

  let count = 0;
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (gone) return reject(new Error(gone));
      const id = ++count;
      const timer = setTimeout(() => waiting.delete(id) && reject(new Error(`${browser.name} did not answer ${method}.`)), 60000);
      waiting.set(id, { resolve, reject, timer, method });
      input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });

  try {
    return await work({ send, listen: (listener) => listeners.add(listener) });
  } finally {
    send("Browser.close").catch(() => {});
    // A timer that is still running would keep this command from ending.
    let patience;
    await Promise.race([exited, new Promise((resolve) => (patience = setTimeout(resolve, 4000)))]);
    clearTimeout(patience);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (!profile) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * Runs in a blank page of the browser: sets the picture of a web page between the bands a phone keeps free of
 * it, for the status bar at the top and the home indicator at the bottom, and draws that indicator. A band
 * takes the colour of the page's edge next to it, so a coloured header runs up into it, or `paper` where that
 * edge is a picture.
 */
async function withDeviceBars({ data, top, bottom, paper, pill }) {
  const picture = new Image();
  picture.src = `data:image/png;base64,${data}`;
  await picture.decode();
  const canvas = document.createElement("canvas");
  canvas.width = picture.width;
  canvas.height = top + picture.height + bottom;
  const pen = canvas.getContext("2d", { willReadFrequently: true });
  pen.drawImage(picture, 0, top);
  const band = (from, height, row, fallback) => {
    if (!height) return;
    const edge = pen.getImageData(0, row, picture.width, 1).data;
    let even = true;
    for (let at = 4; at < edge.length && even; at += 4) for (let c = 0; c < 3; c++) if (Math.abs(edge[at + c] - edge[c]) > 6) even = false;
    pen.fillStyle = even ? `rgb(${edge[0]} ${edge[1]} ${edge[2]})` : fallback;
    pen.fillRect(0, from, picture.width, height);
  };
  band(0, top, top, paper.top);
  band(top + picture.height, bottom, top + picture.height - 1, paper.bottom);
  if (pill) {
    const left = Math.round((canvas.width - pill.width) / 2);
    const from = canvas.height - pill.gap - pill.height;
    // Dark on a light page and light on a dark one, as the phone draws it.
    const under = pen.getImageData(left, from, pill.width, pill.height).data;
    let light = 0;
    for (let at = 0; at < under.length; at += 4) light += 0.299 * under[at] + 0.587 * under[at + 1] + 0.114 * under[at + 2];
    pen.fillStyle = light / (under.length / 4) > 140 ? "#000" : "#fff";
    pen.beginPath();
    pen.roundRect(left, from, pill.width, pill.height, pill.height / 2);
    pen.fill();
  }
  return canvas.toDataURL("image/png").split(",")[1];
}

/** JavaScript given on the command line: the code itself, or @file for a file that holds it. */
function scriptOf(value, flag) {
  if (value === undefined) return null;
  if (typeof value !== "string") fail(`${flag} needs JavaScript, or @file for a file that holds it.`);
  if (!value.startsWith("@")) return value;
  if (!existsSync(value.slice(1))) fail(`No such file: ${value.slice(1)}`);
  return readFileSync(value.slice(1), "utf8");
}

/** The address --web was given: a URL, a host and port without its http://, or an HTML file on this computer. */
function webAddress(value) {
  if (typeof value !== "string") fail("--web needs the address of the page, as in: --web http://localhost:5173/stats");
  if (/^(https?|file):\/\//i.test(value)) return value;
  if (existsSync(value)) return pathToFileURL(path.resolve(value)).href;
  return `http://${value}`;
}

/**
 * Draws one page of a web app at the size of a device and saves it as a raw screenshot of that device. On a
 * phone or tablet the page is laid out between the status bar and the home indicator, as an installed web app
 * is: the status bar's place stays free in the picture and the home indicator is drawn. A page that asks for
 * the whole screen (viewport-fit=cover) gets it, with the safe area it then has to keep to.
 */
async function captureWeb(flags) {
  const address = webAddress(flags.web);
  const kind = shotDevice(flags) ?? "iphone";
  const screen = WEB_SCREENS[kind];
  if (flags.dark && flags.light) fail("Use --dark or --light, not both.");
  const language = shotLanguage(flags);
  const wait = flags.wait === undefined ? 1 : typeof flags.wait === "string" ? Number(flags.wait) : NaN;
  if (!(wait >= 0 && wait <= 600)) fail("--wait needs a number of seconds, as in: --wait 3");
  const given = flags.viewport === undefined ? null : /^(\d{3,4})x(\d{3,4})$/.exec(String(flags.viewport));
  if (flags.viewport !== undefined && !given) fail("--viewport needs a size in points, as in: --viewport 1280x800");
  const width = given ? Number(given[1]) : screen.width;
  const height = given ? Number(given[2]) : screen.height;
  const init = scriptOf(flags.init, "--init");
  const steps = scriptOf(flags.eval, "--eval");
  if (flags.profile !== undefined && typeof flags.profile !== "string") fail("--profile needs a folder, as in: --profile .appshots-browser");
  const browser = findBrowser();
  if (!browser) {
    fail(
      process.env.APPSHOTS_BROWSER
        ? `APPSHOTS_BROWSER points at ${process.env.APPSHOTS_BROWSER}, which does not exist.`
        : "--web draws the page with Chrome, Chromium, Edge or Brave, and none of them is installed. Install Google Chrome, or point APPSHOTS_BROWSER at a Chromium browser's program.",
    );
  }

  let shot;
  try {
    shot = await withBrowser(browser, flags.profile, async ({ send, listen }) => {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const page = (method, params) => send(method, params, sessionId);
      const evaluate = async (expression, what) => {
        const { result, exceptionDetails } = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (exceptionDetails) throw new Error(`${what} failed in the page: ${(exceptionDetails.exception?.description ?? exceptionDetails.text).split("\n")[0]}`);
        return result.value;
      };

      await page("Page.enable");
      await page("Network.enable");
      await page("Page.setLifecycleEventsEnabled", { enabled: true });
      const frame = (await page("Page.getFrameTree")).frameTree.frame.id;
      // What each document of the page has reached so far. A redirect or a click may bring a new one.
      const reached = new Map();
      let current = null;
      let status = 0;
      listen(({ sessionId: from, method, params }) => {
        if (from !== sessionId) return;
        if (method === "Page.lifecycleEvent" && params.frameId === frame) {
          if (params.name === "init") current = params.loaderId;
          if (!reached.has(params.loaderId)) reached.set(params.loaderId, new Set());
          reached.get(params.loaderId).add(params.name);
        } else if (method === "Network.responseReceived" && params.type === "Document" && params.frameId === frame) {
          status = params.response.status;
        } else if (method === "Page.javascriptDialogOpening") {
          // An alert would hold the page up for good.
          page("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        }
      });
      const at = (step) => reached.get(current)?.has(step) ?? false;
      const loaded = async () => {
        if (!(await until(() => at("load"), 30000))) throw new Error(`${address} did not finish loading within 30 seconds.`);
        // Data the page fetches once it runs. A page that never stops fetching is taken as it is.
        await until(() => at("networkIdle"), 5000);
      };

      const { userAgent } = await send("Browser.getVersion");
      await page("Emulation.setUserAgentOverride", { userAgent: userAgent.replace("HeadlessChrome", "Chrome"), ...(language ? { acceptLanguage: language } : {}) });
      if (language) await page("Emulation.setLocaleOverride", { locale: language.replaceAll("-", "_") }).catch(() => {});
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: flags.dark ? "dark" : "light" }] });
      if (screen.touch) await page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const resize = (inset) => page("Emulation.setDeviceMetricsOverride", { width, height: height - inset, deviceScaleFactor: screen.scale, mobile: screen.touch, screenWidth: width, screenHeight: height });
      await resize(screen.bar + screen.home);
      if (init) await page("Page.addScriptToEvaluateOnNewDocument", { source: init });

      // A dev server that was started a moment ago may not be listening yet.
      let answer;
      for (const end = Date.now() + 10000; ; await pause(500)) {
        answer = await page("Page.navigate", { url: address });
        if (answer.errorText !== "net::ERR_CONNECTION_REFUSED" || Date.now() > end) break;
      }
      if (answer.errorText === "net::ERR_CONNECTION_REFUSED") throw new Error(`Nothing answers at ${address}. Is the app's dev server running, and is that its address?`);
      if (answer.errorText) throw new Error(`Could not open ${address}: ${answer.errorText}`);
      await until(() => reached.has(answer.loaderId), 5000);
      await loaded();

      // A page that asks for the whole screen keeps clear of the bars by itself, as on a phone.
      let band = screen.bar * screen.scale;
      let foot = screen.home * screen.scale;
      if (band && /viewport-fit\s*=\s*cover/i.test(await evaluate(`document.querySelector('meta[name="viewport" i]')?.content ?? ""`, "Reading the page"))) {
        const whole = await page("Emulation.setSafeAreaInsetsOverride", { insets: { top: screen.bar, topMax: screen.bar, bottom: screen.home, bottomMax: screen.home } }).then(() => true, () => false);
        if (whole) {
          await resize(0);
          band = foot = 0;
          // Once more from the start, so that what the page measures as it loads is what it ends up with.
          await page("Page.reload");
          await pause(200);
          await loaded();
        }
      }

      await evaluate("document.fonts.ready.then(() => 0)", "Loading the fonts");
      if (steps) {
        // A click that leaves the page takes the script's own answer with it, which is no failure.
        await evaluate(`(async () => {\n${steps}\n})()`, "--eval").catch((error) => {
          if (!/context was destroyed|navigated|Cannot find context/i.test(error.message)) throw error;
        });
        await pause(200);
        await loaded();
      }
      await pause(wait * 1000);

      const paper = await evaluate(
        `(() => {
          const theme = [...document.querySelectorAll('meta[name="theme-color"]')].find((meta) => !meta.media || matchMedia(meta.media).matches)?.content;
          const solid = (colour) => colour && colour !== "transparent" && !/, 0\\)$/.test(colour);
          const ground = [document.body, document.documentElement].map((element) => element && getComputedStyle(element).backgroundColor).find(solid) || "#fff";
          return { top: theme || ground, bottom: ground };
        })()`,
        "Reading the page",
      );
      let { data } = await page("Page.captureScreenshot", { format: "png" });
      const pill = screen.pill ? { width: screen.pill * screen.scale, height: 5 * screen.scale, gap: 8 * screen.scale } : null;
      if (band || pill) {
        const easel = (await send("Target.attachToTarget", { targetId: (await send("Target.createTarget", { url: "about:blank" })).targetId, flatten: true })).sessionId;
        const drawn = await send("Runtime.evaluate", { expression: `(${withDeviceBars})(${JSON.stringify({ data, top: band, bottom: foot, paper, pill })})`, awaitPromise: true, returnByValue: true }, easel);
        if (drawn.exceptionDetails) throw new Error(`Could not make room for the status bar: ${drawn.exceptionDetails.exception?.description ?? drawn.exceptionDetails.text}`);
        data = drawn.result.value;
      }
      return { png: Buffer.from(data, "base64"), status, room: band > 0 };
    });
  } catch (error) {
    if (error instanceof Failure) throw error;
    fail(error.message);
  }

  const { name, file } = shotTarget(flags);
  writeFileSync(file, shot.png);
  console.log(`Captured ${address} as ${screen.label} shows it (${width * screen.scale}x${height * screen.scale}) -> ${file}`);
  if (shot.status >= 400) console.log(`  ! The address answered ${shot.status}, so this may be an error page. Open the picture and look.`);
  if (screen.bar) console.log(`  ${shot.room ? "The top is left free for the status bar" : "The page asks for the whole screen and runs under the status bar"}. "device": {"statusBar": "overlay"} in the theme draws one.`);
  return { name, file, device: kind };
}

// ---------------------------------------------------------------- other toolkits

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Dev servers by the package that brings them, each with the port it takes when the project names none. */
const WEB_KITS = [
  ["next", "Next.js", 3000],
  ["nuxt", "Nuxt", 3000],
  ["@sveltejs/kit", "SvelteKit", 5173],
  ["astro", "Astro", 4321],
  ["@remix-run/dev", "Remix", 5173],
  ["@angular/core", "Angular", 4200],
  ["gatsby", "Gatsby", 8000],
  ["react-scripts", "Create React App", 3000],
  ["@vue/cli-service", "Vue CLI", 8080],
  ["vite", "Vite", 5173],
  ["parcel", "Parcel", 1234],
  ["webpack-dev-server", "webpack", 8080],
];

/**
 * What the app in a folder is made with besides Xcode, and the command each toolkit starts it with: in the
 * simulator, in a window on this Mac, or as pages for a browser. It is read off the files a toolkit leaves
 * in a project; nothing is run. <udid> and <simulator> stand for the simulator to start it in.
 */
function toolkits(dir) {
  const has = (...names) => names.some((name) => existsSync(path.join(dir, name)));
  const text = (name) => {
    try {
      return readFileSync(path.join(dir, name), "utf8");
    } catch {
      return "";
    }
  };
  const pkg = readJson(path.join(dir, "package.json"));
  const uses = (name) => Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
  const scripts = pkg?.scripts ?? {};
  const script = (...names) => names.find((name) => typeof scripts[name] === "string");
  const runner = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lock", "bun.lockb") ? "bun run" : "npm run";
  const kit = WEB_KITS.find(([dependency]) => uses(dependency));
  // The script that serves the pages, and the port it says or its dev server takes by itself.
  const pages = () => {
    const name = script("dev", "start", "serve", "develop");
    if (!name) return null;
    const port = scripts[name].match(/(?:--port[= ]|-p |\bPORT=)(\d{2,5})/)?.[1] ?? kit?.[2];
    return { command: `${runner} ${name}`, address: port ? `http://localhost:${port}` : null };
  };
  const found = [];

  if (/\bsdk:\s*flutter\b/.test(text("pubspec.yaml"))) {
    const web = !has("ios") && !has("macos") && has("web") ? { command: "flutter run -d web-server --web-port 8080", address: "http://localhost:8080" } : null;
    const app = text("macos/Runner/Configs/AppInfo.xcconfig").match(/^PRODUCT_NAME\s*=\s*(.+)$/m)?.[1].trim();
    found.push({ name: "Flutter", sign: "pubspec.yaml", simulator: has("ios") ? "flutter run -d <udid>" : null, window: has("macos") ? { command: "flutter run -d macos", app, built: true } : null, web });
  }
  // With a native project of its own Expo builds the app; without one it opens in Expo Go.
  if (uses("expo")) found.push({ name: "Expo", sign: "package.json", simulator: has("ios") ? "npx expo run:ios --device <udid>" : "npx expo start --ios" });
  else if (uses("react-native")) found.push({ name: "React Native", sign: "package.json", simulator: "npx react-native run-ios --udid <udid>" });

  const capacitor = ["capacitor.config.ts", "capacitor.config.js", "capacitor.config.json"].find((name) => has(name));
  if (capacitor || uses("@capacitor/core")) {
    // The app is the built pages inside a native shell, so they are built before the shell is.
    const simulator = has("ios") ? `${script("build") ? `${runner} build && ` : ""}npx cap run ios --target <udid>` : null;
    found.push({ name: "Capacitor", sign: capacitor ?? "package.json", simulator, web: pages() });
  }

  const tauri = ["src-tauri/tauri.conf.json", "src-tauri/tauri.conf.json5", "src-tauri/Tauri.toml"].find((name) => has(name));
  if (tauri || uses("@tauri-apps/cli")) {
    const cli = script("tauri") ? `${runner} tauri` : uses("@tauri-apps/cli") ? "npx tauri" : "cargo tauri";
    // Run from source, the window belongs to the program Cargo built, which has the package's name.
    const program = text("src-tauri/Cargo.toml").match(/^\[package\][^[]*?^name\s*=\s*"([^"]+)"/ms)?.[1];
    found.push({ name: "Tauri", sign: tauri ?? "package.json", simulator: has("src-tauri/gen/apple") ? `${cli} ios dev "<simulator>"` : null, window: { command: `${cli} dev`, app: program } });
  }
  if (uses("electron")) {
    const name = script("dev", "start");
    found.push({ name: "Electron", sign: "package.json", window: { command: name ? `${runner} ${name}` : "npx electron .", app: "Electron" } });
  }

  // A server that renders the pages goes before the bundler that only builds their styles and scripts.
  const assets = pkg && script("dev") ? `, with '${runner} dev' beside it for the styles and scripts` : "";
  if (has("manage.py")) found.push({ name: "Django", sign: "manage.py", web: { command: "python manage.py runserver", address: "http://localhost:8000" } });
  if (has("bin/rails") && has("config/routes.rb")) found.push({ name: "Rails", sign: "bin/rails", web: { command: has("bin/dev") ? "bin/dev" : "bin/rails server", address: "http://localhost:3000" } });
  if (has("artisan")) found.push({ name: "Laravel", sign: "artisan", web: { command: "php artisan serve", address: "http://localhost:8000", note: assets } });
  if (/:phoenix\b/.test(text("mix.exs"))) found.push({ name: "Phoenix", sign: "mix.exs", web: { command: "mix phx.server", address: "http://localhost:4000" } });

  if (pkg && found.length === 0) {
    const web = pages();
    // A package with a start script may serve pages or may not; `unsure` keeps that apart from a known dev server.
    if (web) found.push({ name: kit?.[1] ?? "Node.js", sign: "package.json", web, unsure: !kit });
  }
  if (found.length === 0 && /\.executable(Target)?\(/.test(text("Package.swift")) && xcodeProjects([dir]).length === 0) {
    found.push({ name: "Swift Package Manager", sign: "Package.swift", window: { command: "swift run" } });
  }
  if (found.length === 0 && has("index.html")) found.push({ name: "plain HTML", sign: "index.html", web: { address: "index.html" } });
  return found;
}

/** Folders below this one that hold an app, for a repository that keeps several side by side. */
function appFolders(dir) {
  const below = (folder) => {
    try {
      return readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
        .map((entry) => path.join(folder, entry.name));
    } catch {
      return [];
    }
  };
  return [...below(dir), ...["apps", "packages"].flatMap((name) => below(path.join(dir, name)))]
    .map((folder) => {
      const kits = toolkits(folder).filter((kit) => !kit.unsure);
      const made = kits.length > 0 ? kits.map((kit) => kit.name) : xcodeProjects([folder]).length > 0 ? ["Xcode"] : [];
      return { folder: path.relative(dir, folder), made };
    })
    .filter((entry) => entry.made.length > 0);
}

/** What 'appshots check' says about one toolkit: a line for each place its app runs in, the commands in order. */
function toolkitLines(kit, simulator, xcode) {
  const lines = [];
  if (kit.simulator) {
    const command = kit.simulator.replaceAll("<udid>", simulator?.udid ?? "<udid>").replaceAll("<simulator>", simulator?.name ?? "<simulator>");
    const first = simulator?.booted ? "" : simulator ? "'appshots boot', then " : xcode ? "'appshots boot', which prints the udid, then " : "once Xcode is installed, 'appshots boot', which prints the udid, then ";
    lines.push(`  In the simulator: ${first}'${command}' in the background, then 'appshots capture --clean --name <name>'`);
  }
  if (kit.window) {
    const named = !kit.window.app ? "The window goes by the name of the program that opens it" : kit.window.built ? `Its window goes by "${kit.window.app}"` : `Its window goes by "${kit.window.app}" while it runs from source`;
    lines.push(`  In a window on this Mac: '${kit.window.command}' in the background, then 'appshots capture --mac ${kit.window.app ? `"${kit.window.app}"` : "<app>"} --name <name>'. ${named}; 'appshots capture --mac' alone lists the windows that are open.`);
  }
  if (kit.web?.command) {
    const { command, address, note = "" } = kit.web;
    const where = address ? `usually at ${address}; it prints the address it took` : "read the address off what it prints";
    lines.push(`  In a browser${kit.unsure ? ", if it serves pages" : ""}: '${command}' in the background${note} (${where}), then 'appshots capture --web ${address ?? "<address>"} --name <name>'`);
  } else if (kit.web) {
    lines.push(`  In a browser: 'appshots capture --web ${kit.web.address} --name <name>' opens the file as it is`);
  }
  return lines;
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

const SIM_KINDS = {
  iphone: { label: "iPhone", flag: "", family: "iPhone", store: "iPhone Pro Max", wanted: [/Pro Max/, /Plus/] },
  duo: { label: "iPhone Duo", flag: " --duo", family: "iPhone", store: "iPhone Duo", wanted: [/Duo/] },
  ipad: { label: "iPad", flag: " --ipad", family: "iPad", store: "13-inch iPad Pro", wanted: [/^iPad Pro 13-inch/, /13-inch|12\.9-inch/, /^iPad Pro/] },
};
const simKind = (flags) => (flags.duo ? "duo" : flags.ipad ? "ipad" : "iphone");

/**
 * The simulator 'appshots run' uses when none is named: the Pro Max, which is the 6.9-inch size the store
 * asks for, the iPhone Duo, or the 13-inch iPad Pro, on the newest iOS and of the newest model. Null when
 * there is no simulator of that kind at all; `fallback` says that another model had to do.
 */
function recommendedSimulator(simulators, kind) {
  const { wanted, family } = SIM_KINDS[kind];
  const rank = (sim) => {
    const at = wanted.findIndex((pattern) => pattern.test(sim.model));
    return at === -1 ? wanted.length : at;
  };
  // The 18 in "iPhone 18 Pro Max", the 5 in "iPad Pro 13-inch (M5)".
  const number = (sim) => Number(sim.model.replace(/[\d.]+-inch/, "").match(/\d+/)?.[0] ?? 0);
  const [best] = simulators
    // The Duo is an iPhone by family but never stands in for one, and nothing stands in for it.
    .filter((sim) => sim.family === family && /Duo/.test(sim.model) === (kind === "duo"))
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

function runSimulator(flags) {
  const simulators = availableSimulators();
  if (typeof flags.sim === "string") return choose(simulators, flags.sim, "simulator", "--sim");
  if (flags.duo && flags.ipad) fail("Use --duo or --ipad, not both.");
  const simulator = recommendedSimulator(simulators, simKind(flags));
  if (!simulator) fail(`No ${SIM_KINDS[simKind(flags)].label} simulator is installed. Add an iOS simulator in Xcode under Settings > Components.`);
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

// This folder, or where a toolkit keeps the Xcode project it wraps: ./ios for React Native and Flutter,
// ./ios/App for Capacitor, ./iosApp for Kotlin Multiplatform.
const projectDirs = () => [".", "ios", "ios/App", "iosApp"].map((dir) => path.join(process.cwd(), dir));
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
  if (typeof given === "string") fail(`No Xcode workspace or project in ${given}. For run, --project is the workspace or project to build; the project a screenshot goes to is --to <project>.`);
  const kits = toolkits(process.cwd()).filter((kit) => !kit.unsure);
  fail(
    kits.length > 0
      ? `No Xcode workspace or project here: this app is made with ${kits.map((kit) => kit.name).join(" and ")}, and 'appshots run' builds Xcode projects only. Start it with its own command and capture it where it runs. 'appshots check' gives the commands.`
      : "No Xcode workspace or project in this folder or in ./ios. Run this in your app's folder, or point at it with --project <path>. An app made with something else is started by its own command; 'appshots check' says how.",
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
    // What Xcode offers instead of the simulator it was asked for says what kind of app this is.
    const offered = text.split("Available destinations")[1] ?? "";
    if (/platform:macOS/.test(offered) && !/platform:iOS/.test(offered)) {
      fail(`${scheme} is a Mac app, and a Mac app runs on this Mac, not in a simulator. Build and open it, then capture its window:\n  xcodebuild -scheme ${scheme} -configuration Debug -derivedDataPath build build\n  open build/Build/Products/Debug/*.app\n  appshots capture --mac <the app's name> --name <name> --project <id>`);
    }
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
  const lang = shotLanguage(flags);
  if (flags.capture !== undefined && typeof flags.capture !== "string") fail("--capture needs the name of the screenshot, as in: --capture stats");
  if (flags.to !== undefined && typeof flags.to !== "string") fail("--to needs the id of a project. 'appshots projects' lists them.");
  if (flags.to && !flags.capture) fail("--to says where a screenshot goes, so it needs --capture <name> as well.");
  const wait = flags.wait === undefined ? 2 : typeof flags.wait === "string" ? Number(flags.wait) : NaN;
  if (!(wait >= 0 && wait <= 600)) fail("--wait needs a number of seconds, as in: --wait 5");
  const language = lang ? ["-AppleLanguages", `(${lang})`, "-AppleLocale", lang.replaceAll("-", "_")] : [];
  return {
    appearance: flags.dark ? "dark" : flags.light ? "light" : null,
    launchArguments: [...launchArguments, ...language],
    capture: flags.capture,
    wait,
    out: flags.out,
    to: flags.to,
    device: shotDevice(flags),
    language: lang,
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
  if (plan.config) await upload(plan.config, plan.to, shot.file, shot.name, plan.device, plan.language);
  console.log(`Next: appshots launch ${bundleId} --capture <name> --to ${plan.to ?? "<project>"}${which} -- <launch arguments>`);
}

async function run(flags, launchArguments) {
  const plan = launchPlan(flags, launchArguments);
  if (plan.config) await hasLanguage(plan.config, plan.to, plan.language);
  const project = findXcodeProject(flags.project);
  const scheme = pickScheme(project, flags.scheme);
  const simulator = runSimulator(flags);
  const note = simulator.fallback ? `. No ${SIM_KINDS[simKind(flags)].store} is installed, which is the size the store asks for` : "";
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
  if (plan.config) await hasLanguage(plan.config, plan.to, plan.language);
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

/** The device a screenshot is filed under when --as, --duo or --mac says so. Left out, the server tells from the size. */
function shotDevice(flags) {
  const device = typeof flags.as === "string" ? flags.as.toLowerCase() : flags.as === undefined ? (flags.duo ? "duo" : flags.mac ? "mac" : undefined) : "";
  if (device !== undefined && !["iphone", "duo", "ipad", "mac"].includes(device)) fail("--as needs iphone, duo, ipad or mac.");
  return device;
}

/** The language a screenshot shows the app in, from --lang. Left out, it is for the project's first language. */
function shotLanguage(flags) {
  if (flags.lang !== undefined && (typeof flags.lang !== "string" || !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(flags.lang))) fail("--lang needs a language code, such as de or pt-BR.");
  return flags.lang;
}

/** Says that a project has no such language before anything slow starts, and not after it. The server decides the same way. */
async function hasLanguage(config, project, language) {
  if (!language) return;
  const { locales } = (await (await request(config, "GET", `/api/projects/${project}`)).json()).project;
  const bare = (code) => code.toLowerCase().split("-")[0];
  if (locales.some((code) => code.toLowerCase() === language.toLowerCase() || bare(code) === language.toLowerCase() || code.toLowerCase() === bare(language))) return;
  fail(`Project ${project} has no language "${language}". Its languages are ${locales.join(", ")}. Add it first: in the Studio under Languages, or with the update_project tool.`);
}

async function upload(config, project, file, name, device, language) {
  const query = new URLSearchParams({ ...(device ? { device } : {}), ...(language ? { locale: language } : {}) }).toString();
  const response = await request(config, "PUT", `/api/projects/${project}/shots/${name}${query ? `?${query}` : ""}`, {
    body: readFileSync(file),
    headers: { "content-type": "application/octet-stream" },
  });
  const shot = await response.json();
  console.log(`Uploaded ${shot.name} (${[shot.device, shot.locale, `${shot.width}x${shot.height}`].filter(Boolean).join(", ")}) to ${project}`);
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
  // The server tells an iPhone, an iPhone Duo and an iPad screenshot apart, so one name can stand for one of each.
  const device = shotDevice(flags);
  const language = shotLanguage(flags);
  const sent = new Map();
  for (const file of files) {
    const shot = await upload(config, project, file, slugify(typeof flags.name === "string" ? flags.name : path.parse(file).name), device, language);
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
  if (flags.web) fail("'appshots shoot' captures what a person has opened, and a web page is drawn without a window. Take each page by its address: appshots capture --web <address> --name <name> --project <project>");
  const config = loadConfig();
  const device = shotDevice(flags);
  const language = shotLanguage(flags);
  await hasLanguage(config, project, language);
  if (!language) await request(config, "GET", `/api/projects/${project}`);
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
    await upload(config, project, shot.file, shot.name, device, language);
    taken.push(shot.name);
  }
  process.stdin.setRawMode(false);
  process.stdin.pause();
  console.log(taken.length > 0 ? `Taken ${taken.length} of ${names.length} for ${project}: ${taken.join(", ")}` : `Nothing taken for ${project}.`);
  if (skipped.length > 0) console.log(`Skipped: ${skipped.join(", ")}`);
  if (at < names.length) console.log(`Stopped before: ${names.slice(at).join(", ")}`);
}
/** Downloads the rendered set as the server zips it and unpacks it into a folder. */
async function fetchExport(config, project, outDir, render) {
  const response = await request(config, "GET", `/api/projects/${project}/export.zip${render ? "?render=1" : ""}`);
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
}

async function pull(config, project, flags) {
  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : path.join("store-screenshots", project));
  await fetchExport(config, project, outDir, flags.render);
  console.log(`Screenshots are in ${outDir}`);
}

/** The flags of `mockups` that say how the device is drawn, and the setting each one is on the server. */
const MOCKUP_FLAGS = { frame: "frame", style: "style", color: "color", shadow: "shadow", rotate: "rotate", perspective: "perspective", "status-bar": "statusBar", time: "statusBarTime" };

async function mockups(config, project, flags) {
  const device = {};
  for (const [flag, field] of Object.entries(MOCKUP_FLAGS)) {
    if (flags[flag] === true) fail(`--${flag} needs a value.`);
    if (flags[flag] !== undefined) device[field] = field === "rotate" ? Number(flags[flag]) : flags[flag];
  }
  if (flags.width === true) fail("--width needs a number of pixels, or auto.");
  // What is set here is saved with the project, laid over what it had. The server says what it does not take.
  if (Object.keys(device).length || flags.width !== undefined) {
    const { project: current } = await (await request(config, "GET", `/api/projects/${project}`)).json();
    const next = { ...current.mockups, device: { ...current.mockups?.device, ...device } };
    if (flags.width === "auto") delete next.width;
    else if (flags.width !== undefined) next.width = Number(flags.width);
    await request(config, "PUT", `/api/projects/${project}`, { body: JSON.stringify({ mockups: next }), headers: { "content-type": "application/json" } });
  }

  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : path.join("mockups", project));
  const language = shotLanguage(flags);
  const response = await request(config, "GET", `/api/projects/${project}/mockups.zip${language ? `?locale=${encodeURIComponent(language)}` : ""}`);
  const dir = mkdtempSync(path.join(tmpdir(), "appshots-"));
  const zip = path.join(dir, "mockups.zip");
  try {
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    mkdirSync(outDir, { recursive: true });
    const result = spawnSync("unzip", ["-o", "-q", zip, "-d", outDir], { encoding: "utf8" });
    if (result.status !== 0) fail(`Could not unpack the download: ${(result.stderr || result.error?.message || "").trim()}`);
    const listed = spawnSync("unzip", ["-Z1", zip], { encoding: "utf8" });
    const count = listed.status === 0 ? listed.stdout.split("\n").filter((name) => name.endsWith(".png")).length : 0;
    console.log(`${count ? `${count} mockup${count === 1 ? " is" : "s are"}` : "The mockups are"} in ${outDir}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

/** JSON handed over on the command line: inline, as @file.json, or as - for what comes in on stdin. */
function jsonInput(source, what) {
  if (source === "-") {
    source = readFileSync(0, "utf8");
  } else if (source.startsWith("@")) {
    if (!existsSync(source.slice(1))) fail(`No such file: ${source.slice(1)}`);
    source = readFileSync(source.slice(1), "utf8");
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${what} not valid JSON: ${error.message}`);
  }
}

async function call(config, name, input, flags) {
  if (!name) fail("Usage: appshots call <tool> ['<arguments as JSON>' | @file.json | -]");
  const args = jsonInput(input ?? "{}", "The arguments are");
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

// ---------------------------------------------------------------- App Store Connect

// A finished set goes into App Store Connect from this Mac, with an API key of the user's own. The key file is
// read here to sign a token that lasts ten minutes, and that token goes to Apple alone: the appShots server
// never sees the key, the token, or where the key is. Nothing here submits a version for review or releases
// one, and a key with the role Marketing, which is all this needs, could not.

/** The issuer ID, the key ID and the path of the key file, as `store login` saves them. Never the key. */
const STORE_FILE = path.join(path.dirname(CONFIG_FILE), "app-store-connect.json");
// A stand-in for Apple's server on this machine can take its place, so the flow can be exercised without an
// account. Nothing else can, so the token is never sent to another host.
const STORE_API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.APPSHOTS_STORE_API ?? "") ? process.env.APPSHOTS_STORE_API : "https://api.appstoreconnect.apple.com";

/**
 * The display of App Store Connect each folder of an export goes onto, as the API names it, and the size the
 * pictures of that folder have. The names are a generation behind: APP_IPHONE_67 is the 6.9-inch display,
 * APP_IPHONE_61 the 6.3-inch one and APP_IPHONE_58 the 6.1-inch one. The Mac has one display for its four
 * sizes, so the largest folder there is goes onto it.
 */
const STORE_DISPLAYS = {
  "iphone-6.9": ["APP_IPHONE_67", 1320, 2868],
  "iphone-6.3": ["APP_IPHONE_61", 1206, 2622],
  "iphone-6.5": ["APP_IPHONE_65", 1284, 2778],
  "iphone-6.1": ["APP_IPHONE_58", 1170, 2532],
  "iphone-5.5": ["APP_IPHONE_55", 1242, 2208],
  "iphone-4.7": ["APP_IPHONE_47", 750, 1334],
  "iphone-4": ["APP_IPHONE_40", 640, 1136],
  "iphone-3.5": ["APP_IPHONE_35", 640, 960],
  "ipad-13": ["APP_IPAD_PRO_3GEN_129", 2064, 2752],
  "ipad-11": ["APP_IPAD_PRO_3GEN_11", 1668, 2420],
  "ipad-12.9": ["APP_IPAD_PRO_129", 2048, 2732],
  "ipad-10.5": ["APP_IPAD_105", 1668, 2224],
  "ipad-9.7": ["APP_IPAD_97", 1536, 2048],
  "mac-2880": ["APP_DESKTOP", 2880, 1800],
  "mac-2560": ["APP_DESKTOP", 2560, 1600],
  "mac-1440": ["APP_DESKTOP", 1440, 900],
  "mac-1280": ["APP_DESKTOP", 1280, 800],
};
/** Folders whose display the API does not have yet. Their files go into App Store Connect by hand. */
const STORE_BY_HAND = { "iphone-duo": "iPhone Duo", "iphone-duo-cover": "iPhone Duo" };
const STORE_PLATFORMS = { IOS: "iOS", MAC_OS: "macOS" };
const platformOf = (display) => (display === "APP_DESKTOP" ? "MAC_OS" : "IOS");
/** The states in which the page of a version can still be changed. */
const STORE_OPEN = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY", "READY_FOR_REVIEW"]);
/** The texts of a store page and how many characters each may have. The first two belong to the app, the rest to a version. */
const STORE_TEXTS = { name: 30, subtitle: 30, description: 4000, keywords: 100, promotionalText: 170, whatsNew: 4000, supportUrl: 0, marketingUrl: 0 };
const APP_TEXTS = ["name", "subtitle"];

const STORE_HOWTO = `All three come from App Store Connect, under Users and Access > Integrations > App Store Connect API > Team Keys:
the issuer ID is above the list of keys, the key ID is beside the key, and the .p8 file is the download offered
once when the key is made. Give the key the role Marketing: it can then make a version and change screenshots
and texts, and it cannot submit or release anything.`;

/** The three settings, from the flags, the environment, or what `store login` saved. */
function storeSettings(flags) {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(STORE_FILE, "utf8"));
  } catch {}
  const pick = (flag, variable, key) => {
    if (flags[flag] === true) fail(`--${flag} needs ${flag === "key" ? "the path of the .p8 file" : "a value"} after it.`);
    return String(flags[flag] ?? process.env[variable] ?? saved[key] ?? "").trim();
  };
  return { issuerId: pick("issuer", "ASC_ISSUER_ID", "issuerId"), keyId: pick("key-id", "ASC_KEY_ID", "keyId"), keyFile: pick("key", "ASC_KEY_PATH", "keyFile") };
}

/** Reads the key so that it can sign, and says what is wrong in words a person can act on. Never prints any of it. */
function storeKey({ issuerId, keyId, keyFile }) {
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(keyFile)) fail("--key takes the path of the .p8 file, not what is in it. The key is never pasted anywhere.");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(issuerId)) fail(`"${issuerId}" is not an issuer ID. It is the long code with dashes above the list of keys in App Store Connect.`);
  if (!/^[A-Z0-9]{6,20}$/i.test(keyId)) fail(`"${keyId}" is not a key ID. It is the short code beside the key in App Store Connect, such as 2X9R4HXF34.`);
  // Without a path, the key is looked for where Apple's own tools look for it.
  const folders = [path.resolve("private_keys"), path.join(homedir(), "private_keys"), path.join(homedir(), ".private_keys"), path.join(homedir(), ".appstoreconnect", "private_keys")];
  const file = keyFile ? path.resolve(keyFile.replace(/^~(?=\/|$)/, homedir())) : folders.map((dir) => path.join(dir, `AuthKey_${keyId}.p8`)).find(existsSync);
  if (!file) fail(`Where is the key? Give the path of the .p8 file with --key, or put it into ~/.appstoreconnect/private_keys as AuthKey_${keyId}.p8.`);
  if (!existsSync(file) || !statSync(file).isFile()) fail(`There is no key file at ${file}. Run 'appshots store login' with --key <path to the .p8 file>.`);
  let key;
  try {
    key = createPrivateKey(readFileSync(file));
  } catch {
    fail(`${file} is not a private key. It has to be the .p8 file from App Store Connect, as it was downloaded.`);
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") fail(`${file} is not an App Store Connect key.`);
  return { issuerId, keyId, file, key };
}

function storeAccount(flags) {
  const settings = storeSettings(flags);
  if (!settings.issuerId || !settings.keyId) fail(`No App Store Connect key is set up on this Mac. Run: appshots store login --issuer <issuer id> --key-id <key id> --key <path to the .p8 file>\n${STORE_HOWTO}`);
  return storeKey(settings);
}

/** The App Store Connect line of 'appshots check'. It looks at what is saved and asks Apple nothing. */
function storeStatus() {
  const settings = storeSettings({});
  if (!settings.issuerId && !settings.keyId) return "no key set up. It is only needed to put a finished set there: 'appshots store login'";
  const { value, problem } = attempt(() => storeKey(settings));
  return problem ?? `key ${value.keyId} (${tilde(value.file)}). 'appshots store push <project> --app <bundle id>' puts a finished set there`;
}

const storeToken = { value: "", until: 0 };

/** A token Apple takes for ten minutes, signed with the key. A long upload gets a new one in time. */
function appleToken(account) {
  const now = Math.floor(Date.now() / 1000);
  if (storeToken.until - now > 120) return storeToken.value;
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = `${part({ alg: "ES256", kid: account.keyId, typ: "JWT" })}.${part({ iss: account.issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
  storeToken.value = `${head}.${sign("sha256", Buffer.from(head), { key: account.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  storeToken.until = now + 600;
  return storeToken.value;
}

/** One call to the App Store Connect API. `what` finishes the sentence "App Store Connect could not ...". */
async function apple(account, method, route, what, body) {
  for (let tries = 1; ; tries++) {
    let response;
    try {
      response = await fetch(STORE_API + route, {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: { authorization: `Bearer ${appleToken(account)}`, ...(body ? { "content-type": "application/json" } : {}) },
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      // Asking again is safe. A change that may have arrived is not sent a second time.
      if (method === "GET" && tries < 3) continue;
      fail(`Cannot reach App Store Connect: ${error.cause?.message ?? error.message}`);
    }
    // Too many requests means this one was not looked at, so it can go again after a pause.
    if ((response.status === 429 || (response.status >= 500 && method === "GET")) && tries < 4) {
      await pause(tries * 3000);
      continue;
    }
    const text = await response.text();
    let reply = null;
    try {
      reply = text ? JSON.parse(text) : null;
    } catch {}
    if (response.ok) return reply;
    const detail = [...new Set((reply?.errors ?? []).map((error) => error.detail || error.title).filter(Boolean))].join(" ") || `It answered ${response.status}.`;
    if (response.status === 401) fail(`App Store Connect did not accept the key. ${detail} Check the issuer ID and the key ID, and that the key has not been revoked, then run 'appshots store login' again.`);
    if (response.status === 403) fail(`App Store Connect does not let this key ${what}. ${detail} A key keeps the role it was made with, and this needs Marketing or App Manager.`);
    fail(`App Store Connect could not ${what}. ${detail}`);
  }
}

/** Every item of a list, however many pages Apple splits it into. */
async function appleList(account, route, what) {
  const items = [];
  for (let next = route; next; ) {
    const page = await apple(account, "GET", next, what);
    items.push(...(page?.data ?? []));
    // The link to the next page is followed only while it stays with the same server, because the token goes along.
    next = page?.links?.next?.startsWith(`${STORE_API}/`) ? page.links.next.slice(STORE_API.length) : null;
  }
  return items;
}

async function storeApps(account) {
  const apps = await appleList(account, "/v1/apps?limit=200", "list the apps");
  return apps.map((app) => ({ id: app.id, name: app.attributes?.name ?? "", bundleId: app.attributes?.bundleId ?? "" })).sort((a, b) => a.name.localeCompare(b.name));
}

const appLines = (apps) => apps.map((app) => `  ${app.bundleId.padEnd(Math.max(...apps.map((each) => each.bundleId.length)))}  ${app.name}`).join("\n");

/** The app --app names by its bundle id, its name or its Apple ID. Left out, it is the only one the key reaches. */
async function storeApp(account, query) {
  const apps = await storeApps(account);
  if (apps.length === 0) fail("This key reaches no app. A key sees the apps of its own team: is it that team's?");
  if (typeof query !== "string") {
    if (apps.length === 1) return apps[0];
    fail(`Which app? Name it with --app <bundle id>:\n${appLines(apps)}`);
  }
  const wanted = query.toLowerCase();
  const found = apps.filter((app) => app.bundleId.toLowerCase() === wanted || app.id === query || app.name.toLowerCase() === wanted);
  if (found.length === 1) return found[0];
  fail(`${found.length > 1 ? "Several apps are" : "No app is"} "${query}" for this key. It reaches:\n${appLines(apps)}`);
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Whether a file sits in a Git repository that would take it along in a commit. */
function couldBeCommitted(file) {
  const git = (args) => spawnSync("git", ["-C", path.dirname(file), ...args], { encoding: "utf8" });
  return git(["rev-parse", "--is-inside-work-tree"]).stdout?.trim() === "true" && git(["check-ignore", "-q", file]).status === 1;
}

async function storeLogin(flags) {
  const settings = storeSettings(flags);
  if (!settings.issuerId || !settings.keyId) {
    // A person at the Terminal is asked for what is missing. None of the three is a secret, and the key itself is never asked for.
    if (!process.stdin.isTTY) fail(`Usage: appshots store login --issuer <issuer id> --key-id <key id> --key <path to the .p8 file>\n${STORE_HOWTO}`);
    console.log(`${STORE_HOWTO}\n`);
    settings.issuerId ||= await promptLine("Issuer ID: ");
    settings.keyId ||= await promptLine("Key ID: ");
    settings.keyFile ||= await promptLine("Path to the .p8 file (empty to look in ~/.appstoreconnect/private_keys): ");
  }
  const account = storeKey(settings);
  const apps = await storeApps(account);
  mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  writeFileSync(STORE_FILE, `${JSON.stringify({ issuerId: account.issuerId, keyId: account.keyId, keyFile: account.file }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STORE_FILE, 0o600);
  console.log(`App Store Connect accepted key ${account.keyId}. Its ID, the issuer ID and where it is are saved in ${tilde(STORE_FILE)}.`);
  console.log(`The key itself stays in ${tilde(account.file)}. It signs in to Apple from this Mac and goes nowhere else.`);
  if (couldBeCommitted(account.file)) console.log("  ! That is inside a Git repository, where it could end up in a commit. Move it out, to ~/.appstoreconnect/private_keys for one, and run this again.");
  console.log(apps.length > 0 ? `It reaches ${apps.length === 1 ? "one app" : `${apps.length} apps`}:\n${appLines(apps)}` : "It reaches no app yet.");
  console.log("Next: appshots store push <project> --app <bundle id> --dry-run");
}

const versionState = (version) => version.attributes?.appVersionState ?? version.attributes?.appStoreState ?? "UNKNOWN";
const plainState = (state) => ({ PREPARE_FOR_SUBMISSION: "being prepared", READY_FOR_DISTRIBUTION: "on the App Store", READY_FOR_SALE: "on the App Store" })[state] ?? state.toLowerCase().replaceAll("_", " ");

/** The versions of an app on one platform, the newest first. */
async function storeVersions(account, app, platform) {
  const versions = await appleList(account, `/v1/apps/${app.id}/appStoreVersions?filter[platform]=${platform}&limit=200`, `list the versions of ${app.name}`);
  return versions.sort((a, b) => String(b.attributes?.createdDate ?? "").localeCompare(String(a.attributes?.createdDate ?? "")));
}

/**
 * The version whose page gets changed: the one being prepared, or with --version a new one. App Store Connect
 * holds one such version per platform. Nothing is created here: a version that has to be comes back without an id,
 * and with the one before it, whose languages, texts and screenshots Apple carries over into the new one.
 */
async function storeVersion(account, app, platform, flags) {
  if (flags.version === true) fail("--version needs a number, such as --version 1.3.");
  const wanted = typeof flags.version === "string" ? flags.version.trim() : "";
  const system = STORE_PLATFORMS[platform];
  const versions = await storeVersions(account, app, platform);
  // Naming a version for a platform the app does not have would add that platform to the app.
  if (versions.length === 0) fail(`${app.name} has no ${system} version in App Store Connect. ${platform === "MAC_OS" ? "Mac screenshots go onto the macOS version of an app: add that platform there first, or leave them out with --only iphone,ipad." : "Add that platform there first, or leave its screenshots out with --only mac."}`);
  const open = versions.find((version) => STORE_OPEN.has(versionState(version)));
  const named = wanted ? versions.find((version) => version.attributes.versionString === wanted) : null;
  const say = (version) => `${version.attributes.versionString} (${plainState(versionState(version))})`;
  if (named && named !== open) fail(`Version ${say(named)} of ${app.name} for ${system} can no longer be changed. ${open ? `The one being prepared is ${open.attributes.versionString}: leave out --version to use it.` : "Name a new one with --version."}`);
  if (open && (named || !wanted)) return { id: open.id, number: open.attributes.versionString, platform };
  if (open) fail(`Version ${open.attributes.versionString} of ${app.name} for ${system} is being prepared already, and App Store Connect holds one at a time. Leave out --version to use it, or rename it there first.`);
  if (!wanted) fail(`No version of ${app.name} for ${system} is being prepared: the latest is ${say(versions[0])}. Name the next one and it is created: --version <number>`);
  if (!/^\d+(\.\d+){0,2}$/.test(wanted)) fail(`"${wanted}" is not a version number. App Store Connect takes up to three numbers with dots between them, such as 1.3 or 2.0.1.`);
  return { id: null, number: wanted, platform, before: versions[0].id };
}

async function createVersion(account, app, version) {
  const body = { data: { type: "appStoreVersions", attributes: { platform: version.platform, versionString: version.number }, relationships: { app: { data: { type: "apps", id: app.id } } } } };
  version.id = (await apple(account, "POST", "/v1/appStoreVersions", `create version ${version.number}`, body)).data.id;
  console.log(`Created version ${version.number} of ${app.name} for ${STORE_PLATFORMS[version.platform]}.`);
}

/** The languages a version's store page has. For a version a dry run would create, the ones it would start with. */
const versionLanguages = (account, version) => appleList(account, `/v1/appStoreVersions/${version.id ?? version.before}/appStoreVersionLocalizations?limit=200`, `list the languages of version ${version.number}`);

const addLanguage = async (account, version, locale, texts = {}) =>
  (await apple(account, "POST", "/v1/appStoreVersionLocalizations", `add the language ${locale}`, { data: { type: "appStoreVersionLocalizations", attributes: { locale, ...texts }, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } })).data;

/** Whether two codes mean one language: the same code, or the same language where one of them names no region. */
const sameLanguage = (a, b) => a.toLowerCase() === b.toLowerCase() || ((!a.includes("-") || !b.includes("-")) && a.toLowerCase().split("-")[0] === b.toLowerCase().split("-")[0]);

/** The language of the store page a folder or a text is for: the same code, or the only one that can be meant. */
function storeLocale(code, listed) {
  const exact = listed.find((entry) => entry.toLowerCase() === code.toLowerCase());
  if (exact) return exact;
  const close = listed.filter((entry) => sameLanguage(entry, code));
  return close.length === 1 ? close[0] : null;
}

function listFlag(flags, name, example) {
  if (flags[name] === undefined) return null;
  if (typeof flags[name] !== "string") fail(`--${name} needs a value, such as --${name} ${example}.`);
  return flags[name].split(",").map((part) => part.trim()).filter(Boolean);
}

/**
 * What a folder of 'appshots pull' holds for the store: per language, the files of each folder that has a display
 * in App Store Connect, in the order of their names. Banners and the header and search results images are not
 * screenshots, so they are not among them.
 */
function exportSets(root, flags) {
  const folders = (dir) => readdirSync(dir).filter((name) => !name.startsWith(".") && statSync(path.join(dir, name)).isDirectory());
  const order = Object.keys(STORE_DISPLAYS);
  const languages = listFlag(flags, "lang", "de-DE,fr-FR");
  const only = listFlag(flags, "only", "iphone,ipad");
  for (const part of only ?? []) {
    if (part in STORE_BY_HAND || part === "duo") fail(`App Store Connect's API has no display for the ${STORE_BY_HAND["iphone-duo"]} yet, so its screenshots go in by hand.`);
    if (!["iphone", "ipad", "mac"].includes(part) && !(part in STORE_DISPLAYS)) fail(`--only takes iphone, ipad, mac, or folders of the export: ${order.join(", ")}.`);
  }
  const sets = [];
  const byHand = new Set();
  let creatives = false;
  const found = folders(root).sort();
  for (const locale of found) {
    if (languages && !languages.some((code) => sameLanguage(code, locale))) continue;
    const taken = new Set();
    for (const target of folders(path.join(root, locale)).sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      if (target === "creative-assets") creatives = true;
      if (target in STORE_BY_HAND && !only) byHand.add(target);
      const [display, width, height] = STORE_DISPLAYS[target] ?? [];
      if (!display || taken.has(display) || (only && !only.some((part) => target === part || target.startsWith(`${part}-`)))) continue;
      const dir = path.join(root, locale, target);
      const files = readdirSync(dir)
        .filter((name) => /\.(png|jpe?g)$/i.test(name) && !name.startsWith("."))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((name) => path.join(dir, name));
      if (files.length === 0) continue;
      if (files.length > 10) fail(`${dir} holds ${files.length} screenshots, and App Store Connect takes ten per display.`);
      // A picture of another size would be refused by Apple after the ones it replaces are gone, so it is caught here.
      for (const file of files) {
        const head = readFileSync(file).subarray(0, 24);
        const png = head.length === 24 && head.readUInt32BE(0) === 0x89504e47;
        if (png && (head.readUInt32BE(16) !== width || head.readUInt32BE(20) !== height)) fail(`${file} is ${head.readUInt32BE(16)} x ${head.readUInt32BE(20)}, and the pictures of ${target} are ${width} x ${height}. Nothing was changed.`);
      }
      taken.add(display);
      sets.push({ locale, target, display, files });
    }
  }
  const missing = (languages ?? []).filter((code) => !found.some((locale) => sameLanguage(code, locale)));
  if (missing.length > 0) fail(`There is no language ${missing.join(", ")} among the files. They hold: ${found.join(", ") || "none"}.`);
  if (sets.length > 0) return { sets, byHand: [...byHand], creatives };
  if (found.some((name) => name in STORE_DISPLAYS)) fail(`${root} holds the folders of one language. --from takes the folder above it, the one with a folder per language.`);
  fail(only ? `Nothing among the files is for ${only.join(", ")}.` : byHand.size > 0 ? `The files hold screenshots for the ${STORE_BY_HAND["iphone-duo"]} only, and App Store Connect's API has no display for it yet. They go in by hand.` : `There are no store screenshots in ${root}. Render the project first: --render does it.`);
}

/** Sends one file where Apple says and tells it the file is there. Returns the screenshot's id. */
async function uploadScreenshot(account, set, file, checksum) {
  const data = readFileSync(file);
  const name = path.basename(file);
  const body = { data: { type: "appScreenshots", attributes: { fileName: name, fileSize: data.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set } } } } };
  const reserved = (await apple(account, "POST", "/v1/appScreenshots", `take ${name}`, body)).data;
  for (const part of reserved.attributes?.uploadOperations ?? []) {
    // The bytes go to the storage address Apple names, with the headers it names. The token does not go along.
    for (let tries = 1; ; tries++) {
      const sent = await fetch(part.url, {
        method: part.method,
        headers: Object.fromEntries((part.requestHeaders ?? []).map((header) => [header.name, header.value])),
        body: data.subarray(part.offset, part.offset + part.length),
        signal: AbortSignal.timeout(300000),
      }).catch((error) => ({ ok: false, status: error.cause?.message ?? error.message }));
      if (sent.ok) break;
      if (tries === 3) fail(`${name} could not be sent to App Store Connect (${sent.status}). Run the command again: it starts that display over.`);
      await pause(tries * 2000);
    }
  }
  await apple(account, "PATCH", `/v1/appScreenshots/${reserved.id}`, `finish ${name}`, { data: { type: "appScreenshots", id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: checksum } } });
  return reserved.id;
}

/** Apple checks each file once it has arrived. Waits for that, three minutes at most, and returns what it refused. */
async function settle(account, uploads) {
  const state = (shot) => shot.attributes?.assetDeliveryState?.state;
  const refused = [];
  const until = Date.now() + 180000;
  let waiting = uploads;
  while (waiting.length > 0) {
    const still = [];
    for (const upload of waiting) {
      const shots = (await appleList(account, `/v1/appScreenshotSets/${upload.set}/appScreenshots?limit=200`, "check the uploads")).filter((shot) => upload.names.has(shot.id));
      if (shots.some((shot) => state(shot) !== "COMPLETE" && state(shot) !== "FAILED")) {
        still.push(upload);
        continue;
      }
      for (const shot of shots.filter((entry) => state(entry) === "FAILED")) {
        const why = (shot.attributes.assetDeliveryState.errors ?? []).map((error) => error.description || error.code).filter(Boolean).join(" ");
        refused.push(`${upload.label}  ${upload.names.get(shot.id)}: ${why || "refused without a reason"}`);
      }
    }
    waiting = still;
    if (waiting.length === 0 || Date.now() > until) break;
    await pause(3000);
  }
  return { refused, late: waiting.reduce((sum, upload) => sum + upload.names.size, 0) };
}

const screenshots = (count) => `${count} ${count === 1 ? "screenshot" : "screenshots"}`;

async function storePush(project, flags) {
  if (flags.from === true || (!project && flags.from === undefined)) {
    fail("Usage: appshots store push <project> --app <bundle id> [--version <number>] [--render] [--from <folder>] [--lang <codes>] [--only <devices or folders>] [--add-languages] [--dry-run]");
  }
  const dry = Boolean(flags["dry-run"]);
  const account = storeAccount(flags);
  // The key and the app are settled before anything is rendered or downloaded.
  const app = await storeApp(account, flags.app);

  let root;
  if (typeof flags.from === "string") {
    root = path.resolve(flags.from);
    if (!existsSync(root) || !statSync(root).isDirectory()) fail(`No such folder: ${root}`);
  } else {
    // A folder of its own each time, so that no file of an earlier render goes along with this one's.
    root = mkdtempSync(path.join(tmpdir(), "appshots-store-"));
    process.on("exit", () => rmSync(root, { recursive: true, force: true }));
    await fetchExport(loadConfig(), project, root, flags.render);
  }
  const { sets, byHand, creatives } = exportSets(root, flags);

  // Every version is found before one is created, so a set for two platforms does not stop half way.
  const versions = [];
  for (const platform of new Set(sets.map((set) => platformOf(set.display)))) versions.push(await storeVersion(account, app, platform, flags));
  if (dry) console.log("Dry run: nothing is changed.");
  for (const version of versions) {
    if (!version.id && !dry) await createVersion(account, app, version);
    else console.log(`${app.name} ${version.number} for ${STORE_PLATFORMS[version.platform]}${version.id ? "" : ": this version would be created, with the languages and screenshots of the one before it"}`);
  }

  const uploads = [];
  const notes = [];
  let unchanged = 0;
  for (const version of versions) {
    const listed = await versionLanguages(account, version);
    const codes = listed.map((entry) => entry.attributes.locale);
    const mine = sets.filter((set) => platformOf(set.display) === version.platform);
    for (const locale of new Set(mine.map((set) => set.locale))) {
      const code = storeLocale(locale, codes) ?? locale;
      let language = listed.find((entry) => entry.attributes.locale === code);
      if (!language) {
        if (!flags["add-languages"]) {
          notes.push(`${locale}: version ${version.number} for ${STORE_PLATFORMS[version.platform]} has no such language on its store page. It has ${codes.join(", ")}. --add-languages adds it.`);
          continue;
        }
        if (!dry) language = await addLanguage(account, version, locale);
        console.log(`${code}  ${dry ? "would be added" : "added"} to the store page`);
      }
      const there = language ? await appleList(account, `/v1/appStoreVersionLocalizations/${language.id}/appScreenshotSets?limit=200`, `list the displays of ${code}`) : [];
      for (const set of mine.filter((entry) => entry.locale === locale)) {
        const label = `${code.padEnd(8)} ${set.target.padEnd(11)}`;
        let display = there.find((entry) => entry.attributes.screenshotDisplayType === set.display);
        const old = display ? await appleList(account, `/v1/appScreenshotSets/${display.id}/appScreenshots?limit=200`, `list the screenshots of ${code}`) : [];
        const sums = set.files.map((file) => createHash("md5").update(readFileSync(file)).digest("hex"));
        // The same files in the same order are left alone, so running this twice changes nothing the second time.
        if (old.length === sums.length && old.every((shot, at) => shot.attributes.sourceFileChecksum === sums[at] && !["FAILED", "AWAITING_UPLOAD"].includes(shot.attributes.assetDeliveryState?.state))) {
          console.log(`${label}  unchanged, the same ${screenshots(old.length)} are there`);
          unchanged += old.length;
          continue;
        }
        const instead = old.length > 0 ? `, in place of the ${old.length} there` : "";
        if (dry) {
          console.log(`${label}  would upload ${screenshots(sums.length)}${instead}`);
          continue;
        }
        for (const shot of old) await apple(account, "DELETE", `/v1/appScreenshots/${shot.id}`, "remove a screenshot");
        display ??= (await apple(account, "POST", "/v1/appScreenshotSets", `open the display ${set.target}`, { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: set.display }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: language.id } } } } })).data;
        // Kept in a Map, which holds the order they were sent in whatever the ids look like.
        const names = new Map();
        for (const [at, file] of set.files.entries()) names.set(await uploadScreenshot(account, display.id, file, sums[at]), path.basename(file));
        // They were sent in the order of the slides. This makes it the order on the store page too.
        if (sums.length > 1) await apple(account, "PATCH", `/v1/appScreenshotSets/${display.id}/relationships/appScreenshots`, "put the screenshots in order", { data: [...names.keys()].map((id) => ({ type: "appScreenshots", id })) });
        uploads.push({ label, set: display.id, names });
        console.log(`${label}  uploaded ${screenshots(sums.length)}${instead}`);
      }
    }
  }

  for (const target of byHand) notes.push(`${target}: App Store Connect's API has no display for the ${STORE_BY_HAND[target]} yet. Drag those files onto it by hand.`);
  if (creatives) notes.push("The header and search results images are not uploaded. They go onto the Header and Search Results tab by hand.");
  const sent = uploads.reduce((sum, upload) => sum + upload.names.size, 0);
  if (sent > 0) {
    console.log("Waiting for Apple to check them...");
    const { refused, late } = await settle(account, uploads);
    for (const line of refused) console.log(`  ! ${line}`);
    if (late > 0) console.log(`  ! Apple is still checking ${screenshots(late)}. They show in App Store Connect when it is done.`);
    if (refused.length > 0) process.exitCode = 1;
    console.log(`${screenshots(sent)} uploaded${refused.length > 0 ? `, ${refused.length} of them refused by Apple` : ""}${unchanged > 0 ? `, ${unchanged} were there already` : ""}.`);
  } else if (!dry) {
    console.log(unchanged > 0 ? "Nothing to upload: App Store Connect has these screenshots already." : "Nothing was uploaded.");
  }
  for (const note of notes) console.log(`  ! ${note}`);
  if (dry) return console.log("Run it again without --dry-run to do it.");
  console.log(`Nothing was submitted for review. Look the version over and submit it yourself: https://appstoreconnect.apple.com/apps/${app.id}`);
}

/** The texts handed to `store text --set`, refused as a whole when one of them cannot go in. */
function checkedTexts(texts) {
  if (!texts || typeof texts !== "object" || Array.isArray(texts) || Object.keys(texts).length === 0) fail(`The texts are one object per language, as 'appshots store text' prints them: {"en-US": {"description": "...", "keywords": "..."}}`);
  const wrong = [];
  for (const [locale, fields] of Object.entries(texts)) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      wrong.push(`${locale}: not an object of texts`);
      continue;
    }
    for (const [field, value] of Object.entries(fields)) {
      const length = typeof value === "string" ? [...value].length : 0;
      if (!(field in STORE_TEXTS)) wrong.push(`${locale}: there is no text called "${field}". There are ${Object.keys(STORE_TEXTS).join(", ")}`);
      else if (typeof value !== "string") wrong.push(`${locale}: ${field} is not a text`);
      else if (STORE_TEXTS[field] > 0 && length > STORE_TEXTS[field]) wrong.push(`${locale}: ${field} has ${length} characters, and App Store Connect takes ${STORE_TEXTS[field]}`);
    }
  }
  if (wrong.length > 0) fail(`The texts cannot go in as they are:\n${wrong.map((line) => `  ${line}`).join("\n")}`);
  return texts;
}

/** The platform whose version holds the texts. An app on both has two sets of them. */
async function textPlatform(account, app, flags) {
  if (flags.platform !== undefined) {
    const platform = { ios: "IOS", mac: "MAC_OS", macos: "MAC_OS" }[String(flags.platform).toLowerCase()];
    if (!platform) fail("--platform needs ios or mac.");
    return platform;
  }
  const versions = await appleList(account, `/v1/apps/${app.id}/appStoreVersions?limit=200`, `list the versions of ${app.name}`);
  const has = (platform) => versions.some((version) => version.attributes?.platform === platform);
  if (has("IOS") && has("MAC_OS")) fail(`${app.name} has an iOS and a macOS version, each with texts of its own. Say which: --platform ios or --platform mac`);
  return has("MAC_OS") ? "MAC_OS" : "IOS";
}

/** The app's own page, which holds the name and the subtitle. While a version is being prepared there are two, and it is the new one. */
async function appInfo(account, app) {
  const infos = await appleList(account, `/v1/apps/${app.id}/appInfos?limit=200`, `read the page of ${app.name}`);
  const state = (info) => info.attributes?.state ?? info.attributes?.appStoreState ?? "";
  return infos.find((info) => STORE_OPEN.has(state(info))) ?? infos.find((info) => !/^READY_FOR_(DISTRIBUTION|SALE)$/.test(state(info))) ?? infos[0] ?? null;
}

const appNames = async (account, info) => (info ? appleList(account, `/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`, "read the names and subtitles") : []);

async function storeText(flags) {
  if (flags.set === true) fail("--set needs the texts as JSON: inline, @file.json, or - for stdin.");
  // What is wrong with the texts is said before Apple is asked anything.
  const texts = flags.set === undefined ? null : checkedTexts(jsonInput(flags.set, "The texts are"));
  const dry = Boolean(flags["dry-run"]);
  const account = storeAccount(flags);
  const app = await storeApp(account, flags.app);
  const platform = await textPlatform(account, app, flags);
  const system = STORE_PLATFORMS[platform];

  if (!texts) {
    if (flags.version === true) fail("--version needs a number, such as --version 1.3.");
    const versions = await storeVersions(account, app, platform);
    // The version being prepared, as that is the one the texts can be changed in. Without one, the latest.
    const version = typeof flags.version === "string" ? versions.find((entry) => entry.attributes.versionString === flags.version.trim()) : (versions.find((entry) => STORE_OPEN.has(versionState(entry))) ?? versions[0]);
    if (!version) fail(typeof flags.version === "string" ? `${app.name} has no version ${flags.version} for ${system}.` : `${app.name} has no ${system} version in App Store Connect.`);
    const languages = await versionLanguages(account, { id: version.id, number: version.attributes.versionString });
    const names = await appNames(account, await appInfo(account, app));
    const page = {};
    for (const language of languages) {
      const name = names.find((entry) => entry.attributes.locale === language.attributes.locale);
      page[language.attributes.locale] = Object.fromEntries(Object.keys(STORE_TEXTS).map((field) => [field, (APP_TEXTS.includes(field) ? name?.attributes[field] : language.attributes[field]) ?? ""]));
    }
    // The note goes to the error stream, so that the output is the JSON alone and can be saved to a file.
    console.error(`${app.name} ${version.attributes.versionString} for ${system}, ${plainState(versionState(version))}`);
    return console.log(JSON.stringify(page, null, 2));
  }

  const version = await storeVersion(account, app, platform, flags);
  if (dry) console.log("Dry run: nothing is changed.");
  if (!version.id && !dry) await createVersion(account, app, version);
  else console.log(`${app.name} ${version.number} for ${system}${version.id ? "" : ": this version would be created, with the texts of the one before it"}`);
  const languages = await versionLanguages(account, version);
  const codes = languages.map((entry) => entry.attributes.locale);
  const code = (locale) => storeLocale(locale, codes) ?? locale;
  // Either every language goes in or none does: a text left out without a word would be worse than a refusal.
  const absent = flags["add-languages"] ? [] : Object.keys(texts).filter((locale) => !codes.includes(code(locale)));
  if (absent.length > 0) fail(`The store page of version ${version.number} has no ${absent.join(", ")}. It has ${codes.join(", ")}. --add-languages adds a language; nothing was changed.`);

  const changed = {};
  const own = (fields, ofApp) => Object.fromEntries(Object.entries(fields).filter(([field]) => APP_TEXTS.includes(field) === ofApp));
  const differing = (fields, now) => Object.keys(fields).filter((field) => (now?.attributes[field] ?? "") !== fields[field]);
  for (const [locale, fields] of Object.entries(texts)) {
    const language = languages.find((entry) => entry.attributes.locale === code(locale));
    const mine = own(fields, false);
    const fresh = differing(mine, language);
    changed[code(locale)] = fresh;
    if (dry) continue;
    if (!language) await addLanguage(account, version, locale, mine);
    else if (fresh.length > 0) await apple(account, "PATCH", `/v1/appStoreVersionLocalizations/${language.id}`, `set the texts of ${code(locale)}`, { data: { type: "appStoreVersionLocalizations", id: language.id, attributes: Object.fromEntries(fresh.map((field) => [field, mine[field]])) } });
  }
  // Names and subtitles come after the languages, because a language added to a version gets its entry here from Apple.
  if (Object.values(texts).some((fields) => Object.keys(own(fields, true)).length > 0)) {
    const info = await appInfo(account, app);
    if (!info) fail(`App Store Connect shows no page for ${app.name} to put a name or subtitle on.`);
    const names = await appNames(account, info);
    for (const [locale, fields] of Object.entries(texts)) {
      const mine = own(fields, true);
      const name = names.find((entry) => entry.attributes.locale === (storeLocale(locale, names.map((each) => each.attributes.locale)) ?? code(locale)));
      const fresh = differing(mine, name);
      changed[code(locale)].push(...fresh);
      if (dry || fresh.length === 0) continue;
      if (name) await apple(account, "PATCH", `/v1/appInfoLocalizations/${name.id}`, `set the name and subtitle of ${code(locale)}`, { data: { type: "appInfoLocalizations", id: name.id, attributes: Object.fromEntries(fresh.map((field) => [field, mine[field]])) } });
      else await apple(account, "POST", "/v1/appInfoLocalizations", `set the name and subtitle of ${code(locale)}`, { data: { type: "appInfoLocalizations", attributes: { locale: code(locale), ...mine }, relationships: { appInfo: { data: { type: "appInfos", id: info.id } } } } });
    }
  }
  for (const [locale, fields] of Object.entries(changed)) console.log(`${locale.padEnd(8)} ${fields.length > 0 ? `${dry ? "would set" : "set"} ${fields.join(", ")}` : "unchanged"}`);
  if (dry) return console.log("Run it again without --dry-run to do it.");
  console.log(`Nothing was submitted for review. Look the version over and submit it yourself: https://appstoreconnect.apple.com/apps/${app.id}`);
}

async function storeCommand([action, ...rest], flags) {
  switch (action) {
    case "login":
      return storeLogin(flags);
    case "apps": {
      const apps = await storeApps(storeAccount(flags));
      return console.log(apps.length > 0 ? appLines(apps) : "This key reaches no app.");
    }
    case "push":
      return storePush(rest[0], flags);
    case "text":
      return storeText(flags);
    default:
      fail("Usage: appshots store login | apps | push <project> | text. 'appshots help' lists what each one takes.");
  }
}

/**
 * One report of what there is to work with, so an agent sees it in a single call. Nothing missing makes it
 * fail: each line says what is there, or what to do about it.
 */
async function check() {
  console.log(`Server: ${await serverStatus()}`);
  const skill = await skillStatus();
  if (skill) console.log(`Skill: ${skill}`);
  console.log(`App Store Connect: ${storeStatus()}`);

  const projects = xcodeProjects(projectDirs());
  const kits = toolkits(process.cwd());
  const known = kits.filter((kit) => !kit.unsure);
  // A simulator is where the toolkit's own command puts the app, when it has one for iOS.
  const starter = kits.some((kit) => kit.simulator) ? "boot" : "run";
  // An app that runs in a window or a browser only has no use for Xcode or a simulator.
  const apart = projects.length === 0 && known.length > 0 && starter === "run";

  const version = process.platform === "darwin" ? spawnSync("xcodebuild", ["-version"], { encoding: "utf8", env: xcodeEnv() }) : null;
  const xcode = version?.status === 0;
  if (xcode) {
    const dir = xcodeEnv().DEVELOPER_DIR ?? execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim();
    console.log(`Xcode: ${dir.replace(/\/Contents\/Developer\/?$/, "")}, version ${version.stdout.match(/Xcode (\S+)/)?.[1] ?? "unknown"}`);
  } else if (version) {
    console.log(apart ? "Xcode: not found, and this project needs none." : "Xcode: not found. Install Xcode from the App Store; the Command Line Tools alone cannot build an app or run a simulator.");
  } else {
    console.log("Xcode: this is not a Mac. Simulators, devices and Mac windows need one. 'appshots capture --web <address>' takes a web app's pages here, and 'appshots upload' takes screenshots you already have.");
  }

  if (projects.length === 0 && known.length > 0) {
    console.log("Project: no Xcode workspace or project here, and 'appshots run' builds only those. This app is captured as its toolkit runs it:");
  } else if (projects.length === 0) {
    console.log("Project: nothing recognised in this folder. Run this in your app's folder. 'appshots run' builds an Xcode workspace or project, and --project <path> points at one elsewhere. An app made with anything else is started by its own command and captured where it runs: 'appshots capture' in the simulator, 'appshots capture --mac <app>' in a window on this Mac, 'appshots capture --web <address>' in a browser.");
    const below = appFolders(process.cwd());
    const list = below.slice(0, 8).map((entry) => `${entry.folder} (${entry.made.join(", ")})`).join(", ");
    if (below.length > 0) console.log(`  Apps below this folder: ${list}${below.length > 8 ? `, and ${below.length - 8} more` : ""}. Run 'appshots check' in the one whose screens you want.`);
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
  for (const kit of kits) {
    const head = projects.length > 0 && kit.simulator ? ", so its own command starts the app rather than 'appshots run'" : "";
    console.log(`Made with ${kit.name} (${kit.sign})${head}:`);
    for (const line of toolkitLines(kit, simulators.value ? recommendedSimulator(simulators.value, "iphone") : null, xcode)) console.log(line);
  }
  if (kits.some((kit) => kit.web) || (projects.length === 0 && kits.length === 0)) {
    const browser = findBrowser();
    console.log(browser ? `Browser: ${browser.name}, which draws the pages for 'appshots capture --web'` : "Browser: none found. 'appshots capture --web' draws pages with Chrome, Chromium, Edge or Brave. Install one, or point APPSHOTS_BROWSER at a Chromium browser's program.");
  }
  // Nothing below concerns an app that never runs in a simulator or on a device.
  if (apart) return;

  if (simulators.problem) {
    console.log(`Simulators: ${simulators.problem.split("\n")[0]}`);
  } else {
    console.log("Simulators:");
    const recommended = new Set();
    for (const [kind, { label, flag, store }] of Object.entries(SIM_KINDS)) {
      const simulator = recommendedSimulator(simulators.value, kind);
      const command = `'appshots ${starter}${flag}'`;
      if (!simulator) {
        // Few apps need the Duo, so its absence is not worth a line.
        if (kind !== "duo") console.log(`  ${label}: none. Add an iOS simulator in Xcode under Settings > Components.`);
        continue;
      }
      recommended.add(simulator.udid);
      const state = simulator.booted ? "booted" : `not booted, ${command} boots it`;
      const note = simulator.fallback ? `. No ${store} is installed, which is the size the store asks for` : "";
      console.log(`  ${label}: ${simulatorLabel(simulator)}, ${state}  (${simulator.udid})${note}`);
    }
    for (const simulator of simulators.value.filter((sim) => sim.booted && !recommended.has(sim.udid))) {
      console.log(`  Also booted: ${simulatorLabel(simulator)}  (${simulator.udid})`);
    }

    // What is installed already needs no build. The simulators 'appshots run' uses come first.
    const booted = simulators.value.filter((sim) => sim.booted).sort((a, b) => recommended.has(b.udid) - recommended.has(a.udid));
    const which = booted.length > 1 ? " --sim <simulator>" : "";
    if (booted.length === 0) {
      console.log(starter === "run" ? "Apps: no simulator is booted. 'appshots run' boots one, then builds and installs the app in this folder." : "Apps: no simulator is booted. 'appshots boot' boots one, and the project's own command builds and installs the app there.");
    } else {
      console.log(`Apps: these are installed and start without a build, with 'appshots launch <bundle id>${which}'`);
      // Each simulator is a question to simctl, and a long list helps nobody.
      for (const simulator of booted.slice(0, 6)) {
        const apps = installedApps(simulator.udid);
        const more = apps?.length > 8 ? `, and ${apps.length - 8} more` : "";
        const list = apps?.slice(0, 8).map((app) => `${app.name} (${app.bundleId})`).join(", ");
        if (!apps) console.log(`  ${simulator.name}: it is busy and did not answer. 'appshots simctl listapps ${simulator.udid}' asks again`);
        else console.log(`  ${simulator.name}: ${list ? `${list}${more}` : starter === "run" ? "none of your own. 'appshots run' builds and installs the app in this folder" : "none of your own yet"}`);
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

/** Commands that set the skill up, bring it up to date or report on it themselves. */
const NO_NOTICE = new Set(["setup", "login", "update", "check"]);

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  // simctl's arguments are its own, --help among them.
  if (command === "simctl") process.exit(xcrun(["simctl", ...rest], { stdio: "inherit" }).status ?? 1);
  const { positional, flags, passthrough } = parseArgs(rest);
  if (!command || command === "help" || command === "--help" || flags.help) return console.log(HELP);
  await dispatch(command, positional, flags, passthrough);
  if (!NO_NOTICE.has(command)) await staleNotice();
}

async function dispatch(command, positional, flags, passthrough) {
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
    case "boot": {
      if (positional.length > 0) fail("Usage: appshots boot [--ipad|--duo|--sim <name|udid>]");
      const simulator = runSimulator(flags);
      boot(simulator);
      const note = simulator.fallback ? `. No ${SIM_KINDS[simKind(flags)].store} is installed, which is the size the store asks for` : "";
      console.log(`Booted ${simulatorLabel(simulator)}  (${simulator.udid})${note}`);
      const which = bootedSimulators().length > 1 ? ` --sim ${simulator.udid}` : "";
      const own = toolkits(process.cwd()).find((kit) => kit.simulator)?.simulator.replaceAll("<udid>", simulator.udid).replaceAll("<simulator>", simulator.name);
      console.log(`Next: ${own ? `'${own}' in the background` : "start the app there with the project's own command, which takes this udid"}, then: appshots capture --name <name> --project <project> --clean${which}`);
      return;
    }
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
      const device = shotDevice(flags);
      const language = shotLanguage(flags);
      if (config) await hasLanguage(config, project, language);
      const shot = flags.web ? await captureWeb(flags) : capture(flags);
      if (config) await upload(config, project, shot.file, shot.name, shot.device ?? device, language);
      return;
    }
    case "shoot": {
      const [project, ...names] = positional;
      if (!project || names.length === 0) fail("Usage: appshots shoot <project> <names...> [--sim <name>] [--device <name>] [--clean] [--out <dir>]");
      return shoot(project, names, flags);
    }
    case "upload": {
      const [project, ...sources] = positional;
      if (!project || sources.length === 0) fail("Usage: appshots upload <project> <files or folders...> [--name <name>] [--lang <code>] [--image]");
      return uploadAll(loadConfig(), project, sources, flags);
    }
    case "pull":
      if (!positional[0]) fail("Usage: appshots pull <project> [--out <dir>] [--render]");
      return pull(loadConfig(), positional[0], flags);
    case "mockups":
      if (!positional[0]) fail("Usage: appshots mockups <project> [--out <dir>] [--lang <code>] [--style clay] [--color silver] [--shadow soft] [--rotate -8] [--width 1200]");
      return mockups(loadConfig(), positional[0], flags);
    case "projects": {
      const projects = await (await request(loadConfig(), "GET", "/api/projects")).json();
      console.log(projects.map((p) => `${p.id}  ${p.name}  (${p.slides} slides)`).join("\n") || "No projects yet.");
      return;
    }
    case "store":
      return storeCommand(positional, flags);
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
