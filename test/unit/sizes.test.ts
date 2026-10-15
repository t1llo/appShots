import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceKindOf, isPlacementId, isTargetId, PLACEMENT_IDS, TARGET_IDS, TARGETS } from "../../src/sizes.ts";

test("a screenshot at an export size is filed under that size's device", () => {
  for (const id of TARGET_IDS) {
    const { device, width, height } = TARGETS[id];
    assert.equal(deviceKindOf(width, height), device, id);
    // An iPhone or iPad held sideways stays one; a Mac is landscape only.
    if (device !== "mac") assert.equal(deviceKindOf(height, width), device, `${id} landscape`);
  }
});

test("an odd portrait shape goes by its proportions", () => {
  assert.equal(deviceKindOf(1179, 2556), "iphone");
  assert.equal(deviceKindOf(1640, 2360), "ipad");
  assert.equal(deviceKindOf(3024, 1964), "mac");
});

test("landscape screenshots at sizes Apple accepts keep their device", () => {
  assert.equal(deviceKindOf(2556, 1179), "iphone");
  assert.equal(deviceKindOf(2796, 1290), "iphone");
  assert.equal(deviceKindOf(2340, 1080), "iphone");
  assert.equal(deviceKindOf(2360, 1640), "ipad");
  assert.equal(deviceKindOf(2266, 1488), "ipad");
});

test("a 3.5-inch iPhone screenshot is an iPhone's", () => {
  assert.equal(deviceKindOf(640, 960), "iphone");
});

test("isTargetId knows every export size and nothing else", () => {
  for (const id of TARGET_IDS) assert.equal(isTargetId(id), true, id);
  for (const value of ["", "iphone", "iphone-7", "IPHONE-6.9", "mac-5k"]) assert.equal(isTargetId(value), false, value);
});

test("isTargetId does not take the names every object has", () => {
  for (const value of ["__proto__", "constructor", "toString", "hasOwnProperty"]) assert.equal(isTargetId(value), false, value);
});

test("isPlacementId knows every placement and not the names every object has", () => {
  for (const id of PLACEMENT_IDS) assert.equal(isPlacementId(id), true, id);
  for (const value of ["", "banner", "__proto__", "constructor", "toString", "hasOwnProperty"]) assert.equal(isPlacementId(value), false, value);
});
