// What the server would make of a slide or an asset typed as JSON. JsonSection loads this only once something is
// applied, since the schemas come with every design and icon id.

import { prettifyError } from "zod";
import { creativeSchema, slideSchema } from "../../../src/schema.ts";

/** The item as the server would keep it, or what it would say is wrong with it. */
export function check(kind: "slide" | "creative", value: unknown): { item: object } | { error: string } {
  const result = (kind === "slide" ? slideSchema : creativeSchema).safeParse(value);
  return result.success ? { item: result.data } : { error: prettifyError(result.error) };
}
