import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Router } from "express";
import { createMcpServer } from "../../mcp.ts";
import { spaceOf } from "../auth.ts";
import type { Log } from "../errors.ts";
import { LIMITS } from "../limits.ts";
import { baseUrl } from "../security.ts";

/** The MCP endpoint at /mcp. A tool that fails unexpectedly is reported to `log`. */
export function mcpRoutes(log: Log = console): Router {
  const routes = express.Router();
  routes.post("/mcp", express.json({ limit: LIMITS.json }), async (req, res) => {
    // Stateless: every request gets a fresh server, so the service scales and restarts without session bookkeeping.
    const server = createMcpServer(baseUrl(req), spaceOf(res), { log });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  routes.all("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  });
  return routes;
}
