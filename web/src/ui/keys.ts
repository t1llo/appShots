const FORWARD = { row: ["ArrowRight"], column: ["ArrowDown"], both: ["ArrowRight", "ArrowDown"] };
const BACK = { row: ["ArrowLeft"], column: ["ArrowUp"], both: ["ArrowLeft", "ArrowUp"] };

/**
 * Where the arrow keys, Home and End move in a list of `count` items from the one at `at` (-1 for none), round from
 * the end to the start; null for any other key. A row answers to left and right, a column to up and down.
 */
export function arrowMove(key: string, at: number, count: number, axis: keyof typeof FORWARD): number | null {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (FORWARD[axis].includes(key)) return (at + 1) % count;
  if (BACK[axis].includes(key)) return at <= 0 ? count - 1 : at - 1;
  return null;
}
