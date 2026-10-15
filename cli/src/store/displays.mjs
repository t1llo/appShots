/**
 * The display of App Store Connect each folder of an export goes onto, as the API names it, and the size the
 * pictures of that folder have. The names are a generation behind: APP_IPHONE_67 is the 6.9-inch display,
 * APP_IPHONE_61 the 6.3-inch one and APP_IPHONE_58 the 6.1-inch one. The Mac has one display for its four
 * sizes, so the largest folder there is goes onto it.
 * @type {Record<string, [display: string, width: number, height: number]>}
 */
export const STORE_DISPLAYS = {
  "iphone-6.9": ["APP_IPHONE_67", 1320, 2868],
  "iphone-6.3": ["APP_IPHONE_61", 1206, 2622],
  "iphone-6.5": ["APP_IPHONE_65", 1284, 2778],
  "iphone-6.1": ["APP_IPHONE_58", 1170, 2532],
  "iphone-5.5": ["APP_IPHONE_55", 1242, 2208],
  "iphone-4.7": ["APP_IPHONE_47", 750, 1334],
  "iphone-4": ["APP_IPHONE_40", 640, 1136],
  "iphone-3.5": ["APP_IPHONE_35", 640, 960],
  "ipad-13": ["APP_IPAD_PRO_3GEN_129", 2064, 2752],
  "ipad-11": ["APP_IPAD_PRO_3GEN_11", 1668, 2420],
  "ipad-12.9": ["APP_IPAD_PRO_129", 2048, 2732],
  "ipad-10.5": ["APP_IPAD_105", 1668, 2224],
  "ipad-9.7": ["APP_IPAD_97", 1536, 2048],
  "mac-2880": ["APP_DESKTOP", 2880, 1800],
  "mac-2560": ["APP_DESKTOP", 2560, 1600],
  "mac-1440": ["APP_DESKTOP", 1440, 900],
  "mac-1280": ["APP_DESKTOP", 1280, 800],
};

/** Folders whose display the API does not have yet. Their files go into App Store Connect by hand. */
export const STORE_BY_HAND = { "iphone-duo": "iPhone Duo", "iphone-duo-cover": "iPhone Duo" };

export const STORE_PLATFORMS = { IOS: "iOS", MAC_OS: "macOS" };

/** @param {string} display */
export const platformOf = (display) => (display === "APP_DESKTOP" ? "MAC_OS" : "IOS");
