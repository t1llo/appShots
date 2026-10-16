import { closeSync, openSync, readSync } from "node:fs";

/** @typedef {"iphone" | "duo" | "ipad"} PlanKind */

/**
 * The displays a capture plan takes screenshots for, by the names the server gives its export sizes: the family a
 * screenshot of each is filed under, and the sizes simulators of it take screenshots at, upright. The first size is
 * the one the server exports. The same as the models in src/domain/devices.ts, which a test keeps them alike with.
 * A Mac app is not in a simulator, so the Mac is not here.
 * @type {Record<string, { kind: PlanKind, sizes: Array<[number, number]> }>}
 */
export const PLAN_DISPLAYS = {
  "iphone-6.9": { kind: "iphone", sizes: [[1320, 2868], [1290, 2796], [1260, 2736]] },
  "iphone-6.3": { kind: "iphone", sizes: [[1206, 2622], [1179, 2556]] },
  "iphone-6.5": { kind: "iphone", sizes: [[1284, 2778], [1242, 2688], [828, 1792]] },
  "iphone-6.1": { kind: "iphone", sizes: [[1170, 2532], [1125, 2436], [1080, 2340]] },
  "iphone-5.5": { kind: "iphone", sizes: [[1242, 2208], [1080, 1920]] },
  "iphone-4.7": { kind: "iphone", sizes: [[750, 1334]] },
  "iphone-4": { kind: "iphone", sizes: [[640, 1136], [640, 1096]] },
  "iphone-3.5": { kind: "iphone", sizes: [[640, 960], [640, 920]] },
  "iphone-duo": { kind: "duo", sizes: [[2007, 2853]] },
  "iphone-duo-cover": { kind: "duo", sizes: [[1398, 2034]] },
  "ipad-13": { kind: "ipad", sizes: [[2064, 2752], [2048, 2732]] },
  "ipad-11": { kind: "ipad", sizes: [[1668, 2420], [1488, 2266], [1668, 2388], [1640, 2360]] },
  "ipad-12.9": { kind: "ipad", sizes: [[2048, 2732]] },
  "ipad-10.5": { kind: "ipad", sizes: [[1668, 2224], [1620, 2160]] },
  "ipad-9.7": { kind: "ipad", sizes: [[1536, 2048], [1536, 2008], [768, 1024], [768, 1004]] },
};

/** A family stands for the display it is designed at. */
export const FAMILY_DISPLAYS = { iphone: "iphone-6.9", duo: "iphone-duo", ipad: "ipad-13" };

/**
 * The display a screenshot of this size is from, upright or on its side. The first that has it wins, which is the
 * current hardware where two share a size. Null for a size no display has.
 * @param {number} width
 * @param {number} height
 */
export function displayOfSize(width, height) {
  const [short, long] = width < height ? [width, height] : [height, width];
  return Object.keys(PLAN_DISPLAYS).find((key) => PLAN_DISPLAYS[key].sizes.some(([w, h]) => w === short && h === long)) ?? null;
}

/**
 * How far down a display's sizes a screen of this size is, upright or on its side: 0 is the size the server exports,
 * -1 none of them.
 * @param {{ width: number, height: number } | null} screen
 * @param {string} display
 */
export function sizeRank(screen, display) {
  if (!screen) return -1;
  const [short, long] = screen.width < screen.height ? [screen.width, screen.height] : [screen.height, screen.width];
  return PLAN_DISPLAYS[display].sizes.findIndex(([w, h]) => w === short && h === long);
}

/**
 * The width and height a PNG gives in its header, or null for a file that is no PNG.
 * @param {string} file
 */
export function pngSize(file) {
  const head = Buffer.alloc(24);
  const fd = openSync(file, "r");
  try {
    readSync(fd, head, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  if (head.readUInt32BE(0) !== 0x89504e47 || head.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}
