import path from "node:path";
import { FONT_CSS_URL } from "./design.ts";
import { hasBakedIsland } from "./palette.ts";
import type { DeviceStyle, Mockups, Project } from "./schema.ts";
import { type Shot, shotsDir, type Space } from "./store.ts";
import { CSS, deviceHtml, deviceShape, esc, round, SHADOW_LAYERS, statusLook } from "./template.ts";

/** A mockup is never drawn wider than this, however large a PNG is asked for. */
const MAX_DEVICE = 4200;

/** Room around the device for what reaches past its edges, in device widths: the buttons, a shadow, a 3D turn. */
const ROOM = { none: 0.05, soft: 0.2, strong: 0.3 };

/**
 * The screenshots a project has mockups of in one language: one per name and device, the language's own picture
 * where it has one, else the one every language shows.
 */
export function mockupShots(project: Project, shots: Shot[], locale?: string): Shot[] {
  const lower = (locale ?? project.locales[0]!).toLowerCase();
  const picked = new Map<string, Shot>();
  for (const shot of shots) {
    const key = `${shot.name}.${shot.device}`;
    const current = picked.get(key);
    const own = shot.locale?.toLowerCase() === lower;
    if (!current || own || (!shot.locale && current.locale?.toLowerCase() !== lower)) picked.set(key, shot);
  }
  return [...picked.values()];
}

/** What a mockup is called as a file: the screenshot's name and its device. */
export const mockupName = (shot: Shot) => `${shot.name}-${shot.device}.png`;

/**
 * The page a mockup is drawn on: the device's width, and a stage large enough for the device however it is turned.
 * The picture is cut down to what is drawn afterwards, so the stage only has to be large enough.
 */
export function mockupStage(shot: Shot, settings: Mockups): { device: number; width: number; height: number } {
  const style: DeviceStyle = settings.device ?? {};
  const shape = deviceShape(shot, style, shot.device);
  const rim = shape.frame === "none" ? 0 : (shape.geometry.band + shape.geometry.bezel) * 2;
  const angle = (Math.abs(style.rotate ?? 0) * Math.PI) / 180;
  /** The box a device of this width fills once it is rotated. */
  const box = (device: number) => ({
    width: device * Math.cos(angle) + device * shape.ratio * Math.sin(angle),
    height: device * Math.sin(angle) + device * shape.ratio * Math.cos(angle),
  });
  // Pixel for pixel: the screen of the device is exactly as wide as the screenshot.
  const native = shot.width / (1 - rim);
  const device = Math.min(MAX_DEVICE, settings.width ? (native * settings.width) / box(native).width : native);
  const room = device * (ROOM[style.shadow ?? "none"] + (style.perspective && style.perspective !== "none" ? 0.12 : 0));
  const { width, height } = box(device);
  return { device: Math.round(device), width: Math.ceil(width + room * 2), height: Math.ceil(height + room * 2) };
}

const READY_SCRIPT = `(async () => {
  try {
    await document.fonts.load("600 40px 'Inter Variable'");
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  } catch {}
  document.body.dataset.ready = '1';
})();`;

/**
 * One screenshot in its device with nothing behind it. The shadow falls straight down however the device is turned,
 * and is left out of a `bare` page: the renderer casts it itself, because the browser draws a blur this large in blocks.
 */
export async function mockupHtml(space: Space, project: Project, shot: Shot, settings: Mockups = project.mockups, bare = false): Promise<string> {
  const shots = shotsDir(space, project.id);
  const { shadow = "none", ...style }: DeviceStyle = settings.device ?? {};
  const stage = mockupStage(shot, settings);
  // A drop shadow takes the spread of the blur itself, which is half of what a box shadow calls its blur.
  const cast = bare
    ? ""
    : SHADOW_LAYERS[shadow].map((layer) => `drop-shadow(0 ${round(layer.down * stage.device)}px ${round((layer.blur / 2) * stage.device)}px rgba(0,0,0,${layer.opacity}))`).join(" ");
  const device = deviceHtml({
    shot,
    wanted: shot.name,
    url: `/files/${project.id}/shots/${shot.file}?v=${shot.version}`,
    style,
    targetDevice: shot.device,
    width: 1,
    pixels: stage.device,
    canvas: stage,
    fit: "width",
    island: shot.device !== "iphone" || !(await hasBakedIsland(path.join(shots, shot.file), shot.version, shot.width)),
    status: await statusLook(shot, style, shots),
    // A mockup turns about its middle. Its shadow is cast around it, not by the frame.
    extraCss: "transform-origin:50% 50%",
    defaults: { shadow: "none" },
  });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(project.name)} · ${esc(shot.name)}</title>
<link rel="stylesheet" href="${FONT_CSS_URL}">
<style>${CSS}
html,body{background:transparent}
body{display:grid;place-items:center;--text:#111114;--body:'Inter Variable',system-ui,sans-serif}
</style>
</head>
<body style="width:${stage.width}px;height:${stage.height}px">
<div${cast ? ` style="filter:${cast}"` : ""}>${device}</div>
<script>${READY_SCRIPT}</script>
</body>
</html>`;
}
