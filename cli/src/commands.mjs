import { hasLanguage, request } from "./api.mjs";
import { capture } from "./capture.mjs";
import { connectedDevices } from "./capture/device.mjs";
import { captureWeb } from "./capture/web.mjs";
import { check } from "./check.mjs";
import { clean } from "./clean.mjs";
import { loadConfig } from "./config.mjs";
import { fail } from "./fail.mjs";
import { bootCommand, launch, run } from "./plan.mjs";
import { run as runProgram } from "./proc.mjs";
import { mockups, pull } from "./pull.mjs";
import { login, setup } from "./setup.mjs";
import { shoot } from "./shoot.mjs";
import { shotDevice, shotLanguage } from "./shot.mjs";
import { bootedSimulators } from "./sim.mjs";
import { appLines, storeAccount, storeApps, storeLogin } from "./store/asc.mjs";
import { storePush } from "./store/push.mjs";
import { storeText } from "./store/text.mjs";
import { call, tools } from "./tools.mjs";
import { update } from "./update.mjs";
import { upload, uploadAll } from "./upload.mjs";

/**
 * @typedef {object} Command
 * @property {string[]} flags The options it takes, so that one it does not take is pointed out rather than ignored.
 * @property {(args: import("./args.mjs").Args) => Promise<unknown> | unknown} run
 * @property {boolean} [quiet] It sets the skill up, brings it up to date or reports on it itself, so the
 *   notice that the skill is out of date is left out.
 */

// The ones a screenshot is filed under: --as says outright, --ipad, --duo and --mac on the way.
const FILING = ["as", "ipad", "duo", "mac", "lang"];
const LAUNCH = ["sim", "dark", "light", "capture", "to", "wait", "out", ...FILING];
const STORE_KEY = ["issuer", "key-id", "key", "app"];

/** @type {Record<string, Command>} */
export const COMMANDS = {
  setup: { flags: ["agent", "token"], quiet: true, run: ({ positional, flags }) => setup(positional[0], flags) },
  login: { flags: ["token"], quiet: true, run: ({ positional, flags }) => login(positional[0], flags) },
  update: { flags: [], quiet: true, run: () => update() },
  check: { flags: [], quiet: true, run: () => check() },
  run: {
    flags: [...LAUNCH, "scheme", "project", "fresh", "create"],
    run: ({ positional, flags, passthrough }) => {
      if (positional.length > 0) fail("Usage: appshots run [options] [-- <launch arguments>]. What the app is to get goes after a lone --, as in: appshots run -- -appshots stats");
      return run(flags, passthrough);
    },
  },
  launch: {
    flags: [...LAUNCH, "project"],
    run: ({ positional, flags, passthrough }) => {
      if (positional.length !== 1) fail("Usage: appshots launch <bundle id> [--sim <name|udid>] [--dark|--light] [--lang <code>] [--capture <name>] [--to <project>] [-- <launch arguments>]");
      return launch(positional[0], flags, passthrough);
    },
  },
  boot: {
    flags: ["ipad", "duo", "sim", "create"],
    run: ({ positional, flags }) => {
      if (positional.length > 0) fail("Usage: appshots boot [--ipad|--duo|--sim <name|udid>] [--create]");
      return bootCommand(flags);
    },
  },
  devices: {
    flags: [],
    run: async () => {
      const [simulators, devices] = await Promise.all([bootedSimulators(), connectedDevices()]);
      console.log("Booted simulators:");
      console.log(simulators.map((s) => `  ${s.name}  (${s.udid})`).join("\n") || "  (none)");
      console.log("Connected devices:");
      console.log(devices.map((d) => `  ${d.name}  ${d.model}  ${d.transport}  (${d.udid})`).join("\n") || "  (none)");
    },
  },
  capture: {
    flags: ["name", "sim", "device", "web", "dark", "light", "wait", "init", "eval", "viewport", "profile", "user-agent", "clean", "project", "to", "out", ...FILING],
    run: async ({ flags }) => {
      // run and launch call it --to, so that is taken here as well.
      const project = typeof flags.to === "string" ? flags.to : flags.project;
      const config = typeof project === "string" ? loadConfig() : null;
      const device = shotDevice(flags);
      const language = shotLanguage(flags);
      if (config && typeof project === "string") await hasLanguage(config, project, language);
      const shot = flags.web ? await captureWeb(flags) : await capture(flags);
      if (config && typeof project === "string") await upload(config, project, shot.file, shot.name, ("device" in shot ? shot.device : undefined) ?? device, language);
    },
  },
  shoot: { flags: ["sim", "device", "clean", "out", "web", ...FILING], run: (args) => shoot(args) },
  upload: {
    flags: ["name", "image", ...FILING],
    run: ({ positional, flags }) => {
      const [project, ...sources] = positional;
      if (!project || sources.length === 0) fail("Usage: appshots upload <project> <files or folders...> [--name <name>] [--lang <code>] [--image]");
      return uploadAll(loadConfig(), project, sources, flags);
    },
  },
  pull: {
    flags: ["out", "render"],
    run: ({ positional, flags }) => {
      if (!positional[0]) fail("Usage: appshots pull <project> [--out <dir>] [--render]");
      return pull(loadConfig(), positional[0], flags);
    },
  },
  mockups: {
    flags: ["out", "lang", "frame", "style", "color", "shadow", "rotate", "perspective", "status-bar", "time", "width"],
    run: ({ positional, flags }) => {
      if (!positional[0]) fail("Usage: appshots mockups <project> [--out <dir>] [--lang <code>] [--style clay] [--color silver] [--shadow soft] [--rotate -8] [--width 1200]");
      return mockups(loadConfig(), positional[0], flags);
    },
  },
  projects: {
    flags: [],
    run: async () => {
      const projects = await (await request(loadConfig(), "GET", "/api/projects")).json();
      console.log(projects.map((p) => `${p.id}  ${p.name}  (${p.slides} slides)`).join("\n") || "No projects yet.");
    },
  },
  store: {
    flags: [...STORE_KEY, "version", "render", "from", "lang", "only", "add-languages", "dry-run", "set", "platform"],
    run: async ({ positional: [action, ...rest], flags }) => {
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
    },
  },
  open: {
    flags: [],
    run: async ({ positional }) => {
      const config = loadConfig();
      await runProgram("open", [positional[0] ? `${config.url}/#/${positional[0]}` : config.url]);
    },
  },
  tools: { flags: [], run: ({ positional }) => tools(loadConfig(), positional[0]) },
  call: { flags: ["out"], run: ({ positional, flags }) => call(loadConfig(), positional[0], positional[1], flags) },
  clean: {
    flags: ["builds", "older-than", "dry-run"],
    run: ({ positional, flags }) => {
      // --builds is the only thing there is to clean for now; asking for it keeps a bare 'clean' free for later.
      if (positional.length > 0 || !flags.builds) fail("Usage: appshots clean --builds [--older-than <days>] [--dry-run]");
      return clean(flags);
    },
  },
};

