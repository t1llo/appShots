import sharp from "sharp";
import { renderSettings } from "../config.ts";
import { mockupStage } from "../mockup.ts";
import type { Mockups, Project } from "../schema.ts";
import { InputError, type Shot, type Space } from "../store.ts";
import { SHADOW_LAYERS } from "../template.ts";
import { openWindow } from "./capture.ts";
import { local, scheduler } from "./engine.ts";

export interface Mockup {
  png: Buffer;
  width: number;
  height: number;
}

// Drawn mockups are kept a while: the Studio, a ZIP and an agent ask for the same ones again and again.
const mockups = new Map<string, Mockup>();
const MOCKUPS_KEPT_BYTES = 96 * 1024 * 1024;
/** Mockups being drawn, so a second request for one waits for the same drawing. */
const inflight = new Map<string, Promise<Mockup>>();
const drawing = new Map<string, number>();
/** Mockups one account may have waiting to be drawn. They cost no render, so this is what keeps the queue free. */
const MAX_DRAWING = 4;

/**
 * Draws one screenshot in its device on a transparent background and cuts the picture down to what is drawn.
 * Mockups wait in a lane of their own, apart from the renders, and count as none.
 */
export function renderMockup(space: Space, project: Project, shot: Shot, settings: Mockups = project.mockups): Promise<Mockup> {
  const key = `${space.id}/${project.id}/${shot.file}@${shot.version}:${JSON.stringify(settings)}`;
  const kept = mockups.get(key);
  if (kept) {
    // Asked for again, so it is the last to be dropped.
    mockups.delete(key);
    mockups.set(key, kept);
    return Promise.resolve(kept);
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const count = drawing.get(space.id) ?? 0;
  if (count >= MAX_DRAWING) return Promise.reject(new InputError("Mockups are already being drawn for this account. Try again in a moment."));
  drawing.set(space.id, count + 1);

  // The browser's part and the work on its picture both happen in the lane: a large mockup takes a lot of memory.
  const drawn = scheduler
    .schedule("mockup", space.id, () => draw(space, project, shot, settings))
    .then((mockup) => {
      mockups.set(key, mockup);
      let bytes = 0;
      for (const each of mockups.values()) bytes += each.png.length;
      for (const [oldest, each] of mockups) {
        if (bytes <= MOCKUPS_KEPT_BYTES) break;
        mockups.delete(oldest);
        bytes -= each.png.length;
      }
      return mockup;
    })
    .finally(() => {
      inflight.delete(key);
      const left = (drawing.get(space.id) ?? 1) - 1;
      if (left > 0) drawing.set(space.id, left);
      else drawing.delete(space.id);
    });
  inflight.set(key, drawn);
  return drawn;
}

/** How much the kept mockups take, and how many are being drawn, for a health page. */
export function mockupCache(): { entries: number; bytes: number; drawing: number } {
  let bytes = 0;
  for (const each of mockups.values()) bytes += each.png.length;
  return { entries: mockups.size, bytes, drawing: inflight.size };
}

async function draw(space: Space, project: Project, shot: Shot, settings: Mockups): Promise<Mockup> {
  const stage = mockupStage(shot, settings);
  const layers = SHADOW_LAYERS[settings.device?.shadow ?? "none"];
  const window = await openWindow(space, stage, { transparent: true });
  let picture: Buffer;
  let scale = 1;
  try {
    await window.load(`http://${local}/render/${project.id}/mockup/${encodeURIComponent(shot.file)}?bare=1&settings=${encodeURIComponent(JSON.stringify(settings))}`, `The mockup of "${shot.name}"`);
    // Only the device is drawn: the stage around it has room for any turn and shadow, and is empty.
    const box = await window.page.evaluate(() => {
      const edges = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (const element of document.body.querySelectorAll("*")) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        edges.left = Math.min(edges.left, rect.left);
        edges.top = Math.min(edges.top, rect.top);
        edges.right = Math.max(edges.right, rect.right);
        edges.bottom = Math.max(edges.bottom, rect.bottom);
      }
      return edges;
    });
    // Room for what a frame draws past the elements' boxes, such as its buttons. What stays empty is cut off below.
    const margin = stage.device * 0.04;
    const left = Number.isFinite(box.left) ? Math.max(0, Math.floor(box.left - margin)) : 0;
    const top = Number.isFinite(box.top) ? Math.max(0, Math.floor(box.top - margin)) : 0;
    const right = Number.isFinite(box.right) ? Math.min(stage.width, Math.ceil(box.right + margin)) : stage.width;
    const bottom = Number.isFinite(box.bottom) ? Math.min(stage.height, Math.ceil(box.bottom + margin)) : stage.height;
    // Drawn at the scale of the finished picture, the shadow cast around the device included, so no larger
    // picture is drawn and worked on only to be shrunk at the end. Never larger than the page itself.
    const reach = Math.max(0, ...layers.map((layer) => Math.ceil(layer.blur * 1.5 * stage.device)));
    // The device's own width, as the cut will leave it: the whole page's when nothing on it has a size.
    const drawn = Number.isFinite(box.left) ? Math.min(right, box.right) - Math.max(left, box.left) : right - left;
    if (settings.width) scale = Math.min(1, settings.width / Math.max(1, drawn + reach * 2));
    picture = await window.shoot({ x: left, y: top, width: right - left, height: bottom - top }, scale);
  } finally {
    await window.close();
  }
  const device = await cut(picture);
  const whole = await withShadow(device, layers, stage.device * scale);
  // The last few pixels to the width asked for are a matter of scaling.
  const { data, info } = await sharp(whole.data, { raw: whole.info })
    .resize(settings.width ? { width: settings.width } : {})
    .png({ compressionLevel: renderSettings.pngLevel })
    .toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}

interface Pixels {
  data: Buffer;
  info: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
}

/** A picture cut down to what is drawn on it. */
async function cut(picture: Buffer | Pixels): Promise<Pixels> {
  const source = Buffer.isBuffer(picture) ? sharp(picture) : sharp(picture.data, { raw: picture.info });
  const { data, info } = await source.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).raw().toBuffer({ resolveWithObject: true });
  return { data, info: { width: info.width, height: info.height, channels: info.channels } };
}

/**
 * Lays a device's shadow under it. The browser draws a blur of this size in visible blocks, so the shadow is made
 * here from the device's outline: blurred small, where it is cheap, and scaled up, which a blur does not show.
 */
async function withShadow(device: Pixels, layers: (typeof SHADOW_LAYERS)["soft"], deviceWidth: number): Promise<Pixels> {
  if (layers.length === 0) return device;
  const { width, height } = device.info;
  const outline = await sharp(device.data, { raw: device.info }).extractChannel(3).raw().toBuffer();
  const reach = (layer: (typeof layers)[number]) => Math.ceil(layer.blur * 1.5 * deviceWidth);
  const room = Math.max(...layers.map((layer) => reach(layer) + Math.ceil(layer.down * deviceWidth)));
  const shadows = await Promise.all(
    layers.map(async (layer) => {
      const sigma = (layer.blur / 2) * deviceWidth;
      const shrink = Math.max(1, sigma / 6);
      const edge = Math.ceil(reach(layer) / shrink);
      // Each step says how many channels it returned: sharp is free to widen a grey picture on the way.
      const small = await sharp(outline, { raw: { width, height, channels: 1 } })
        .resize(Math.max(1, Math.round(width / shrink)), Math.max(1, Math.round(height / shrink)), { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const blurred = await sharp(small.data, { raw: small.info })
        .extend({ top: edge, bottom: edge, left: edge, right: edge, background: "#000" })
        .blur(Math.max(0.3, sigma / shrink))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const full = { width: Math.round((blurred.info.width * width) / small.info.width), height: Math.round((blurred.info.height * height) / small.info.height) };
      const alpha = await sharp(blurred.data, { raw: blurred.info })
        .resize(full.width, full.height, { fit: "fill", kernel: "cubic" })
        .linear(layer.opacity, 0)
        .extractChannel(0)
        .raw()
        .toBuffer({ resolveWithObject: true });
      // Handed on as pixels: encoding a layer this large only for the next step to decode it took longer than the blur.
      const layered = await sharp({ create: { ...full, channels: 3, background: "#000" } })
        .joinChannel(alpha.data, { raw: alpha.info })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        input: layered.data,
        raw: { width: layered.info.width, height: layered.info.height, channels: layered.info.channels },
        left: room - Math.round((full.width - width) / 2),
        top: room - Math.round((full.height - height) / 2) + Math.round(layer.down * deviceWidth),
      };
    }),
  );
  const { data, info } = await sharp({ create: { width: width + room * 2, height: height + room * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    // The widest shadow lies lowest.
    .composite([...shadows, { input: device.data, raw: device.info, left: room, top: room }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return cut({ data, info: { width: info.width, height: info.height, channels: info.channels } });
}

/** Mockups side by side on a neutral grey, so a light frame shows as well as a dark one. */
export async function mockupSheet(drawn: Mockup[]): Promise<Buffer> {
  const gap = 36;
  const height = 620;
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  let left = gap;
  for (const mockup of drawn) {
    const { data, info } = await sharp(mockup.png).resize({ height, width: 900, fit: "inside" }).toBuffer({ resolveWithObject: true });
    tiles.push({ input: data, left, top: gap + Math.round((height - info.height) / 2) });
    left += info.width + gap;
  }
  return sharp({ create: { width: left, height: height + gap * 2, channels: 3, background: "#A2A2AA" } })
    .composite(tiles)
    .jpeg({ quality: 84 })
    .toBuffer();
}
