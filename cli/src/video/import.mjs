import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fail } from "../fail.mjs";
import { confirm } from "../prompt.mjs";
import { findFfmpeg } from "./ffmpeg.mjs";
import { planHash } from "./plan.mjs";
import { pointAtPrimary, workFolder } from "./record/index.mjs";
import { MOVIES, autoTrim, footageDisplay, inspectMovie, rawDir, round2, sidecar, writeJson } from "./record/session.mjs";

/**
 * Points to pixels of a movie made elsewhere, by the screen it most likely shows: an iPad has 2, an iPhone 3
 * unless it is one of the narrow ones that have 2, a Mac 2 unless the window is small enough to be 1.
 * @param {string} display
 * @param {[number, number]} size
 */
const likelyScale = (display, size) => (display === "ipad" ? 2 : display === "mac" ? (Math.max(...size) >= 2000 ? 2 : 1) : Math.min(...size) <= 828 ? 2 : 3);

/**
 * 'appshots video import <file>': a recording made elsewhere, such as QuickTime's of a plugged-in iPhone, as a
 * scene's footage. The movie is copied as it is, with its own kind; its sidecar says it was imported and takes
 * its length for the scene's.
 * @param {any} plan
 * @param {string | undefined} file
 * @param {Record<string, string | true | undefined>} flags
 * @returns {Promise<import("./record/session.mjs").Sidecar & { file: string }>}
 */
export async function importFootage(plan, file, flags) {
  const scenes = /** @type {any[]} */ (plan.scenes ?? []);
  const ids = scenes.map((scene) => scene.id).join(", ");
  if (typeof file !== "string" || !file) fail(`Name the movie to import, as in: appshots video import ~/Movies/${scenes[0]?.id ?? "inbox"}.mov --scene ${scenes[0]?.id ?? "inbox"}`);
  const source = path.resolve(file);
  if (!existsSync(source) || !statSync(source).isFile()) fail(`No such file: ${file}`);
  const name = path.basename(source);
  const extension = path.extname(source).toLowerCase();
  if (!MOVIES.includes(extension)) fail(`${name} is not a kind of movie appShots takes: ${MOVIES.join(", ")}. QuickTime Player saves a .mov.`);
  if (typeof flags.scene !== "string") fail(`--scene says which scene ${name} is, as in: --scene ${scenes[0]?.id ?? "inbox"}. The plan's scenes: ${ids}`);
  const scene = scenes.find((each) => each.id === flags.scene) ?? fail(`The plan has no scene "${flags.scene}". Its scenes: ${ids}`);
  const locales = /** @type {string[]} */ (plan.locales ?? []);
  const locale = typeof flags.lang === "string" ? flags.lang : (locales[0] ?? fail(`--lang says which language ${name} shows, as in: --lang en.`));
  if (locales.length > 0 && !locales.includes(locale)) fail(`The plan has no language "${locale}". Its languages: ${locales.join(", ")}`);
  const displays = [...new Set((/** @type {string[]} */ (plan.displays ?? [])).map(footageDisplay))];
  const display =
    typeof flags.display === "string"
      ? footageDisplay(flags.display)
      : displays.length === 1
        ? displays[0]
        : fail(`The plan has the displays ${displays.join(", ")}; say which one ${name} is for with --display, as in: --display ${displays[0] ?? "iphone"}.`);
  if (!displays.includes(display)) fail(`The plan has no display "${flags.display}". Its displays: ${displays.join(", ")}`);

  const root = workFolder(flags);
  // As for a recording, the ffmpeg that will cut the footage is the one asked for.
  const tools = await findFfmpeg({ root, ask: confirm });
  const movie = await inspectMovie(source, tools);
  if (!movie || movie.streams === 0) fail(`${name} holds no video that ffprobe can read.`);
  if (movie.duration < 1) fail(`${name} is ${round2(movie.duration)} seconds long; a scene's footage takes a second at least.`);

  const dir = rawDir(root, display, locale);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${scene.id}${extension}`);
  // Copied under another name first, so an earlier recording stays until this one is all there.
  const part = path.join(dir, `${scene.id}.import${extension}`);
  try {
    copyFileSync(source, part);
    for (const other of MOVIES) rmSync(path.join(dir, `${scene.id}${other}`), { force: true });
    renameSync(part, target);
  } finally {
    rmSync(part, { force: true });
  }
  const trim = scene.trim === "auto" ? await autoTrim(target, { wall: movie.duration, padded: false }, tools) : null;
  const data = sidecar({
    scene: scene.id,
    locale,
    display,
    source: "import",
    model: "",
    os: "",
    size: movie.size,
    scale: likelyScale(display, movie.size),
    orientation: display === "mac" ? "landscape" : (plan.orientation ?? "portrait"),
    wall: movie.duration,
    driverOffset: 0,
    touches: [],
    trim,
    planHash: planHash(plan),
  });
  writeJson(path.join(dir, `${scene.id}.json`), data);
  console.log(`Imported ${name} as ${scene.id} (${locale}, ${display}): ${movie.size[0]}×${movie.size[1]}, ${data.wall} s${trim ? `, trimmed to ${trim[0]}–${trim[1]} s` : ""} -> ${path.relative(process.cwd(), target) || target}`);
  if (plan.footage === "primary" && locale === locales[0]) {
    const pointed = pointAtPrimary(root, { displays: [display], scenes: [scene.id], locales, primary: locale }, false);
    if (pointed.length > 0) console.log(`  ${pointed.map((each) => each.locale).join(", ")} use${pointed.length === 1 ? "s" : ""} it too, as the plan records one language's footage for all.`);
  }
  return { ...data, file: target };
}
