import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { projectRoute, request } from "./api.mjs";
import { fail } from "./fail.mjs";
import { shotDevice, shotLanguage } from "./shot.mjs";
import { pool, slugify } from "./util.mjs";

/** @typedef {import("./config.mjs").Config} Config */

/** How many files go to the server at once. A few keep the line busy without crowding a small server. */
const UPLOADS = 4;

/**
 * @param {Config} config
 * @param {string} project
 * @param {string} file
 * @param {string} name
 * @param {string} [device]
 * @param {string} [language]
 */
async function sendShot(config, project, file, name, device, language) {
  const query = new URLSearchParams({ ...(device ? { device } : {}), ...(language ? { locale: language } : {}) }).toString();
  const response = await request(config, "PUT", projectRoute(project, `/shots/${encodeURIComponent(name)}${query ? `?${query}` : ""}`), {
    body: readFileSync(file),
    headers: { "content-type": "application/octet-stream" },
  });
  return response.json();
}

/** @param {string} project */
const uploaded = (project) => (shot) => `Uploaded ${shot.name} (${[shot.device, shot.locale, `${shot.width}x${shot.height}`].filter(Boolean).join(", ")}) to ${project}`;

/**
 * @param {Config} config
 * @param {string} project
 * @param {string} file
 * @param {string} name
 * @param {string} [device]
 * @param {string} [language]
 */
export async function upload(config, project, file, name, device, language) {
  const shot = await sendShot(config, project, file, name, device, language);
  console.log(uploaded(project)(shot));
  return shot;
}

/**
 * Uploads a logo or other artwork, which slides place by its name.
 * @param {Config} config
 * @param {string} project
 * @param {string} file
 * @param {string} name
 */
async function sendImage(config, project, file, name) {
  const response = await request(config, "PUT", projectRoute(project, `/images/${encodeURIComponent(name)}`), {
    body: readFileSync(file),
    headers: { "content-type": "application/octet-stream" },
  });
  return response.json();
}

/**
 * A file stands for itself, a folder for the PNG and JPEG files directly inside it, in the order of their names.
 * @param {string} source
 * @param {RegExp} [kinds]
 */
export function picturesIn(source, kinds = /\.(png|jpe?g)$/i) {
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

/**
 * Sends files a few at a time and prints a line for each in the order they were given. Files that come out under
 * one name go one after the other, in that order, so the last of them is the one that stays, as when they went
 * one by one.
 * @template T, R
 * @param {T[]} files
 * @param {(file: T) => string} nameOf
 * @param {(file: T, name: string) => Promise<R>} send
 * @param {(result: R) => string} line
 * @returns {Promise<R[]>}
 */
async function sendAll(files, nameOf, send, line) {
  const groups = new Map();
  for (const [at, file] of files.entries()) {
    const name = nameOf(file);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(at);
  }
  /** @type {R[]} */
  const results = new Array(files.length);
  const done = new Array(files.length).fill(false);
  let printed = 0;
  await pool([...groups.entries()], UPLOADS, async ([name, indexes]) => {
    for (const at of indexes) {
      results[at] = await send(files[at], name);
      done[at] = true;
      for (; printed < files.length && done[printed]; printed++) console.log(line(results[printed]));
    }
  });
  return results;
}

/**
 * Uploads screenshots a few at a time, each under its name, family and language, and prints a line for each in the
 * order they were given, as appshots upload does.
 * @param {Config} config
 * @param {string} project
 * @param {Array<{ file: string, name: string, device?: string, language?: string }>} shots
 */
export function uploadShots(config, project, shots) {
  const key = (shot) => [shot.name, shot.device, shot.language].join(" ");
  return sendAll(shots, key, (shot) => sendShot(config, project, shot.file, shot.name, shot.device, shot.language), uploaded(project));
}

/**
 * @param {Config} config
 * @param {string} project
 * @param {string[]} sources
 * @param {Record<string, string | true>} flags
 */
export async function uploadAll(config, project, sources, flags) {
  const files = sources.flatMap((source) => picturesIn(source, flags.image ? /\.(png|jpe?g|svg|webp)$/i : undefined));
  if (typeof flags.name === "string" && files.length > 1) fail("--name only works with a single file.");
  const nameOf = (file) => slugify(typeof flags.name === "string" ? flags.name : path.parse(file).name);
  if (flags.image) {
    const images = await sendAll(files, nameOf, (file, name) => sendImage(config, project, file, name), (image) => `Uploaded image ${image.name} (${image.width}x${image.height}) to ${project}`);
    const names = new Set(images.map((image) => image.name));
    console.log(`${names.size} ${names.size === 1 ? "image" : "images"} uploaded to ${project}. Slides place them by name, as "logo" or in "images".`);
    return;
  }
  // The server tells an iPhone, an iPhone Duo and an iPad screenshot apart, so one name can stand for one of each.
  const device = shotDevice(flags);
  const language = shotLanguage(flags);
  const shots = await sendAll(files, nameOf, (file, name) => sendShot(config, project, file, name, device, language), uploaded(project));
  const sent = new Map();
  for (const [at, shot] of shots.entries()) {
    const earlier = sent.get(`${shot.name} ${shot.device}`);
    if (earlier) console.log(`  ! ${path.basename(files[at])} replaced ${path.basename(earlier)}: both come out as "${shot.name}". Rename one and upload it again.`);
    sent.set(`${shot.name} ${shot.device}`, files[at]);
  }
  console.log(`${sent.size} ${sent.size === 1 ? "screenshot" : "screenshots"} uploaded to ${project}`);
}
