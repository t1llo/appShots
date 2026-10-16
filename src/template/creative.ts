import path from "node:path";
import { type DeviceKind, isDeviceKind } from "../domain/devices.ts";
import { hasBakedIsland } from "../palette.ts";
import type { Creative, DeviceStyle, Project } from "../schema.ts";
import { PLACEMENTS, type PlacementId } from "../sizes.ts";
import { findShot, listImages, type Shot, shotsDir, type Space, type StoredImage } from "../store.ts";
import { CSS } from "./css.ts";
import { type BackgroundDef, bodyFont, type CreativeLayoutId, type FontId, FONTS } from "./design.ts";
import { FIT_SCRIPT } from "./fit.ts";
import { deviceShape } from "./frames.ts";
import { anchorOf, deskSlots, type Slot } from "./layouts/devices.ts";
import { backgroundCss, backgroundLuminance, resolveBackground } from "./parts/background.ts";
import { badgeHtml, DEFS } from "./parts/badges.ts";
import { deviceHtml, statusLook } from "./parts/device.ts";
import { logoHtml, shotUrl } from "./parts/images.ts";
import { createIds, directionOf, esc, pick, rich, round } from "./parts/text.ts";
import { fontsToLoad, pageHtml, themeVars } from "./shell.ts";

export interface CreativeContext {
  space: Space;
  project: Project;
  shots: Shot[];
  placement: PlacementId;
  locale: string;
  /** Draws the safe area over the page. For previews only; a render never asks for it. */
  guides?: boolean;
  /** The project's images, when the caller has listed them once for a whole job. Read from the project when left out. */
  images?: StoredImage[];
}

interface Size {
  width: number;
  height: number;
}

interface Rect extends Size {
  x: number;
  y: number;
}

/** What the layouts need to know about the devices they place: how tall each is per unit of width, and what it is. */
interface Group {
  ratios: number[];
  kinds: DeviceKind[];
  /** Which of them are laptops or windows, which stand on a desk with the others in front. */
  laptops: boolean[];
}

/** How many screenshots each layout has room for. */
export const CREATIVE_CAPACITY: Record<CreativeLayoutId, number> = { fan: 5, sides: 4, wall: 6, split: 3 };

/** The layout an asset is drawn with. A banner is a split unless it says otherwise, and an App Store asset never is one: its copy would stand outside the safe area, so it is drawn as sides. */
export function creativeLayout(creative: Creative, placement: PlacementId): CreativeLayoutId {
  const banner = PLACEMENTS[placement].kind === "banner";
  const wanted = creative.layout ?? (banner ? "split" : "fan");
  return wanted === "split" && !banner ? "sides" : wanted;
}

/** Positions around the centre, nearest first: 0, -1, 1, -2, 2 for five devices and -0.5, 0.5, -1.5, 1.5 for four. */
function outward(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i - (count - 1) / 2).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
}

/**
 * The width of each device in a row of phones and tablets, from the width the layout gives the stubbiest of them.
 * Devices of one kind share that width. Phones and tablets together stand equally tall, or a tablet would come out
 * smaller than the phone beside it.
 */
function rowWidths(group: Group, width: number, stubby: number): number[] {
  const mixed = new Set(group.kinds).size > 1;
  return group.ratios.map((ratio) => (mixed ? (width * stubby) / ratio : width));
}

/** The ratio a row of devices is sized by: its stubbiest device's where kinds are mixed, else the first one's. */
const sizingRatio = (group: Group) => (new Set(group.kinds).size > 1 ? Math.min(...group.ratios) : group.ratios[0]!);

/**
 * How far from the middle each device of a row stands, at the positions `outward` gives. Neighbours stand `step`
 * of their average width apart, so devices of different widths overlap each other as much as equal ones do.
 */
function offsets(positions: number[], widths: number[], step: number): number[] {
  const at = new Map(positions.map((position, i) => [position, i]));
  const x = positions.map(() => 0);
  positions.forEach((position, i) => {
    if (position === 0) return;
    const sign = Math.sign(position);
    // Positions come nearest first, so the neighbour towards the middle is placed already.
    const inner = at.get(Math.abs(position) === 0.5 ? -position : position - sign)!;
    x[i] = Math.abs(position) === 0.5 ? (sign * step * (widths[i]! + widths[inner]!)) / 4 : x[inner]! + (sign * step * (widths[i]! + widths[inner]!)) / 2;
  });
  return x;
}

/** Turns positions measured in widths of the laptop into canvas pixels, with the laptop's top left corner at `left` and `top`. */
const onCanvas = (slots: Slot[], width: number, left: number, top: number): Slot[] =>
  slots.map((slot) => ({ ...slot, x: left + slot.x * width, top: top + slot.top * width, width: slot.width * width }));

function fanSlots(group: Group, canvas: Size, safe: Rect, hasCopy: boolean, scale: number): Slot[] {
  const { ratios, laptops } = group;
  const top = safe.y + safe.height * (hasCopy ? 0.58 : 0.1);
  const anchor = anchorOf(ratios, laptops);
  if (anchor >= 0) {
    // A laptop is cut through its screen, well above the base: one cut just above it looks broken.
    const width = Math.min(canvas.width * 0.6, ((canvas.height - top) * 1.3) / ratios[anchor]!) * scale;
    const desk = deskSlots(ratios, anchor, "both", laptops);
    const rise = Math.min(...desk.map((slot) => slot.top));
    return onCanvas(desk, width, canvas.width / 2 - width / 2, top - rise * width);
  }
  // Wide enough to carry the safe area, and tall enough to run off the bottom edge.
  const stubby = sizingRatio(group);
  const width = Math.max(safe.width * 0.47, ((canvas.height - top) * 1.15) / stubby) * scale;
  const widths = rowWidths(group, width, stubby);
  const positions = outward(ratios.length);
  const x = offsets(positions, widths, 0.86);
  return positions.map((position, i) => {
    const steps = Math.abs(position);
    return {
      x: canvas.width / 2 + x[i]!,
      top: top + steps * steps * width * 0.05,
      width: widths[i]! * (1 - steps * 0.07),
      rotate: position * 6,
      z: 10 - Math.round(steps * 2),
    };
  });
}

function sidesSlots(group: Group, canvas: Size, safe: Rect, scale: number): Slot[] {
  const { ratios, laptops } = group;
  const room = Math.min(safe.x, canvas.width - safe.x - safe.width);
  const gap = Math.max(room * 0.08, canvas.width * 0.02);
  // As large as the canvas height carries, but never so wide that the canvas edge cuts into the device.
  const width = Math.min(Math.max(room * 0.74, canvas.height * 0.36), canvas.height * 0.5, room * 0.95 - gap) * scale;
  const middle = safe.y + safe.height / 2;
  const upright = ratios.filter((_, i) => !laptops[i]);
  const widths = rowWidths(group, width, upright.length ? Math.min(...upright) : 1);
  /** How far out from its edge of the safe area each device reaches, so the one outside it stands beyond it. */
  const reach: number[] = [];
  return ratios.map((ratio, i) => {
    // A lone screenshot stands on the right; after that they alternate left and right, moving outwards.
    const side = ratios.length === 1 ? 1 : i % 2 === 0 ? -1 : 1;
    const outer = i >= 2;
    const edge = side < 0 ? safe.x - gap : safe.x + safe.width + gap;
    if (laptops[i]) {
      // A laptop is as tall as the copy beside it and stands level. What the canvas has no room for runs off its edge.
      const own = Math.min(room * 1.5, (canvas.height * 0.6) / ratio) * scale * (outer ? 0.78 : 1);
      reach[i] = own;
      return { x: edge + side * (own / 2 + (outer ? own * 0.3 : 0)), top: middle - (own * ratio) / 2 - (outer ? canvas.height * 0.08 : 0), width: own, rotate: 0, z: outer ? 1 : 2 };
    }
    const base = widths[i]!;
    const own = base * (outer ? 0.78 : 1);
    const height = own * ratio;
    reach[i] = base;
    // A device taller than the canvas rises from the bottom edge; one that fits stands level with the copy.
    const top = height >= canvas.height * 0.9 ? canvas.height * 0.13 : Math.max(canvas.height * 0.05, middle - height / 2);
    return {
      // One outside another stands a little past the far side of the one in front of it.
      x: edge + side * (outer ? reach[i - 2]! + base * 0.12 : base / 2),
      top: top + (outer ? canvas.height * 0.1 : 0),
      width: own,
      rotate: side * (outer ? 11 : 5),
      z: outer ? 1 : 2,
    };
  });
}

/** The column a split sets its copy in, and where its devices start. */
function splitBox(canvas: Size): Rect {
  const margin = Math.max(canvas.height * 0.11, canvas.width * 0.05);
  return { x: margin, y: canvas.height * 0.1, width: canvas.width * 0.47 - margin, height: canvas.height * 0.8 };
}

function splitSlots(group: Group, canvas: Size, scale: number): Slot[] {
  const { ratios, laptops } = group;
  const left = canvas.width * 0.5;
  const room = canvas.width - canvas.height * 0.1 - left;
  const anchor = anchorOf(ratios, laptops);
  if (anchor >= 0) {
    const desk = deskSlots(ratios, anchor, "left", laptops);
    const from = Math.min(...desk.map((slot) => slot.x - slot.width / 2));
    const to = Math.max(...desk.map((slot) => slot.x + slot.width / 2));
    const rise = Math.min(...desk.map((slot) => slot.top));
    const depth = Math.max(...desk.map((slot, i) => slot.top + slot.width * ratios[i]!)) - rise;
    // Large enough to carry the banner. A group too wide for its half starts at the middle and runs off the right edge,
    // as long as most of the laptop stays in view.
    const width = Math.min((canvas.height * 0.72) / ratios[anchor]!, (canvas.width - left) / 0.62 / (to - from)) * scale;
    const span = (to - from) * width;
    const start = span <= room ? left + (room - span) / 2 : left;
    return onCanvas(desk, width, start - from * width, (canvas.height - depth * width) / 2 - rise * width);
  }
  const count = ratios.length;
  const step = 0.74;
  // Phones as tall as the banner run off its bottom edge. Where three of them have no room for that, they stand whole.
  const stubby = sizingRatio(group);
  const width = Math.min((canvas.height * 1.12) / stubby, room / (1 + step * (count - 1))) * scale;
  const height = width * stubby;
  const top = height >= canvas.height * 0.9 ? canvas.height * 0.13 : (canvas.height - height) / 2;
  const widths = rowWidths(group, width, stubby);
  const positions = outward(count);
  const x = offsets(positions, widths, step);
  return positions.map((position, i) => {
    const steps = Math.abs(position);
    // Two stand side by side with the first in front; of three, the first is in the middle.
    const back = count === 2 ? i : Math.round(steps);
    return {
      x: left + room / 2 + x[i]!,
      top: top + back * width * 0.1,
      width: widths[i]! * (1 - back * 0.07),
      rotate: position * 6,
      z: 10 - back,
    };
  });
}

const WALL_TILT = 12;

/** A grid of bare screenshots, turned a little and large enough to cover the canvas at that angle. */
function wallHtml(tiles: { url: string; aspect: string; ratio: number; radius: number }[], canvas: Size): string {
  const angle = (WALL_TILT * Math.PI) / 180;
  const across = canvas.width * Math.cos(angle) + canvas.height * Math.sin(angle);
  const down = canvas.width * Math.sin(angle) + canvas.height * Math.cos(angle);
  const ratios = tiles.map((tile) => tile.ratio);
  const width = (canvas.height * 0.62) / Math.max(...ratios);
  const gap = width * 0.07;
  const shortest = width * Math.min(...ratios);
  const columns = Math.ceil(across / (width + gap)) + 1;
  // Every other column sits half a tile lower, so each one needs that much extra to still cover the canvas.
  const rows = Math.ceil((down + shortest) / (shortest + gap)) + 1;
  // Stepping by two keeps a screenshot from landing next to itself in the neighbouring column.
  const step = tiles.length >= 3 ? 2 : 1;

  let html = "";
  for (let column = 0; column < columns; column++) {
    let cells = "";
    for (let row = 0; row < rows; row++) {
      const tile = tiles[(column * step + row) % tiles.length]!;
      cells += `<div class="tile" style="aspect-ratio:${tile.aspect};border-radius:${round(width * tile.radius)}px"><img src="${esc(tile.url)}" alt=""></div>`;
    }
    const shift = column % 2 === 0 ? 0 : (shortest + gap) / 2;
    html += `<div class="col" style="transform:translateY(${round(shift)}px)">${cells}</div>`;
  }
  return `<div class="wall" style="--tw:${round(width)}px;--tg:${round(gap)}px;transform:translate(-50%,-50%) rotate(-${WALL_TILT}deg)">${html}</div>`;
}

/** The colour that carries a background, for laying a soft patch of it behind the copy. */
const toneOf = (background: BackgroundDef) => background.colors[background.type === "gradient" ? Math.floor(background.colors.length / 2) : 0]!;

const CREATIVE_CSS = `
.creative{display:block}
.creative .devices{position:absolute;inset:0;z-index:1}
.creative .device{position:absolute}
.creative .c-box{position:absolute;z-index:3;display:flex;flex-direction:column;justify-content:center;align-items:center}
.creative .copy{flex:none;padding:0}
.creative .badges.top{margin-bottom:calc(var(--u)*3.6)}
.creative .badges.bottom{margin-top:calc(var(--u)*3.8)}
.creative-split .c-box{align-items:flex-start}
.creative-split .copy{align-items:flex-start;text-align:start}
.creative-split .badges{justify-content:flex-start}
.wall{position:absolute;left:50%;top:50%;z-index:1;display:flex;align-items:center;gap:var(--tg)}
.wall .col{flex:none;width:var(--tw);display:flex;flex-direction:column;gap:var(--tg)}
.wall .tile{overflow:hidden;background:#101012;box-shadow:0 calc(var(--tw)*.03) calc(var(--tw)*.09) rgba(0,0,0,.28)}
.wall img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.veil,.spot{position:absolute;inset:0;z-index:2}
.veil{opacity:.74}
.guide{position:absolute;z-index:9;pointer-events:none;border:var(--g) dashed #FF2D78;box-shadow:0 0 0 calc(var(--g)*.5) rgba(255,255,255,.55),inset 0 0 0 calc(var(--g)*.5) rgba(255,255,255,.55)}
.guide span{position:absolute;left:calc(var(--g)*-1);bottom:100%;margin-bottom:calc(var(--g)*1.5);padding:calc(var(--g)*1.2) calc(var(--g)*2.4);border-radius:calc(var(--g)*1.5);background:#FF2D78;color:#fff;font:700 calc(var(--g)*5.5)/1 system-ui,sans-serif;white-space:nowrap}
`;

export async function creativeHtml(ctx: CreativeContext): Promise<string> {
  const { project, shots, locale } = ctx;
  if (!Object.hasOwn(PLACEMENTS, ctx.placement)) throw new Error(`There is no placement called ${ctx.placement}`);
  const placement = PLACEMENTS[ctx.placement];
  const creative = Object.hasOwn(project.creatives, ctx.placement) ? project.creatives[ctx.placement] : undefined;
  if (!creative) throw new Error(`This project has no ${placement.label.toLowerCase()} asset`);
  const canvas: Size = { width: placement.width, height: placement.height };
  const safe: Rect = placement.safe;
  const shotsPath = shotsDir(ctx.space, project.id);
  const fallback = project.locales[0] ?? "en";
  const theme = project.theme;
  const banner = placement.kind === "banner";
  const layout = creativeLayout(creative, ctx.placement);
  const ids = createIds();
  // A page read from right to left has its copy column and its devices the other way round.
  const rtl = directionOf(locale) === "rtl";
  const mirror = (rect: Rect): Rect => (rtl ? { ...rect, x: canvas.width - rect.x - rect.width } : rect);

  // These assets are not tied to one device, so a name with several variants shows the iPhone one unless another frame is asked for.
  const deviceStyle: DeviceStyle = {
    frame: creative.device?.frame ?? theme.device?.frame,
    style: creative.device?.style ?? theme.device?.style,
    color: creative.device?.color ?? theme.device?.color,
    shadow: creative.device?.shadow ?? theme.device?.shadow,
    statusBar: creative.device?.statusBar ?? theme.device?.statusBar,
    statusBarTime: theme.device?.statusBarTime,
    statusBarColor: theme.device?.statusBarColor,
  };
  const scale = creative.device?.scale ?? 1;
  const prefer = isDeviceKind(deviceStyle.frame) ? deviceStyle.frame : "iphone";
  const names = (creative.screenshots ?? []).slice(0, CREATIVE_CAPACITY[layout]);
  const placed = names.map((name) => ({ name, shot: findShot(shots, name, prefer, locale) }));

  const background = await resolveBackground(creative.background ?? theme.background, shotsPath, placed[0]?.shot);
  const dark = backgroundLuminance(background) < 0.32;
  const textColor = creative.textColor ?? theme.textColor ?? (dark ? "#FFFFFF" : "#0B0B0F");
  const accent = creative.accentColor ?? theme.accentColor;
  const fontId: FontId = creative.font ?? theme.font ?? "inter";
  const font = FONTS[fontId];
  const body = bodyFont(fontId);
  const textScale = creative.textScale ?? theme.textScale ?? 1;

  const eyebrow = pick(creative.eyebrow, locale, fallback);
  const headline = pick(creative.headline, locale, fallback);
  const sub = pick(creative.subheadline, locale, fallback);
  const badges = creative.badges ?? [];
  const badgePosition = creative.badgePosition ?? "bottom";
  const badgesHtml = badges.length
    ? `<div class="badges ${badgePosition}">${badges.map((badge) => badgeHtml(badge, locale, fallback)).join("")}</div>`
    : "";
  const headlineHtml = rich(headline);
  const emphasis = creative.emphasis ?? theme.emphasis ?? "tint";
  const twoTone = emphasis === "tint" && !accent && headlineHtml.includes("<em>");
  const copyParts = [
    creative.logo ? logoHtml(creative.logo, ctx.images ?? (await listImages(ctx.space, project.id)), project.id) : "",
    badgePosition === "top" ? badgesHtml : "",
    eyebrow ? `<div class="eyebrow${accent ? "" : " muted"}">${esc(eyebrow)}</div>` : "",
    headline ? `<h1 class="headline${twoTone ? " two-tone" : ""}">${headlineHtml}</h1>` : "",
    sub ? `<p class="sub">${rich(sub)}</p>` : "",
    badgePosition === "bottom" ? badgesHtml : "",
  ].join("");

  let artHtml = "";
  if (layout === "wall") {
    const tiles = placed.flatMap(({ shot }) => {
      if (!shot) return [];
      const shape = deviceShape(shot, { frame: "none" }, prefer);
      return [{ url: shotUrl(project.id, shot), aspect: shape.aspect, ratio: shape.ratio, radius: shape.geometry.bare }];
    });
    if (tiles.length) {
      const tone = toneOf(background);
      const reach = [Math.max(safe.width * 0.8, canvas.width * 0.24), Math.max(safe.height * 1.05, canvas.height * 0.44)];
      const spot = `radial-gradient(ellipse ${round(reach[0]!)}px ${round(reach[1]!)}px at ${round(safe.x + safe.width / 2)}px ${round(safe.y + safe.height / 2)}px,color-mix(in srgb,${tone} 80%,transparent) 0,color-mix(in srgb,${tone} 52%,transparent) 45%,transparent 100%)`;
      artHtml = `${wallHtml(tiles, canvas)}<div class="veil" style="${backgroundCss(background)}"></div>${copyParts ? `<div class="spot" style="background:${spot}"></div>` : ""}`;
    }
  } else if (placed.length) {
    const shapes = placed.map(({ shot }) => deviceShape(shot, deviceStyle, prefer));
    const group: Group = { ratios: shapes.map((shape) => shape.ratio), kinds: shapes.map((shape) => shape.kind), laptops: shapes.map((shape) => shape.kind === "mac" && shape.ratio < 1) };
    const slots = (
      layout === "split" ? splitSlots(group, canvas, scale) : layout === "sides" ? sidesSlots(group, canvas, safe, scale) : fanSlots(group, canvas, safe, Boolean(copyParts), scale)
    ).map((slot) => (rtl ? { ...slot, x: canvas.width - slot.x, rotate: -slot.rotate } : slot));
    const devices = await Promise.all(
      placed.map(async ({ name, shot }, i) => {
        const slot = slots[i]!;
        const baked = shot?.device === "iphone" && (await hasBakedIsland(path.join(shotsPath, shot.file), shot.version, shot.width));
        return deviceHtml({
          shot,
          wanted: name,
          url: shot && shotUrl(project.id, shot),
          style: deviceStyle,
          targetDevice: prefer,
          width: 1,
          pixels: slot.width,
          canvas,
          fit: "width",
          island: !baked,
          status: await statusLook(shot, deviceStyle, shotsPath),
          defaults: { rotate: slot.rotate },
          extraCss: `left:${round(slot.x - slot.width / 2)}px;top:${round(slot.top)}px;z-index:${slot.z}`,
          ids,
        });
      }),
    );
    artHtml = `<div class="devices">${devices.join("")}</div>`;
  }

  // The copy keeps a little clear of the safe area's edges. Under a fan it takes the upper half, so the devices' tops stay inside too.
  const halved = layout === "fan" && placed.length > 0;
  const box: Rect =
    layout === "split"
      ? mirror(splitBox(canvas))
      : {
          x: safe.x + safe.width * 0.02,
          y: safe.y + safe.height * 0.04,
          width: safe.width * 0.96,
          height: safe.height * (halved ? 0.52 : 0.92),
        };
  const copyHtml = copyParts
    ? `<div class="c-box" style="left:${round(box.x)}px;top:${round(box.y)}px;width:${round(box.width)}px;height:${round(box.height)}px"><div class="copy">${copyParts}</div></div>`
    : "";

  // Type is sized off the safe area, since that is all a narrow crop shows of the canvas. A split sizes it off its own column.
  const unit = layout === "split" ? Math.min(box.width / 56, box.height / 40) : Math.min(safe.width / 88, safe.height / 40);
  const badgeScale = (halved ? 0.6 : 0.8) * (badges.length >= 3 ? 0.78 : 1);
  const vars = [`width:${canvas.width}px`, `height:${canvas.height}px`, `--u:${round(unit)}px`, `--ts:${textScale}`, `--bs:${round(badgeScale)}`, ...themeVars(font, body, textColor, accent)].join(";");
  const noise = typeof background === "object" && background.noise ? `<div class="noise" style="opacity:${round(background.noise * 0.6)}"></div>` : "";
  // A banner is shown whole wherever it is used, so it has no safe area to draw.
  const guide = ctx.guides && !banner
    ? `<div class="guide" style="left:${safe.x}px;top:${safe.y}px;width:${safe.width}px;height:${safe.height}px;--g:${round(canvas.width / 480)}px"><span>Safe area</span></div>`
    : "";
  // The fit script checks that the copy stays inside it.
  const inside = mirror(safe);
  const safeData = banner ? "" : ` data-safe="${inside.x} ${inside.y} ${inside.width} ${inside.height}"`;

  return pageHtml({
    title: `${project.name} · ${placement.label}`,
    locale,
    css: CSS + CREATIVE_CSS,
    body: `<div class="canvas creative creative-${layout} em-${emphasis} ${dark ? "dark" : "light"}" style="${vars}" data-copy-max="${(box.height / canvas.height).toFixed(4)}" data-shrink="together"${safeData} data-fonts="${esc(fontsToLoad(font, body))}">
<div class="bg" style="${backgroundCss(background)}"></div>${noise}${DEFS}
${artHtml}
${copyHtml}
${guide}
</div>`,
    script: FIT_SCRIPT,
  });
}
