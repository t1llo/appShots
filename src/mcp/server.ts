import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Log } from "../http/errors.ts";
import type { Space } from "../storage/paths.ts";
import type { ToolContext } from "./context.ts";
import { TOOL_FAMILIES } from "./tools/index.ts";

export interface McpDeps {
  /** Where unexpected failures of a tool are reported. The console unless a test listens in. */
  log?: Log;
}

/** `space` is the account the request was authenticated as; every tool works inside it. */
export function createMcpServer(base: string, space: Space, deps: McpDeps = {}): McpServer {
  const server = new McpServer(
    { name: "appshots", version: "0.1.0" },
    {
      instructions:
        "Generates App Store screenshots for iPhone, iPad and Mac apps and for web apps, whatever they are built with: raw app screenshots placed in device frames with headlines, backgrounds and social-proof badges, exported at exact store sizes. Also makes the product page header and search results assets of App Store Connect, wide banners for a README or a link preview, and transparent device mockups. Call get_design_guide first.",
    },
  );
  const tools: ToolContext = { base, space, ctx: { space, actor: "mcp" }, log: deps.log ?? console };
  for (const register of TOOL_FAMILIES) register(server, tools);
  return server;
}
