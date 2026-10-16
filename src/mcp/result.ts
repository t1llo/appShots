import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { publicError, reportError } from "../http/errors.ts";
import type { Warning } from "../services/context.ts";
import type { ToolContext } from "./context.ts";

export const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });

/** Data for the model, without the indentation a person would want: it is read by a parser, and spaces cost tokens. */
export const json = (value: unknown): CallToolResult => text(JSON.stringify(value));

/** A warning as the tools word it: a field that is not there points to where the fields are. */
export const noted = (warning: Warning): string => (warning.kind === "field" || warning.kind === "remove" ? `${warning.text} The design guide lists the fields.` : warning.text);

/** Warnings to put after a sentence, each on a line of its own. */
export const notes = (warnings: Warning[]): string => warnings.map((warning) => `\n${noted(warning)}`).join("");

/**
 * Tool failures go back to the model as readable text so it can correct the call. What the caller cannot act on,
 * such as a file the server could not read, is logged under a reference and answered in general terms.
 */
export async function guard(tools: ToolContext, name: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    const known = publicError(error);
    if (known) return { isError: true, content: [{ type: "text", text: known.message }] };
    const ref = reportError(tools.log, error, `the MCP tool ${name} for account ${tools.space.id}`);
    return { isError: true, content: [{ type: "text", text: `Something went wrong on the server (ref ${ref}); try again.` }] };
  }
}
