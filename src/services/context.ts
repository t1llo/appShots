// The services are what the HTTP API and the MCP tools both call to read and change a project. Each front door
// turns its request into a call here and the answer into its own format, so the two cannot drift apart: the same
// change is checked the same way, saved under the same lock, and warns about the same things.

import type { WriteOptions } from "../storage/projects.ts";
import type { Space } from "../storage/paths.ts";

/** Who makes a change, as the project's history records it. */
export type Actor = "studio" | "api" | "mcp";

/** What every service call is made with. */
export interface Ctx {
  /** The account the request was authenticated as. */
  space: Space;
  actor: Actor;
  /** The revision the caller made its change on. When the project has moved on since, the change is refused with a ConflictError. */
  ifRevision?: number;
}

/** Something a call went through without, and says so: a misspelt field, a name nothing is uploaded under. */
export interface Warning {
  kind: "field" | "locale" | "screenshot" | "image" | "remove" | "stored";
  /** What it is about: field paths, screenshot or image names, language codes. */
  names: string[];
  /** One sentence saying so, as the HTTP API answers it under `warnings`. */
  text: string;
}

export const writeOptions = (ctx: Ctx): WriteOptions => ({ ifRevision: ctx.ifRevision, actor: ctx.actor });

export const warningTexts = (warnings: Warning[]): string[] => warnings.map((warning) => warning.text);
