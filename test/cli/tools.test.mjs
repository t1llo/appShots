import assert from "node:assert/strict";
import { after, test } from "node:test";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

const home = await cliHome("tools");
after(() => home.remove());
const { leavesFieldsOut, tools } = await import("../../cli/src/tools.mjs");

// A part of a slide as tools/list shows it now: an object, its fields left to the design guide.
const part = { description: "Ratings, awards, reviews", type: "object", properties: {}, additionalProperties: {} };
const lean = {
  name: "set_creative_assets",
  description: "Designs the project's wide images.",
  inputSchema: { type: "object", properties: { project: { type: "string" }, header: part, slides: { type: "array", items: { type: "object", properties: { badges: { type: "array", items: part } } } } }, required: ["project"] },
};
// The same tool from a server that writes every field out, and a tool that takes nothing.
const full = { ...lean, inputSchema: { type: "object", properties: { project: { type: "string" }, header: { type: "object", properties: { headline: { type: "string" } } } }, required: ["project"] } };
const bare = { name: "list_projects", description: "Lists the projects.", inputSchema: { type: "object", properties: {} } };

/**
 * What `appshots tools` prints against a server whose tools/list answers with `list`.
 * @param {object[]} list
 * @param {string} [name]
 */
async function printed(list, name) {
  const server = await stubServer(() => [200, { jsonrpc: "2.0", id: 1, result: { tools: list } }]);
  try {
    return await quietly(() => tools({ url: server.url, token: "test-token" }, name));
  } finally {
    await server.close();
  }
}

test("an object shown without its fields is found, also inside a list or a list's items", () => {
  assert.equal(leavesFieldsOut(lean.inputSchema), true);
  assert.equal(leavesFieldsOut({ type: "object", properties: { badges: { type: "array", items: part } } }), true);
  // A text in several languages is an object of strings, not one whose fields are left out.
  assert.equal(leavesFieldsOut({ type: "object", properties: { headline: { anyOf: [{ type: "string" }, { type: "object", additionalProperties: { type: "string" } }] } } }), false);
  assert.equal(leavesFieldsOut(full.inputSchema), false);
  assert.equal(leavesFieldsOut(bare.inputSchema), false);
});

test("one tool's arguments say where the fields left out of them are", async () => {
  const text = await printed([lean, bare], "set_creative_assets");
  assert.match(text, /^set_creative_assets: Designs/);
  assert.ok(text.includes(`appshots call get_design_guide '{"topic":"fields"}'`));
  assert.ok(!(await printed([lean, bare], "list_projects")).includes("get_design_guide"));
  assert.ok(!(await printed([full], "set_creative_assets")).includes("get_design_guide"));
});

test("the list says where every field is only when the server leaves some out", async () => {
  const text = await printed([lean, bare]);
  assert.match(text, /prints one tool's arguments; a \? marks an optional one/);
  assert.ok(!text.includes("in full"));
  assert.ok(text.includes(`appshots call get_design_guide '{"topic":"fields"}'`));
  assert.ok(text.includes("set_creative_assets  { project, header?, slides? }"));
  assert.ok(!(await printed([full, bare])).includes(`"topic":"fields"`));
});
