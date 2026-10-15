// Which screenshot a slide shows under a name: the one the renderer draws and the one the Studio shows as its
// thumbnail. Both import this, so the two cannot pick differently. It imports nothing, so the Studio bundles it too.

/** Which device's screenshot stands in when a name has none for the device asked for: the one closest in shape first. */
export const STAND_INS = {
  iphone: ["iphone", "duo", "ipad", "mac"],
  duo: ["duo", "ipad", "iphone", "mac"],
  ipad: ["ipad", "duo", "iphone", "mac"],
  mac: ["mac", "ipad", "duo", "iphone"],
} as const;

export type StandInDevice = keyof typeof STAND_INS;

/**
 * Picks the variant for the target's device and the language: that language's own screenshot, else the one for
 * every language, else another language's. Only then another device's stands in, because the shape matters most.
 */
export function findShot<S extends { name: string; device: StandInDevice; locale?: string }>(shots: S[], name: string | undefined, device: StandInDevice, locale?: string): S | undefined {
  if (!name) return undefined;
  const named = shots.filter((shot) => shot.name === name);
  const lower = locale?.toLowerCase();
  for (const kind of STAND_INS[device]) {
    const ofKind = named.filter((shot) => shot.device === kind);
    const found = ofKind.find((shot) => lower != null && shot.locale?.toLowerCase() === lower) ?? ofKind.find((shot) => !shot.locale) ?? ofKind[0];
    if (found) return found;
  }
  return undefined;
}
