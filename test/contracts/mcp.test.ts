import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { png } from "../helpers/images.ts";
import { callTool, jsonOf, rpc, textOf, type ToolResult } from "../helpers/mcp.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";

// The MCP tools as docs/mcp.md describes them and as agents call them today. Tool names, every input accepted
// today and the shape of each answer stay; new tools, inputs and keys may be added. Slides count from 1 here and
// from 0 in the HTTP API, and both are checked against each other.

const RENDER = process.env.RENDER_TESTS === "1";
const renderTier = { skip: RENDER ? false : "draws with Chromium; run with RENDER_TESTS=1" };

/** Each tool with the inputs it takes today. */
const TOOLS: Record<string, string[]> = {
  get_design_guide: [],
  list_projects: [],
  create_project: ["name", "locales", "theme"],
  get_project: ["project"],
  update_project: ["project", "name", "locales", "theme", "targets"],
  set_slides: ["project", "slides", "device", "theme"],
  update_slide: ["project", "slide", "of", "changes", "remove"],
  set_creative_assets: ["project", "header", "search", "universal", "readme", "social", "link", "post", "remove"],
  render: ["project", "slides", "creatives", "targets", "locales"],
  render_mockups: ["project", "screenshots", "locale", "device", "width"],
  list_revisions: ["project"],
  restore_project: ["project", "revision"],
};
const READ_ONLY = ["get_design_guide", "list_projects", "get_project", "list_revisions"];
const DESCRIBE_KEYS = ["id", "name", "locales", "theme", "slides", "deviceSlides", "creativeAssets", "mockups", "screenshots", "images", "exportSizes", "studio"];

const THREE_SLIDES = [
  { layout: "device-bottom", headline: "First *slide*", subheadline: "Under the first", screenshot: "home" },
  { layout: "statement", headline: "Second slide" },
  { layout: "statement", headline: "Third slide" },
];

let server: TestServer;
before(async () => {
  server = await startServer({ inProcess: true });
});
after(async () => {
  await server?.stop();
});

function assertKeys(value: unknown, keys: string[]): void {
  assert.ok(value !== null && typeof value === "object", `expected an object, got ${JSON.stringify(value)}`);
  const missing = keys.filter((key) => !(key in value));
  assert.deepEqual(missing, [], `missing from ${JSON.stringify(value).slice(0, 300)}`);
}

/** A tool that refused: a readable sentence and `isError`, never a JSON-RPC error. */
function assertRefused(result: ToolResult, says?: RegExp): void {
  assert.equal(result.isError, true, textOf(result));
  assert.equal(result.content[0]!.type, "text");
  if (says) assert.match(textOf(result), says);
}

function assertSucceeded(result: ToolResult): void {
  assert.notEqual(result.isError, true, textOf(result));
}

async function rest(route: string, init: RequestInit = {}): Promise<any> {
  const response = await server.fetch(route, init);
  assert.ok(response.ok, `${route} answered ${response.status}`);
  return response.status === 204 ? null : response.json();
}

describe("the endpoint", () => {
  test("initialize names the server, its tools and how to start", async () => {
    const { status, body } = await rpc(server, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contract-test", version: "1.0.0" } });
    assert.equal(status, 200);
    assert.equal(body.result.serverInfo.name, "appshots");
    assert.equal(typeof body.result.serverInfo.version, "string");
    assert.ok(body.result.capabilities.tools);
    assert.match(body.result.instructions, /get_design_guide/);
  });

  test("tools/list has every tool with the inputs it takes", async () => {
    const { status, body } = await rpc(server, "tools/list");
    assert.equal(status, 200);
    const tools = new Map<string, any>(body.result.tools.map((tool: { name: string }) => [tool.name, tool]));
    assert.deepEqual(
      Object.keys(TOOLS).filter((name) => !tools.has(name)),
      [],
    );
    for (const [name, inputs] of Object.entries(TOOLS)) {
      const tool = tools.get(name);
      assert.equal(typeof tool.description, "string", name);
      assert.equal(tool.inputSchema.type, "object", name);
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      assert.deepEqual(
        inputs.filter((input) => !properties.includes(input)),
        [],
        name,
      );
    }
    for (const name of READ_ONLY) assert.equal(tools.get(name).annotations?.readOnlyHint, true, name);
    // Only these are required, so every call that works today keeps working.
    assert.deepEqual(tools.get("create_project").inputSchema.required, ["name"]);
    assert.deepEqual(tools.get("update_slide").inputSchema.required.sort(), ["project", "slide"]);
    assert.deepEqual(tools.get("render").inputSchema.required, ["project"]);
    assert.deepEqual(tools.get("render_mockups").inputSchema.required, ["project"]);
  });

  test("tools/list has the tool that draws the layers of an app preview", { todo: "listed once src/mcp.ts registers registerVideoTools" }, async () => {
    const { body } = await rpc(server, "tools/list");
    const tool = body.result.tools.find((each: { name: string }) => each.name === "render_video_layers");
    assert.ok(tool, "render_video_layers is listed");
    assert.deepEqual(tool.inputSchema.required, ["project"]);
    for (const input of ["project", "display", "size", "orientation", "locales", "captionStyle", "captions", "intro", "outro", "plate", "touch"]) assert.ok(input in tool.inputSchema.properties, input);
  });

  test("an unknown tool or a wrong argument is refused as a tool error", async () => {
    assertRefused(await callTool(server, "no_such_tool"), /no_such_tool/);
    assertRefused(await callTool(server, "get_project", {}), /project/);
    assertRefused(await callTool(server, "get_project", { project: "Not A Slug" }), /project/);
  });

  test("an unknown project is a sentence naming it", async () => {
    assertRefused(await callTool(server, "get_project", { project: "nope" }), /^No project "nope"$/);
  });
});

describe("tools", () => {
  test("get_design_guide is the guide, with this server's address", async () => {
    const result = await callTool(server, "get_design_guide");
    assertSucceeded(result);
    const guide = textOf(result);
    assert.ok(guide.length > 5000);
    assert.ok(guide.includes(server.url));
    for (const tool of ["set_slides", "render", "render_mockups", "set_creative_assets"]) assert.ok(guide.includes(tool), tool);
  });

  test("get_design_guide takes a topic and answers with that part of the guide", async () => {
    const guide = textOf(await callTool(server, "get_design_guide"));
    const result = await callTool(server, "get_design_guide", { topic: "mockups" });
    assertSucceeded(result);
    const topic = textOf(result);
    assert.match(topic, /^## Mockups\n/);
    assert.ok(topic.includes(`${server.url}/#/<project>/mockups`));
    // The part is the guide's own section, word for word.
    assert.ok(guide.includes(topic.slice(0, topic.indexOf("\n\nThis is one topic"))));
    assert.match(textOf(await callTool(server, "get_design_guide", { topic: "uploading" })), /^## Uploading\n/);
  });

  test("get_design_guide answers a topic it does not have with the whole guide, as before it took topics", async () => {
    const guide = textOf(await callTool(server, "get_design_guide"));
    const result = await callTool(server, "get_design_guide", { topic: "layouts and badges" });
    assertSucceeded(result);
    assert.match(textOf(result), /^The design guide has no topic "layouts and badges".*\bmockups\b/);
    assert.ok(textOf(result).endsWith(guide));
    for (const topic of [5, null, ["mockups"]]) assert.equal(textOf(await callTool(server, "get_design_guide", { topic })), guide, String(topic));
  });

  test("create_project returns the id and how to upload into it", async () => {
    const result = await callTool(server, "create_project", { name: "MCP App", locales: ["en-US", "de-DE"], theme: { font: "inter" } });
    assertSucceeded(result);
    const text = textOf(result);
    assert.match(text, /^Created project "mcp-app"\./);
    assert.ok(text.includes(`${server.url}/#/mcp-app`));
    assert.ok(text.includes("/api/projects/mcp-app/shots/"));
    assert.equal((await rest("/api/projects/mcp-app")).project.theme.font, "inter");
  });

  test("list_projects lists the same as GET /api/projects", async () => {
    const result = await callTool(server, "list_projects");
    assertSucceeded(result);
    const listed = jsonOf(result);
    const item = listed.find((each: { id: string }) => each.id === "mcp-app");
    assertKeys(item, ["id", "name", "slides", "ownSets", "locales", "updatedAt"]);
    assert.deepEqual(listed, await rest("/api/projects"));
  });

  test("get_project describes the project", async () => {
    await rest("/api/projects/mcp-app/shots/home", { method: "PUT", body: new Uint8Array(await png(1320, 2868)) });
    await rest("/api/projects/mcp-app/shots/home?locale=de-DE", { method: "PUT", body: new Uint8Array(await png(1320, 2868)) });
    await rest("/api/projects/mcp-app/shots/window", { method: "PUT", body: new Uint8Array(await png(2880, 1800)) });
    const result = await callTool(server, "get_project", { project: "mcp-app" });
    assertSucceeded(result);
    const project = jsonOf(result);
    assertKeys(project, DESCRIBE_KEYS);
    assert.equal(project.id, "mcp-app");
    assert.equal(project.studio, `${server.url}/#/mcp-app`);
    assert.deepEqual(project.screenshots, [
      { name: "home", device: "iphone", locale: "de-DE", size: "1320×2868" },
      { name: "home", device: "iphone", size: "1320×2868" },
      { name: "window", device: "mac", size: "2880×1800", shown: "MacBook" },
    ]);
    assert.ok(project.exportSizes.includes("iphone-6.9") && project.exportSizes.includes("mac-2880"));
  });

  test("update_project changes what it is given and answers with the project", async () => {
    const result = await callTool(server, "update_project", { project: "mcp-app", name: "MCP App Two", targets: ["iphone-6.9"] });
    assertSucceeded(result);
    const project = jsonOf(result);
    assertKeys(project, DESCRIBE_KEYS);
    assert.equal(project.name, "MCP App Two");
    assert.deepEqual(project.exportSizes, ["iphone-6.9"]);
    // [] goes back to the standard sizes.
    assert.ok(jsonOf(await callTool(server, "update_project", { project: "mcp-app", targets: [] })).exportSizes.length > 1);
    assertRefused(await callTool(server, "update_project", { project: "mcp-app", locales: [] }));
    // A language given twice is taken once, in its first spelling.
    assert.deepEqual(jsonOf(await callTool(server, "update_project", { project: "mcp-app", locales: ["en-US", "de-DE", "EN-us"] })).locales, ["en-US", "de-DE"]);
  });

  test("set_slides replaces the shared set and names screenshots that are not there", async () => {
    const result = await callTool(server, "set_slides", { project: "mcp-app", slides: [...THREE_SLIDES, { layout: "device-bottom", headline: "Fourth", screenshot: "later" }] });
    assertSucceeded(result);
    assert.match(textOf(result), /^Saved 4 slides\. Call render to see them\./);
    assert.match(textOf(result), /placeholders: later\./);
    const again = await callTool(server, "set_slides", { project: "mcp-app", slides: THREE_SLIDES, theme: { font: "manrope" } });
    assert.equal(textOf(again), "Saved 3 slides. Call render to see them.");
    assert.equal((await rest("/api/projects/mcp-app")).project.theme.font, "manrope");
    assertRefused(await callTool(server, "set_slides", { project: "mcp-app", slides: [] }), /at least one slide/);
  });

  test("set_slides with a device gives it a set of its own, and [] takes it away", async () => {
    const own = await callTool(server, "set_slides", { project: "mcp-app", device: "ipad", slides: [{ layout: "device-right", headline: "On iPad", screenshot: "home" }] });
    assert.match(textOf(own), /^Saved 1 slide for the iPad alone\./);
    const shared = await callTool(server, "set_slides", { project: "mcp-app", slides: THREE_SLIDES });
    assert.match(textOf(shared), /iPad has a set of its own and does not show these\./);
    const described = jsonOf(await callTool(server, "get_project", { project: "mcp-app" }));
    assert.deepEqual(
      described.deviceSlides.ipad.map((slide: { slide: number }) => slide.slide),
      [1],
    );
    assert.deepEqual((await rest("/api/projects")).find((each: { id: string }) => each.id === "mcp-app").ownSets, ["ipad"]);
    const removed = await callTool(server, "set_slides", { project: "mcp-app", device: "ipad", slides: [] });
    assert.match(textOf(removed), /no slide set of its own any more/);
  });

  test("slides count from 1 here and from 0 in the HTTP API", async () => {
    const described = jsonOf(await callTool(server, "get_project", { project: "mcp-app" }));
    const { project } = await rest("/api/projects/mcp-app");
    assert.deepEqual(
      described.slides.map((slide: { slide: number }) => slide.slide),
      [1, 2, 3],
    );
    for (const [i, slide] of described.slides.entries()) assert.equal(slide.headline, project.slides[i].headline);

    const changed = await callTool(server, "update_slide", { project: "mcp-app", slide: 2, changes: { headline: "Changed *second*" } });
    assertSucceeded(changed);
    assertKeys(jsonOf(changed), ["slide", "layout", "headline"]);
    assert.equal(jsonOf(changed).slide, 2);
    assert.equal((await rest("/api/projects/mcp-app")).project.slides[1].headline, "Changed *second*");

    // Slide 4 of three: index 3 in the HTTP API.
    assertRefused(await callTool(server, "update_slide", { project: "mcp-app", slide: 4, changes: { headline: "x" } }), /^Slide 4 does not exist; the project has 3\.$/);
    assertRefused(await callTool(server, "render", { project: "mcp-app", slides: [4] }), /^Slide 4 does not exist; the project has 3\.$/);
    const response = await server.fetch("/api/projects/mcp-app/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slides: [3] }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Slide 4 does not exist; the project has 3.");
    assertRefused(await callTool(server, "update_slide", { project: "mcp-app", slide: 0, changes: { headline: "x" } }));

    // One slide changed through the HTTP API: index 2 there is slide 3 here.
    const patched = await server.fetch("/api/projects/mcp-app/slides/2", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes: { headline: "Third, by index 2" } }) });
    assert.equal(patched.status, 200);
    assert.equal(jsonOf(await callTool(server, "get_project", { project: "mcp-app" })).slides[2].headline, "Third, by index 2");
    const beyond = await server.fetch("/api/projects/mcp-app/slides/3", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes: { headline: "x" } }) });
    assert.equal(beyond.status, 400);
    assert.equal((await beyond.json()).error, "Slide 4 does not exist; the project has 3.");
  });

  test("update_slide merges the device and clears what remove names", async () => {
    await callTool(server, "update_slide", { project: "mcp-app", slide: 1, changes: { device: { offsetY: 6 } } });
    const result = await callTool(server, "update_slide", { project: "mcp-app", slide: 1, changes: { device: { scale: 0.9 } }, remove: ["subheadline"] });
    assertSucceeded(result);
    const slide = jsonOf(result);
    assert.deepEqual(slide.device, { offsetY: 6, scale: 0.9 });
    assert.equal(slide.subheadline, undefined);
    assert.equal(slide.headline, "First *slide*");
    assertRefused(await callTool(server, "update_slide", { project: "mcp-app", slide: 1, of: "mac", changes: { headline: "x" } }), /has no slide set of its own/);
  });

  test("set_creative_assets sets, lists and removes the wide pictures", async () => {
    const result = await callTool(server, "set_creative_assets", { project: "mcp-app", readme: { headline: "A banner" }, header: { headline: "A header", screenshots: ["home"] } });
    assertSucceeded(result);
    assert.match(textOf(result), /^The project now has these assets:\n- header: .*\n- readme: /);
    assert.deepEqual(Object.keys((await rest("/api/projects/mcp-app")).project.creatives).sort(), ["header", "readme"]);
    const removed = await callTool(server, "set_creative_assets", { project: "mcp-app", remove: ["readme", "header"] });
    assert.equal(textOf(removed), "The project has no header, search results or banner images now.");
    assertRefused(await callTool(server, "set_creative_assets", { project: "mcp-app", remove: ["poster"] }));
  });

  test("render refuses what it cannot draw before drawing anything", async () => {
    await callTool(server, "create_project", { name: "MCP Empty" });
    assertRefused(await callTool(server, "render", { project: "mcp-empty" }), /nothing to render yet/);
    assertRefused(await callTool(server, "render", { project: "mcp-app", creatives: ["social"] }), /no .* asset yet/);
    assertRefused(await callTool(server, "render", { project: "mcp-app", targets: ["iphone-99"] }));
    assertRefused(await callTool(server, "render", { project: "nope" }), /No project "nope"/);
  });

  test("render_mockups needs screenshots, and the ones it names", async () => {
    assertRefused(await callTool(server, "render_mockups", { project: "mcp-empty" }), /no screenshots yet/);
    assertRefused(await callTool(server, "render_mockups", { project: "mcp-app", screenshots: ["hme"] }), /No screenshot is uploaded under "hme"\. The project has: home, window\./);
  });

  test("list_revisions and restore_project bring back an earlier version", async () => {
    await callTool(server, "create_project", { name: "MCP Undo" });
    await callTool(server, "set_slides", { project: "mcp-undo", slides: [{ layout: "statement", headline: "Kept" }] });
    await callTool(server, "update_slide", { project: "mcp-undo", slide: 1, changes: { headline: "Worse" } });
    const listed = await callTool(server, "list_revisions", { project: "mcp-undo" });
    assertSucceeded(listed);
    const { revision, revisions } = jsonOf(listed);
    assert.equal(revision, 3);
    assert.deepEqual(
      revisions.map((row: { revision: number; actor: string }) => [row.revision, row.actor]),
      [
        [3, "mcp"],
        [2, "mcp"],
        [1, "mcp"],
      ],
    );
    for (const row of revisions) assertKeys(row, ["revision", "time", "actor", "size"]);
    const restored = await callTool(server, "restore_project", { project: "mcp-undo", revision: 2 });
    assertSucceeded(restored);
    assert.match(textOf(restored), /^Restored revision 2 of "mcp-undo"\. It is revision 4 now/);
    assert.equal(jsonOf(await callTool(server, "get_project", { project: "mcp-undo" })).slides[0].headline, "Kept");
    assertRefused(await callTool(server, "restore_project", { project: "mcp-undo", revision: 40 }), /keeps no revision 40/);
  });

  test("parallel update_slide calls on different slides keep every edit", async () => {
    await callTool(server, "set_slides", { project: "mcp-app", slides: THREE_SLIDES });
    await Promise.all([1, 2, 3].map((slide) => callTool(server, "update_slide", { project: "mcp-app", slide, changes: { headline: `Parallel ${slide}` } })));
    const { project } = await rest("/api/projects/mcp-app");
    assert.deepEqual(
      project.slides.map((slide: { headline: string }) => slide.headline),
      ["Parallel 1", "Parallel 2", "Parallel 3"],
    );
  });

  test("update_slide names the fields a slide does not have, and leaves them out", async () => {
    const result = await callTool(server, "update_slide", { project: "mcp-app", slide: 1, changes: { headlne: "typo" } });
    assertSucceeded(result);
    assert.match(textOf(result), /Ignored, because a slide has no such field: headlne\./);
    assert.equal(jsonOf(result).headlne, undefined);
    assert.equal((await rest("/api/projects/mcp-app")).project.slides[0].headlne, undefined);
  });

  test("update_slide takes a change of nothing and saves no revision for it", async () => {
    const before = await rest("/api/projects/mcp-app");
    for (const edit of [{}, { changes: {} }, { changes: {}, remove: [] }, { changes: { headline: before.project.slides[0].headline } }]) {
      const result = await callTool(server, "update_slide", { project: "mcp-app", slide: 1, ...edit });
      assertSucceeded(result);
      assert.equal(jsonOf(result).headline, before.project.slides[0].headline);
    }
    assert.equal((await rest("/api/projects/mcp-app")).revision, before.revision);
  });

  test("a damaged project is reported without the parser's words", async () => {
    await callTool(server, "create_project", { name: "MCP Damaged" });
    await writeFile(path.join(server.dataDir, "projects", "mcp-damaged", "project.json"), '{"id": "mcp-damaged",');
    const result = await callTool(server, "get_project", { project: "mcp-damaged" });
    assertRefused(result);
    assert.doesNotMatch(textOf(result), /JSON|position|\//);
  });
});

describe("refusals change nothing, and nothing goes unsaid", () => {
  test("render_mockups saves nothing when it refuses", async () => {
    const before = (await rest("/api/projects/mcp-app")).project.mockups;
    assertRefused(await callTool(server, "render_mockups", { project: "mcp-app", screenshots: ["hme"], device: { style: "clay" } }), /hme/);
    assert.deepEqual((await rest("/api/projects/mcp-app")).project.mockups, before);
  });

  test("update_slide says so when it names a screenshot that is not there or a field to remove that does not exist", async () => {
    const result = await callTool(server, "update_slide", { project: "mcp-app", slide: 1, changes: { screenshot: "setings" }, remove: ["subheading"] });
    assertSucceeded(result);
    assert.match(textOf(result), /Not uploaded yet, so these will render as placeholders: setings\./);
    assert.match(textOf(result), /Not cleared, because a slide has no such field: subheading\./);
    assert.equal(jsonOf(result).screenshot, "setings");
    await callTool(server, "update_slide", { project: "mcp-app", slide: 1, changes: { screenshot: "home" } });
  });
});

describe("rendering, drawn with Chromium", renderTier, () => {
  test("render answers with links, the contact sheet and what is left", async () => {
    await callTool(server, "set_slides", { project: "mcp-app", slides: THREE_SLIDES.slice(0, 2) });
    const result = await callTool(server, "render", { project: "mcp-app", slides: [2], targets: ["iphone-6.9"], locales: ["en-US"] });
    assertSucceeded(result);
    const text = textOf(result);
    assert.match(text, /^Rendered 1 PNG\./);
    assert.ok(text.includes(`${server.url}/files/mcp-app/out/en-US/iphone-6.9/02.png`), text);
    assert.ok(text.includes(`${server.url}/api/projects/mcp-app/export.zip`));
    assert.ok(result.content.some((part) => part.type === "image" && part.mimeType === "image/jpeg"));
  });

  test("render_mockups answers with links and a preview", async () => {
    const result = await callTool(server, "render_mockups", { project: "mcp-app", screenshots: ["home"], width: 600 });
    assertSucceeded(result);
    assert.match(textOf(result), /^Drew 1 mockup,/);
    assert.ok(textOf(result).includes(`${server.url}/api/projects/mcp-app/mockups/home.iphone.png`));
    assert.ok(result.content.some((part) => part.type === "image"));
    assert.equal((await rest("/api/projects/mcp-app")).project.mockups.width, 600);
  });

  test("render refuses languages the project does not have", async () => {
    assertRefused(await callTool(server, "render", { project: "mcp-app", locales: ["fr"], targets: ["iphone-6.9"] }), /fr/);
  });
});
