#!/usr/bin/env node
import { parseArgs, unknownFlags } from "./args.mjs";
import { COMMANDS } from "./commands.mjs";
import { Failure, fail } from "./fail.mjs";
import { HELP } from "./help.mjs";
import { staleNotice } from "./update.mjs";
import { xcrun } from "./xcode.mjs";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  // simctl's arguments are its own, --help among them. What it runs may take as long as it takes.
  if (command === "simctl") {
    process.exitCode = (await xcrun(["simctl", ...rest], { stdio: "inherit", timeout: 0 })).status ?? 1;
    return;
  }
  const args = parseArgs(rest);
  if (!command || command === "help" || command === "--help" || args.flags.help) return console.log(HELP);
  const entry = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!entry) fail(`Unknown command "${command}". Run 'appshots help'.`);
  for (const flag of unknownFlags(args.flags, entry.flags)) console.error(`appshots: ${command} takes no --${flag}, so it is left out. 'appshots help' lists what each command takes.`);
  await entry.run(args);
  if (!entry.quiet) await staleNotice();
}

// The functions below a command throw what is wrong; here it is said, and the command ends with 1.
const [major] = process.versions.node.split(".").map(Number);
if (major < 18 || typeof fetch !== "function") {
  console.error(`appshots: this needs Node.js 18 or newer, and this is ${process.version}. Install a newer one from nodejs.org, or with the package manager it came from.`);
  process.exit(1);
}
try {
  await main();
} catch (error) {
  if (!(error instanceof Failure)) throw error;
  // Written before the exit, so that a long message reaches a pipe in full.
  process.stderr.write(`appshots: ${error.message}\n`, () => process.exit(1));
}
