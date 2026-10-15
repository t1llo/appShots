import assert from "node:assert/strict";
import { test } from "node:test";
import { WEB_SCREENS } from "../../cli/src/capture/web.mjs";
import { displayOf, SIM_KINDS } from "../../cli/src/sim.mjs";
import { platformOf, STORE_BY_HAND, STORE_DISPLAYS } from "../../cli/src/store/displays.mjs";
import { designTarget, TARGETS } from "../../src/sizes.ts";

test("every size the server exports has a display in App Store Connect, or is put there by hand", () => {
  for (const [id, target] of Object.entries(TARGETS)) {
    if (id in STORE_BY_HAND) continue;
    assert.ok(id in STORE_DISPLAYS, `${id} has no display`);
    const [, width, height] = STORE_DISPLAYS[id];
    assert.deepEqual([width, height], [target.width, target.height], id);
  }
  for (const id of [...Object.keys(STORE_DISPLAYS), ...Object.keys(STORE_BY_HAND)]) assert.ok(id in TARGETS, `${id} is not a size the server exports`);
});

test("each folder goes onto the display of its own slot, and the Mac sizes onto the one Mac display", () => {
  assert.equal(STORE_DISPLAYS["iphone-6.9"][0], "APP_IPHONE_67");
  assert.equal(STORE_DISPLAYS["iphone-6.3"][0], "APP_IPHONE_61");
  assert.equal(STORE_DISPLAYS["ipad-13"][0], "APP_IPAD_PRO_3GEN_129");
  const displays = Object.values(STORE_DISPLAYS).map(([display]) => display);
  // No two iPhone or iPad folders share a display, or one would replace the other's pictures.
  const devices = displays.filter((display) => display !== "APP_DESKTOP");
  assert.equal(new Set(devices).size, devices.length);
  assert.equal(platformOf("APP_DESKTOP"), "MAC_OS");
  assert.equal(platformOf("APP_IPAD_97"), "IOS");
});

test("the simulators 'appshots run' prefers take the size each family is designed at", () => {
  for (const [kind, device] of [["iphone", "iphone"], ["duo", "duo"], ["ipad", "ipad"]]) {
    const target = TARGETS[designTarget(/** @type {any} */ (device))];
    assert.deepEqual(SIM_KINDS[kind].size, [target.width, target.height], kind);
  }
});

test("a web page is drawn at the size of its family's first export size", () => {
  for (const [kind, screen] of Object.entries(WEB_SCREENS)) {
    const target = TARGETS[designTarget(/** @type {any} */ (kind))];
    assert.deepEqual([screen.width * screen.scale, screen.height * screen.scale], [target.width, target.height], kind);
  }
});

test("displayOf names the display a simulator's screenshots fit as they are", () => {
  assert.equal(displayOf({ width: 1320, height: 2868 }), "the 6.9-inch iPhone display");
  assert.equal(displayOf({ width: 2868, height: 1320 }), "the 6.9-inch iPhone display");
  assert.equal(displayOf({ width: 1206, height: 2622 }), "the 6.3-inch iPhone display");
  assert.equal(displayOf({ width: 2064, height: 2752 }), "the 13-inch iPad display");
  assert.equal(displayOf({ width: 2007, height: 2853 }), "the iPhone Duo display");
  // The iPhone 15 and 16 take 1179x2556, which no export size has.
  assert.equal(displayOf({ width: 1179, height: 2556 }), null);
  assert.equal(displayOf(null), null);
});
