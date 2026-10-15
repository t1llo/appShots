const MB = 1024 * 1024;

/** How large a request body may be, by what it carries. The routes and their error messages read the same table. */
export const LIMITS = {
  /** A JSON body to /api or /mcp. */
  json: 2 * MB,
  /** A raw screenshot. */
  shot: 40 * MB,
  /** A logo or other image. */
  image: 20 * MB,
} as const;

/** What a body over its limit is told: the limit of its own kind, which the parser that refused it reports. */
export function tooLarge(limit: number): string {
  const size = `${Math.round(limit / MB)} MB`;
  return limit === LIMITS.json ? `Request body too large (limit ${size})` : `File too large (limit ${size})`;
}
