import assert from "node:assert/strict";
import { test } from "node:test";
import { findShot } from "../../src/domain/standins.ts";
import { findShot as storeFindShot, type Shot } from "../../src/store.ts";

const shot = (name: string, device: Shot["device"], locale?: string): Shot => ({
  name,
  device,
  ...(locale ? { locale } : {}),
  file: `${name}.${device}${locale ? `.${locale}` : ""}.png`,
  width: 100,
  height: 200,
  bytes: 1,
  version: 1,
});

const shots = [shot("home", "iphone"), shot("home", "iphone", "de"), shot("home", "ipad", "fr"), shot("home", "mac"), shot("list", "ipad"), shot("list", "duo", "de"), shot("menu", "mac", "ja")];

test("a device's own screenshot comes before another language's, and another device's stands in last", () => {
  assert.equal(findShot(shots, "home", "iphone", "de")?.file, "home.iphone.de.png");
  assert.equal(findShot(shots, "home", "iphone", "fr")?.file, "home.iphone.png");
  assert.equal(findShot(shots, "home", "ipad", "en")?.file, "home.ipad.fr.png");
  assert.equal(findShot(shots, "list", "iphone", "de")?.file, "list.duo.de.png");
  assert.equal(findShot(shots, "menu", "iphone")?.file, "menu.mac.ja.png");
  assert.equal(findShot(shots, "gone", "iphone"), undefined);
  assert.equal(findShot(shots, undefined, "iphone"), undefined);
});

test("the Studio's thumbnails pick what the renderer picks", () => {
  // The renderer reaches the function through store.ts; it has to be the very one the Studio bundles.
  assert.equal(storeFindShot, findShot);
});
