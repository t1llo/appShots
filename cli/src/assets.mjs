import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Files the CLI writes out as they are, such as the Remotion project of 'appshots video remotion'. They live in
// cli/assets, where they can be read, run and changed as the files they are. Installed, the CLI is one file with
// nothing next to it, so scripts/build-cli.mjs puts the text of each into the bundle in place of the null below.

/** @type {Record<string, string> | null} */
const INLINED = null;

/**
 * The text of a file in cli/assets, by its path there, such as "remotion/src/Root.tsx".
 * @param {string} name
 * @returns {string}
 */
export function asset(name) {
  if (INLINED) {
    if (!Object.hasOwn(INLINED, name)) throw new Error(`The CLI was built without the file ${name}.`);
    return INLINED[name];
  }
  return readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)), "utf8");
}
