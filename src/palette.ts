import sharp from "sharp";

const cache = new Map<string, string[]>();
const islandCache = new Map<string, boolean>();

/**
 * Simulator screenshots already contain the Dynamic Island as a black pill; screenshots taken on a
 * real phone do not. Reports whether the spot where the island sits is already solid black, in
 * which case drawing one on top would only double it up.
 */
export async function hasBakedIsland(file: string, version: number, width: number): Promise<boolean> {
  const key = `${file}:${version}`;
  const cached = islandCache.get(key);
  if (cached !== undefined) return cached;
  const region = { left: Math.round(width * 0.45), top: Math.round(width * 0.05), width: Math.round(width * 0.1), height: Math.round(width * 0.055) };
  const { data } = await sharp(file).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) <= 12) dark++;
  }
  const baked = dark / (data.length / 3) > 0.98;
  islandCache.set(key, baked);
  return baked;
}

/**
 * Where the status bar of each device leaves the screenshot bare: a band at the height of the clock, and the
 * stretches of it that hold neither the clock nor the icons nor the Dynamic Island. All as fractions of the width.
 */
const STATUS_PATCHES = {
  iphone: { top: 0.055, bottom: 0.095, spans: [[0.025, 0.06], [0.26, 0.33], [0.67, 0.74], [0.94, 0.975]] },
  duo: { top: 0.012, bottom: 0.045, spans: [[0.3, 0.45], [0.55, 0.7]] },
  ipad: { top: 0.004, bottom: 0.02, spans: [[0.3, 0.45], [0.55, 0.7]] },
} as const;

export interface StatusBarLook {
  /** What to paint over the screenshot's own status bar: its colour beside the clock and the icons, left to right. */
  fill: string;
  /** True where that colour is dark, so the bar is drawn in white. */
  light: boolean;
}

const statusCache = new Map<string, StatusBarLook>();

/** Reads the colour behind a screenshot's status bar off the spots where the bar shows nothing. */
export async function statusBarLook(file: string, version: number, device: keyof typeof STATUS_PATCHES, width: number): Promise<StatusBarLook> {
  const key = `${file}:${version}:${device}`;
  const cached = statusCache.get(key);
  if (cached) return cached;
  const { top, bottom, spans } = STATUS_PATCHES[device];
  const columns = 200;
  const band = { left: 0, top: Math.round(width * top), width, height: Math.max(1, Math.round(width * (bottom - top))) };
  const { data } = await sharp(file).extract(band).resize(columns, 1, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let brightness = 0;
  const stops = spans.map(([from, to]) => {
    const sum = [0, 0, 0];
    const first = Math.round(from * columns);
    const last = Math.max(first + 1, Math.round(to * columns));
    for (let x = first; x < last; x++) for (let c = 0; c < 3; c++) sum[c]! += data[x * 3 + c]!;
    const rgb = sum.map((value) => Math.round(value / (last - first)));
    brightness += (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255 / spans.length;
    return `rgb(${rgb.join(" ")}) ${Math.round(((from + to) / 2) * 100)}%`;
  });
  const look = { fill: `linear-gradient(90deg,${stops.join(",")})`, light: brightness < 0.55 };
  statusCache.set(key, look);
  return look;
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

/**
 * Derives mesh-gradient colours from a screenshot: finds its dominant hue and builds a muted,
 * near-monochrome backdrop that contrasts with the UI's brightness (mid-tone behind light UIs, deep behind dark ones).
 */
export async function paletteFor(file: string, version: number): Promise<string[]> {
  const key = `${file}:${version}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const { data } = await sharp(file).resize(24, 48, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Array<number>(12).fill(0);
  const binHue = new Array<number>(12).fill(0);
  let lightness = 0;
  let chromaTotal = 0;
  const pixels = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    lightness += (max + min) / 2;
    if (chroma < 0.12) continue;
    let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
    hue = (hue * 60 + 360) % 360;
    const bin = Math.floor(hue / 30) % 12;
    bins[bin]! += chroma;
    binHue[bin]! += hue * chroma;
    chromaTotal += chroma;
  }
  lightness /= pixels;
  const lightUi = lightness > 0.55;

  let colors: string[];
  if (chromaTotal / pixels < 0.012) {
    // A greyscale UI has no hue worth echoing.
    colors = lightUi ? ["#18181B", "#3F3F46", "#27272A", "#52525B"] : ["#F4F4F5", "#E4E4E7", "#FAFAFA", "#D4D4D8"];
  } else {
    const top = bins.indexOf(Math.max(...bins));
    const hue = binHue[top]! / bins[top]!;
    colors = lightUi
      ? [hslToHex(hue, 0.42, 0.42), hslToHex(hue + 12, 0.46, 0.5), hslToHex(hue - 10, 0.44, 0.36), hslToHex(hue + 4, 0.5, 0.56)]
      : [hslToHex(hue, 0.35, 0.09), hslToHex(hue, 0.45, 0.28), hslToHex(hue + 14, 0.4, 0.24), hslToHex(hue - 12, 0.4, 0.2)];
  }
  cache.set(key, colors);
  return colors;
}
