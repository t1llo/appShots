import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "../../web/src/editor/check.ts";
import { arrowMove } from "../../web/src/ui/keys.ts";

test("the arrow keys move along a row or a column and wrap round", () => {
  assert.equal(arrowMove("ArrowRight", 0, 3, "row"), 1);
  assert.equal(arrowMove("ArrowRight", 2, 3, "row"), 0);
  assert.equal(arrowMove("ArrowLeft", 0, 3, "row"), 2);
  assert.equal(arrowMove("ArrowDown", 1, 3, "column"), 2);
  assert.equal(arrowMove("ArrowUp", 0, 3, "column"), 2);
  assert.equal(arrowMove("ArrowDown", 0, 3, "both"), 1);
  // Nothing focused yet: forward starts at the first, back at the last.
  assert.equal(arrowMove("ArrowDown", -1, 3, "column"), 0);
  assert.equal(arrowMove("ArrowUp", -1, 3, "column"), 2);
});

test("Home and End go to the ends, and other keys and directions are left alone", () => {
  assert.equal(arrowMove("Home", 2, 3, "row"), 0);
  assert.equal(arrowMove("End", 0, 3, "column"), 2);
  assert.equal(arrowMove("ArrowDown", 0, 3, "row"), null);
  assert.equal(arrowMove("ArrowLeft", 0, 3, "column"), null);
  assert.equal(arrowMove("Enter", 0, 3, "both"), null);
  assert.equal(arrowMove("Home", -1, 0, "row"), null);
});

test("JSON for a slide is checked the way the server checks it", () => {
  const refused = check("slide", { layout: "nope", headline: "x" });
  assert.ok("error" in refused);
  assert.match(refused.error, /layout/);
  const taken = check("slide", { layout: "hero", headline: { "en-US": "Track", "de-DE": "Verfolge" } });
  assert.deepEqual(taken, { item: { layout: "hero", headline: { "en-US": "Track", "de-DE": "Verfolge" } } });
});

test("JSON for an asset is checked against the asset's own fields", () => {
  assert.ok("error" in check("creative", { layout: "device-bottom" }));
  assert.ok("item" in check("creative", { headline: "Track every habit" }));
});
