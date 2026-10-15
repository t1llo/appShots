import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rpc } from "./api.mjs";
import { fail } from "./fail.mjs";

/** @typedef {import("./config.mjs").Config} Config */

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
    return;
  }
  console.log(`Tools of the appShots server at ${config.url}. Call one with:  appshots call <tool> '<arguments as JSON>'`);
  console.log("Start with get_design_guide. 'appshots tools <tool>' prints one tool's arguments in full; a ? marks an optional one.\n");
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
