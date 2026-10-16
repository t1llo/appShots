import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Project } from "../schema.ts";
import { type DeviceKind, TARGETS, type TargetId } from "../sizes.ts";
import { imagesDir, listImages, outDir, type Space } from "../store.ts";

// The first slides of a set where most people meet them: three side by side in a search result, and at the top of
// the product page, in light and dark. Drawn from the rendered files, with plain shapes for the store around them:
// it shows whether the copy reads at the store's size, not how the store draws itself.

/** An iPhone screen in points, drawn a pixel each. */
const PANEL = { width: 390, height: 844 };
const GAP = 28;
const LABEL = 34;
const SIDE = 16;

const LOOKS = {
  light: { page: "#FFFFFF", field: "#EEEEF0", text: "#000000", soft: "#E3E3E8", blue: "#0071E3", line: "#D8D8DC" },
  dark: { page: "#000000", field: "#1C1C1E", text: "#FFFFFF", soft: "#2C2C2E", blue: "#0A84FF", line: "#38383A" },
};
type Look = (typeof LOOKS)[keyof typeof LOOKS];

/** Uploaded images under one of these names stand for the app's icon. */
const ICON_NAMES = ["icon", "app-icon", "appicon", "app_icon"];

const FONT = "Inter Variable, Inter, Helvetica, Arial, sans-serif";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text);

/** The devices whose set a preview shows, the one most people see first. */
const LISTED: DeviceKind[] = ["iphone", "ipad", "duo", "mac"];

/** The set a store preview shows: the first language's iPhone set, else its iPad, iPhone Duo or Mac one. */
export function listingSet(files: { locale: string; target: TargetId }[]): { locale: string; target: TargetId } | undefined {
  const locale = files[0]?.locale;
  const own = files.filter((file) => file.locale === locale);
  for (const kind of LISTED) {
    const file = own.find((each) => TARGETS[each.target].device === kind);
    if (file) return { locale: file.locale, target: file.target };
  }
  return undefined;
}

const rounded = (width: number, height: number, radius: number) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`);

/** A picture at a size with its corners rounded, cut to `visible` pixels of its width where the page's edge cuts it. */
async function picture(file: string, width: number, height: number, radius: number, visible = width): Promise<Buffer> {
  const image = await sharp(file)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .composite([{ input: rounded(width, height, radius), blend: "dest-in" }])
    .png()
    .toBuffer();
  return visible < width ? sharp(image).extract({ left: 0, top: 0, width: visible, height }).png().toBuffer() : image;
}

/** The app's icon at a size: an uploaded one, or a tile of the accent colour with the name's first letter. */
async function icon(source: string | undefined, size: number, name: string, accent: string): Promise<Buffer> {
  const radius = Math.round(size * 0.225);
  if (source) return picture(source, size, size, radius);
  const letter = esc([...name.trim()][0]?.toUpperCase() ?? "A");
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${accent}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${Math.round(size * 0.5)}" fill="#fff">${letter}</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

const bar = (look: Look, x: number, y: number, width: number, height = 10) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${look.soft}"/>`;
const getButton = (look: Look, x: number, y: number) =>
  `<rect x="${x}" y="${y}" width="74" height="30" rx="15" fill="${look.field}"/><text x="${x + 37}" y="${y + 20}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="15" fill="${look.blue}">Get</text>`;

interface Layer {
  input: Buffer;
  left: number;
  top: number;
}

/** A search for the app, and its result with the first three slides under it. */
async function searchPanel(look: Look, name: string, logo: (size: number) => Promise<Buffer>, shots: (string | undefined)[], ratio: number): Promise<Buffer> {
  const room = PANEL.width - SIDE * 2;
  const portrait = ratio > 1;
  const width = portrait ? Math.floor((room - 16) / 3) : room;
  const height = Math.round(width * ratio);
  const top = 196;
  const below = top + height + 26;
  const chrome = `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL.width}" height="${PANEL.height}">
<rect width="100%" height="100%" fill="${look.page}"/>
<rect x="${SIDE}" y="58" width="${room}" height="36" rx="10" fill="${look.field}"/>
<circle cx="${SIDE + 18}" cy="75" r="6" fill="none" stroke="#8E8E93" stroke-width="2"/><line x1="${SIDE + 22.5}" y1="79.5" x2="${SIDE + 27}" y2="84" stroke="#8E8E93" stroke-width="2" stroke-linecap="round"/>
<text x="${SIDE + 36}" y="82" font-family="${FONT}" font-size="17" fill="${look.text}">${esc(cut(name.toLowerCase(), 30))}</text>
<text x="${SIDE + 76}" y="141" font-family="${FONT}" font-weight="600" font-size="17" fill="${look.text}">${esc(cut(name, 22))}</text>
${bar(look, SIDE + 76, 151, 150)}${bar(look, SIDE + 76, 168, 86, 8)}${getButton(look, PANEL.width - SIDE - 74, 133)}
${Array.from({ length: portrait ? 3 : 1 }, (_, i) => `<rect x="${SIDE + i * (width + 8)}" y="${top}" width="${width}" height="${height}" rx="12" fill="${look.soft}"/>`).join("")}
<line x1="${SIDE}" y1="${below}" x2="${PANEL.width - SIDE}" y2="${below}" stroke="${look.line}"/>
<rect x="${SIDE}" y="${below + 20}" width="64" height="64" rx="14.5" fill="${look.soft}"/>${bar(look, SIDE + 76, below + 34, 120, 12)}${bar(look, SIDE + 76, below + 54, 170)}
</svg>`;
  const layers: Layer[] = [{ input: await logo(64), left: SIDE, top: 116 }];
  for (const [i, file] of shots.slice(0, portrait ? 3 : 1).entries()) {
    if (file) layers.push({ input: await picture(file, width, height, 12), left: SIDE + i * (width + 8), top });
  }
  return sharp(Buffer.from(chrome)).composite(layers).png().toBuffer();
}

/** The top of the product page: the icon and the name, a strip of facts, and the first screenshots running off its edge. */
async function productPanel(look: Look, name: string, logo: (size: number) => Promise<Buffer>, shots: (string | undefined)[], ratio: number): Promise<Buffer> {
  const portrait = ratio > 1;
  const height = portrait ? 440 : Math.round((PANEL.width - SIDE * 2) * ratio);
  const width = portrait ? Math.round(height / ratio) : PANEL.width - SIDE * 2;
  const top = 288;
  const facts = Array.from({ length: 4 }, (_, i) => {
    const x = SIDE + (i * (PANEL.width - SIDE * 2)) / 4;
    const column = (PANEL.width - SIDE * 2) / 4;
    const divider = i ? `<line x1="${x}" y1="212" x2="${x}" y2="250" stroke="${look.line}"/>` : "";
    return `${divider}${bar(look, x + column / 2 - 26, 214, 52, 8)}${bar(look, x + column / 2 - 18, 232, 36, 14)}`;
  }).join("");
  const chrome = `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL.width}" height="${PANEL.height}">
<rect width="100%" height="100%" fill="${look.page}"/>
<text x="${SIDE + 134}" y="92" font-family="${FONT}" font-weight="700" font-size="22" fill="${look.text}">${esc(cut(name, 17))}</text>
${bar(look, SIDE + 134, 104, 150, 12)}${getButton(look, SIDE + 134, 146)}
<line x1="${SIDE}" y1="196" x2="${PANEL.width - SIDE}" y2="196" stroke="${look.line}"/>
${facts}
<line x1="${SIDE}" y1="266" x2="${PANEL.width - SIDE}" y2="266" stroke="${look.line}"/>
${Array.from({ length: portrait ? 2 : 1 }, (_, i) => `<rect x="${SIDE + i * (width + 10)}" y="${top}" width="${width}" height="${height}" rx="18" fill="${look.soft}"/>`).join("")}
${bar(look, SIDE, top + height + 26, 300, 12)}${bar(look, SIDE, top + height + 48, 330, 12)}${bar(look, SIDE, top + height + 70, 240, 12)}
</svg>`;
  const layers: Layer[] = [{ input: await logo(118), left: SIDE, top: 64 }];
  for (const [i, file] of shots.slice(0, portrait ? 2 : 1).entries()) {
    const left = SIDE + i * (width + 10);
    const visible = Math.min(width, PANEL.width - left);
    if (file && visible > 0) layers.push({ input: await picture(file, width, height, 18, visible), left, top });
  }
  return sharp(Buffer.from(chrome)).composite(layers).png().toBuffer();
}

/**
 * One JPEG of a rendered set's first three slides as the App Store shows them: a search result and the product
 * page, light and dark. Slides not rendered yet are left as grey frames.
 */
export async function storeListing(space: Space, project: Project, set: { locale: string; target: TargetId }): Promise<Buffer> {
  const dir = path.join(outDir(space, project.id), set.locale, set.target);
  const found = async (file: string) => ((await stat(file).catch(() => null))?.isFile() ? file : undefined);
  const shots = await Promise.all([1, 2, 3].map((n) => found(path.join(dir, `${String(n).padStart(2, "0")}.png`))));
  const { width, height } = TARGETS[set.target];
  const images = await listImages(space, project.id).catch(() => []);
  const named = ICON_NAMES.map((name) => images.find((image) => image.name === name)).find(Boolean);
  const source = named && (await found(path.join(imagesDir(space, project.id), named.file)));
  const icons = new Map<number, Promise<Buffer>>();
  const logo = (size: number) => icons.get(size) ?? icons.set(size, icon(source, size, project.name, project.theme.accentColor ?? "#0A84FF")).get(size)!;

  const panels = await Promise.all(
    (["light", "dark"] as const).flatMap((look) => [searchPanel(LOOKS[look], project.name, logo, shots, height / width), productPanel(LOOKS[look], project.name, logo, shots, height / width)]),
  );
  const labels = ["Search results, light", "Product page, light", "Search results, dark", "Product page, dark"];
  const sheet = { width: GAP + panels.length * (PANEL.width + GAP), height: GAP + LABEL + PANEL.height + GAP };
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${LABEL + GAP}">${labels
    .map((label, i) => `<text x="${GAP + i * (PANEL.width + GAP)}" y="${GAP + 16}" font-family="${FONT}" font-size="15" fill="#9A9AA0">${label}</text>`)
    .join("")}</svg>`;
  const framed = await Promise.all(
    panels.map((panel) =>
      sharp(panel)
        .composite([{ input: rounded(PANEL.width, PANEL.height, 36), blend: "dest-in" }])
        .png()
        .toBuffer(),
    ),
  );
  return sharp({ create: { width: sheet.width, height: sheet.height, channels: 3, background: "#141416" } })
    .composite([{ input: Buffer.from(text), left: 0, top: 0 }, ...framed.map((input, i) => ({ input, left: GAP + i * (PANEL.width + GAP), top: GAP + LABEL }))])
    .jpeg({ quality: 84 })
    .toBuffer();
}
