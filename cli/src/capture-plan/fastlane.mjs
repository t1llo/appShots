import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fail } from "../fail.mjs";
import { uploadShots } from "../upload.mjs";
import { slugify } from "../util.mjs";
import { displayOfSize, PLAN_DISPLAYS, pngSize } from "./displays.mjs";
import { projectLocale } from "./jobs.mjs";

/** @typedef {import("../config.mjs").Config} Config */

/**
 * Splits the name fastlane snapshot gives a file into the simulator it was taken on and the name the UI test gave
 * it: "iPhone 17 Pro Max-01Home" is iPhone 17 Pro Max and 01Home. The first hyphen ends the simulator's name, apart
 * from the one in a size such as "13-inch". A name that starts with no device is the screenshot's name as it is.
 * @param {string} base The file name without .png.
 */
export function splitSnapshotName(base) {
  const match = /^((?:iPhone|iPad)\b.*?)-(?!inch\b)(.+)$/i.exec(base);
  return match ? { device: match[1], name: match[2] } : { device: null, name: base };
}

/**
 * The family a simulator's name says it is, for a picture whose size no display has.
 * @param {string | null} device
 * @returns {import("./displays.mjs").PlanKind | null}
 */
const kindOfName = (device) => (!device ? null : /^iPad/i.test(device) ? "ipad" : /^iPhone.*\bDuo\b/i.test(device) ? "duo" : /^iPhone/i.test(device) ? "iphone" : null);

/**
 * The name a picture goes by in the project: the one the UI test gave it, as a screenshot name. Where the plan has
 * a screen of that name once its leading number is gone, as home for 01Home, it is that screen.
 * @param {string} given
 * @param {string[] | null} ids The plan's screens.
 */
function shotName(given, ids) {
  const name = slugify(given);
  const bare = name.replace(/^\d+[-_]?/, "");
  return ids && !ids.includes(name) && ids.includes(bare) ? bare : name;
}

/**
 * @typedef {object} Imported
 * @property {string} file
 * @property {string} relative The file as it is in the fastlane folder, for what is printed.
 * @property {string} name The name it is uploaded under.
 * @property {string | null} display Null for a size no display has, filed by the simulator's name.
 * @property {import("./displays.mjs").PlanKind} kind
 * @property {string} locale The project's code of its language.
 */

/**
 * What fastlane snapshot wrote, as the project would take it: a folder per language, such as en-US, and in each a
 * PNG per simulator and screen, named "<simulator>-<name>.png". The size of a picture decides its display, and the
 * simulator's name its family where no display has that size. Pictures frameit made, ones of no iPhone or iPad and
 * a language the project lacks are left out, and so is all but one of the pictures that come out under one name,
 * family and language, as a project keeps one of each: the one of the display listed first, which is the larger.
 * @param {string} dir
 * @param {string[]} locales The project's languages, or those of them the run takes.
 * @param {{ only?: string[] | null, ids?: string[] | null }} [options] only: the names to take; ids: the plan's screens.
 */
export function fastlaneShots(dir, locales, { only = null, ids = null } = {}) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`No such folder: ${dir}. --fastlane takes the folder fastlane snapshot writes into, usually fastlane/screenshots.`);
  const folders = readdirSync(dir)
    .filter((name) => /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(name) && statSync(path.join(dir, name)).isDirectory())
    .sort();
  if (folders.length === 0) fail(`${dir} has no folder per language, such as en-US. fastlane snapshot writes into <output>/<language>/; point --fastlane at the folder that holds those, usually fastlane/screenshots.`);
  /** @type {Imported[]} */
  const found = [];
  /** @type {Array<{ relative: string, why: string }>} */
  const left = [];
  for (const folder of folders) {
    const locale = projectLocale(locales, folder);
    const files = readdirSync(path.join(dir, folder))
      .filter((name) => /\.png$/i.test(name) && !name.startsWith(".") && !/_framed\.png$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const entry of files) {
      const relative = path.join(folder, entry);
      if (!locale) {
        left.push({ relative, why: `the run takes no language ${folder}, only ${locales.join(", ")}` });
        continue;
      }
      const file = path.join(dir, relative);
      const parts = splitSnapshotName(path.parse(entry).name);
      const size = pngSize(file);
      const display = size ? displayOfSize(size.width, size.height) : null;
      const kind = display ? PLAN_DISPLAYS[display].kind : size ? kindOfName(parts.device) : null;
      if (!size || !kind) {
        left.push({ relative, why: size ? `${size.width}x${size.height} is the size of no iPhone or iPad display` : "it is not a PNG" });
        continue;
      }
      const name = shotName(parts.name, ids);
      if (only && !only.includes(name)) continue;
      found.push({ file, relative, name, display, kind, locale });
    }
  }
  const order = (shot) => (shot.display ? Object.keys(PLAN_DISPLAYS).indexOf(shot.display) : Infinity);
  /** @type {Map<string, Imported>} */
  const kept = new Map();
  for (const shot of found) {
    const key = `${shot.name} ${shot.kind} ${shot.locale}`;
    const other = kept.get(key);
    const why = (first) => `${first.relative} is ${shot.name} in ${shot.locale} already, and a project keeps one of each per family`;
    if (other && order(other) <= order(shot)) left.push({ relative: shot.relative, why: why(other) });
    else {
      if (other) left.push({ relative: other.relative, why: why(shot) });
      kept.set(key, shot);
    }
  }
  const chosen = new Set(kept.values());
  return { shots: found.filter((shot) => chosen.has(shot)), left };
}

/**
 * Uploads what fastlane snapshot wrote, each under its name, family and language, in place of what the project has.
 * @param {Config} config
 * @param {{ project: string, locales: string[], dir: string, only: string[] | null, ids: string[] | null, dryRun: boolean }} options
 */
export async function importFastlane(config, { project, locales, dir, only, ids, dryRun }) {
  const { shots, left } = fastlaneShots(dir, locales, { only, ids });
  for (const shot of shots) console.log(`${shot.relative} -> ${shot.name} (${[shot.display ?? shot.kind, shot.locale].join(", ")})`);
  for (const { relative, why } of left) console.log(`  ! Left out ${relative}: ${why}.`);
  const count = (n) => `${n} ${n === 1 ? "screenshot" : "screenshots"}`;
  if (shots.length === 0) fail(`Nothing in ${dir} to import${only ? ` named ${only.join(", ")}` : ""}.`);
  if (dryRun) return console.log(`Would upload ${count(shots.length)} to ${project}. Nothing was uploaded (--dry-run).`);
  await uploadShots(config, project, shots.map((shot) => ({ file: shot.file, name: shot.name, device: shot.kind, language: shot.locale })));
  console.log(`Imported ${count(shots.length)} from fastlane into ${project}.`);
}
