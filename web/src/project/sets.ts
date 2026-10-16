// The sets of slides a project has, and what its slides and assets name, as the project's pages need them.

import type { DeviceKind, PlacementId, Project, Slide, StoredImage } from "../api.ts";

type Sets = Pick<Project, "slides" | "deviceSlides">;

/** The slides a device shows: its own set, or the one the devices share. */
export const setOf = (project: Sets, device: DeviceKind): Slide[] => project.deviceSlides?.[device] ?? project.slides;
export const everySlide = (project: Sets): Slide[] => [...project.slides, ...Object.values(project.deviceSlides ?? {}).flatMap((set) => set ?? [])];

/** The screenshots and the images that some slide or asset of the project shows, by name. */
export function usedNames(project: Sets & Pick<Project, "creatives">): { shots: Set<string | undefined>; images: Set<string | undefined> } {
  const all = everySlide(project);
  const creatives = Object.keys(project.creatives ?? {}).map((where) => project.creatives[where as PlacementId]);
  return {
    shots: new Set([
      ...all.flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3, ...(slide.features ?? []).map((feature) => feature.screenshot)]),
      ...creatives.flatMap((creative) => creative?.screenshots ?? []),
    ]),
    images: new Set([
      ...all.flatMap((slide) => [slide.logo?.image, ...(slide.images ?? []).map((placed) => placed.image), ...(slide.features ?? []).map((feature) => feature.image)]),
      ...creatives.map((creative) => creative?.logo?.image),
    ]),
  };
}

/** An image named as the app's icon, such as "icon", "app-icon" or "icon-1024", but not "silicon" or "icons". */
const ICON = /(^|[-_])(app)?icon($|[-_\d])/i;

/** The app's icon in the store: an image named just that, then one named as one, or else the logo the slides show. */
export function appIcon(images: StoredImage[], slides: Slide[]): StoredImage | undefined {
  const logo = slides.find((slide) => slide.logo?.image)?.logo?.image;
  return images.find((image) => /^(app[-_]?)?icon$/i.test(image.name)) ?? images.find((image) => ICON.test(image.name)) ?? images.find((image) => image.name === logo);
}
