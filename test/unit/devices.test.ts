import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEVICE_KINDS, type DeviceModel, deviceCatalog, deviceKindOf, frameOf, MODEL_IDS, MODELS, modelOf, modelOfTarget, STAND_INS, TARGET_IDS, TARGETS } from "../../src/domain/devices.ts";

interface AppleClass {
  slot: string;
  display: string | null;
  sizes: [number, number][];
}

const apple: { classes: AppleClass[] } = JSON.parse(readFileSync(new URL("../fixtures/apple-screenshot-sizes.json", import.meta.url), "utf8"));
const key = (sizes: readonly (readonly [number, number])[]) => sizes.map(([w, h]) => `${w}x${h}`).sort().join(" ");

test("every display class Apple lists is in the registry with exactly its sizes", () => {
  const models = MODEL_IDS.map((id) => MODELS[id] as DeviceModel);
  for (const entry of apple.classes) {
    const match = models.filter((model) => model.slot === entry.slot && (model.display ?? null) === entry.display && key(model.sizes) === key(entry.sizes));
    assert.equal(match.length, 1, `${entry.slot} ${key(entry.sizes)}`);
  }
  assert.equal(models.length, apple.classes.length, "the registry has no display class Apple does not list");
});

test("every size Apple accepts is filed under its own device", () => {
  for (const id of MODEL_IDS) {
    const model: DeviceModel = MODELS[id];
    for (const [width, height] of model.sizes) {
      assert.equal(deviceKindOf(width, height), model.device, `${id} ${width}x${height}`);
      assert.equal(MODELS[modelOf(width, height)!].device, model.device, `${id} ${width}x${height}`);
    }
  }
});

test("the export sizes are the ones they have always been", () => {
  assert.deepEqual(TARGETS, {
    "iphone-6.9": { label: 'iPhone 6.9"', slot: "iPhone with Dynamic Island (large display)", device: "iphone", width: 1320, height: 2868, standard: true },
    "iphone-6.3": { label: 'iPhone 6.3"', slot: "iPhone with Dynamic Island (medium display)", device: "iphone", width: 1206, height: 2622, standard: true, from: "iphone-6.9" },
    "iphone-6.5": { label: 'iPhone 6.5"', slot: "iPhone with Face ID (large display)", device: "iphone", width: 1284, height: 2778, standard: true },
    "iphone-6.1": { label: 'iPhone 6.1"', slot: "iPhone with Face ID (medium display)", device: "iphone", width: 1170, height: 2532, standard: true, from: "iphone-6.5" },
    "iphone-5.5": { label: 'iPhone 5.5"', slot: "iPhone with Home Button (large display)", device: "iphone", width: 1242, height: 2208 },
    "iphone-4.7": { label: 'iPhone 4.7"', slot: "iPhone with Home Button (medium display)", device: "iphone", width: 750, height: 1334, from: "iphone-5.5" },
    "iphone-4": { label: 'iPhone 4"', slot: 'iPhone with Home Button (4" display)', device: "iphone", width: 640, height: 1136, from: "iphone-5.5" },
    "iphone-3.5": { label: 'iPhone 3.5"', slot: 'iPhone with Home Button (3.5" display)', device: "iphone", width: 640, height: 960 },
    "iphone-duo": { label: "iPhone Duo", slot: "iPhone Duo", device: "duo", width: 2007, height: 2853, standard: true },
    "iphone-duo-cover": { label: "iPhone Duo cover display", slot: "iPhone Duo", device: "duo", width: 1398, height: 2034 },
    "ipad-13": { label: 'iPad 13"', slot: 'iPad 13" display', device: "ipad", width: 2064, height: 2752, standard: true },
    "ipad-11": { label: 'iPad 11"', slot: 'iPad 11" display', device: "ipad", width: 1668, height: 2420, standard: true },
    "ipad-12.9": { label: 'iPad 12.9"', slot: 'iPad Pro (2nd generation) 12.9" display', device: "ipad", width: 2048, height: 2732, from: "ipad-13" },
    "ipad-10.5": { label: 'iPad 10.5"', slot: 'iPad 10.5" display', device: "ipad", width: 1668, height: 2224, from: "ipad-13" },
    "ipad-9.7": { label: 'iPad 9.7"', slot: 'iPad 9.7" display', device: "ipad", width: 1536, height: 2048, from: "ipad-13" },
    "mac-2880": { label: "Mac", slot: "Mac", device: "mac", width: 2880, height: 1800, standard: true },
    "mac-2560": { label: "Mac 2560", slot: "Mac", device: "mac", width: 2560, height: 1600, from: "mac-2880" },
    "mac-1440": { label: "Mac 1440", slot: "Mac", device: "mac", width: 1440, height: 900, from: "mac-2880" },
    "mac-1280": { label: "Mac 1280", slot: "Mac", device: "mac", width: 1280, height: 800, from: "mac-2880" },
  });
});

test("each export size is one its display class accepts", () => {
  for (const id of TARGET_IDS) {
    const { width, height } = TARGETS[id];
    const model: DeviceModel = MODELS[modelOfTarget(id)];
    assert.ok(model.sizes.some(([w, h]) => w === width && h === height), id);
  }
});

test("a screenshot gets the frame of the hardware it was taken on", () => {
  assert.equal(frameOf("iphone", 1320, 2868), "iphone");
  assert.equal(frameOf("iphone", 2556, 1179), "iphone");
  assert.equal(frameOf("iphone", 1284, 2778), "iphone-notch");
  assert.equal(frameOf("iphone", 1125, 2436), "iphone-notch");
  assert.equal(frameOf("iphone", 1242, 2208), "iphone-home");
  assert.equal(frameOf("iphone", 750, 1334), "iphone-home");
  assert.equal(frameOf("iphone", 640, 960), "iphone-home");
  // A size Apple does not list goes by its shape.
  assert.equal(frameOf("iphone", 1080, 1919), "iphone-home");
  assert.equal(frameOf("iphone", 1000, 2170), "iphone");
  assert.equal(frameOf("ipad", 2048, 2732), "ipad");
  assert.equal(frameOf("ipad", 1536, 2048), "ipad-home");
  assert.equal(frameOf("ipad", 1640, 2360), "ipad");
  assert.equal(frameOf("mac", 2880, 1800), "mac");
  // Shown as another family's device, a screenshot gets that family's usual frame.
  assert.equal(frameOf("ipad", 750, 1334), "ipad");
});

test("every family stands in for itself first and lists all the others", () => {
  for (const kind of DEVICE_KINDS) {
    assert.equal(STAND_INS[kind][0], kind);
    assert.deepEqual([...STAND_INS[kind]].sort(), [...DEVICE_KINDS].sort());
  }
});

test("the catalog lists every display class under its family", () => {
  const catalog = deviceCatalog();
  assert.deepEqual(
    catalog.map((entry) => entry.id),
    [...DEVICE_KINDS],
  );
  assert.equal(
    catalog.reduce((sum, entry) => sum + entry.models.length, 0),
    MODEL_IDS.length,
  );
  assert.deepEqual(catalog.flatMap((entry) => entry.models.flatMap((model) => model.targets)).sort(), [...TARGET_IDS].sort());
});
