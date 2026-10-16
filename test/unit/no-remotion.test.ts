import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// Remotion has a licence of its own, which is not appShots'. 'appshots video remotion' writes a Remotion project
// into the user's repository and installs it there, after the user has agreed to that licence; appShots itself
// neither depends on Remotion nor ships it. These keep it that way.

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (file: string) => readFile(path.join(root, file), "utf8");
const imports = (code: string) => [...code.matchAll(/(?:^\s*import\s[^;]*?from\s*|^\s*export\s[^;]*?from\s*|(?<![\w.])import\(|(?<![\w.])require\()\s*["']([^"']+)["']/gm)].map((match) => match[1]!);
const isRemotion = (name: string) => name === "remotion" || name.startsWith("remotion/") || name.startsWith("@remotion/");

test("appShots' package.json and lockfile have no Remotion in them", async () => {
  const manifest = JSON.parse(await read("package.json"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    assert.deepEqual(Object.keys(manifest[field] ?? {}).filter(isRemotion), [], field);
  }
  assert.doesNotMatch(await read("package-lock.json"), /remotion/i);
});

test("the image installs no Remotion", async () => {
  assert.doesNotMatch(await read("Dockerfile"), /remotion/i);
});

test("neither the server, the web app nor the CLI imports Remotion", async () => {
  const folders = ["src", path.join("web", "src"), path.join("cli", "src")];
  const files = (await Promise.all(folders.map(async (folder) => (await readdir(path.join(root, folder), { recursive: true })).map((file) => path.join(folder, file))))).flat();
  const code = files.filter((file) => /\.(ts|tsx|mjs|js)$/.test(file));
  assert.ok(code.length > 20, `found only ${code.length} source files`);
  const named = (await Promise.all(code.map(async (file) => imports(await read(file)).map((name) => `${file}: ${name}`)))).flat();
  assert.ok(named.length > 100, `found only ${named.length} imports`);
  assert.deepEqual(named.filter((line) => isRemotion(line.slice(line.lastIndexOf(" ") + 1))), []);
  assert.deepEqual(imports(await read(path.join("cli", "appshots.mjs"))).filter(isRemotion), []);
});

test("the Remotion template in cli/assets is only text the CLI writes out, pinned to one version", async () => {
  const manifest = JSON.parse(await read(path.join("cli", "assets", "remotion", "package.json")));
  const pinned = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(([name]) => isRemotion(name));
  assert.ok(pinned.length >= 2);
  for (const [name, version] of pinned) assert.match(String(version), /^\d+\.\d+\.\d+$/, `${name} is not pinned to one version`);
  assert.equal(new Set(pinned.map(([, version]) => version)).size, 1, "every Remotion package is on the same version");
});
