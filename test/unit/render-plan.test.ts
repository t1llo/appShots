import assert from "node:assert/strict";
import { test } from "node:test";
import { drawnAt, MAX_LOCALES, planRender, resolveLocales } from "../../src/render/plan.ts";
import { type Project, projectSchema } from "../../src/schema.ts";
import { TARGET_IDS, TARGETS, type TargetId } from "../../src/sizes.ts";
import type { Shot } from "../../src/store.ts";

// What a render will draw, worked out without a browser: which languages, which passes of the browser, and what
// each set looks like, so a set drawn from an older design can be told apart.

function project(fields: Record<string, unknown> = {}): Project {
  const now = new Date().toISOString();
  return projectSchema.parse({ id: "plan", name: "Plan", createdAt: now, updatedAt: now, locales: ["en"], theme: {}, slides: [{ layout: "statement", headline: "One" }], deviceSlides: {}, creatives: {}, ...fields });
}

const shot = (name: string, fields: Partial<Shot> = {}): Shot => ({ name, device: "iphone", file: `${name}.iphone.png`, width: 1320, height: 2868, bytes: 1, version: 1, ...fields });

test("languages are matched to the project's own codes, each once", () => {
  const de = project({ locales: ["en-US", "de-DE", "fr"] });
  assert.deepEqual(resolveLocales(de, undefined), ["en-US", "de-DE", "fr"]);
  assert.deepEqual(resolveLocales(de, ["DE-de", "de", "en-us", "fr-CA"]), ["de-DE", "en-US", "fr"]);
});

test("a language the project does not have is refused with the ones it has", () => {
  assert.throws(() => resolveLocales(project({ locales: ["en", "de"] }), ["en", "ja"]), /no language "ja"\. Its languages are en, de\. Add "ja"/);
});

test(`a render takes up to ${MAX_LOCALES} languages`, () => {
  // Counted as asked for: a list that long is refused before it is looked at.
  assert.throws(() => resolveLocales(project({ locales: ["en"] }), Array(MAX_LOCALES + 1).fill("en")), new RegExp(`up to ${MAX_LOCALES} languages`));
  assert.deepEqual(resolveLocales(project({ locales: ["en"] }), Array(MAX_LOCALES).fill("en")), ["en"]);
});

test("only a size of exactly the same shape is a scaled copy", () => {
  for (const id of TARGET_IDS) {
    const from = drawnAt(id);
    const [a, b] = [TARGETS[id], TARGETS[from]];
    assert.equal(a.device, b.device, id);
    assert.equal(a.width * b.height, a.height * b.width, `${id} is drawn at ${from}`);
  }
  // Each iPhone size Apple asks for has a shape of its own.
  for (const id of ["iphone-6.9", "iphone-6.3", "iphone-6.5", "iphone-6.1", "iphone-5.5", "iphone-4.7", "iphone-4", "ipad-12.9"] as TargetId[]) assert.equal(drawnAt(id), id);
  assert.equal(drawnAt("ipad-10.5"), "ipad-13");
  assert.equal(drawnAt("ipad-9.7"), "ipad-13");
  assert.equal(drawnAt("mac-1280"), "mac-2880");
});

test("sizes of one shape share a pass, and each device gets one contact sheet", () => {
  const plan = planRender(project({ targets: ["iphone-6.9", "iphone-6.5", "ipad-13", "ipad-10.5", "ipad-12.9"] }), [], [], {});
  assert.deepEqual(
    plan.passes.map((pass) => [pass.source, pass.targets, pass.sheet]),
    [
      ["iphone-6.9", ["iphone-6.9"], true],
      ["iphone-6.5", ["iphone-6.5"], false],
      ["ipad-13", ["ipad-13", "ipad-10.5"], true],
      ["ipad-12.9", ["ipad-12.9"], false],
    ],
  );
  // A scaled size asked for alone is still drawn at the size it copies, and that one is not written.
  const alone = planRender(project({ targets: ["ipad-9.7"] }), [], [], {});
  assert.deepEqual(alone.passes.map((pass) => [pass.source, pass.targets]), [["ipad-13", ["ipad-9.7"]]]);
});

test("a render of some slides is partial, and one of everything clears old sizes", () => {
  const slides = ["One", "Two", "Three"].map((headline) => ({ layout: "statement", headline }));
  const some = planRender(project({ slides }), [], [], { slides: [2, 0, 2] });
  assert.deepEqual(some.passes[0]!.indexes, [0, 2]);
  assert.equal(some.passes[0]!.full, false);
  assert.equal(some.passes[0]!.count, 3);
  assert.equal(some.cleanup, false);
  const all = planRender(project({ slides }), [], [], {});
  assert.equal(all.passes[0]!.full, true);
  assert.equal(all.cleanup, true);
  assert.equal(planRender(project({ slides }), [], [], { locales: ["en"] }).cleanup, false);
  assert.throws(() => planRender(project({ slides }), [], [], { slides: [3] }), /Slide 4 does not exist/);
});

test("the design of a language changes with its own words only", () => {
  const base = { locales: ["en", "de"], slides: [{ layout: "device-bottom", headline: { en: "Hello", de: "Hallo" }, screenshot: "home" }] };
  const designs = (fields: Record<string, unknown>, shots = [shot("home")]) => planRender(project({ ...base, ...fields }), shots, [], {}).designs;
  const before = designs({});
  assert.deepEqual(Object.keys(before).sort(), ["de iphone", "en iphone"]);
  const german = designs({ slides: [{ ...base.slides[0], headline: { en: "Hello", de: "Servus" } }] });
  assert.equal(german["en iphone"], before["en iphone"]);
  assert.notEqual(german["de iphone"], before["de iphone"]);
  // A screenshot uploaded again is a new design for every language that shows it.
  const replaced = designs({}, [shot("home", { version: 2 })]);
  assert.notEqual(replaced["en iphone"], before["en iphone"]);
  assert.notEqual(replaced["de iphone"], before["de iphone"]);
  assert.deepEqual(designs({}), before);
});

test("the screenshots a render reads are the variants its languages show", () => {
  const shots = [shot("home"), shot("home", { locale: "de", file: "home.de.iphone.png" }), shot("other")];
  const plan = planRender(project({ locales: ["en", "de"], slides: [{ layout: "device-bottom", headline: "Hi", screenshot: "home" }] }), shots, [], {});
  assert.deepEqual(plan.shots.map((each) => each.file).sort(), ["home.de.iphone.png", "home.iphone.png"]);
});
