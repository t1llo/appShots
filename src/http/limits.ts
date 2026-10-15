/** How large a request body may be, by what it carries. The routes and their error messages read the same table. */
export const LIMITS = {
  /** A JSON body to /api or /mcp. */
  json: "2mb",
  /** A raw screenshot. */
  shot: "40mb",
  /** A logo or other image. */
  image: "20mb",
} as const;
