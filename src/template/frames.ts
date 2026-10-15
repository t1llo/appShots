import { DEFAULT_FRAMES, type DeviceKind, type Frame, type FrameId, FRAMES, frameOf, isDeviceKind } from "../domain/devices.ts";
import type { DeviceStyle } from "../schema.ts";
import type { Shot } from "../store.ts";
import { round4 } from "./parts/text.ts";

/** The frame drawn around a screenshot: a device family's, or none for a bare screenshot or a window. */
export type FrameKind = DeviceKind | "none";

/** Device width as a fraction of canvas width, by target device then by the frame drawn on it. */
export const BASE_WIDTH: Record<DeviceKind, Record<DeviceKind, number>> = {
  iphone: { iphone: 0.86, duo: 0.92, ipad: 0.92, mac: 0.94 },
  duo: { duo: 0.82, ipad: 0.82, iphone: 0.5, mac: 0.92 },
  ipad: { ipad: 0.84, duo: 0.82, iphone: 0.5, mac: 0.92 },
  mac: { mac: 0.8, ipad: 0.36, duo: 0.36, iphone: 0.25 },
};

/**
 * A frame turned on its side for a landscape screenshot. Its measures are fractions of the device width, which is
 * now the long side, so each shrinks by how much longer that side is; the deep bezels of a home button device move
 * from above and below the screen to its sides.
 */
function turn(frame: Frame, aw: number, ah: number): Frame {
  const upright = (1 - (frame.band + frame.bezel) * 2) * (aw / ah) + (frame.band + (frame.bezelY ?? frame.bezel)) * 2;
  const k = 1 / upright;
  return {
    ...frame,
    outer: round4(frame.outer * k),
    band: round4(frame.band * k),
    bezel: round4((frame.bezelY ?? frame.bezel) * k),
    bezelY: round4(frame.bezel * k),
    inner: round4(frame.inner * k),
    bare: round4((frame.bare * ah) / aw),
    home: frame.home && round4(frame.home * k),
  };
}

/**
 * Which frame a screenshot gets, how much of the device's width its screen takes, and how tall the device comes
 * out per unit of its width. An iPhone, a Duo or an iPad screenshot wider than it is tall was taken with the
 * device on its side, and the device is drawn that way.
 */
export function deviceShape(shot: Shot | undefined, style: DeviceStyle, fallback: DeviceKind) {
  const kind: DeviceKind = isDeviceKind(style.frame) ? style.frame : (shot?.device ?? fallback);
  const model: FrameId = shot ? frameOf(kind, shot.width, shot.height) : DEFAULT_FRAMES[kind];
  const upright = FRAMES[model];
  const turned = kind !== "mac" && shot != null && shot.width > shot.height;
  const [lo, hi] = upright.fits;
  const own = shot ? (turned ? shot.height / shot.width : shot.width / shot.height) : 0;
  const holds = own >= lo && own <= hi;
  // A Mac screenshot that is a captured window, or not the shape of a display, is shown as the window it is unless a MacBook is asked for.
  const window = kind === "mac" && shot != null && (!holds || shot.corner != null) && style.frame !== "mac";
  const frame: FrameKind = style.frame === "none" || window ? "none" : kind;

  // Follow the screenshot's own proportions so nothing gets cropped, within what the frame can plausibly hold.
  // A bare window has no frame to fill, so it keeps its shape whatever that is.
  let [aw, ah] = turned ? [upright.aspect[1], upright.aspect[0]] : upright.aspect;
  if (shot && (holds || (kind === "mac" && frame === "none"))) [aw, ah] = [shot.width, shot.height];
  const geometry = turned ? turn(upright, aw, ah) : upright;
  const rim = frame === "none" ? 0 : (geometry.band + geometry.bezel) * 2;
  const rimY = frame === "none" ? 0 : (geometry.band + (geometry.bezelY ?? geometry.bezel)) * 2;
  const screen = (frame === "none" ? 1 : (geometry.lid ?? 1)) - rim;
  const base = frame === "none" ? 0 : (geometry.base ?? 0);
  // A window narrower than a display is drawn as tall as a display would be, not as wide.
  const slim = kind === "mac" && frame === "none" ? Math.min(1, (aw / ah) * (geometry.aspect[1] / geometry.aspect[0])) : 1;
  // A captured window keeps the corners it was captured with.
  const corner = frame === "none" && shot?.corner ? shot.corner / shot.width : geometry.bare;
  return { kind, frame, model, turned, geometry, aspect: `${aw}/${ah}`, screen, slim, corner, ratio: screen * (ah / aw) + rimY + base };
}
