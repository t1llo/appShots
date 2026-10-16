/** Flags that never take a value. */
export const BOOLEAN_FLAGS = new Set(["clean", "render", "help", "ipad", "duo", "dark", "light", "fresh", "image", "dry-run", "add-languages", "builds", "create", "again"]);

/**
 * Flags whose value may be left out: a bare --sim or --device is the only one there is, a bare --mac lists the
 * windows. The word after one is taken as its value, and kept in `borrowed` in case it was meant otherwise.
 */
export const OPTIONAL_FLAGS = new Set(["sim", "device", "mac"]);

/**
 * @typedef {object} Args
 * @property {string[]} positional
 * @property {Record<string, string | true>} flags
 * @property {string[]} passthrough What follows a lone --, for the app being launched.
 * @property {Record<string, number>} borrowed For a flag in OPTIONAL_FLAGS that took the next word: where among the
 *   positionals that word would stand had the flag gone without it.
 */

/**
 * @param {string[]} argv
 * @returns {Args}
 */
export function parseArgs(argv) {
  const positional = [];
  /** @type {Record<string, string | true>} */
  const flags = {};
  /** @type {Record<string, number>} */
  const borrowed = {};
  // What follows a lone -- belongs to the app being launched and is handed on as it is.
  const end = argv.indexOf("--");
  const own = end === -1 ? argv : argv.slice(0, end);
  const passthrough = end === -1 ? [] : argv.slice(end + 1);
  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    // --name=value says outright which word is the value.
    const equals = arg.indexOf("=");
    if (equals > 2) {
      const key = arg.slice(2, equals);
      const value = arg.slice(equals + 1);
      if (!BOOLEAN_FLAGS.has(key)) flags[key] = value;
      else if (!/^(false|no|0)$/i.test(value)) flags[key] = true;
      continue;
    }
    const key = arg.slice(2);
    const next = own[i + 1];
    if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
      if (OPTIONAL_FLAGS.has(key)) borrowed[key] = positional.length;
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags, passthrough, borrowed };
}

/**
 * Puts the word an optional flag took back among the positionals, where it stood, and leaves the flag bare:
 * in `shoot <project> --sim home stats`, home is a screen when no simulator goes by that name.
 * @param {Args} args
 * @param {string} key
 * @returns {boolean} Whether there was a word to give back.
 */
export function giveBack(args, key) {
  const at = args.borrowed[key];
  if (at === undefined || typeof args.flags[key] !== "string") return false;
  args.positional.splice(at, 0, args.flags[key]);
  args.flags[key] = true;
  delete args.borrowed[key];
  // A word another flag took came after this one.
  for (const [other, index] of Object.entries(args.borrowed)) if (index >= at) args.borrowed[other] = index + 1;
  return true;
}

/**
 * The flags given that a command does not take, which would otherwise do nothing without a word.
 * @param {Record<string, unknown>} flags
 * @param {Iterable<string>} known
 */
export function unknownFlags(flags, known) {
  const taken = new Set(["help", ...known]);
  return Object.keys(flags).filter((key) => !taken.has(key));
}
