import { lstatSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { BUILD_CACHE, tilde } from "./config.mjs";
import { fail } from "./fail.mjs";

/**
 * How much a file or folder takes on disk, in bytes.
 * @param {string} file
 * @returns {number}
 */
function sizeOf(file) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  let names = [];
  try {
    names = readdirSync(file);
  } catch {}
  return names.reduce((sum, name) => sum + sizeOf(path.join(file, name)), 0);
}

/** @param {number} bytes */
const amount = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

/**
 * Removes what 'appshots run' keeps between builds: the build logs and, for --fresh, the builds themselves. With
 * --older-than only those of projects not built for that many days.
 * @param {Record<string, string | true>} flags
 */
export function clean(flags) {
  if (flags["older-than"] === true) fail("--older-than needs a number of days, as in: --older-than 30");
  const days = flags["older-than"] === undefined ? 0 : Number(String(flags["older-than"]).replace(/d$/i, ""));
  if (!(days >= 0)) fail("--older-than needs a number of days, as in: --older-than 30");
  const dry = Boolean(flags["dry-run"]);
  let names = [];
  try {
    names = readdirSync(BUILD_CACHE);
  } catch {}
  // A project's log and its build go together, and the later of the two says when it was last built.
  const projects = new Map();
  for (const name of names) {
    const project = name.replace(/\.log$/, "");
    let stat;
    try {
      stat = lstatSync(path.join(BUILD_CACHE, name));
    } catch {
      continue;
    }
    const entry = projects.get(project) ?? { files: [], used: 0 };
    entry.files.push(path.join(BUILD_CACHE, name));
    entry.used = Math.max(entry.used, stat.mtimeMs);
    projects.set(project, entry);
  }
  const before = Date.now() - days * 86400000;
  const old = [...projects.entries()].filter(([, entry]) => entry.used <= before).sort(([a], [b]) => a.localeCompare(b));
  if (old.length === 0) {
    console.log(projects.size === 0 ? `There are no builds in ${tilde(BUILD_CACHE)}.` : `None of the ${projects.size} builds in ${tilde(BUILD_CACHE)} is older than ${days} days.`);
    return;
  }
  let freed = 0;
  for (const [project, entry] of old) {
    const size = entry.files.reduce((sum, file) => sum + sizeOf(file), 0);
    freed += size;
    const age = Math.floor((Date.now() - entry.used) / 86400000);
    console.log(`  ${project}  (last built ${age === 0 ? "today" : age === 1 ? "a day ago" : `${age} days ago`}, ${amount(size)})`);
    if (!dry) for (const file of entry.files) rmSync(file, { recursive: true, force: true });
  }
  const count = `${old.length} ${old.length === 1 ? "build" : "builds"}`;
  console.log(dry ? `Would remove ${count} from ${tilde(BUILD_CACHE)}, ${amount(freed)}. Run it again without --dry-run to do it.` : `Removed ${count} from ${tilde(BUILD_CACHE)}, ${amount(freed)} freed. Xcode's own build folder is left as it is.`);
}
