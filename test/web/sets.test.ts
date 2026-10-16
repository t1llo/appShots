import assert from "node:assert/strict";
import { test } from "node:test";
import type { Slide, StoredImage } from "../../web/src/api.ts";
import { appIcon } from "../../web/src/project/sets.ts";

// Which uploaded image the store preview shows as the app's icon.

const image = (name: string): StoredImage => ({ name, file: `${name}.png`, width: 1024, height: 1024, bytes: 1, version: 1 });
const images = (...names: string[]) => names.sort().map(image);
const slide = (logo?: string): Slide => ({ headline: "A headline", ...(logo ? { logo: { image: logo } } : {}) });

test("an image named as the app's icon is taken, whatever comes before or after the word", () => {
  for (const name of ["icon", "app-icon", "appicon", "app_icon", "icon-1024", "icon2", "my-app-icon-dark"]) {
    assert.equal(appIcon(images("hero", name), [slide()])?.name, name, name);
  }
});

test("a name that only has the letters in it is not an icon", () => {
  for (const name of ["silicon", "icons", "icons-row", "lexicon", "iconic"]) {
    assert.equal(appIcon(images("hero", name), [slide()]), undefined, name);
  }
});

test("an image named just the icon wins over one that is a version of it", () => {
  assert.equal(appIcon(images("icon-dark", "icon"), [slide()])?.name, "icon");
  assert.equal(appIcon(images("app-icon-dark", "app-icon"), [slide()])?.name, "app-icon");
});

test("without an icon, the logo the slides show stands in", () => {
  assert.equal(appIcon(images("logo", "silicon"), [slide(), slide("logo")])?.name, "logo");
  assert.equal(appIcon(images("logo", "icon-1024"), [slide("logo")])?.name, "icon-1024");
  assert.equal(appIcon(images("hero"), [slide()]), undefined);
});
