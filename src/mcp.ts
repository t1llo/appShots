// The MCP server lives in src/mcp/: the server in server.ts, one module per family of tools in tools/, and the
// design guide by topic in guide/. This keeps the address everything imports it from.
export { createMcpServer, type McpDeps } from "./mcp/server.ts";
