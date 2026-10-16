import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, test } from "node:test";
import { cliHome, PIXEL, quietly, stubServer } from "./helpers.mjs";

// The Remotion layer of the app previews, with npm, npx and ffmpeg stood in for by a script and the server by a
// stand-in for the project and its fonts. Nothing here installs Remotion or renders.
const home = await cliHome("remotion");
after(() => home.remove());

const FONT_CSS = `/* fraunces-latin-wght-normal */
@font-face {
  font-family: 'Fraunces Variable';
  font-style: normal;
  font-display: block;
  font-weight: 100 900;
  src: url(/fonts/fraunces/fraunces-latin-wght-normal.woff2) format('woff2-variations');
  unicode-range: U+0000-00FF,U+0131;
}
@font-face {
  font-family: 'Fraunces Variable';
  font-style: normal;
  font-weight: 100 900;
  src: url(/fonts/fraunces/fraunces-greek-wght-normal.woff2) format('woff2-variations');
  unicode-range: U+0370-0377;
}
/* anton-latin-400-normal */
@font-face {
  font-family: 'Anton';
  font-style: normal;
  font-weight: 400;
  src: url(/fonts/anton/anton-latin-400-normal.woff2) format('woff2'), url(/fonts/anton/anton-latin-400-normal.woff) format('woff');
}
`;
const server = await stubServer(({ url }) => {
  if (url === "/api/projects/p_example") return [200, { project: { id: "p_example", theme: { font: "fraunces" } }, revision: 3 }];
  if (url === "/fonts/fonts.css") return [200, FONT_CSS];
  if (url.startsWith("/fonts/fraunces/")) return [200, Buffer.from(`font ${url}`)];
  return [404, { error: "Not found" }];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;

const { REMOTION_LICENCE, REMOTION_VERSION, TEMPLATE_FILES, composeRemotion, facesOf, framesOf, remotionProps, renderArgs, scaffoldRemotion } = await import("../../cli/src/video/remotion.mjs");
const { asset } = await import("../../cli/src/assets.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
const { setRunner } = await import("../../cli/src/proc.mjs");

const repository = path.resolve(import.meta.dirname, "..", "..");
const noTerminal = { skip: process.stdin.isTTY && "stdin is a terminal" };

/**
 * A runner that answers from `answer` and keeps each call with the folder it ran in.
 * @param {(command: string, args: string[], options: any) => any} [answer]
 */
function recorder(answer = () => ({})) {
  /** @type {Array<{ command: string, args: string[], cwd?: string }>} */
  const calls = [];
  setRunner(async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    const { status = 0, stdout = "", stderr = "", error } = (await answer(command, args, options)) ?? {};
    return { status, signal: null, stdout, stderr, timedOut: false, ...(error ? { error } : {}) };
  });
  return calls;
}
const spawnRunner = setRunner(recorder());
afterEach(() => setRunner(spawnRunner));

/** A new work folder, appshots-video/ in a repository of its own. */
const workFolder = () => path.join(mkdtempSync(path.join(home.home, "repo-")), "appshots-video");

/** @param {string} folder */
const filesIn = (folder) =>
  readdirSync(folder, { recursive: true })
    .map((name) => String(name))
    .filter((name) => statSync(path.join(folder, name)).isFile())
    .sort();

test("the scaffold writes the template's files and nothing else, with Remotion pinned exactly", async () => {
  const root = workFolder();
  const calls = recorder();
  let result;
  const printed = await quietly(async () => {
    result = await scaffoldRemotion(root, { yes: true, install: false });
  });
  const { folder, written, installed } = result;
  assert.equal(folder, path.join(root, "remotion"));
  assert.deepEqual(filesIn(folder), [...TEMPLATE_FILES].sort());
  assert.deepEqual([...written].sort(), [...TEMPLATE_FILES].sort());
  assert.equal(installed, false);
  assert.deepEqual(calls, []);
  // A compose would fail before the install, so that is the step it names next.
  assert.match(printed, /Remotion is not installed there yet\.\nNext: cd .*remotion && npm install, then appshots video compose --engine remotion\n$/);

  const pkg = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8"));
  assert.equal(pkg.private, true);
  const pins = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of ["remotion", "@remotion/cli", "@remotion/media", "@remotion/transitions", "@remotion/fonts"]) assert.equal(pins[name], REMOTION_VERSION, name);
  for (const [name, version] of Object.entries(pins)) assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is pinned to one version`);
  for (const name of ["react", "react-dom", "typescript"]) assert.ok(pins[name], name);

  const readme = readFileSync(path.join(folder, "README.md"), "utf8");
  assert.match(readme, /Built with \[Remotion\]/);
  assert.match(readme, /remotion\.pro\/license/);
  assert.deepEqual(readFileSync(path.join(folder, ".gitignore"), "utf8").trim().split("\n"), ["node_modules/", "out/", "public/", "props/"]);
  // Their licence is the owner's to choose: the files carry no header saying one.
  for (const file of TEMPLATE_FILES) assert.doesNotMatch(readFileSync(path.join(folder, file), "utf8"), /SPDX-License-Identifier|Licensed under/, file);
});

test("without a terminal and without --yes, it fails with the licence and writes nothing", noTerminal, async () => {
  const root = workFolder();
  const calls = recorder();
  await assert.rejects(
    quietly(() => scaffoldRemotion(root, { install: true })),
    (error) => error instanceof Failure && error.message.startsWith(REMOTION_LICENCE) && /ask whether to go on; after a yes, run: appshots video remotion --yes$/.test(error.message),
  );
  assert.equal(existsSync(root), false);
  assert.deepEqual(calls, []);
});

test("the licence says what Remotion costs, that appShots does not include it, and what is downloaded", () => {
  for (const part of ["not open source", "up to 3 people", "non-profits", "Remotion Company License", "remotion.pro/license", "appShots does not include Remotion", "appshots-video/remotion/", "from npm", "Chrome Headless Shell"])
    assert.ok(REMOTION_LICENCE.replace(/\n/g, " ").includes(part), part);
});

test("with install, npm installs in the project's folder, and Remotion's skills are only offered", noTerminal, async () => {
  const root = workFolder();
  const calls = recorder();
  const printed = await quietly(() => scaffoldRemotion(root, { yes: true }));
  assert.deepEqual(calls, [{ command: "npm", args: ["install", "--no-audit", "--no-fund"], cwd: path.join(root, "remotion") }]);
  assert.match(printed, /To add them, ask the user, then run: cd .*remotion && npx remotion skills add/);
  assert.match(printed, /\nNext: appshots video compose --engine remotion\n$/);
});

test("an install that fails says why and how to see more", noTerminal, async () => {
  const root = workFolder();
  recorder(() => ({ status: 1, stderr: "npm error code ETARGET\nnpm error notarget No matching version" }));
  await assert.rejects(quietly(() => scaffoldRemotion(root, { yes: true })), (error) => error instanceof Failure && /^npm install failed \(exit 1\):\nnpm error code ETARGET/.test(error.message) && /cd .*remotion && npm install --no-audit --no-fund$/.test(error.message));
  recorder(() => ({ status: null, error: new Error("spawn npm ENOENT") }));
  await assert.rejects(quietly(() => scaffoldRemotion(workFolder(), { yes: true })), (error) => error instanceof Failure && /npm is not on this Mac/.test(error.message));
});

test("files the user changed stay as they are, and --again puts the template back over them", noTerminal, async () => {
  const root = workFolder();
  recorder();
  await quietly(() => scaffoldRemotion(root, { yes: true, install: false }));
  const caption = path.join(root, "remotion", "src", "Caption.tsx");
  writeFileSync(caption, "// mine\n");
  const kept = await quietly(() => scaffoldRemotion(root, { yes: true, install: false }));
  assert.equal(readFileSync(caption, "utf8"), "// mine\n");
  assert.match(kept, /stay as they are:\n {2}src\/Caption\.tsx\nTo put the template back over them: appshots video remotion --again/);

  const calls = recorder();
  // The yes to the licence is not one to losing the user's changes: that is asked apart, through --replace.
  await assert.rejects(
    quietly(() => scaffoldRemotion(root, { yes: true, install: false, again: true })),
    (error) => error instanceof Failure && /loses the changes in them:\n {2}src\/Caption\.tsx\n\nThis needs the user's yes/.test(error.message) && /after a yes, run: appshots video remotion --yes --again --replace --no-install$/.test(error.message),
  );
  assert.equal(readFileSync(caption, "utf8"), "// mine\n");
  const again = await quietly(() => scaffoldRemotion(root, { yes: true, install: false, again: true, replace: true }));
  assert.equal(readFileSync(caption, "utf8"), asset("remotion/src/Caption.tsx"));
  assert.match(again, /loses the changes in them:\n {2}src\/Caption\.tsx/);
  assert.match(again, /Wrote 1 file into .*: src\/Caption\.tsx/);
  assert.deepEqual(calls, []);
});

test("the template's package.json is the one REMOTION_VERSION names", async () => {
  const pkg = JSON.parse(asset("remotion/package.json"));
  assert.equal(pkg.dependencies.remotion, REMOTION_VERSION);
  // The scaffold writes the files it lists and the bundle carries every file of cli/assets: the two are the
  // same, so that no file of the template is carried and never written, nor listed and missing.
  const { assetFiles } = await import("../../scripts/build-cli.mjs");
  const carried = assetFiles(path.join(repository, "cli", "assets", "remotion")).map((file) => (file === "gitignore" ? ".gitignore" : file)).sort();
  assert.deepEqual(carried, [...TEMPLATE_FILES].sort());
  assert.equal(existsSync(path.join(repository, "cli", "assets", "remotion", ".gitignore")), false);
});

test("facesOf reads one font's files from the server's stylesheet", () => {
  assert.deepEqual(facesOf(FONT_CSS, "fraunces"), [
    { family: "Fraunces Variable", name: "fraunces-latin-wght-normal.woff2", weight: "100 900", style: "normal", unicodeRange: "U+0000-00FF,U+0131" },
    { family: "Fraunces Variable", name: "fraunces-greek-wght-normal.woff2", weight: "100 900", style: "normal", unicodeRange: "U+0370-0377" },
  ]);
  assert.deepEqual(facesOf(FONT_CSS, "anton"), [{ family: "Anton", name: "anton-latin-400-normal.woff2", weight: "400", style: "normal" }]);
  assert.deepEqual(facesOf(FONT_CSS, "inter"), []);
});

/**
 * A work folder with a layer set, the segments stage 1 cut, and the context compose passes.
 * @param {{ plan?: any, locale?: string }} [options]
 */
function fixture({ plan = {}, locale = "en" } = {}) {
  const root = workFolder();
  const set = "b3f1a9c04d7e2a61";
  const layers = path.join(root, "layers", set);
  mkdirSync(path.join(layers, locale), { recursive: true });
  const manifest = {
    set,
    charged: false,
    size: [886, 1920],
    warnings: [],
    layers: [
      { id: "plate", locale: null, kind: "plate", width: 886, height: 1920 },
      { id: "intro-logo", locale, kind: "intro-logo", width: 886, height: 1920, box: [343, 700, 200, 200] },
      { id: "intro-text", locale, kind: "intro-text", width: 886, height: 1920, box: [100, 960, 686, 140], text: "Notes that keep up" },
      { id: "outro-text", locale, kind: "outro-text", width: 886, height: 1920, box: [100, 900, 686, 200], text: "Try it today\nSubscription required" },
      { id: "caption-inbox", locale, kind: "caption", width: 886, height: 1920, box: [64, 132, 758, 236], text: "Alles an einem Ort", fallback: false, fit: 1 },
      { id: "caption-share", locale: null, kind: "caption", width: 886, height: 1920, box: [64, 1560, 758, 236], text: "Share in one tap" },
    ],
  };
  for (const layer of manifest.layers) writeFileSync(path.join(layers, ...(layer.locale ? [layer.locale] : []), `${layer.id}.png`), PIXEL);
  mkdirSync(path.join(root, "work"), { recursive: true });
  const segments = [
    { scene: "inbox", seconds: 6, frames: 180 },
    { scene: "search", seconds: 5.5, frames: 165 },
    { scene: "share", seconds: 7, frames: 210 },
  ].map((segment, at) => {
    const file = path.join(root, "work", `${"0123456789abcdef".slice(at)}${at}.mp4`);
    writeFileSync(file, `segment ${segment.scene}`);
    return { ...segment, file };
  });
  const fullPlan = {
    version: 1,
    project: "p_example",
    displays: ["iphone"],
    captionStyle: "panel",
    intro: { seconds: 1.5, logo: true },
    outro: { seconds: 2, lines: [], logo: true, disclosure: ["subscription"] },
    transition: { type: "fade", seconds: 0.4 },
    scenes: [
      { id: "inbox", caption: { slide: 2 }, captionPosition: "top" },
      { id: "search", caption: false, captionPosition: "top" },
      { id: "share", caption: "Share in one tap", captionPosition: "bottom" },
    ],
    ...plan,
  };
  const ctx = { plan: fullPlan, root, display: "iphone", locale, size: /** @type {[number, number]} */ ([886, 1920]), layers: manifest, tools: { ffmpeg: "/usr/local/bin/ffmpeg-test" }, jobs: 1 };
  return { root, set, ctx, segments, publicDir: path.join(root, "remotion", "public") };
}

test("the props hold the parts compose cuts, and public/ holds every file they name", async () => {
  const { set, ctx, segments, publicDir } = fixture({ locale: "de" });
  const before = server.requests.length;
  const props = await remotionProps(ctx, segments, publicDir);
  assert.deepEqual(
    { ...props, intro: undefined, outro: undefined, scenes: undefined, fonts: undefined },
    { width: 886, height: 1920, fps: 30, locale: "de", dir: "ltr", captionStyle: "panel", intro: undefined, scenes: undefined, outro: undefined, transition: { type: "fade", frames: 12 }, music: null, fonts: undefined },
  );
  assert.deepEqual(props.intro, {
    frames: 45,
    plate: `layers/${set}/plate.png`,
    logo: { file: `layers/${set}/de/intro-logo.png`, box: [343, 700, 200, 200], text: "" },
    text: { file: `layers/${set}/de/intro-text.png`, box: [100, 960, 686, 140], text: "Notes that keep up" },
  });
  assert.deepEqual(props.outro, { frames: 60, plate: `layers/${set}/plate.png`, logo: null, text: { file: `layers/${set}/de/outro-text.png`, box: [100, 900, 686, 200], text: "Try it today\nSubscription required" } });
  assert.deepEqual(
    props.scenes.map((/** @type {any} */ scene) => [scene.id, scene.frames, scene.video, scene.caption]),
    [
      ["inbox", 180, `segments/${path.basename(segments[0].file)}`, { file: `layers/${set}/de/caption-inbox.png`, box: [64, 132, 758, 236], text: "Alles an einem Ort", position: "top" }],
      ["search", 165, `segments/${path.basename(segments[1].file)}`, null],
      ["share", 210, `segments/${path.basename(segments[2].file)}`, { file: `layers/${set}/caption-share.png`, box: [64, 1560, 758, 236], text: "Share in one tap", position: "bottom" }],
    ],
  );
  // The parts overlap by the transition, as the ffmpeg cut's do: four joins of 12 frames.
  assert.equal(framesOf(props), 45 + 180 + 165 + 210 + 60 - 4 * 12);

  const named = [props.intro.plate, props.intro.logo.file, props.intro.text.file, props.outro.text.file, ...props.scenes.flatMap((/** @type {any} */ scene) => [scene.video, scene.caption?.file].filter(Boolean)), ...props.fonts.map((/** @type {any} */ font) => font.file)];
  for (const name of named) assert.ok(existsSync(path.join(publicDir, ...name.split("/"))), name);
  assert.equal(readFileSync(path.join(publicDir, "segments", path.basename(segments[2].file)), "utf8"), "segment share");

  // The project's font, fetched once and kept for a render without network.
  assert.deepEqual(props.fonts, [
    { family: "Fraunces Variable", weight: "100 900", style: "normal", unicodeRange: "U+0000-00FF,U+0131", file: "fonts/fraunces/fraunces-latin-wght-normal.woff2" },
    { family: "Fraunces Variable", weight: "100 900", style: "normal", unicodeRange: "U+0370-0377", file: "fonts/fraunces/fraunces-greek-wght-normal.woff2" },
  ]);
  assert.equal(readFileSync(path.join(publicDir, "fonts", "fraunces", "fraunces-greek-wght-normal.woff2"), "utf8"), "font /fonts/fraunces/fraunces-greek-wght-normal.woff2");
  assert.deepEqual(
    server.requests.slice(before).map((request) => request.url),
    ["/api/projects/p_example", "/fonts/fonts.css", "/fonts/fraunces/fraunces-latin-wght-normal.woff2", "/fonts/fraunces/fraunces-greek-wght-normal.woff2"],
  );
});

test("a plan without an intro, a cut without transitions and a language read from right to left", async () => {
  const { ctx, segments, publicDir } = fixture({ plan: { intro: false, transition: { type: "none", seconds: 0 } }, locale: "ar" });
  const props = await remotionProps(ctx, segments, publicDir);
  assert.equal(props.intro, null);
  assert.equal(props.dir, "rtl");
  assert.deepEqual(props.transition, { type: "none", frames: 0 });
  assert.equal(framesOf(props), 180 + 165 + 210 + 60);
});

test("a caption that has no layer, and scenes that are not the plan's, fail with what to do", async () => {
  const { ctx, segments, publicDir } = fixture();
  ctx.layers = { ...ctx.layers, layers: ctx.layers.layers.filter((layer) => layer.id !== "caption-inbox") };
  await assert.rejects(remotionProps(ctx, segments, publicDir), (error) => error instanceof Failure && error.message === 'The layers have no caption for scene "inbox" in en. Draw them again: appshots video layers --display iphone');
  await assert.rejects(remotionProps(fixture().ctx, segments.slice(1), publicDir), (error) => error instanceof Failure && /got 2 scenes to render, and the plan has 3/.test(error.message));
});

test("the music is brought to the previews' loudness once, and the template fades it", async () => {
  const { root, ctx, segments, publicDir } = fixture();
  const repo = path.dirname(root);
  mkdirSync(path.join(repo, "music"));
  writeFileSync(path.join(repo, "music", "theme.m4a"), "music");
  ctx.plan = { ...ctx.plan, music: { file: "music/theme.m4a", volume: 0.5, start: 2, fadeOut: 1 } };
  const calls = recorder((command, args) => {
    if (command === ctx.tools.ffmpeg) writeFileSync(args.at(-1), "normalised");
    return {};
  });
  const props = await remotionProps(ctx, segments, publicDir);
  assert.match(props.music.file, /^music\/[0-9a-f]{16}\.m4a$/);
  assert.deepEqual({ ...props.music, file: undefined }, { file: undefined, volume: 0.5, start: 2, fadeOut: 1 });
  assert.equal(readFileSync(path.join(publicDir, ...props.music.file.split("/")), "utf8"), "normalised");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf("-i") + 1], path.join(repo, "music", "theme.m4a"));
  assert.match(calls[0].args.join(" "), /loudnorm=I=-16:TP=-1\.5:LRA=11/);
  await remotionProps(ctx, segments, publicDir);
  assert.equal(calls.length, 1);

  ctx.plan = { ...ctx.plan, music: { file: "music/missing.m4a" } };
  await assert.rejects(remotionProps(ctx, segments, publicDir), (error) => error instanceof Failure && /The music file music\/missing\.m4a is not there/.test(error.message));
});

test("previews composed side by side prepare the music once, and one that failed is tried again", async () => {
  const { root, ctx, segments, publicDir } = fixture();
  const repo = path.dirname(root);
  mkdirSync(path.join(repo, "music"));
  writeFileSync(path.join(repo, "music", "theme.m4a"), "music");
  ctx.plan = { ...ctx.plan, music: { file: "music/theme.m4a" } };
  // ffmpeg holds on until a second one starts, or for a moment when none does.
  let started = () => {};
  let status = 1;
  const calls = recorder(async (command, args) => {
    if (command !== ctx.tools.ffmpeg) return {};
    const other = started;
    other();
    await new Promise((resolve) => {
      started = resolve;
      setTimeout(resolve, 200);
    });
    writeFileSync(args.at(-1), "normalised");
    return { status, stderr: status === 0 ? "" : "Invalid data found when processing input" };
  });
  await assert.rejects(remotionProps(ctx, segments, publicDir), (error) => error instanceof Failure && /^ffmpeg could not read the music file music\/theme\.m4a:\nInvalid data/.test(error.message));
  assert.deepEqual(readdirSync(path.join(publicDir, "music")), []);

  status = 0;
  const [first, second] = await Promise.all([remotionProps(ctx, segments, publicDir), remotionProps(ctx, segments, publicDir)]);
  assert.equal(calls.filter((call) => call.command === ctx.tools.ffmpeg).length, 2);
  assert.deepEqual(first.music, second.music);
  assert.deepEqual(readdirSync(path.join(publicDir, "music")), [path.basename(first.music.file)]);
  assert.equal(readFileSync(path.join(publicDir, ...first.music.file.split("/")), "utf8"), "normalised");
});

test("a manifest whose names would lead out of the layers' folder is refused", async () => {
  const { set, ctx, segments, publicDir } = fixture();
  ctx.layers = { ...ctx.layers, layers: ctx.layers.layers.map((layer) => (layer.id === "intro-text" ? { ...layer, id: "../../../victim" } : layer)) };
  await assert.rejects(
    remotionProps(ctx, segments, publicDir),
    (error) => error instanceof Failure && error.message === `The layers' manifest names a layer "${set}/en/../../../victim", which is not a layer's name. Fetch the layers again: appshots video layers --display iphone`,
  );
  const other = fixture();
  other.ctx.layers = { ...other.ctx.layers, set: "../../outside" };
  await assert.rejects(remotionProps(other.ctx, other.segments, other.publicDir), (error) => error instanceof Failure && /names a layer "\.\.\/\.\.\/outside\/en\/caption-inbox"/.test(error.message));
});

test("compose renders with npx remotion in the project, from the props it wrote", async () => {
  const { root, ctx, segments } = fixture();
  const folder = path.join(root, "remotion");
  await assert.rejects(composeRemotion(ctx, segments), (error) => error instanceof Failure && /There is no Remotion project in .*remotion\. .*run 'appshots video remotion'/.test(error.message));
  recorder();
  await quietly(() => scaffoldRemotion(root, { yes: true, install: false }));
  await assert.rejects(composeRemotion(ctx, segments), (error) => error instanceof Failure && /Remotion is not installed in .*remotion yet\. Install it: cd .*remotion && npm install$/.test(error.message));

  mkdirSync(path.join(folder, "node_modules", ".bin"), { recursive: true });
  writeFileSync(path.join(folder, "node_modules", ".bin", "remotion"), "");
  const calls = recorder((command, args, options) => {
    if (command === "npx") writeFileSync(path.join(options.cwd, args[4]), "rendered");
    return {};
  });
  let file;
  const printed = await quietly(async () => {
    file = await composeRemotion(ctx, segments);
  });
  assert.equal(file, path.join(folder, "out", "en-iphone.mp4"));
  assert.deepEqual(calls, [{ command: "npx", args: renderArgs("en-iphone"), cwd: folder }]);
  assert.deepEqual(renderArgs("en-iphone"), [
    "remotion",
    "render",
    "src/index.ts",
    "AppPreview",
    "out/en-iphone.mp4",
    "--props=props/en-iphone.json",
    "--codec=h264",
    "--crf=18",
    "--pixel-format=yuv420p",
    "--color-space=bt709",
    "--audio-codec=aac",
    "--audio-bitrate=256k",
    "--enforce-audio-track",
  ]);
  const props = JSON.parse(readFileSync(path.join(folder, "props", "en-iphone.json"), "utf8"));
  assert.equal(props.scenes.length, 3);
  assert.match(printed, /Remotion renders 612 frames from props\/en-iphone\.json/);
  assert.match(printed, /The first render downloads Chrome Headless Shell/);

  // The user's .tsx files are not touched by a compose: only props/ and public/ change.
  for (const file of TEMPLATE_FILES) assert.equal(readFileSync(path.join(folder, file), "utf8"), asset(`remotion/${file === ".gitignore" ? "gitignore" : file}`), file);

  recorder(() => ({ status: 1, stderr: "Error: Could not find composition with ID AppPreview" }));
  await assert.rejects(quietly(() => composeRemotion(ctx, segments)), (error) => error instanceof Failure && /^npx remotion failed \(exit 1\):\nError: Could not find composition/.test(error.message));
});

test("the build puts the files of cli/assets into the bundle, which reads no file of its own", async () => {
  const { assetFiles, bundleCli } = await import("../../scripts/build-cli.mjs");
  const names = assetFiles(path.join(repository, "cli", "assets"));
  assert.ok(names.includes("remotion/src/Root.tsx") && names.includes("remotion/gitignore"));
  const folder = mkdtempSync(path.join(home.home, "bundle-"));
  const entry = path.join(folder, "entry.mjs");
  writeFileSync(entry, `#!/usr/bin/env node\nimport { asset } from ${JSON.stringify(path.join(repository, "cli", "src", "assets.mjs"))};\nprocess.stdout.write(JSON.stringify(process.argv.slice(2).map(asset)));\n`);
  const code = await bundleCli(entry);
  const out = path.join(folder, "bundled.mjs");
  writeFileSync(out, code);
  // Run from a folder with no cli/assets next to it, as an installed CLI is.
  const texts = JSON.parse(execFileSync(process.execPath, [out, ...names], { encoding: "utf8" }));
  assert.deepEqual(
    texts,
    names.map((name) => readFileSync(path.join(repository, "cli", "assets", ...name.split("/")), "utf8")),
  );
  assert.ok(!code.includes("const INLINED = null;"));
});
