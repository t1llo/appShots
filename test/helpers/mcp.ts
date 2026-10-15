import type { TestServer } from "./spawn-server.ts";

/** One part of a tool's answer, as the MCP endpoint sends it. */
export interface ToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

let next = 1;

/**
 * One JSON-RPC call to /mcp. The endpoint keeps no session, so a call needs no `initialize` first. It answers in
 * JSON only to a client that also takes an event stream, as every MCP client does.
 */
export async function rpc(server: TestServer, method: string, params?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const response = await server.fetch("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: next++, method, ...(params === undefined ? {} : { params }) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** Calls a tool and returns its result. A tool that fails answers with `isError`, not with a JSON-RPC error. */
export async function callTool(server: TestServer, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const { status, body } = await rpc(server, "tools/call", { name, arguments: args });
  if (status !== 200 || !body?.result) throw new Error(`tools/call ${name} answered ${status}: ${JSON.stringify(body)}`);
  return body.result as ToolResult;
}

/** The text parts of a result, joined. */
export const textOf = (result: ToolResult): string =>
  result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

/** The first text part read as JSON, as the tools that return data send it. */
export const jsonOf = (result: ToolResult): any => JSON.parse(result.content[0]!.text!);
