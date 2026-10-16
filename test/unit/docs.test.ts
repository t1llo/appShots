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

// The app preview pages name the video commands of the CLI, the routes that draw their layers and the MCP tool.
// These read the pages and compare them with the code, so a page cannot name a command, an option, a route, an
// argument or a size that is not there.

const CLI_VIDEO = new URL("../../cli/src/video/command.mjs", import.meta.url);
const CLI_REMOTION = new URL("../../cli/src/video/remotion.mjs", import.meta.url);
const { VIDEO_ACTIONS, VIDEO_FLAGS } = (await import(CLI_VIDEO.href)) as { VIDEO_ACTIONS: Record<string, { flags: string[] }>; VIDEO_FLAGS: string[] };
const { REMOTION_LICENCE } = (await import(CLI_REMOTION.href)) as { REMOTION_LICENCE: string };

const docs: Record<string, string> = Object.fromEntries(
  await Promise.all(
    (await readdir(path.join(root, "docs"))).filter((file) => file.endsWith(".md")).map(async (file) => [file.replace(/\.md$/, ""), await readFile(path.join(root, "docs", file), "utf8")]),
  ),
);
const page = (name: string) => docs[name] ?? assert.fail(`there is no docs/${name}.md`);

/** The part of a page under one `## ` heading, up to the next. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `no section "${heading}"`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The rows of the first table at or after `from` in `text`, as cells, without its head. */
function tableAfter(text: string, from: string): string[][] {
  const at = text.indexOf(from);
  assert.ok(at >= 0, `no "${from}"`);
  const lines = text.slice(at).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

/** Every `appshots video …` command a page shows, in code spans and in code blocks. */
const videoCommands = (text: string) => [...text.matchAll(/`(appshots video [^`]+)`/g), ...text.matchAll(/^(appshots video .+)$/gm)].map((match) => match[1]!);

/** The names of the options in a text, as `--lang en=en-GB` gives `lang`. */
const optionsIn = (text: string) => [...text.matchAll(/(?:^|[\s`])--([a-z][a-z-]*)/g)].map((match) => match[1]!);

/** The code spans of a text, outside its code blocks. */
const spans = (text: string) => [...text.replace(/^```[^]*?^```$/gm, "").matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!);

test("every video command the docs show is one the CLI has, with options it takes", () => {
  const shown = Object.values(docs).flatMap(videoCommands);
  assert.ok(shown.length >= 20, `found only ${shown.length}`);
  const wrong = shown.flatMap((command) => {
    const action = command.split(/\s+/)[2]!;
    const known = VIDEO_ACTIONS[action];
    if (!known) return [`${command}: there is no action ${action}`];
    return optionsIn(command)
      .filter((flag) => !known.flags.includes(flag))
      .map((flag) => `${command}: ${action} takes no --${flag}`);
  });
  assert.deepEqual(wrong, []);
});

test("every option the video pages name is one a video command takes", () => {
  const named = [page("video"), section(page("cli"), "App preview videos")].flatMap((text) => spans(text).filter((span) => span.startsWith("--")).flatMap(optionsIn));
  assert.ok(named.length >= 20, `found only ${named.length}`);
  assert.deepEqual([...new Set(named.filter((flag) => !VIDEO_FLAGS.includes(flag)))], []);
});

test("the options the command line page gives video record and video push are theirs", () => {
  const part = section(page("cli"), "App preview videos");
  for (const action of ["record", "push"]) {
    const rows = tableAfter(part, `| Option of \`${action}\` |`);
    assert.ok(rows.length >= 5, action);
    const flags = rows.flatMap(([option]) => optionsIn(option ?? ""));
    assert.deepEqual(
      flags.filter((flag) => !VIDEO_ACTIONS[action]!.flags.includes(flag)),
      [],
      action,
    );
  }
});

test("the layer routes the API page lists are the server's", async () => {
  const source = await readFile(path.join(root, "src", "http", "routes", "video.ts"), "utf8");
  const mounted: Record<string, string> = { api: "/api", files: "/files" };
  const routes = new Set([...source.matchAll(/\b(api|files)\.(get|post|delete)\("([^"]+)"/g)].map(([, router, verb, route]) => `${verb!.toUpperCase()} ${mounted[router!]}${route}`));
  const listed = tableAfter(section(page("api"), "App preview layers"), "| Request |").map(([request]) => (request ?? "").replace(/`/g, "").replace("<file>.png", "*file"));
  assert.equal(listed.length, 4);
  assert.deepEqual(
    listed.filter((route) => !routes.has(route)),
    [],
  );
});

test("the fields the API and MCP pages give for video layers are the ones the server takes", async () => {
  const { videoLayersShape } = await import("../../src/video/request.ts");
  const fields = Object.keys(videoLayersShape);
  const api = tableAfter(section(page("api"), "App preview layers"), "| Field |").map(([field]) => (field ?? "").replace(/`/g, ""));
  assert.deepEqual(api.sort(), [...fields, "background"].sort());
  const tool = page("mcp").slice(page("mcp").indexOf("### render_video_layers"));
  const mcp = tableAfter(tool, "| Argument |").flatMap(([argument]) => spans(argument ?? ""));
  assert.deepEqual(mcp.sort(), ["project", ...fields].sort());
});

test("the preview sizes the video page lists are the server's", async () => {
  const { PREVIEW_SPECS } = await import("../../src/domain/previews.ts");
  const rows = tableAfter(section(page("video"), "Sizes"), "| Display |");
  const displays = rows.map(([display]) => (display ?? "").replace(/`/g, ""));
  assert.deepEqual([...displays].sort(), Object.keys(PREVIEW_SPECS).sort());
  for (const [at, display] of displays.entries()) {
    const spec = PREVIEW_SPECS[display as keyof typeof PREVIEW_SPECS];
    const listed = [...(rows[at]![1] ?? "").matchAll(/(\d+) × (\d+)/g)].map(([, width, height]) => [Number(width), Number(height)]);
    const sizes = [spec.portrait, spec.landscape].filter((size) => size !== null).map((size) => [...size]);
    assert.deepEqual(listed, sizes, display);
  }
});

test("the video page states Remotion's licence as the CLI does, and links it", () => {
  const remotion = section(page("video"), "Animated text with Remotion");
  assert.match(remotion, /\(https:\/\/remotion\.pro\/license\)/);
  assert.match(REMOTION_LICENCE, /remotion\.pro\/license/);
  for (const words of ["not open source", "individuals", "non-profits", "Company License", "per seat or per render"]) {
    assert.ok(remotion.includes(words), `the page: ${words}`);
    assert.ok(REMOTION_LICENCE.includes(words), `the CLI: ${words}`);
  }
  assert.match(REMOTION_LICENCE, /up to 3 people/);
  assert.match(remotion, /up to three people/);
});
