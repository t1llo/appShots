import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { xcodeProjects } from "./projects.mjs";
import { readJson } from "./util.mjs";

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
 * @typedef {object} Toolkit
 * @property {string} name
 * @property {string} sign The file that gave it away.
 * @property {string | null} [simulator] The command that starts the app in a simulator.
 * @property {{ command: string, app?: string, built?: boolean } | null} [window] The command that opens it in a window on this Mac.
 * @property {{ command?: string, address: string | null, note?: string } | null} [web] The command that serves its pages.
 * @property {boolean} [unsure] A package with a start script, which may serve pages or may not.
 */

/**
 * What the app in a folder is made with besides Xcode, and the command each toolkit starts it with: in the
 * simulator, in a window on this Mac, or as pages for a browser. It is read off the files a toolkit leaves
 * in a project; nothing is run. <udid> and <simulator> stand for the simulator to start it in.
 * @param {string} dir
 * @returns {Toolkit[]}
 */
export function toolkits(dir) {
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

/**
 * Folders below this one that hold an app, for a repository that keeps several side by side.
 * @param {string} dir
 */
export function appFolders(dir) {
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

/**
 * What 'appshots check' says about one toolkit: a line for each place its app runs in, the commands in order.
 * @param {Toolkit} kit
 * @param {{ name: string, udid: string, booted: boolean } | null} simulator
 * @param {boolean} xcode
 */
export function toolkitLines(kit, simulator, xcode) {
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
