import type { DeviceKind } from "../../domain/devices.ts";
import type { Feature } from "../../schema.ts";
import { findShot, type Shot, type StoredImage } from "../../store.ts";
import { deviceShape } from "../frames.ts";
import { inkOn } from "../parts/background.ts";
import { shotUrl } from "../parts/images.ts";
import type { Ids } from "../parts/text.ts";

/** What the layouts that draw a slide's features need to know about the slide they are on. */
export interface Scene {
  canvas: { width: number; height: number };
  unit: number;
  locale: string;
  fallback: string;
  projectId: string;
  /** Where the screenshots and images a feature names are looked up. */
  shots: Shot[];
  images: StoredImage[];
  device: DeviceKind;
  ids: Ids;
}

/** The screenshot a feature shows small, for the device the slide is made for. */
export function featureShot(feature: Feature, scene: Scene) {
  if (!feature.screenshot) return undefined;
  const shot = findShot(scene.shots, feature.screenshot, scene.device, scene.locale);
  if (!shot) return undefined;
  // A captured window keeps the corners it was captured with; any other screenshot gets those of the screen it was taken on.
  const { corner } = deviceShape(shot, { frame: "none" }, shot.device);
  return { url: shotUrl(scene.projectId, shot), name: shot.name, wide: shot.width > shot.height, aspect: `${shot.width}/${shot.height}`, corner };
}

/** The image a feature shows in place of its icon. */
export function featureImage(feature: Feature, scene: Scene) {
  if (!feature.image) return undefined;
  return scene.images.find((entry) => entry.name === feature.image);
}

/** A canvas wider than a phone's has room for larger type on a slide that is all type. */
export const shapeOf = (canvas: { width: number; height: number }) => (canvas.width > canvas.height ? "wide" : canvas.width / canvas.height > 0.6 ? "tablet" : "phone");

/** A feature's own colour, as the variables its card, its icon and its figure are drawn in. */
export const colorVars = (feature: Feature) => (feature.color ? `--c:${feature.color};--ci:${inkOn(feature.color)}` : "");
