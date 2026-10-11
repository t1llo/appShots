import path from "node:path";
import { type BackgroundDef, bodyFont, type CreativeLayoutId, FONT_CSS_URL, type FontId, FONTS } from "./design.ts";
import { hasBakedIsland } from "./palette.ts";
import type { DeviceStyle, Project } from "./schema.ts";
import { isDeviceKind, PLACEMENTS, type PlacementId } from "./sizes.ts";
import { findShot, listImages, type Shot, shotsDir, type Space } from "./store.ts";
import { backgroundCss, backgroundLuminance, badgeHtml, CSS, DEFS, deviceHtml, deviceShape, esc, FIT_SCRIPT, logoHtml, pick, resolveBackground, rich, round } from "./template.ts";

export interface CreativeContext {
  space: Space;
  project: Project;
  shots: Shot[];
  placement: PlacementId;
  locale: string;
  /** Draws the safe area over the page. For previews only; a render never asks for it. */
  guides?: boolean;
}

interface Size {
  width: number;
  height: number;
}

interface Rect extends Size {
  x: number;
  y: number;
}

/** Where one device stands: its centre line, top edge and width in canvas pixels. */
interface Slot {
  x: number;
  top: number;
  width: number;
  rotate: number;
  z: number;
}

/** How many screenshots each layout has room for. */
export const CREATIVE_CAPACITY: Record<CreativeLayoutId, number> = { fan: 5, sides: 4, wall: 6 };

/** Positions around the centre, nearest first: 0, -1, 1, -2, 2 for five devices and -0.5, 0.5, -1.5, 1.5 for four. */
function outward(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i - (count - 1) / 2).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
}

function fanSlots(ratios: number[], canvas: Size, safe: Rect, hasCopy: boolean, scale: number): Slot[] {
  const top = safe.y + safe.height * (hasCopy ? 0.58 : 0.1);
  // Wide enough to carry the safe area, and tall enough to run off the bottom edge.
  const width = Math.max(safe.width * 0.47, ((canvas.height - top) * 1.15) / ratios[0]!) * scale;
  return outward(ratios.length).map((position) => {
    const steps = Math.abs(position);
    return {
      x: canvas.width / 2 + position * width * 0.86,
      top: top + steps * steps * width * 0.05,
      width: width * (1 - steps * 0.07),
      rotate: position * 6,
      z: 10 - Math.round(steps * 2),
    };
  });
}

function sidesSlots(ratios: number[], canvas: Size, safe: Rect, scale: number): Slot[] {
  const room = Math.min(safe.x, canvas.width - safe.x - safe.width);
  const gap = Math.max(room * 0.08, canvas.width * 0.02);
  // As large as the canvas height carries, but never so wide that the canvas edge cuts into the device.
  const width = Math.min(Math.max(room * 0.74, canvas.height * 0.36), canvas.height * 0.5, room * 0.95 - gap) * scale;
  const middle = safe.y + safe.height / 2;
  return ratios.map((ratio, i) => {
    // A lone screenshot stands on the right; after that they alternate left and right, moving outwards.
    const side = ratios.length === 1 ? 1 : i % 2 === 0 ? -1 : 1;
    const outer = i >= 2;
    const own = width * (outer ? 0.78 : 1);
    const height = own * ratio;
    const edge = side < 0 ? safe.x - gap : safe.x + safe.width + gap;
    // A device taller than the canvas rises from the bottom edge; one that fits stands level with the copy.
    const top = height >= canvas.height * 0.9 ? canvas.height * 0.13 : Math.max(canvas.height * 0.05, middle - height / 2);
    return {
      x: edge + side * (width / 2 + (outer ? width * 0.62 : 0)),
      top: top + (outer ? canvas.height * 0.1 : 0),
      width: own,
      rotate: side * (outer ? 11 : 5),
      z: outer ? 1 : 2,
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
  const creative = project.creatives[ctx.placement];
  if (!creative) throw new Error(`This project has no ${PLACEMENTS[ctx.placement].label.toLowerCase()} asset`);
  const placement = PLACEMENTS[ctx.placement];
  const canvas: Size = { width: placement.width, height: placement.height };
  const safe: Rect = placement.safe;
  const shotsPath = shotsDir(ctx.space, project.id);
  const fallback = project.locales[0] ?? "en";
  const theme = project.theme;
  const layout: CreativeLayoutId = creative.layout ?? "fan";

  // These assets are not tied to one device, so a name with several variants shows the iPhone one unless another frame is asked for.
  const deviceStyle: DeviceStyle = {
    frame: creative.device?.frame ?? theme.device?.frame,
    color: creative.device?.color ?? theme.device?.color,
    shadow: creative.device?.shadow ?? theme.device?.shadow,
  };
  const scale = creative.device?.scale ?? 1;
  const prefer = isDeviceKind(deviceStyle.frame) ? deviceStyle.frame : "iphone";
  const names = (creative.screenshots ?? []).slice(0, CREATIVE_CAPACITY[layout]);
  const placed = names.map((name) => ({ name, shot: findShot(shots, name, prefer, locale) }));
  const shotUrl = (shot: Shot) => `/files/${project.id}/shots/${shot.file}?v=${shot.version}`;

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
  const twoTone = !accent && headlineHtml.includes("<em>");
  const copyParts = [
    creative.logo ? logoHtml(creative.logo, await listImages(ctx.space, project.id), project.id) : "",
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
      return [{ url: shotUrl(shot), aspect: shape.aspect, ratio: shape.ratio, radius: shape.geometry.bare }];
    });
    if (tiles.length) {
      const tone = toneOf(background);
      const reach = [Math.max(safe.width * 0.8, canvas.width * 0.24), Math.max(safe.height * 1.05, canvas.height * 0.44)];
      const spot = `radial-gradient(ellipse ${round(reach[0]!)}px ${round(reach[1]!)}px at ${round(safe.x + safe.width / 2)}px ${round(safe.y + safe.height / 2)}px,color-mix(in srgb,${tone} 80%,transparent) 0,color-mix(in srgb,${tone} 52%,transparent) 45%,transparent 100%)`;
      artHtml = `${wallHtml(tiles, canvas)}<div class="veil" style="${backgroundCss(background)}"></div>${copyParts ? `<div class="spot" style="background:${spot}"></div>` : ""}`;
    }
  } else if (placed.length) {
    const ratios = placed.map(({ shot }) => deviceShape(shot, deviceStyle, prefer).ratio);
    const slots = layout === "sides" ? sidesSlots(ratios, canvas, safe, scale) : fanSlots(ratios, canvas, safe, Boolean(copyParts), scale);
    const devices = await Promise.all(
      placed.map(async ({ name, shot }, i) => {
        const slot = slots[i]!;
        const baked = shot?.device === "iphone" && (await hasBakedIsland(path.join(shotsPath, shot.file), shot.version, shot.width));
        return deviceHtml({
          shot,
          wanted: name,
          url: shot && shotUrl(shot),
          style: deviceStyle,
          targetDevice: prefer,
          width: 1,
          pixels: slot.width,
          canvas,
          fit: "width",
          island: !baked,
          defaults: { rotate: slot.rotate },
          extraCss: `left:${round(slot.x - slot.width / 2)}px;top:${round(slot.top)}px;z-index:${slot.z}`,
        });
      }),
    );
    artHtml = `<div class="devices">${devices.join("")}</div>`;
  }

  // The copy keeps a little clear of the safe area's edges. Under a fan it takes the upper half, so the devices' tops stay inside too.
  const halved = layout === "fan" && placed.length > 0;
  const box: Rect = {
    x: safe.x + safe.width * 0.02,
    y: safe.y + safe.height * 0.04,
    width: safe.width * 0.96,
    height: safe.height * (halved ? 0.52 : 0.92),
  };
  const copyHtml = copyParts
    ? `<div class="c-box" style="left:${round(box.x)}px;top:${round(box.y)}px;width:${round(box.width)}px;height:${round(box.height)}px"><div class="copy">${copyParts}</div></div>`
    : "";

  // Type is sized off the safe area, since that is all a narrow crop shows of the canvas.
  const unit = Math.min(safe.width / 88, safe.height / 40);
  const badgeScale = (halved ? 0.6 : 0.8) * (badges.length >= 3 ? 0.78 : 1);
  const vars = [
    `width:${canvas.width}px`,
    `height:${canvas.height}px`,
    `--u:${round(unit)}px`,
    `--ts:${textScale}`,
    `--bs:${round(badgeScale)}`,
    `--fs:${font.scale}`,
    `--hw:${font.weight}`,
    `--track:${font.tracking}`,
    `--text:${textColor}`,
    `--accent:${accent ?? textColor}`,
    `--star:${accent ?? "#FFB61E"}`,
    `--font:'${font.family}','Inter Variable',system-ui,sans-serif`,
    `--body:'${body.family}','Inter Variable',system-ui,sans-serif`,
  ].join(";");
  const fonts = JSON.stringify([`${font.weight} 40px '${font.family}'`, `500 40px '${body.family}'`, `700 40px '${body.family}'`]);
  const noise = typeof background === "object" && background.noise ? `<div class="noise" style="opacity:${round(background.noise * 0.6)}"></div>` : "";
  const guide = ctx.guides
    ? `<div class="guide" style="left:${safe.x}px;top:${safe.y}px;width:${safe.width}px;height:${safe.height}px;--g:${round(canvas.width / 480)}px"><span>Safe area</span></div>`
    : "";

  return `<!doctype html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<title>${esc(project.name)} · ${esc(placement.label)}</title>
<link rel="stylesheet" href="${FONT_CSS_URL}">
<style>${CSS}${CREATIVE_CSS}</style>
</head>
<body>
<div class="canvas creative creative-${layout} ${dark ? "dark" : "light"}" style="${vars}" data-copy-max="${(box.height / canvas.height).toFixed(4)}" data-shrink="together" data-fonts="${esc(fonts)}">
<div class="bg" style="${backgroundCss(background)}"></div>${noise}${DEFS}
${artHtml}
${copyHtml}
${guide}
</div>
<script>${FIT_SCRIPT}</script>
</body>
</html>`;
}
