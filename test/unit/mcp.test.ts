import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, describe, test } from "node:test";
import { z } from "zod";
import { tmpData } from "../helpers/tmp-data.ts";

// The parts the MCP tools and the HTTP API share, without a server: the guide's topics, the contact sheets a render
// shows, how a failure is worded, and the mockup settings. The settings are read when src/config.ts is first
// imported, so the modules are imported once the environment points at a throwaway directory.

const data = await tmpData("mcp");
after(() => data.remove());
for (const name of Object.keys(process.env)) if (/^(GOOGLE_|UMAMI_|USER_)|^(ADMIN_EMAIL|PUBLIC_URL|ALLOWED_HOSTS|TRUST_PROXY|HOST|PORT)$/.test(name)) delete process.env[name];
process.env.DATA_DIR = data.dir;

const { designGuide, TOPICS } = await import("../../src/mcp/guide/index.ts");
const { pickSheets } = await import("../../src/mcp/tools/render.ts");
const { guard } = await import("../../src/mcp/result.ts");
const { publicError } = await import("../../src/http/errors.ts");
const { mergeSettings } = await import("../../src/services/mockups.ts");
const { ConflictError, InputError, NotFoundError } = await import("../../src/store.ts");
const { render, SHELL_IDS } = await import("../../src/site.ts");

const base = "https://appshots.example.com";
const { space } = data;

describe("the design guide", () => {
  test("is its topics in order, each under its own heading", () => {
    const guide = designGuide(base, space);
    assert.ok(guide.startsWith("# appShots: App Store screenshot generator\n\n## "));
    let at = 0;
    for (const topic of TOPICS) {
      const heading = guide.indexOf(`\n## ${topic.title}\n`, at);
      assert.ok(heading >= at, `${topic.id} is out of order or missing`);
      at = heading + 1;
    }
    assert.equal(new Set(TOPICS.map((topic) => topic.id)).size, TOPICS.length);
  });

  test("a topic is its section word for word, and names the others", () => {
    const guide = designGuide(base, space);
    for (const topic of TOPICS) {
      const one = designGuide(base, space, topic.id);
      const [section, footer] = one.split("\n\nThis is one topic of the design guide.");
      assert.ok(guide.includes(`${section}\n\n`) || guide.endsWith(section!), topic.id);
      for (const other of TOPICS) if (other !== topic) assert.ok(footer!.includes(other.id), `${topic.id} leaves out ${other.id}`);
    }
  });

  test("has a core topic a small model can read, which names every other topic", () => {
    const core = designGuide(base, space, "core");
    assert.match(core, /^## Start here\n/);
    // About two to three thousand tokens, at four characters a token.
    assert.ok(core.length > 6000 && core.length < 12_000, `${core.length} characters`);
    assert.ok(core.length * 4 < designGuide(base, space).length, "is a quarter of the guide at most");
    for (const id of [...TOPICS.map((topic) => topic.id), "fields"]) assert.match(core, new RegExp(`\\n- \`${id}\`: `), `does not say when to read ${id}`);
    assert.ok(!designGuide(base, space).includes("## Start here"), "is not part of the whole guide");
  });

  test("has a fields topic with every field of a slide and its parts", async () => {
    const schema = await import("../../src/schema.ts");
    const fields = designGuide(base, space, "fields");
    const parts = {
      Slide: schema.slideSchema,
      Device: schema.deviceSchema,
      Badge: schema.badgeSchema,
      Feature: schema.featureSchema,
      "Feature cards": schema.featureCardsSchema,
      "Icon row": schema.iconRowSchema,
      Logo: schema.logoSchema,
      Image: schema.placedImageSchema,
      Asset: schema.creativeSchema,
      Mockups: schema.mockupsSchema,
    };
    for (const [title, part] of Object.entries(parts)) {
      const start = fields.indexOf(`\n### ${title}\n`);
      assert.ok(start > 0, title);
      const end = fields.indexOf("\n### ", start + 1);
      const body = fields.slice(start, end < 0 ? undefined : end);
      for (const field of Object.keys(part.shape)) assert.ok(body.includes(`\n- \`${field}\`: `), `${title} leaves out ${field}`);
    }
    for (const field of Object.keys(schema.themeSchema.shape)) assert.ok(fields.includes(`\`${field}\``), `the theme leaves out ${field}`);
    assert.ok(!designGuide(base, space).includes("\n## Fields\n"), "is not part of the whole guide");
  });
});

describe("contact sheets", () => {
  const sheet = (target: string, locale = "en-US") => ({ target, locale, path: `${locale}/${target}/sheet.jpg` }) as Parameters<typeof pickSheets>[0][number];

  test("of the first language, one of each device before a second of any", () => {
    const sheets = [sheet("iphone-6.9"), sheet("iphone-6.5"), sheet("iphone-6.3"), sheet("ipad-13"), sheet("mac-2880"), sheet("iphone-6.9", "de-DE"), sheet("mac-2880", "de-DE")];
    const { shown, left } = pickSheets(sheets);
    assert.deepEqual(
      shown.map((each) => each.target),
      ["iphone-6.9", "ipad-13", "mac-2880", "iphone-6.5"],
    );
    assert.deepEqual(
      left.map((each) => each.target),
      ["iphone-6.3"],
    );
  });

  test("none, or fewer than fit, are all shown", () => {
    assert.deepEqual(pickSheets([]), { shown: [], left: [] });
    assert.equal(pickSheets([sheet("mac-2880")]).shown.length, 1);
  });
});

describe("failures", () => {
  const logged: unknown[][] = [];
  const log = { log: () => {}, warn: () => {}, error: (...args: unknown[]) => void logged.push(args) };
  const tools = { base, space, ctx: { space, actor: "mcp" as const }, log };

  test("what the caller can act on is said as it is", async () => {
    const refused = await guard(tools, "get_project", async () => {
      throw new NotFoundError('No project "nope"');
    });
    assert.deepEqual(refused, { isError: true, content: [{ type: "text", text: 'No project "nope"' }] });
    assert.deepEqual(logged, []);
  });

  test("anything else is answered with a reference, and its details go to the log under it", async () => {
    const failed = await guard(tools, "render", async () => {
      throw new Error(`EACCES: permission denied, open '${data.dir}/projects/x/project.json'`);
    });
    assert.equal(failed.isError, true);
    const said = (failed.content[0] as { text: string }).text;
    const ref = /^Something went wrong on the server \(ref ([0-9a-f]{8})\); try again\.$/.exec(said);
    assert.ok(ref, said);
    assert.ok(!said.includes(data.dir));
    assert.equal(logged.length, 1);
    assert.match(String(logged[0]![0]), new RegExp(`^Error ${ref[1]} in the MCP tool render`));
    assert.ok(logged[0]![1] instanceof Error);
  });

  test("the HTTP API and the tools give the same status and sentence", () => {
    assert.deepEqual(publicError(new InputError("Bad")), { status: 400, message: "Bad" });
    assert.deepEqual(publicError(new NotFoundError("Gone")), { status: 404, message: "Gone" });
    assert.equal(publicError(new ConflictError("Moved on", 3))?.status, 409);
    assert.equal(publicError(z.object({ name: z.string() }).safeParse({}).error)?.status, 400);
    // A file the sender could not find names its path on the server.
    assert.deepEqual(publicError(Object.assign(new Error("ENOENT: /srv/data/x.png"), { status: 404, expose: false })), { status: 404, message: "Not found" });
    assert.match(publicError(Object.assign(new Error("request entity too large"), { status: 413, limit: 20 * 1024 * 1024 }))!.message, /20 MB/);
    assert.equal(publicError(new Error("anything")), null);
    assert.equal(publicError(Object.assign(new Error("upstream"), { status: 502 })), null);
  });
});

describe("mockup settings", () => {
  const saved = { device: { style: "clay", color: "silver", rotate: -8 }, width: 1200 } as Parameters<typeof mergeSettings>[0];

  test("a device is laid over the saved one, and {} goes back to the defaults", () => {
    assert.deepEqual(mergeSettings(saved, { device: { rotate: 4 } as never }), { device: { style: "clay", color: "silver", rotate: 4 }, width: 1200 });
    assert.deepEqual(mergeSettings(saved, { device: {} as never }), { width: 1200 });
    assert.deepEqual(mergeSettings(saved, {}), saved);
  });

  test("a width of null goes back to the screenshot's own", () => {
    assert.deepEqual(mergeSettings(saved, { width: null }), { device: saved.device });
    assert.deepEqual(mergeSettings(saved, { width: 900 }).width, 900);
  });

  test("what the schema refuses is refused before anything is saved", () => {
    assert.throws(() => mergeSettings(saved, { device: { style: "neon" } as never }), z.ZodError);
  });
});

describe("docs pages", () => {
  test("a heading never takes an id the page around it has", async () => {
    const shell = await readFile(path.join(import.meta.dirname, "..", "..", "web", "docs.html"), "utf8");
    const ids = [...shell.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!);
    assert.deepEqual(
      ids.filter((id) => !SHELL_IDS.includes(id)),
      [],
    );
    const { html, headings } = render("## Content\n\nText.\n\n## Menu\n\n## Content\n");
    assert.deepEqual(
      headings.map((heading) => heading.id),
      ["content-2", "menu-2", "content-3"],
    );
    for (const id of SHELL_IDS) assert.ok(!html.includes(`id="${id}"`), id);
  });
});
