import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerVideoTools } from "../../src/mcp/tools/video.ts";
import { createProject, updateProject } from "../../src/store.ts";
import { videoService } from "../../src/video/service.ts";
import { tmpData } from "../helpers/tmp-data.ts";
import { type FakeCapturer, fakeCapturer, gate } from "./video-fakes.ts";

// render_video_layers as an agent calls it, on an MCP server of its own with the browser swapped for plain pictures.

const BASE = "https://appshots.example.com";
const data = await tmpData("video-mcp");
const { space } = data;
let client: Client;
let fake: FakeCapturer;
let project: string;

before(async () => {
  fake = fakeCapturer();
  videoService.useCapturer(fake);
  const server = new McpServer({ name: "appshots", version: "0.0.0" });
  registerVideoTools(server, { base: BASE, space });
  const [near, far] = InMemoryTransport.createLinkedPair();
  await server.connect(far);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(near);
  project = (await createProject(space, { name: "Preview", locales: ["en", "de"] })).id;
  await updateProject(space, project, { slides: [{ layout: "statement", headline: { en: "Plan your *week*", de: "Plane deine *Woche*" } }] });
});
after(async () => {
  await client?.close();
  await data.remove();
});
beforeEach(() => {
  fake.calls.length = 0;
  fake.before = undefined;
});

const text = (result: CallToolResult) => result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
const draw = (args: Record<string, unknown>, options?: { signal: AbortSignal }) => client.callTool({ name: "render_video_layers", arguments: { project, ...args } }, undefined, options) as Promise<CallToolResult>;

test("the tool is listed with its project required and every input of the REST body but the background flag", async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((entry) => entry.name === "render_video_layers");
  assert.ok(tool);
  assert.equal(tool.title, "Render app preview layers");
  assert.match(tool.description!, /^Draws the captions, intro and outro cards and background of an app preview video in the project's style/);
  assert.match(tool.description!, /`appshots video guide`/);
  assert.deepEqual(tool.inputSchema.required, ["project"]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), ["captionStyle", "captions", "display", "intro", "locales", "orientation", "outro", "plate", "project", "size", "touch"]);
});

test("a set is drawn once and then answered for free, with the manifest as structured content", async () => {
  const first = await draw({ display: "iphone", captions: [{ id: "plan", text: { slide: 1 } }], outro: { disclosure: ["login"] } });
  assert.equal(first.isError, undefined, text(first));
  const answer = first.structuredContent as Record<string, unknown> & { set: string; layers: { id: string }[] };
  assert.deepEqual(Object.keys(answer).sort(), ["charged", "display", "layers", "locales", "rendersLeft", "set", "size", "warnings", "zip"]);
  assert.equal(answer.charged, true);
  assert.match(text(first), new RegExp(`^Drew ${answer.layers.length} layers as set ${answer.set} \\(886×1920; en, de\\)\\.`));
  assert.ok(text(first).includes(`ZIP of the set: ${BASE}/api/projects/${project}/video-layers/${answer.set}/layers.zip`));
  assert.ok(text(first).includes(`${BASE}/files/${project}/video/${answer.set}/`));
  // The small print is English in German too, which the model is told to check.
  assert.match(text(first), /\n {2}de, outro-text: no de wording for the "login" notice, drawn in en\n/);

  const again = await draw({ display: "iphone", captions: [{ id: "plan", text: { slide: 1 } }], outro: { disclosure: ["login"] } });
  assert.equal((again.structuredContent as { charged: boolean }).charged, false);
  assert.match(text(again), /was there already, with \d+ layers\. Nothing was charged\./);
  assert.equal(fake.calls.length, 2);
});

test("a call the project cannot answer, or the schema refuses, comes back as readable text", async () => {
  for (const [args, says] of [
    [{ display: "iphone", locales: ["fr"] }, /no language "fr"/],
    [{ display: "iphone", captions: [{ id: "a", text: { slide: 4 } }] }, /no slide 4/],
    [{ display: "mac", orientation: "portrait" }, /landscape only/],
    [{ display: "iphone", captions: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, text: "A" })) }, /captions/],
    [{ project: "no-such-project", display: "iphone" }, /./],
  ] as const) {
    const result = await draw(args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(text(result), says, JSON.stringify(args));
  }
  assert.equal(fake.calls.length, 0);
});

test("a call the client gives up on stops its run", async () => {
  const hold = gate();
  fake.before = () => hold.opened;
  const caller = new AbortController();
  const call = draw({ display: "iphone", captions: [{ id: "gone", text: "Gone" }] }, { signal: caller.signal }).catch((error: unknown) => error);
  while (fake.calls.length === 0) await sleep(5);
  const page = fake.calls[0]!;
  caller.abort();
  assert.ok((await call) instanceof Error);
  while (!page.signal.aborted) await sleep(5);
  hold.open();
  const job = new URL(page.path, "http://page").searchParams.get("job")!;
  while (!videoService.getJob(space, job)?.finishedAt) await sleep(5);
  assert.equal(videoService.getJob(space, job)!.state, "cancelled");
  assert.equal(fake.calls.length, 1);
});

test("a call the client gives up on does not stop a run another request waits for", async () => {
  const hold = gate();
  fake.before = () => hold.opened;
  const args = { display: "iphone" as const, captions: [{ id: "shared", text: "Shared" }] };
  const caller = new AbortController();
  const call = draw(args, { signal: caller.signal }).catch((error: unknown) => error);
  while (fake.calls.length === 0) await sleep(5);
  const page = fake.calls[0]!;
  const other = await videoService.start(space, project, args);
  assert.ok("job" in other && !other.started);
  caller.abort();
  assert.ok((await call) instanceof Error);
  await sleep(50);
  const stopped = page.signal.aborted;
  hold.open();
  assert.equal(stopped, false);
  assert.equal((await other.finished).layers.length > 0, true);
  const job = new URL(page.path, "http://page").searchParams.get("job")!;
  assert.equal(videoService.getJob(space, job)!.state, "done");
});
