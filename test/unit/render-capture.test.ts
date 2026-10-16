import assert from "node:assert/strict";
import { after, test } from "node:test";
import { tmpData } from "../helpers/tmp-data.ts";

// How the reason a page gives for not being drawn reads in the render's error. The module reads the settings when
// src/config.ts is first imported, so it is imported once the environment points at a throwaway directory.

const data = await tmpData("capture");
after(() => data.remove());
process.env.DATA_DIR = data.dir;

const { described } = await import("../../src/render/capture.ts");

test("a screenshot and a font are named; any other reason is passed on as the page gave it", () => {
  assert.match(described("screenshot:home missing"), /^the screenshot "home" is not there any more\./);
  assert.match(described("screenshot:home undecodable"), /^the screenshot "home" could not be read as a picture\./);
  assert.match(described("font:Inter Variable"), /^the font "Inter Variable" did not load/);
  // A page that reports an exception under "font:" names no font.
  assert.equal(described("font:boards is null"), "the page could not be drawn (font:boards is null).");
  assert.equal(described(""), "the page could not be drawn (no reason given).");
});

test("several reasons are said one after the other", () => {
  assert.match(described("screenshot:home missing; font:Lora Variable"), /^the screenshot "home" is not there any more\..* Also, the font "Lora Variable" did not load/);
});
