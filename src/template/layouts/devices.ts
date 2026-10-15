import type { DeviceKind } from "../../domain/devices.ts";
import type { StatusBarLook } from "../../palette.ts";
import type { DeviceStyle } from "../../schema.ts";
import type { Shot } from "../../store.ts";
import { deviceShape } from "../frames.ts";
import { type DeviceOptions, deviceHtml } from "../parts/device.ts";
import { type Ids, round, round4 } from "../parts/text.ts";
import { LAYOUT_DEFS, type LayoutDef, type LayoutId } from "./index.ts";

/** Where one device of a group stands: its centre and its top, its width, its tilt and what it is in front of. */
export interface Slot {
  x: number;
  top: number;
  width: number;
  rotate: number;
  z: number;
}

/**
 * A laptop or a window with the other devices around it, as they would stand on a desk: further laptops behind it,
 * up and to the left, and phones and tablets in front of its lower corners. Measured in widths of the laptop,
 * from its top left corner. A device is a laptop when it is wider than it is tall, unless `laptops` says otherwise:
 * a phone on its side is wide too.
 */
export function deskSlots(ratios: number[], anchor: number, corners: "left" | "both", laptops = ratios.map((ratio) => ratio < 1)): Slot[] {
  const depth = ratios[anchor]!;
  let behind = 0;
  let front = 0;
  return ratios.map((ratio, i) => {
    if (i === anchor) return { x: 0.5, top: 0, width: 1, rotate: 0, z: 5 };
    if (laptops[i]) {
      const step = ++behind;
      return { x: 0.5 - step * 0.15, top: -step * 0.085, width: 1 - step * 0.06, rotate: 0, z: 5 - step };
    }
    // A tablet stands taller beside a laptop than a phone does. One on its side is as wide as it would be tall.
    const long = depth * (Math.max(ratio, 1 / ratio) > 1.7 ? 0.64 : 0.78);
    const height = ratio >= 1 ? long : long * ratio;
    const width = height / ratio;
    const nth = front++;
    const right = corners === "both" && nth % 2 === 1;
    const out = (corners === "both" ? Math.floor(nth / 2) : nth) * width * 0.8;
    return { x: right ? 0.98 + out : 0.02 - out, top: depth + 0.03 - height, width, rotate: 0, z: 9 - nth };
  });
}

/** The first laptop or window among the devices, which the others gather around. */
export const anchorOf = (ratios: number[], laptops = ratios.map((ratio) => ratio < 1)) => laptops.indexOf(true);

/** What a device needs to know about its screenshot: whether to draw the island, and the colour behind its status bar. */
export interface Dress {
  island: boolean;
  status: StatusBarLook | undefined;
}

export interface StageOptions {
  layout: LayoutId;
  /** The screenshots the layout shows, in the order it names them, and the names asked for. */
  group: { shot: Shot | undefined; wanted: string | undefined }[];
  style: DeviceStyle;
  target: DeviceKind;
  canvas: { width: number; height: number };
  unit: number;
  /** The copy stands in a column beside the device. */
  side: boolean;
  wide: boolean;
  /** A group is mirrored on a page read from right to left, so it is read in the same order as the copy. */
  rtl: boolean;
  ids: Ids;
  url: (shot: Shot | undefined) => string | undefined;
  dress: (shot: Shot | undefined) => Promise<Dress>;
}

/** The stage of a layout that shows devices: one alone, two or three in a group, or a laptop with the others on a desk. */
export async function deviceStage(options: StageOptions): Promise<string> {
  const { layout, group, style, target, canvas, unit, side, wide, ids } = options;
  const def: LayoutDef = LAYOUT_DEFS[layout];
  const [first] = group;
  // Beside a narrow column of copy on a wide canvas, the device has the room to stand at its full size.
  const common = { style, targetDevice: target, canvas, width: side && wide ? 1 : def.width, ids };
  const gap = unit * 6.5;
  const mirror = options.rtl ? -1 : 1;
  // Several devices fan out around the slide's own tilt: the left one leans left by half the angle between them, the right one right.
  // Laptops and windows stand level unless an angle is asked for: a leaning one looks like it is falling over.
  const level = deviceShape(first?.shot, style, target).ratio < 1;
  const spread = (style.spread ?? (level ? 0 : def.spread) ?? 0) / 2;
  const apart = ((style.gap ?? 0) / 100) * canvas.width;
  const fanned = (side: number): DeviceStyle => ({ ...style, rotate: round((style.rotate ?? 0) + side * spread) });
  const draw = async (entry: (typeof group)[number], extra: Partial<DeviceOptions>) =>
    deviceHtml({ ...common, shot: entry.shot, wanted: entry.wanted, url: options.url(entry.shot), ...(await options.dress(entry.shot)), fit: "width", ...extra });
  /** One device of a layout that places several: which side of the middle it is on, its centre in device widths from there, how far down it starts, and what is in front. */
  const placed = async (entry: (typeof group)[number], side: number, x: number, top: number, z: number) => {
    // Phones are drawn small on a tablet-shaped canvas; a group of them has the room to be larger.
    const boost = target !== "iphone" && deviceShape(entry.shot, style, target).kind === "iphone" ? 1.45 : 1;
    const extraCss = `margin-left:calc(var(--dw)*${round(mirror * x - 0.5)} + ${round(mirror * side * apart)}px);top:${round(gap + top * unit)}px;z-index:${z}`;
    return draw(entry, { style: fanned(mirror * side), width: common.width * boost, extraCss });
  };

  const shapes = group.map((entry) => deviceShape(entry.shot, style, target));
  const ratios = shapes.map((shape) => shape.ratio);
  const laptops = shapes.map((shape) => shape.kind === "mac" && shape.ratio < 1);
  // A laptop among phones and tablets: side by side they would not match in height, so they stand as on a desk.
  const desk = group.length > 1 && laptops.some(Boolean) && laptops.some((laptop) => !laptop);
  let html: string;
  let anchorWidth = 0;
  if (desk) {
    const slots = deskSlots(ratios, anchorOf(ratios, laptops), "both", laptops).map((slot) => ({ ...slot, x: options.rtl ? 1 - slot.x : slot.x }));
    const edges = slots.flatMap((slot) => [slot.x - slot.width / 2, slot.x + slot.width / 2]);
    // The group as a whole stands in the middle, whichever corners the smaller devices are at.
    const middle = (Math.min(...edges) + Math.max(...edges)) / 2;
    const rise = Math.min(...slots.map((slot) => slot.top));
    anchorWidth = canvas.width * (wide ? 0.62 : 0.78) * (style.scale ?? 1);
    const parts = await Promise.all(
      group.map((entry, i) => {
        const slot = slots[i]!;
        const side = Math.sign(round(slot.x - middle));
        const extraCss = `--dw:calc(var(--aw)*${round4(slot.width)});margin-left:calc(var(--aw)*${round4(slot.x - middle - slot.width / 2)} + ${round(side * apart)}px);top:calc(${round(gap)}px + var(--aw)*${round4(slot.top - rise)});z-index:${slot.z}`;
        return draw(entry, { pixels: slot.width * anchorWidth, extraCss });
      }),
    );
    html = parts.join("");
  } else if (layout === "duo") {
    const [front, back] = group as [(typeof group)[number], (typeof group)[number]];
    const place = (side: number, x: number, top: number, z: number) =>
      `margin-left:calc(var(--dw)*-.5 + ${round(mirror * (x * canvas.width + side * apart))}px);top:${round(top)}px;z-index:${z}`;
    html =
      (await draw(back, { style: fanned(-mirror), extraCss: place(-1, -0.19, gap + (level ? 0 : unit * 10), 1) })) +
      (await draw(front, { style: fanned(mirror), extraCss: place(1, 0.17, gap + (level ? unit * 9 : 0), 2) }));
  } else if (layout === "side-by-side") {
    html = (await placed(group[0]!, -1, -0.53, 0, 2)) + (await placed(group[1]!, 1, 0.53, 9, 1));
  } else if (layout === "trio") {
    html = (await placed(group[1]!, -1, -0.5, 11, 1)) + (await placed(group[2]!, 1, 0.5, 11, 1)) + (await placed(group[0]!, 0, 0, 0, 2));
  } else {
    // A phone beside the copy on a tablet-shaped canvas has the room to be larger, like a group of them has.
    const boost = side && target !== "iphone" && shapes[0]!.kind === "iphone" ? 1.45 : 1;
    html = await draw(first!, {
      width: common.width * boost,
      fit: layout === "device-center" || layout === "floating" ? "contain" : "width",
      defaults: layout === "tilted" ? { rotate: -8, offsetX: 5 } : layout === "floating" ? { perspective: "left", shadow: "strong" } : undefined,
    });
  }
  return `<div class="stage${def.shots > 1 ? " multi" : ""}${desk ? ` desk" style="--aw:${round(anchorWidth)}px` : ""}">${html}</div>`;
}
