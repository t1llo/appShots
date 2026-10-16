import type { Space } from "../../storage/paths.ts";

/** One section of the design guide: `## title`, then what `body` writes for this server and this account. */
export interface Topic {
  /** What get_design_guide takes as `topic`, such as "mockups". */
  id: string;
  title: string;
  body: (base: string, space: Space) => string;
}

/** Choices with what each one does, one line each. */
export const list = (entries: Record<string, string>) =>
  Object.entries(entries)
    .map(([key, value]) => `- \`${key}\`: ${value}`)
    .join("\n");
