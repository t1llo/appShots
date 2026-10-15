import { readFileSync } from "node:fs";
import { fail } from "./fail.mjs";

/** @param {string} value */
export const slugify = (value) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "shot";

/** @param {number} ms */
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `test` holds, for `ms` at most, and says whether it came to hold.
 * @param {() => boolean} test
 * @param {number} ms
 */
export async function until(test, ms) {
  for (const deadline = Date.now() + ms; !test(); await pause(50)) if (Date.now() > deadline) return false;
  return true;
}

/** @param {string} file */
export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Runs `work` for each item, `limit` at a time, and returns the results in the order of the items. The first
 * failure stops what has not started yet.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, at: number) => Promise<R>} work
 * @returns {Promise<R[]>}
 */
export async function pool(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const at = next++;
      try {
        results[at] = await work(items[at], at);
      } catch (error) {
        next = items.length;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/**
 * The simulator or device `query` names: its udid, its exact name, or a part of its name that only one has.
 * Without a query, the only one there is.
 * @template {{ name: string, udid: string }} T
 * @param {T[]} candidates
 * @param {string | boolean | undefined} query
 * @param {string} kind
 * @param {string} flag
 * @returns {T}
 */
export function choose(candidates, query, kind, flag) {
  const describe = (list) => list.map((item) => `  ${item.name}  (${item.udid})`).join("\n");
  if (typeof query === "string") {
    const match = findMatch(candidates, query);
    if (match.length === 1) return match[0];
    fail(match.length === 0 ? `No ${kind} matches "${query}". Available:\n${describe(candidates) || "  (none)"}` : `"${query}" matches several:\n${describe(match)}`);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) fail(kind === "simulator" ? "No simulator is booted. Start your app in one with 'appshots run' first, or with 'appshots boot' and the project's own run command. A plugged-in device is --device, a window on this Mac --mac <app>, a web page --web <address>." : "No iPhone or iPad is connected. Plug it in, unlock it and trust this Mac.");
  fail(`Several ${kind}s are available; pick one with ${flag} <name>:\n${describe(candidates)}`);
}

/**
 * What `query` matches among the candidates. An exact name wins, so "iPhone 17" still works while
 * "iPhone 17 Pro" is booted too.
 * @template {{ name: string, udid: string }} T
 * @param {T[]} candidates
 * @param {string} query
 */
export function findMatch(candidates, query) {
  const needle = query.toLowerCase();
  const exact = candidates.filter((item) => item.udid.toLowerCase() === needle || item.name.toLowerCase() === needle);
  return exact.length === 1 ? exact : candidates.filter((item) => item.name.toLowerCase().includes(needle));
}
