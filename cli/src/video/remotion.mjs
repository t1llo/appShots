// Remotion, as an optional layer of the app previews: captions and cards that spring and slide in, drawn by a
// small Remotion project in the user's own repository. Remotion is not open source and is never part of appShots.
// 'appshots video remotion' explains its licence and, after a yes, writes the project into appshots-video/remotion/
// and installs Remotion there from npm. 'appshots video compose --engine remotion' then fills the project's
// props/ and public/ for each preview and runs `npx remotion render` there; compose encodes what comes out to
// Apple's specification as it does its own.

import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoute, request } from "../api.mjs";
import { asset } from "../assets.mjs";
import { readConfig } from "../config.mjs";
import { fail } from "../fail.mjs";
import { run } from "../proc.mjs";
import { promptLine } from "../prompt.mjs";
import { readJson } from "../util.mjs";

/** The Remotion the template is written for. Its package.json pins every Remotion package to exactly this. */
export const REMOTION_VERSION = "4.0.535";

/**
 * What the user is told before anything of Remotion's is written or installed, and agrees to at the Terminal or,
 * through their agent, with --yes. The one place the CLI describes Remotion's licence.
 */
export const REMOTION_LICENCE = `Remotion makes the animated captions and cards. It is not open source: it is free for individuals, for
companies of up to 3 people and for non-profits; a larger company needs a Remotion Company License (see
remotion.pro/license), paid per seat or per render. appShots does not include Remotion. This writes a small
Remotion project into appshots-video/remotion/ in your repository and installs Remotion there from npm, under
Remotion's licence. The first render also downloads Chrome Headless Shell (about 170 MB). appShots leaves the
changes you make to the files it writes there alone.`;

/**
 * The files of the Remotion project, by where they go in appshots-video/remotion/. Each is written from the asset
 * of the same name under remotion/, but for .gitignore: a file of that name in cli/assets would tell appShots' own
 * repository what to ignore.
 */
export const TEMPLATE_FILES = ["package.json", "remotion.config.ts", "tsconfig.json", "README.md", ".gitignore", "src/index.ts", "src/Root.tsx", "src/AppPreview.tsx", "src/Scene.tsx", "src/Caption.tsx", "src/Intro.tsx", "src/Outro.tsx", "src/props.ts"];

/** @param {string} file */
const templateOf = (file) => asset(`remotion/${file === ".gitignore" ? "gitignore" : file}`);

/** Frames a second of every preview. */
const FPS = 30;

/** @param {number} seconds */
const toFrames = (seconds) => Math.round(seconds * FPS);

/** Changes when the music is prepared differently, so that a file prepared before is made again. */
const MUSIC_VERSION = 1;

/** Languages written from right to left; the live text of the template follows them. */
const RTL = new Set(["ar", "he", "fa", "ur"]);

/**
 * A path as the user reads it: from the folder the command runs in when it is inside it, else in full.
 * @param {string} file
 */
function shown(file) {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative || ".";
}

/**
 * A yes or no from the person at the Terminal; no when they only press Return, as nothing here should happen
 * by accident.
 * @param {string} question
 */
async function agrees(question) {
  return /^y(es)?$/i.test(await promptLine(`${question} [y/N] `, "There is nobody at a terminal to answer."));
}

/**
 * Runs npm or npx in the Remotion project. At a terminal what it prints is shown as it goes, as one progress line
 * that redraws itself; for an agent it is kept back, as a render would print a line for each frame. A missing
 * program fails with how to get it; one that fails, with its last lines and how to see the rest.
 * @param {string} command
 * @param {string[]} args
 * @param {string} folder
 * @param {number} timeout
 */
async function inProject(command, args, folder, timeout) {
  const result = await run(command, args, { cwd: folder, timeout, stdio: ["ignore", process.stdout.isTTY ? "inherit" : "pipe", "pipe"] });
  if (result.error) fail(`${command} is not on this Mac. It comes with Node.js (nodejs.org), which Remotion needs as well. Install it, then run this again.`);
  const line = `cd ${shown(folder)} && ${command} ${args.join(" ")}`;
  if (result.timedOut) fail(`${command} ${args[0]} took longer than ${Math.round(timeout / 60000)} minutes and was stopped. Run it yourself to see where it stops: ${line}`);
  if (result.status !== 0) {
    const tail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-20).join("\n");
    fail(`${command} ${args[0]} failed${result.status === null ? "" : ` (exit ${result.status})`}${tail ? `:\n${tail}\n` : ". "}Run it yourself to see more: ${line}`);
  }
  return result;
}

/**
 * Writes the Remotion project into appshots-video/remotion/ and installs it, once the user has agreed to
 * Remotion's licence: at the Terminal, or in a chat with their agent, which then passes `yes`. Files that are
 * there already stay as they are, the user's changes with them; `again` puts appShots' template back over the
 * ones that differ, after saying which they are and asking. That is a question of its own, as the yes to the
 * licence does not give away the user's changes: `replace` passes the user's answer to it from a chat.
 * @param {string} root The work folder, appshots-video/ next to the plan.
 * @param {{ yes?: boolean, install?: boolean, again?: boolean, replace?: boolean }} [options] `install: false` writes the files only.
 * @returns {Promise<{ folder: string, written: string[], installed: boolean }>}
 */
export async function scaffoldRemotion(root, { yes = false, install = true, again = false, replace = false } = {}) {
  const folder = path.join(root, "remotion");
  const rerun = (/** @type {boolean} */ replacing) => `appshots video remotion --yes${again ? " --again" : ""}${again && replacing ? " --replace" : ""}${install ? "" : " --no-install"}`;
  if (!yes && !process.stdin.isTTY) fail(`${REMOTION_LICENCE}\n\nThis needs the user's yes. Show them the text above and ask whether to go on; after a yes, run: ${rerun(replace)}`);
  console.log(REMOTION_LICENCE);
  if (!yes && !(await agrees("Continue?"))) {
    console.log("Nothing was written.");
    return { folder, written: [], installed: false };
  }

  const files = TEMPLATE_FILES.map((file) => {
    const target = path.join(folder, file);
    const text = templateOf(file);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    return { file, target, text, state: current === null ? "new" : current === text ? "same" : "changed" };
  });
  const changed = files.filter((entry) => entry.state === "changed");
  let replacing = false;
  if (changed.length > 0) {
    const list = changed.map((entry) => `  ${entry.file}`).join("\n");
    const losing = `These differ from appShots' template, and putting it back loses the changes in them:\n${list}`;
    if (!again) console.log(`${shown(folder)} is there already. These differ from appShots' template and stay as they are:\n${list}\nTo put the template back over them: appshots video remotion --again`);
    else if (!replace && !process.stdin.isTTY)
      fail(`${losing}\n\nThis needs the user's yes, apart from the one to Remotion's licence. Show them the list and ask whether to replace these files; after a yes, run: ${rerun(true)}`);
    else {
      console.log(losing);
      replacing = replace || (await agrees(`Replace ${changed.length === 1 ? "it" : `these ${changed.length}`} with the template?`));
      if (!replacing) console.log("They stay as they are.");
    }
  }
  const written = [];
  for (const entry of files) {
    if (entry.state === "same" || (entry.state === "changed" && !replacing)) continue;
    mkdirSync(path.dirname(entry.target), { recursive: true });
    writeFileSync(entry.target, entry.text);
    written.push(entry.file);
  }
  if (written.length > 0) console.log(`Wrote ${written.length} file${written.length === 1 ? "" : "s"} into ${shown(folder)}: ${written.join(", ")}`);
  else if (changed.length === 0) console.log(`${shown(folder)} has appShots' template already.`);

  const there = existsSync(path.join(folder, "node_modules", "remotion", "package.json"));
  let installed = there && !written.includes("package.json");
  if (!install) console.log(installed ? "Remotion is installed there." : `Remotion is not installed there yet. To install it: cd ${shown(folder)} && npm install`);
  else if (installed) console.log("Remotion is installed there already.");
  else {
    console.log(`Installing Remotion ${REMOTION_VERSION} in ${shown(folder)} with npm. This takes a few minutes.`);
    await inProject("npm", ["install", "--no-audit", "--no-fund"], folder, 20 * 60000);
    installed = true;
  }

  if (installed) {
    // Remotion's own skills help an agent change the project. They are Remotion's to offer: a separate question.
    const skills = `cd ${shown(folder)} && npx remotion skills add`;
    if (!process.stdin.isTTY) console.log(`Remotion has skills of its own for coding agents. To add them, ask the user, then run: ${skills}`);
    else if (await agrees("Remotion has skills of its own for coding agents. Add them now (npx remotion skills add)?")) await inProject("npx", ["remotion", "skills", "add"], folder, 5 * 60000);
  }
  console.log(`Next: appshots video compose --engine remotion`);
  return { folder, written, installed };
}

/**
 * @typedef {{ id: string, locale: string | null, kind: string, width?: number, height?: number, box?: number[] | null, text?: string }} Layer
 * @typedef {{ set: string, size?: [number, number], layers: Layer[] }} Manifest
 *
 * @typedef {object} Context What one preview is made from, as compose passes it: one display, one language.
 * @property {any} plan The plan as readPlan returns it.
 * @property {string} root The work folder, appshots-video/ next to the plan.
 * @property {string} display
 * @property {string} locale
 * @property {[number, number]} size
 * @property {Manifest} layers The display's layer set, its files under layers/<set>/.
 * @property {{ ffmpeg: string }} tools
 *
 * @typedef {{ scene: string, file: string, seconds: number, frames?: number }} Segment A scene as stage 1 cut it,
 *   without a caption or touches.
 *
 * @typedef {{ file: string, box: number[] | null, text: string }} Picture
 * @typedef {{ family: string, file: string, weight?: string, style?: string, unicodeRange?: string }} Font
 */

let partials = 0;

/**
 * The name a file is made under before it is put in place: one of its own for each file being made, in this
 * process and in any other making the same file at the same time.
 * @param {string} file
 */
const partialOf = (file) => `${file}.${process.pid}-${++partials}.partial`;

/**
 * What `work` makes for `key`, made once however many previews ask for it at the same time, as compose makes
 * several side by side. A failure is not kept, so that the next to ask tries again.
 * @template T
 * @param {Map<string, Promise<T>>} made
 * @param {string} key
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
function once(made, key, work) {
  let promise = made.get(key);
  if (!promise) {
    promise = work().catch((error) => {
      made.delete(key);
      throw error;
    });
    made.set(key, promise);
  }
  return promise;
}

/**
 * Puts a file into the project's public/ folder, where the render reads it, and returns its path there. A copy
 * that is there already and not older than the file is kept; on the Mac's own disks a copy is a clone and takes
 * no room.
 * @param {string} file
 * @param {string} publicDir
 * @param {string} name Its path in public/, with "/" between folders.
 */
function place(file, publicDir, name) {
  const target = path.join(publicDir, ...name.split("/"));
  const source = statSync(file);
  if (!existsSync(target) || statSync(target).size !== source.size || statSync(target).mtimeMs < source.mtimeMs) {
    mkdirSync(path.dirname(target), { recursive: true });
    const partial = partialOf(target);
    copyFileSync(file, partial, constants.COPYFILE_FICLONE);
    renameSync(partial, target);
  }
  return name;
}

/**
 * Writes a file under another name first and then puts it in place, so that a render never reads half of it.
 * @param {string} file
 * @param {string | Buffer} content
 */
function writeWhole(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = partialOf(file);
  writeFileSync(partial, content);
  renameSync(partial, file);
}

/**
 * The faces of one font in the server's stylesheet of fonts: the first file of each @font-face whose files are
 * that font's, with what the browser needs to pick it.
 * @param {string} css The text of /fonts/fonts.css.
 * @param {string} id The font's id, such as "inter".
 */
export function facesOf(css, id) {
  const faces = [];
  for (const [, block] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const value = (/** @type {string} */ property) => new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(block)?.[1].trim();
    const url = /url\(\s*['"]?\/fonts\/([a-z0-9-]+)\/([a-z0-9-]+\.woff2?)['"]?\s*\)/.exec(block);
    const family = value("font-family")?.replace(/^['"]|['"]$/g, "");
    if (!url || url[1] !== id || !family) continue;
    const weight = value("font-weight");
    const style = value("font-style");
    const unicodeRange = value("unicode-range");
    faces.push({ family, name: url[2], ...(weight ? { weight } : {}), ...(style ? { style } : {}), ...(unicodeRange ? { unicodeRange } : {}) });
  }
  return faces;
}

/** @type {Map<string, Promise<Font[]>>} The project's fonts by Remotion project and appShots project, so each is asked of the server once a run. */
const fontsFetched = new Map();

/**
 * The project's font, for the template's live text: each of its files in public/fonts/<font>/, fetched from the
 * server's public /fonts once and kept there, so that a render needs no network.
 * @param {any} plan
 * @param {string} publicDir
 */
const projectFonts = (plan, publicDir) => once(fontsFetched, `${publicDir}\n${plan.project}`, () => fetchFonts(plan, publicDir));

/**
 * @param {any} plan
 * @param {string} publicDir
 * @returns {Promise<Font[]>}
 */
async function fetchFonts(plan, publicDir) {
  const config = readConfig();
  if (!config.url) fail("No server configured. Run the setup command from Connect in the Studio, or 'appshots login <url>'.");
  const { project } = await (await request(config, "GET", projectRoute(plan.project))).json();
  const id = typeof project?.theme?.font === "string" ? project.theme.font : "inter";
  const folder = path.join(publicDir, "fonts", id);
  const record = path.join(folder, "faces.json");
  let faces = readJson(record);
  if (!Array.isArray(faces) || faces.some((face) => !existsSync(path.join(folder, face.name)))) {
    faces = facesOf(await (await request(config, "GET", "/fonts/fonts.css")).text(), id);
    if (faces.length === 0) fail(`The server's fonts.css has no files of the font "${id}".`);
    for (const face of faces) {
      const file = path.join(folder, face.name);
      if (!existsSync(file)) writeWhole(file, Buffer.from(await (await request(config, "GET", `/fonts/${id}/${face.name}`)).arrayBuffer()));
    }
    writeWhole(record, `${JSON.stringify(faces, null, 2)}\n`);
  }
  return faces.map(({ name, ...face }) => ({ ...face, file: `fonts/${id}/${name}` }));
}

/**
 * The plan's music, brought to the loudness of the previews compose cuts with ffmpeg (-16 LUFS, -1.5 dBTP) and to
 * 48 kHz stereo, in public/music/. Volume, start and the fades are the template's to apply.
 * @param {Context} ctx
 * @param {string} publicDir
 */
async function prepareMusic(ctx, publicDir) {
  const music = ctx.plan.music;
  if (!music) return null;
  if (typeof music.file !== "string" || music.file === "") fail("music.file in the plan needs the path of an audio file, such as music/theme.m4a.");
  const file = path.resolve(ctx.plan.root ?? path.dirname(ctx.root), music.file);
  if (!existsSync(file) || !statSync(file).isFile()) fail(`The music file ${music.file} is not there (looked at ${file}). Put the file there, or take "music" out of the plan for a silent preview.`);
  const stat = statSync(file);
  const key = createHash("sha256").update(JSON.stringify({ version: MUSIC_VERSION, file, size: stat.size, mtime: Math.round(stat.mtimeMs) })).digest("hex").slice(0, 16);
  const name = `music/${key}.m4a`;
  const target = path.join(publicDir, "music", `${key}.m4a`);
  if (!existsSync(target)) await once(musicPrepared, target, () => normalise(ctx.tools.ffmpeg, file, music.file, target));
  return { file: name, volume: music.volume ?? 0.8, start: music.start ?? 0, fadeOut: music.fadeOut ?? 1.5 };
}

/** @type {Map<string, Promise<void>>} The music files being prepared, by where they go. */
const musicPrepared = new Map();

/**
 * Makes the prepared music at `target` under another name first, so that a render never reads half of it, and
 * leaves nothing behind when ffmpeg fails.
 * @param {string} ffmpeg
 * @param {string} file The plan's music file.
 * @param {string} asWritten Its path as the plan writes it.
 * @param {string} target
 */
async function normalise(ffmpeg, file, asWritten, target) {
  mkdirSync(path.dirname(target), { recursive: true });
  // The extension tells ffmpeg what to write.
  const partial = `${partialOf(target)}.m4a`;
  const result = await run(
    ffmpeg,
    ["-nostdin", "-hide_banner", "-y", "-i", file, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo", "-c:a", "aac", "-b:a", "256k", partial],
    { timeout: 5 * 60000 },
  );
  if (result.status !== 0) {
    rmSync(partial, { force: true });
    fail(`ffmpeg could not read the music file ${asWritten}:\n${result.stderr.trim().split("\n").slice(-10).join("\n")}`);
  }
  renameSync(partial, target);
}

/** A layer set's id, a language code or a layer's id: the names a layer's file is found by. */
const LAYER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/** @param {any} scene */
const hasCaption = (scene) => scene.caption !== undefined && scene.caption !== null && scene.caption !== false;

/**
 * The props of one preview for the template's AppPreview composition (src/props.ts), with every file they name
 * put into public/. Parts and lengths are the ones compose cuts with ffmpeg: an intro or outro card when the plan
 * asked the server for one, the scenes as stage 1 cut them, and the plan's transition between them.
 * @param {Context} ctx
 * @param {Segment[]} segments One for each of the plan's scenes, in its order.
 * @param {string} publicDir
 */
export async function remotionProps(ctx, segments, publicDir) {
  const { plan, layers, locale, display, size } = ctx;
  if (segments.length !== plan.scenes.length) fail(`Remotion got ${segments.length} scenes to render, and the plan has ${plan.scenes.length}.`);
  const type = plan.transition?.type ?? "fade";
  const transition = { type, frames: type === "none" ? 0 : toFrames(plan.transition?.seconds ?? 0.4) };

  // A layer of the set for this language: its own, or the one every language shares.
  const layerOf = (/** @type {string} */ kind, /** @type {string | undefined} */ id) => {
    const fits = (/** @type {Layer} */ layer) => layer.kind === kind && (id === undefined || layer.id === id);
    return layers.layers.find((layer) => fits(layer) && layer.locale === locale) ?? layers.layers.find((layer) => fits(layer) && layer.locale === null) ?? null;
  };
  const fileOf = (/** @type {Layer} */ layer) => {
    const folders = [layers.set, ...(layer.locale ? [layer.locale] : [])];
    // The names become folders and files, so a manifest that came apart must not reach outside layers/ and public/.
    if (![...folders, layer.id].every((part) => typeof part === "string" && LAYER_NAME.test(part)))
      fail(`The layers' manifest names a layer ${JSON.stringify([...folders, layer.id].join("/"))}, which is not a layer's name. Fetch the layers again: appshots video layers --display ${display}`);
    const parts = [...folders, `${layer.id}.png`];
    const file = path.join(ctx.root, "layers", ...parts);
    if (!existsSync(file)) fail(`The layer ${layer.id}${layer.locale ? ` for ${layer.locale}` : ""} is not in ${path.dirname(file)}. Fetch the layers again: appshots video layers --display ${display}`);
    return place(file, publicDir, ["layers", ...parts].join("/"));
  };
  /** @returns {Picture | null} */
  const pictureOf = (/** @type {Layer | null} */ layer) => (layer ? { file: fileOf(layer), box: Array.isArray(layer.box) ? layer.box : null, text: layer.text ?? "" } : null);

  const card = (/** @type {"intro" | "outro"} */ kind) => {
    if (plan[kind] === false) return null;
    const logo = layerOf(`${kind}-logo`);
    const text = layerOf(`${kind}-text`);
    // The plan asked the server for a card only if it wants one, so the layers say whether there is one.
    if (!logo && !text) return null;
    const plate = layerOf("plate");
    return { frames: toFrames(plan[kind]?.seconds ?? (kind === "intro" ? 1.5 : 2)), plate: plate && fileOf(plate), logo: pictureOf(logo), text: pictureOf(text) };
  };

  const scenes = plan.scenes.map((/** @type {any} */ scene, /** @type {number} */ at) => {
    const segment = segments[at];
    if (segment.scene !== scene.id) fail(`Remotion got scene "${segment.scene}" where the plan has "${scene.id}".`);
    let caption = null;
    if (hasCaption(scene)) {
      const layer = layerOf("caption", `caption-${scene.id}`);
      if (!layer) fail(`The layers have no caption for scene "${scene.id}" in ${locale}. Draw them again: appshots video layers --display ${display}`);
      caption = { ...pictureOf(layer), position: scene.captionPosition === "bottom" ? "bottom" : "top" };
    }
    return { id: scene.id, video: place(segment.file, publicDir, `segments/${path.basename(segment.file)}`), frames: segment.frames ?? toFrames(segment.seconds), caption };
  });

  // Only live text needs the font, and it is off unless the user turned it on: a server that cannot be reached
  // costs that text its face, not the preview.
  /** @type {Font[]} */
  let fonts = [];
  try {
    fonts = await projectFonts(plan, publicDir);
  } catch (error) {
    console.log(`  The project's font could not be fetched, so live text would be in the system's font: ${error.message}`);
  }
  return {
    width: size[0],
    height: size[1],
    fps: FPS,
    locale,
    dir: RTL.has(locale.split("-")[0].toLowerCase()) ? "rtl" : "ltr",
    captionStyle: plan.captionStyle ?? "panel",
    intro: card("intro"),
    scenes,
    outro: card("outro"),
    transition,
    music: await prepareMusic(ctx, publicDir),
    fonts,
  };
}

/**
 * The frames a preview with these props runs: its parts, less the frames two of them overlap in a transition.
 * The same sum as durationOf in the template's src/props.ts.
 * @param {{ intro: { frames: number } | null, scenes: Array<{ frames: number }>, outro: { frames: number } | null, transition: { type: string, frames: number } }} props
 */
export function framesOf(props) {
  const parts = [...(props.intro ? [props.intro.frames] : []), ...props.scenes.map((scene) => scene.frames), ...(props.outro ? [props.outro.frames] : [])];
  const overlap = props.transition.type === "none" ? 0 : props.transition.frames;
  return Math.max(1, parts.reduce((sum, frames) => sum + frames, 0) - Math.max(0, parts.length - 1) * overlap);
}

/**
 * The arguments of `npx` that render one preview, from inside the Remotion project.
 * @param {string} name The preview's name there, such as "en-iphone".
 */
export const renderArgs = (name) => [
  "remotion",
  "render",
  "src/index.ts",
  "AppPreview",
  `out/${name}.mp4`,
  `--props=props/${name}.json`,
  "--codec=h264",
  "--crf=18",
  "--pixel-format=yuv420p",
  "--color-space=bt709",
  "--audio-codec=aac",
  "--audio-bitrate=256k",
  "--enforce-audio-track",
];

/**
 * Renders one preview with Remotion: the scenes as stage 1 cut them, without captions or touches, and around and
 * over them what the template draws from the server's layers. Writes props/<locale>-<display>.json, which is all
 * that changes in the project when the plan does, and returns the file Remotion made, for compose's final pass.
 * @param {Context} ctx
 * @param {Segment[]} segments
 * @returns {Promise<string>}
 */
export async function composeRemotion(ctx, segments) {
  const folder = path.join(ctx.root, "remotion");
  if (!existsSync(path.join(folder, "package.json")))
    fail(`There is no Remotion project in ${shown(folder)}. It comes with Remotion's licence, which the user has to agree to: run 'appshots video remotion', which explains it, then compose again.`);
  if (!existsSync(path.join(folder, "node_modules", ".bin", "remotion"))) fail(`Remotion is not installed in ${shown(folder)} yet. Install it: cd ${shown(folder)} && npm install`);
  const name = `${ctx.locale}-${ctx.display}`;
  const props = await remotionProps(ctx, segments, path.join(folder, "public"));
  writeWhole(path.join(folder, "props", `${name}.json`), `${JSON.stringify(props, null, 2)}\n`);
  const out = path.join(folder, "out", `${name}.mp4`);
  mkdirSync(path.dirname(out), { recursive: true });
  console.log(`  Remotion renders ${framesOf(props)} frames from props/${name}.json; a 30-second preview takes a minute or two.`);
  if (!existsSync(path.join(folder, "node_modules", ".remotion"))) console.log("  The first render downloads Chrome Headless Shell (about 170 MB).");
  await inProject("npx", renderArgs(name), folder, 30 * 60000);
  if (!existsSync(out) || statSync(out).size === 0) fail(`Remotion finished without writing ${shown(out)}. Render it yourself to see why: cd ${shown(folder)} && npx ${renderArgs(name).join(" ")}`);
  return out;
}
