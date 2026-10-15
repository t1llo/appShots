import sharp from "sharp";

/**
 * Remembers what was worked out from a screenshot, keyed by its file and version. A new version of a file is a new
 * key, so the oldest answers are dropped once there are `max` of them. The promise is kept rather than the answer:
 * two slides of one render that need the same answer wait for the one reading of the file. A failure is not kept,
 * because the file may well be readable the next time.
 */
export function remembered<T>(max: number): (key: string, work: () => Promise<T>) => Promise<T> {
  const kept = new Map<string, Promise<T>>();
  return (key, work) => {
    const found = kept.get(key);
    if (found) {
      // Asked for again, so it is the last to be dropped.
      kept.delete(key);
      kept.set(key, found);
      return found;
    }
    const answer = work();
    kept.set(key, answer);
    answer.catch(() => {
      if (kept.get(key) === answer) kept.delete(key);
    });
    if (kept.size > max) kept.delete(kept.keys().next().value!);
    return answer;
  };
}

/** Each answer is a few hundred bytes at most, so this keeps every screenshot a busy server works with. */
const KEPT = 2000;

const palettes = remembered<string[]>(KEPT);
const islands = remembered<boolean>(KEPT);
const statusBars = remembered<StatusBarLook>(KEPT);

/** The part of a picture inside its edges: sharp refuses to cut out anything that reaches past them. */
function within(area: { left: number; top: number; width: number; height: number }, size: { width?: number; height?: number }) {
  const width = Math.min(area.width, (size.width ?? 0) - area.left);
  const height = Math.min(area.height, (size.height ?? 0) - area.top);
  return width >= 1 && height >= 1 ? { ...area, width, height } : undefined;
}

/**
 * Simulator screenshots already contain the Dynamic Island as a black pill; screenshots taken on a
 * real phone do not. Reports whether the spot where the island sits is already solid black, in
 * which case drawing one on top would only double it up.
 */
export function hasBakedIsland(file: string, version: number, width: number): Promise<boolean> {
  return islands(`${file}:${version}`, async () => {
    const image = sharp(file);
    const region = { left: Math.round(width * 0.45), top: Math.round(width * 0.05), width: Math.round(width * 0.1), height: Math.round(width * 0.055) };
    // A picture too short to reach the spot, such as a wide strip filed as an iPhone screenshot, has no island in it.
    const meta = await image.metadata();
    if (region.left + region.width > meta.width || region.top + region.height > meta.height) return false;
    const { data } = await image.extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (let i = 0; i < data.length; i += 3) {
      if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) <= 12) dark++;
    }
    return dark / (data.length / 3) > 0.98;
  });
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

/** Reads the colour behind a screenshot's status bar off the spots where the bar shows nothing. */
export function statusBarLook(file: string, version: number, device: keyof typeof STATUS_PATCHES, width: number): Promise<StatusBarLook> {
  return statusBars(`${file}:${version}:${device}`, async () => {
    const { top, bottom, spans } = STATUS_PATCHES[device];
    const columns = 200;
    const image = sharp(file);
    const wanted = { left: 0, top: Math.round(width * top), width, height: Math.max(1, Math.round(width * (bottom - top))) };
    // A picture shorter than the band is read along its last rows instead.
    const meta = await image.metadata();
    const band = within(wanted, meta) ?? within({ ...wanted, top: Math.max(0, meta.height - wanted.height) }, meta) ?? { left: 0, top: 0, width: meta.width, height: meta.height };
    const { data } = await image.extract(band).resize(columns, 1, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
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
    return { fill: `linear-gradient(90deg,${stops.join(",")})`, light: brightness < 0.55 };
  });
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
export function paletteFor(file: string, version: number): Promise<string[]> {
  return palettes(`${file}:${version}`, async () => {
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

    // A greyscale UI has no hue worth echoing.
    if (chromaTotal / pixels < 0.012) return lightUi ? ["#18181B", "#3F3F46", "#27272A", "#52525B"] : ["#F4F4F5", "#E4E4E7", "#FAFAFA", "#D4D4D8"];
    const top = bins.indexOf(Math.max(...bins));
    const hue = binHue[top]! / bins[top]!;
    return lightUi
      ? [hslToHex(hue, 0.42, 0.42), hslToHex(hue + 12, 0.46, 0.5), hslToHex(hue - 10, 0.44, 0.36), hslToHex(hue + 4, 0.5, 0.56)]
      : [hslToHex(hue, 0.35, 0.09), hslToHex(hue, 0.45, 0.28), hslToHex(hue + 14, 0.4, 0.24), hslToHex(hue - 12, 0.4, 0.2)];
  });
}
