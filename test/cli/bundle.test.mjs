import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const file = path.resolve(import.meta.dirname, "..", "..", "cli", "appshots.mjs");
const code = readFileSync(file, "utf8");

test("the CLI is one file that imports nothing but Node", () => {
  assert.ok(code.startsWith("#!/usr/bin/env node\n// Generated from cli/src by `npm run build:cli`."));
  const imports = [...code.matchAll(/(?:^import\s[^;]*?from\s*|(?<![\w.])import\()\s*["']([^"']+)["']/gm)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  assert.deepEqual(imports.filter((name) => !name.startsWith("node:")), []);
});

test("the CLI can be run as it is", { skip: process.platform === "win32" && "no POSIX modes" }, () => {
  assert.equal(statSync(file).mode & 0o111, 0o111);
  const help = execFileSync(process.execPath, [file, "help"], { encoding: "utf8", env: { ...process.env, HOME: tmpdir(), XDG_CONFIG_HOME: tmpdir(), APPSHOTS_URL: "" } });
  assert.match(help, /^ {2}appshots capture /m);
  assert.match(help, /^ {2}appshots clean --builds /m);
});
