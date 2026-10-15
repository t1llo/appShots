// The slide template lives in src/template/. This module keeps the names the rest of the app imports from here.
export { CSS } from "./template/css.ts";
export { FIT_SCRIPT } from "./template/fit.ts";
export { deviceShape } from "./template/frames.ts";
export { anchorOf, deskSlots, type Slot } from "./template/layouts/devices.ts";
export { backgroundCss, backgroundLuminance, inkOn, resolveBackground } from "./template/parts/background.ts";
export { badgeHtml, DEFS } from "./template/parts/badges.ts";
export { deviceHtml, SHADOW_LAYERS, statusLook } from "./template/parts/device.ts";
export { logoHtml } from "./template/parts/images.ts";
export { esc, pick, rich, round } from "./template/parts/text.ts";
export { type SlideContext, slideHtml } from "./template/slide.ts";
