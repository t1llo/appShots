import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { MODEL_IDS } from "../../src/domain/devices.ts";
import { displayForSize, isPreviewDisplay, PREVIEW_DISPLAYS, PREVIEW_SPECS, type PreviewSpec, previewDevice, previewSize } from "../../src/domain/previews.ts";

// The sizes Apple takes for an app preview, as App Store Connect's help lists them.
const APPLE = {
  iphone: { portrait: [886, 1920], landscape: [1920, 886], record: "iphone-6.9" },
  "iphone-5.5": { portrait: [1080, 1920], landscape: [1920, 1080], record: "iphone-6.9" },
  "iphone-4.7": { portrait: [750, 1334], landscape: [1334, 750], record: "iphone-6.9" },
  ipad: { portrait: [1200, 1600], landscape: [1600, 1200], record: "ipad-13" },
  "ipad-9.7": { portrait: [900, 1200], landscape: [1200, 900], record: "ipad-13" },
  mac: { portrait: null, landscape: [1920, 1080], record: "mac" },
};

const CLI_SPECS = new URL("../../cli/src/video/specs.mjs", import.meta.url);

test("every display a preview is made for has exactly the sizes Apple takes", () => {
  assert.deepEqual([...PREVIEW_DISPLAYS].sort(), Object.keys(APPLE).sort());
  for (const display of PREVIEW_DISPLAYS) {
    const spec: PreviewSpec = PREVIEW_SPECS[display];
    const apple = APPLE[display];
    assert.deepEqual(spec.portrait, apple.portrait, display);
    assert.deepEqual(spec.landscape, apple.landscape, display);
    assert.equal(spec.record, apple.record, display);
  }
});

test("footage is recorded on a device the registry knows", () => {
  for (const display of PREVIEW_DISPLAYS) assert.ok((MODEL_IDS as readonly string[]).includes(PREVIEW_SPECS[display].record), display);
});

test("every size is even and leads back to its display", () => {
  for (const display of PREVIEW_DISPLAYS) {
    for (const orientation of ["portrait", "landscape"] as const) {
      const size = previewSize(display, orientation);
      if (!size) continue;
      assert.equal(size[0] % 2, 0, `${display} ${orientation}`);
      assert.equal(size[1] % 2, 0, `${display} ${orientation}`);
      assert.equal(displayForSize(size[0], size[1], previewDevice(display)), display);
    }
  }
  assert.equal(displayForSize(1920, 1080), "mac", "the size two displays share goes to the one made by default");
  assert.equal(displayForSize(1920, 886), "iphone");
  assert.equal(previewSize("mac", "portrait"), null);
  assert.equal(displayForSize(1290, 2796), null, "a screenshot size is not a preview size");
});

test("a display's captions come from its device's slides", () => {
  assert.equal(previewDevice("iphone-4.7"), "iphone");
  assert.equal(previewDevice("ipad-9.7"), "ipad");
  assert.equal(previewDevice("mac"), "mac");
  assert.equal(isPreviewDisplay("ipad"), true);
  assert.equal(isPreviewDisplay("toString"), false);
});

test("the CLI's copy of the table is the same", { skip: existsSync(CLI_SPECS) ? false : "the CLI has no video specs yet" }, async () => {
  const cli = (await import(CLI_SPECS.href)) as { PREVIEW_SPECS: Record<string, { portrait?: number[] | null; landscape: number[]; record: string }> };
  assert.deepEqual(Object.keys(cli.PREVIEW_SPECS).sort(), [...PREVIEW_DISPLAYS].sort());
  for (const display of PREVIEW_DISPLAYS) {
    const theirs = cli.PREVIEW_SPECS[display];
    const ours: PreviewSpec = PREVIEW_SPECS[display];
    assert.deepEqual(theirs.portrait ?? null, ours.portrait, display);
    assert.deepEqual(theirs.landscape, ours.landscape, display);
    assert.equal(theirs.record, ours.record, display);
  }
});
