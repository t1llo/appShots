import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rpc } from "./api.mjs";
import { fail } from "./fail.mjs";

/** @typedef {import("./config.mjs").Config} Config */

const FIELDS = `appshots call get_design_guide '{"topic":"fields"}'`;

/**
 * Whether a tool's arguments, as tools/list shows them, hold an object whose fields are left out. The server shows
 * the parts of a slide that way to keep the list small, and its design guide writes their fields out instead. A
 * server from before that shows every field, and has no such topic to point to.
 * @param {unknown} schema
 * @returns {boolean}
 */
export function leavesFieldsOut(schema) {
  if (!schema || typeof schema !== "object") return false;
  const { type, properties, additionalProperties } = /** @type {Record<string, unknown>} */ (schema);
  const empty = (/** @type {unknown} */ value) => !!value && typeof value === "object" && Object.keys(value).length === 0;
  if (type === "object" && empty(properties) && empty(additionalProperties)) return true;
  return Object.values(schema).some((value) => (Array.isArray(value) ? value.some(leavesFieldsOut) : leavesFieldsOut(value)));
}

/**
 * @param {Config} config
 * @param {string} [name]
 */
export async function tools(config, name) {
  const list = (await rpc(config, "tools/list")).tools;
  if (name) {
    const tool = list.find((entry) => entry.name === name);
    if (!tool) fail(`No tool "${name}". Run 'appshots tools' for the list.`);
    console.log(`${tool.name}: ${tool.description}\n\nArguments, as a JSON Schema:\n${JSON.stringify(tool.inputSchema, null, 2)}`);
    if (leavesFieldsOut(tool.inputSchema)) console.log(`\nAn object shown without its fields takes the ones the design guide lists:\n  ${FIELDS}`);
    return;
  }
  console.log(`Tools of the appShots server at ${config.url}. Call one with:  appshots call <tool> '<arguments as JSON>'`);
  console.log("Start with get_design_guide. 'appshots tools <tool>' prints one tool's arguments; a ? marks an optional one.");
  if (list.some((tool) => leavesFieldsOut(tool.inputSchema))) console.log(`Every field of a slide's parts, such as its badges or device:  ${FIELDS}`);
  console.log("");
  for (const tool of list) {
    const required = new Set(tool.inputSchema?.required ?? []);
    const args = Object.keys(tool.inputSchema?.properties ?? {}).map((key) => (required.has(key) ? key : `${key}?`));
    console.log(`${tool.name}${args.length ? `  { ${args.join(", ")} }` : ""}\n  ${tool.description}\n`);
  }
}

/**
 * JSON handed over on the command line: inline, as @file.json, or as - for what comes in on stdin.
 * @param {string} source
 * @param {string} what
 */
export function jsonInput(source, what) {
  if (source === "-") {
    source = readFileSync(0, "utf8");
  } else if (source.startsWith("@")) {
    if (!existsSync(source.slice(1))) fail(`No such file: ${source.slice(1)}`);
    source = readFileSync(source.slice(1), "utf8");
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${what} not valid JSON: ${error.message}`);
  }
}

/**
 * @param {Config} config
 * @param {string | undefined} name
 * @param {string | undefined} input
 * @param {Record<string, string | true>} flags
 */
export async function call(config, name, input, flags) {
  if (!name) fail("Usage: appshots call <tool> ['<arguments as JSON>' | @file.json | -]");
  const args = jsonInput(input ?? "{}", "The arguments are");
  const result = await rpc(config, "tools/call", { name, arguments: args });
  // An agent without MCP cannot be handed a picture, so pictures become files it can open.
  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : path.join(tmpdir(), "appshots"));
  let pictures = 0;
  for (const part of result.content ?? []) {
    if (part.type === "text") {
      (result.isError ? console.error : console.log)(part.text);
    } else if (part.type === "image") {
      mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, `${name}-${++pictures}.${part.mimeType === "image/png" ? "png" : "jpg"}`);
      writeFileSync(file, Buffer.from(part.data, "base64"));
      console.log(`Picture saved, open it to look: ${file}`);
    }
  }
  if (result.isError) process.exitCode = 1;
}
