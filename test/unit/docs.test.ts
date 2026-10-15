import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// The privacy policy has to say what the code does. These read both and compare, so a new key in the browser or a
// new analytics event cannot go out unmentioned.

const root = path.resolve(import.meta.dirname, "..", "..");
const privacy = await readFile(path.join(root, "docs", "privacy.md"), "utf8");

/** Every file of the web app's sources and pages, as text. */
async function webSources(): Promise<string[]> {
  const files = (await readdir(path.join(root, "web", "src"), { recursive: true })).map((file) => path.join("web", "src", file));
  const pages = (await readdir(path.join(root, "web"))).filter((file) => file.endsWith(".html")).map((file) => path.join("web", file));
  const wanted = [...files, ...pages].filter((file) => /\.(ts|tsx|html)$/.test(file));
  return Promise.all(wanted.map((file) => readFile(path.join(root, file), "utf8")));
}
const sources = await webSources();

const found = (pattern: RegExp) => [...new Set(sources.flatMap((source) => [...source.matchAll(pattern)].map((match) => match[1]!)))].sort();

test("the privacy policy lists every key the web app keeps in the browser (docs-10)", () => {
  const keys = found(/["'`](appshots\.[a-zA-Z0-9_-]+)["'`]/g);
  assert.ok(keys.length >= 4, `found only ${keys.join(", ")}`);
  assert.deepEqual(
    keys.filter((key) => !privacy.includes(`\`${key}\``)),
    [],
  );
});

test("the privacy policy lists every analytics event the web app sends (docs-1)", () => {
  const events = [...found(/\btrack\(\s*"([a-z_]+)"/g), ...found(/data-umami-event="([a-z_]+)"/g)];
  assert.ok(events.length >= 7, `found only ${events.join(", ")}`);
  assert.deepEqual(
    events.filter((event) => !privacy.includes(`\`${event}\``)),
    [],
  );
});

test("the privacy policy describes the analytics the server uses (docs-1)", () => {
  assert.match(privacy, /Umami/);
  assert.doesNotMatch(privacy, /PostHog/i);
  // The address comes from the server's settings, never from the page itself.
  assert.match(privacy, /\{\{ANALYTICS_HOST\}\}/);
});
