import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Log } from "../http/errors.ts";
import { slugSchema } from "../schema.ts";
import type { Ctx } from "../services/context.ts";
import { DEVICE_KINDS } from "../sizes.ts";
import type { Space } from "../storage/paths.ts";

/** What every tool of one MCP request works with. */
export interface ToolContext {
  /** The address this server is reached at, for the links in the answers. */
  base: string;
  /** The account the request was authenticated as; every tool works inside it. */
  space: Space;
  /** The service calls the tools make, saved as made by "mcp". */
  ctx: Ctx;
  log: Log;
}

/** Registers one family of tools. Each lives in src/mcp/tools/ and is listed once in its index. */
export type RegisterTools = (server: McpServer, tools: ToolContext) => void;

// Inputs several tools share.
export const projectInput = slugSchema.describe("Project id");
export const slideNumber = z.number().int().min(1).max(10).describe("Slide number, starting at 1");
export const deviceKind = z.enum(DEVICE_KINDS);
