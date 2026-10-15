import assert from "node:assert/strict";
import { test } from "node:test";
import { giveBack, parseArgs, unknownFlags } from "../../cli/src/args.mjs";

test("a flag takes the word after it, a boolean one never does", () => {
  const args = parseArgs(["shoot", "demo", "--clean", "home", "--out", "shots", "--lang", "de"]);
  assert.deepEqual(args.positional, ["shoot", "demo", "home"]);
  assert.deepEqual(args.flags, { clean: true, out: "shots", lang: "de" });
});

test("--sim, --device and --mac may go without a value", () => {
  assert.deepEqual(parseArgs(["capture", "--sim"]).flags, { sim: true });
  assert.deepEqual(parseArgs(["capture", "--device", "--name", "home"]).flags, { device: true, name: "home" });
  assert.deepEqual(parseArgs(["capture", "--mac", "--clean"]).flags, { mac: true, clean: true });
});

test("--name=value says which word is the value, and a boolean one can be switched off", () => {
  const args = parseArgs(["capture", "--sim=iPhone 17", "--clean=false", "--dry-run=yes", "--eval=a=b"]);
  assert.deepEqual(args.flags, { sim: "iPhone 17", "dry-run": true, eval: "a=b" });
  assert.deepEqual(args.borrowed, {});
});

test("what follows a lone -- goes to the app untouched", () => {
  const args = parseArgs(["run", "--scheme", "Demo", "--", "-demo", "--sim", "x"]);
  assert.deepEqual(args.flags, { scheme: "Demo" });
  assert.deepEqual(args.passthrough, ["-demo", "--sim", "x"]);
});

test("a word an optional flag took can be given back where it stood", () => {
  const args = parseArgs(["shoot", "demo", "--sim", "home", "settings"]);
  assert.deepEqual(args.flags, { sim: "home" });
  assert.equal(giveBack(args, "sim"), true);
  assert.deepEqual(args.positional, ["shoot", "demo", "home", "settings"]);
  assert.deepEqual(args.flags, { sim: true });
  // Only once: the flag is bare now.
  assert.equal(giveBack(args, "sim"), false);
});

test("giving one word back moves the place of a later one along", () => {
  const args = parseArgs(["shoot", "demo", "--sim", "home", "--device", "stats", "end"]);
  assert.deepEqual(args.borrowed, { sim: 2, device: 2 });
  giveBack(args, "sim");
  giveBack(args, "device");
  assert.deepEqual(args.positional, ["shoot", "demo", "home", "stats", "end"]);
});

test("a value given with = is never given back", () => {
  const args = parseArgs(["shoot", "demo", "--sim=home", "settings"]);
  assert.equal(giveBack(args, "sim"), false);
  assert.deepEqual(args.positional, ["shoot", "demo", "settings"]);
});

test("unknownFlags names what a command does not take, and --help is always fine", () => {
  const { flags } = parseArgs(["pull", "demo", "--help", "--claen", "--out", "x"]);
  assert.deepEqual(unknownFlags(flags, ["out"]), ["claen"]);
});
