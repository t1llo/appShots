import path from "node:path";
import { type DeviceKind, FRAMES, isDeviceKind } from "../../domain/devices.ts";
import { type StatusBarLook, statusBarLook } from "../../palette.ts";
import type { DeviceStyle } from "../../schema.ts";
import type { Shot } from "../../store.ts";
import { DEVICE_COLORS } from "../design.ts";
import { BASE_WIDTH, deviceShape } from "../frames.ts";
import { createIds, esc, type Ids, round, round4 } from "./text.ts";

/** A device's shadow as layers: how far down each falls and how far it blurs, both in device widths, and how dark it is. */
export const SHADOW_LAYERS = {
  none: [],
  soft: [
    { down: 0.045, blur: 0.1, opacity: 0.28 },
    { down: 0.012, blur: 0.026, opacity: 0.2 },
  ],
  strong: [
    { down: 0.07, blur: 0.14, opacity: 0.5 },
    { down: 0.02, blur: 0.04, opacity: 0.32 },
  ],
};

const boxShadow = (layers: (typeof SHADOW_LAYERS)["soft"]) =>
  layers.map((layer) => `0 calc(var(--dw)*${layer.down}) calc(var(--dw)*${layer.blur}) rgba(0,0,0,${layer.opacity})`).join(",");

const SHADOWS = {
  // Not "none": the value stands in lists beside other shadows.
  none: "0 0 0 transparent",
  soft: boxShadow(SHADOW_LAYERS.soft),
  strong: boxShadow(SHADOW_LAYERS.strong),
};

export interface DeviceOptions {
  shot: Shot | undefined;
  /** Name asked for, shown in the placeholder when nothing is uploaded under it yet. */
  wanted: string | undefined;
  url: string | undefined;
  style: DeviceStyle;
  targetDevice: DeviceKind;
  width: number;
  /** Exact device width in pixels, for layouts that place devices themselves. Replaces the width derived from the canvas. */
  pixels?: number;
  canvas: { width: number; height: number };
  fit: "width" | "contain";
  /** False when the screenshot already shows the Dynamic Island. */
  island: boolean;
  /** The colour behind the screenshot's status bar, where a clean one is to be drawn. */
  status?: StatusBarLook;
  extraCss?: string;
  defaults?: Partial<DeviceStyle>;
  /** The ids of the page the device is drawn on. A device drawn alone numbers its own. */
  ids?: Ids;
}

/** The colour behind a screenshot's status bar, where the device style asks for a clean one to be drawn. A Mac has none. */
export async function statusLook(shot: Shot | undefined, style: DeviceStyle, shotsPath: string): Promise<StatusBarLook | undefined> {
  if (!shot || !style.statusBar || style.statusBar === "none") return undefined;
  const kind = isDeviceKind(style.frame) ? style.frame : shot.device;
  if (kind === "mac") return undefined;
  return statusBarLook(path.join(shotsPath, shot.file), shot.version, kind, shot.width);
}

export function deviceHtml(options: DeviceOptions): string {
  const { shot, style, canvas } = options;
  const merged = { ...options.defaults, ...style };
  const { kind, frame, model, turned, geometry, aspect, screen: screenWidth, slim, corner, ratio } = deviceShape(shot, merged, options.targetDevice);
  const hardware = FRAMES[model];
  const home = frame !== "none" && hardware.home !== undefined;

  const dw = round(options.pixels ?? canvas.width * BASE_WIDTH[options.targetDevice][kind] * slim * options.width * (options.fit === "width" ? (merged.scale ?? 1) : 1));
  const transforms: string[] = [];
  if (merged.offsetX || merged.offsetY) {
    transforms.push(`translate(${round(((merged.offsetX ?? 0) / 100) * canvas.width)}px,${round(((merged.offsetY ?? 0) / 100) * canvas.height)}px)`);
  }
  if (merged.perspective === "left" || merged.perspective === "right") {
    const sign = merged.perspective === "left" ? 1 : -1;
    transforms.push(`perspective(${round(dw * 3.4)}px) rotateY(${sign * 22}deg) rotateX(7deg) rotateZ(${-sign * 3}deg)`);
  }
  if (merged.rotate) transforms.push(`rotate(${merged.rotate}deg)`);

  const look = frame === "none" ? "real" : (merged.style ?? "real");
  const drawn = look === "outline" || look === "sketch";
  // A MacBook is silver unless a colour is asked for; every other device is black.
  const colors = DEVICE_COLORS[merged.color ?? hardware.color];
  const vars = [
    `--dw:${dw}px`,
    `--sw:calc(var(--dw)*${round4(screenWidth)})`,
    `--ar:${aspect}`,
    frame === "mac" ? `--lid:${geometry.lid};--bh:${geometry.base}` : "",
    `--ro:${geometry.outer}`,
    `--band:${geometry.band}`,
    `--bez:${geometry.bezel}`,
    geometry.bezelY === undefined ? "" : `--bezy:${geometry.bezelY}`,
    home ? `--hb:${geometry.home}` : "",
    // On its side the device's own width is its height, which the buttons and the home button are measured in.
    turned ? `--k:${round4(ratio)}` : "",
    `--ri:${frame === "none" ? round4(corner) : geometry.inner}`,
    // A line drawing lies flat on the slide unless it is asked to cast a shadow.
    `--shadow:${SHADOWS[merged.shadow ?? (drawn ? "none" : "soft")]}`,
    ...colors.map((color, i) => `--f${i + 1}:${color}`),
    drawn ? `--line:${merged.color ? colors[2] : "var(--text)"}` : "",
    transforms.length ? `transform:${transforms.join(" ")}` : "",
    options.extraCss ?? "",
  ].filter(Boolean);

  const screen = options.url
    ? `<img src="${esc(options.url)}" alt=""${shot ? ` data-shot="${esc(shot.name)}"` : ""}>`
    : `<div class="placeholder"${options.wanted ? ` data-missing="${esc(`screenshot:${options.wanted}`)}"` : ""}><span>${options.wanted ? `Upload a screenshot named<br><b>${esc(options.wanted)}</b>` : "No screenshot"}</span></div>`;
  // A device on its side hides its status bar, as an iPhone does in landscape.
  const bar = options.url && options.status && !turned ? statusBarHtml(kind, options.status, merged, kind === "iphone" && hardware.home !== undefined) : "";
  // A status bar painted over the screenshot's own covers an island the screenshot shows, so that one is drawn again.
  // On its side the island stands at the end of the screen, where the screenshot cannot be checked for one, so none is drawn.
  const cutout = hardware.cutout !== "none" && !turned && ((frame !== "none" && options.island) || (hardware.cutout === "island" && !options.island && bar && merged.statusBar === "cover"));
  const island = cutout ? `<div class="${hardware.cutout}"></div>` : "";
  const window = frame === "none" && kind === "mac";
  const shape = `${home ? " home" : ""}${turned ? " land" : ""}`;
  const attrs = `class="device ${frame}${shape}${window ? " window" : ""}${look === "real" ? "" : ` ${drawn ? "drawn " : ""}${look}`}" data-fit="${options.fit}" data-scale="${merged.scale ?? 1}" style="${vars.join(";")}"`;

  if (frame === "none") return `<div ${attrs}><div class="screen bare">${screen}${bar}${island}</div></div>`;
  // On its side the buttons of the left edge are along the bottom and those of the right edge along the top.
  const buttons = hardware.buttons
    .map((button) =>
      turned
        ? `<i class="btn ${button.side === "l" ? "b" : "t"}" style="left:${button.top}%;width:${button.length}%"></i>`
        : `<i class="btn ${button.side}" style="top:${button.top}%;height:${button.length}%"></i>`,
    )
    .join("");
  const parts = home ? `${kind === "iphone" ? '<i class="speaker"></i>' : '<i class="cam"></i>'}<i class="home-btn"></i>` : "";
  // The wobble of a pen is a filter over the line alone. Its grain follows the size of the device, so a small one is not smudged.
  const pens = look === "sketch" ? (options.ids ?? createIds()).next("pen") : 0;
  const pen = pens
    ? `<svg class="defs" aria-hidden="true"><filter id="pen-${pens}" x="-4%" y="-2%" width="108%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="${round4(9 / dw)}" numOctaves="2" seed="${pens % 7}"/><feDisplacementMap in="SourceGraphic" scale="${round(dw * 0.014)}" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`
    : "";
  const frameStyle = pen ? ` style="--pen:url(#pen-${pens})"` : "";
  const base = frame === "mac" ? `<i class="base"${frameStyle}></i>` : "";
  return `<div ${attrs}>${pen}${buttons}<div class="frame"${frameStyle}><div class="bezel"><div class="screen">${screen}${bar}${island}</div></div>${parts}</div>${base}</div>`;
}

const STATUS_ICONS = {
  signal: '<svg class="sb-signal" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx=".8"/><rect x="5" y="5.4" width="3" height="6.6" rx=".8"/><rect x="10" y="2.7" width="3" height="9.3" rx=".8"/><rect x="15" y="0" width="3" height="12" rx=".8"/></svg>',
  wifi: '<svg class="sb-wifi" viewBox="0 0 17 12"><path d="M8.5 11.6 6.2 9.1a3.2 3.2 0 0 1 4.6 0z"/><path d="M4.12 6.82a6.2 6.2 0 0 1 8.76 0M1.71 4.41a9.6 9.6 0 0 1 13.58 0" fill="none" stroke="currentColor" stroke-width="2.1"/></svg>',
  battery:
    '<svg class="sb-battery" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.7" fill="none" stroke="currentColor" stroke-opacity=".42"/><rect x="2" y="2" width="20" height="9" rx="2.3"/><path d="M25 4.3c.9.4 1.5 1.2 1.5 2.2s-.6 1.8-1.5 2.2z" opacity=".45"/></svg>',
};

/**
 * The status bar of a device: the time on the left, and what the device shows on the right. An iPhone with a home
 * button has the older, slimmer bar: the signal on the left, the time in the middle and the battery on the right.
 */
function statusBarHtml(kind: DeviceKind, look: StatusBarLook, style: DeviceStyle, home: boolean): string {
  const light = style.statusBarColor === "light" || (style.statusBarColor !== "dark" && look.light);
  const fill = style.statusBar === "cover" ? `<i class="sb-fill" style="background:${look.fill}"></i>` : "";
  const time = `<span class="sb-time">${esc(style.statusBarTime ?? "9:41")}</span>`;
  if (home) {
    return `<div class="sb sb-${kind} sb-home ${light ? "light" : "dark"}">${fill}<span class="sb-net">${STATUS_ICONS.signal + STATUS_ICONS.wifi}</span>${time}<span class="sb-icons">${STATUS_ICONS.battery}</span></div>`;
  }
  const icons = (kind === "iphone" ? STATUS_ICONS.signal : "") + STATUS_ICONS.wifi + STATUS_ICONS.battery;
  return `<div class="sb sb-${kind} ${light ? "light" : "dark"}">${fill}${time}<span class="sb-icons">${icons}</span></div>`;
}
