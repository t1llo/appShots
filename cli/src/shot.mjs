import { mkdirSync } from "node:fs";
import path from "node:path";
import { fail } from "./fail.mjs";
import { slugify } from "./util.mjs";

/**
 * The name a capture goes by and the file it is saved as. Makes the folder.
 * @param {Record<string, unknown>} flags
 */
export function shotTarget(flags) {
  const name = typeof flags.name === "string" ? slugify(flags.name) : `shot-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : "raw-shots");
  mkdirSync(outDir, { recursive: true });
  return { name, file: path.join(outDir, `${name}.png`) };
}

/**
 * The device a screenshot is filed under when --as, --ipad, --duo or --mac says so. Left out, the server tells
 * from the size.
 * @param {Record<string, unknown>} flags
 * @returns {string | undefined}
 */
export function shotDevice(flags) {
  if (flags.as === undefined && flags.ipad && flags.duo) fail("Use --ipad or --duo, not both.");
  const device = typeof flags.as === "string" ? flags.as.toLowerCase() : flags.as === undefined ? (flags.ipad ? "ipad" : flags.duo ? "duo" : flags.mac ? "mac" : undefined) : "";
  if (device !== undefined && !["iphone", "duo", "ipad", "mac"].includes(device)) fail("--as needs iphone, duo, ipad or mac.");
  return device;
}

/**
 * The language a screenshot shows the app in, from --lang. Left out, it is for the project's first language.
 * @param {Record<string, unknown>} flags
 * @returns {string | undefined}
 */
export function shotLanguage(flags) {
  if (flags.lang !== undefined && (typeof flags.lang !== "string" || !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(flags.lang))) fail("--lang needs a language code, such as de or pt-BR.");
  return /** @type {string | undefined} */ (flags.lang);
}
