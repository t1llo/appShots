import assert from "node:assert/strict";
import { after, test } from "node:test";
import { creativeHtml } from "../../src/creative.ts";
import { FEATURE_LAYOUTS, LAYOUT_IDS, LAYOUT_SHOTS, LAYOUT_SPREAD, SIDE_LAYOUTS } from "../../src/design.ts";
import type { Slide } from "../../src/schema.ts";
import type { PlacementId, TargetId } from "../../src/sizes.ts";
import { createProject, listShots, saveShot, updateProject } from "../../src/store.ts";
import { backgroundLuminance, deviceShape, slideHtml } from "../../src/template.ts";
import { READY_SCRIPT } from "../../src/template/fit.ts";
import { LAYOUT_DEFS } from "../../src/template/layouts/index.ts";
import { directionOf, quoted } from "../../src/template/parts/text.ts";
import { png } from "../helpers/images.ts";
import { tmpData } from "../helpers/tmp-data.ts";

const RENDER = process.env.RENDER_TESTS === "1";
const renderTier = { skip: RENDER ? false : "draws with Chromium; run with RENDER_TESTS=1" };

// Made up for the tests: synthetic projects and one-colour screenshots in a throwaway data directory.
const data = await tmpData("template");
after(() => data.remove());
const { space } = data;

const { id } = await createProject(space, { name: "Template", locales: ["en", "ar"] });
await saveShot(space, id, "home", await png(1320, 2868), "iphone");
await saveShot(space, id, "wide", await png(2868, 1320), "iphone");
await saveShot(space, id, "classic", await png(1242, 2208), "iphone");
await saveShot(space, id, "home", await png(2064, 2752), "ipad");
await saveShot(space, id, "tablet", await png(2064, 2752), "ipad");
const shots = await listShots(space, id);

/** Every slide of the set, drawn for one size and one language. */
async function draw(slides: Slide[], target: TargetId = "iphone-6.9", locale = "en"): Promise<string[]> {
  const project = await updateProject(space, id, { slides });
  return Promise.all(slides.map((_, index) => slideHtml({ space, project, shots, index, target, locale, images: [] })));
}

/** The class and inline style of each device on a page, in the order they are drawn. */
const devices = (html: string) => [...html.matchAll(/<div class="device ([^"]*)"[^>]* style="([^"]*)"/g)].map((match) => ({ classes: match[1]!, style: match[2]! }));

test("the layout table keeps every layout's old settings", () => {
  assert.deepEqual(LAYOUT_IDS, ["device-bottom", "device-top", "device-center", "tilted", "closeup", "floating", "duo", "side-by-side", "trio", "device-right", "device-left", "hero", "features", "statement", "stat", "steps", "reviews"]);
  assert.deepEqual(LAYOUT_SHOTS, { "device-bottom": 1, "device-top": 1, "device-center": 1, tilted: 1, closeup: 1, floating: 1, duo: 2, "side-by-side": 2, trio: 3, "device-right": 1, "device-left": 1, hero: 1, features: 0, statement: 0, stat: 0, steps: 0, reviews: 0 });
  assert.deepEqual(SIDE_LAYOUTS, ["device-right", "device-left"]);
  assert.deepEqual(FEATURE_LAYOUTS, ["features", "stat", "steps"]);
  assert.deepEqual(LAYOUT_SPREAD, { duo: 11, "side-by-side": 0, trio: 14 });
  const widths = Object.fromEntries(LAYOUT_IDS.map((layout) => [layout, LAYOUT_DEFS[layout].width]));
  assert.deepEqual(widths, { "device-bottom": 1, "device-top": 1, "device-center": 1, tilted: 1.04, closeup: 1.42, floating: 0.92, duo: 0.7, "side-by-side": 0.52, trio: 0.6, "device-right": 0.7, "device-left": 0.7, hero: 0.9, features: 1, statement: 1, stat: 1, steps: 1, reviews: 1 });
  const copyMax = Object.fromEntries(LAYOUT_IDS.map((layout) => [layout, LAYOUT_DEFS[layout].copyMax]));
  assert.deepEqual(copyMax, { "device-bottom": 0.34, "device-top": 0.34, "device-center": 0.36, tilted: 0.34, closeup: 0.34, floating: 0.36, duo: 0.32, "side-by-side": 0.32, trio: 0.32, "device-right": 0.84, "device-left": 0.84, hero: 0.48, features: 0.3, statement: 0.84, stat: 0.28, steps: 0.28, reviews: 0.3 });
});

test("the same slide comes out the same every time it is drawn", async () => {
  const slides: Slide[] = [
    { layout: "device-bottom", headline: "Sketched", screenshot: "home", device: { style: "sketch" } },
    { layout: "duo", headline: "Two sketches", screenshot: "home", screenshot2: "home", device: { style: "sketch" } },
    { layout: "features", headline: "Cards", features: [{ icon: "bolt", title: "Fast" }, { icon: "star", title: "Loved" }], featureCards: { icons: "gradient" } },
  ];
  const first = await draw(slides);
  const second = await draw(slides);
  assert.deepEqual(second, first);
  // Each page numbers its own pen strokes from one, however many pages were drawn before it.
  assert.match(first[0]!, /id="pen-1"/);
  assert.match(first[1]!, /id="pen-1"[\s\S]*id="pen-2"/);
});

test("a slide is drawn for every layout, in its language", async () => {
  const slides: Slide[] = LAYOUT_IDS.map((layout) => ({
    layout,
    headline: "Every layout",
    screenshot: "home",
    screenshot2: "home",
    screenshot3: "home",
    features: [{ icon: "bolt", title: "One" }],
    badges: [{ type: "review", title: "Lovely", subtitle: "Someone" }],
  }));
  // A set holds ten slides at most.
  for (const part of [slides.slice(0, 9), slides.slice(9)]) {
    for (const html of await draw(part)) assert.match(html, /^<!doctype html>\n<html lang="en">/);
    for (const html of await draw(part, "iphone-6.9", "ar")) assert.match(html, /^<!doctype html>\n<html lang="ar" dir="rtl">/);
  }
});

test("languages written from right to left are told apart by their code", () => {
  for (const locale of ["ar", "he", "fa", "ur", "ar-SA", "HE"]) assert.equal(directionOf(locale), "rtl", locale);
  for (const locale of ["en", "de-DE", "ja", "zh-Hans"]) assert.equal(directionOf(locale), "ltr", locale);
});

test("a group of devices is mirrored on a page read from right to left", async () => {
  const slides: Slide[] = [{ layout: "side-by-side", screenshot: "home", screenshot2: "classic", device: { spread: 10 } }];
  const [ltr] = await draw(slides);
  const [rtl] = await draw(slides, "iphone-6.9", "ar");
  const left = devices(ltr!).map((device) => device.style.match(/margin-left:calc\(var\(--dw\)\*(-?[\d.]+)/)![1]);
  const right = devices(rtl!).map((device) => device.style.match(/margin-left:calc\(var\(--dw\)\*(-?[\d.]+)/)![1]);
  // The first screenshot stands where a reader of the language starts: on the left in English, on the right in Arabic.
  assert.deepEqual(left, ["-1.03", "0.03"]);
  assert.deepEqual(right, ["0.03", "-1.03"]);
  assert.match(devices(ltr!)[0]!.style, /rotate\(-5deg\)/);
  assert.match(devices(rtl!)[0]!.style, /rotate\(5deg\)/);
});

test("the reviews layout keeps its review badges out of the copy", async () => {
  const reviews = Array.from({ length: 8 }, (_, i) => ({ type: "review" as const, title: `Review ${i + 1}`, subtitle: "Someone" }));
  const [html] = await draw([{ layout: "reviews", headline: "Loved", badges: [...reviews, { type: "pill", title: "Editors' Choice" }] }]);
  assert.equal(html!.match(/class="rv-card/g)?.length, 6);
  // The seventh and eighth reviews have no room on the wall, and the copy is no place for them either.
  assert.doesNotMatch(html!, /Review 7|Review 8/);
  assert.match(html!, /class="badges bottom"><div class="badge pill/);
});

test("cards and a list take the four columns they are given", async () => {
  const features = Array.from({ length: 8 }, (_, i) => ({ icon: "star" as const, title: `Feature ${i + 1}` }));
  const [cards, list] = await draw([
    { layout: "features", headline: "Cards", features, featureStyle: "cards", featureCards: { columns: 4 } },
    { layout: "features", headline: "List", features, featureStyle: "list", featureCards: { columns: 4 } },
  ]);
  for (const html of [cards!, list!]) assert.match(html, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test("a quote is set in the quotation marks of its language", () => {
  assert.equal(quoted("Great app", "en"), "“Great app”");
  assert.equal(quoted("Tolle App", "de-DE"), "„Tolle App“");
  assert.equal(quoted("رائع", "ar"), "«رائع»");
  // French keeps its guillemets on the line of the words they hold, with narrow spaces that do not break.
  assert.equal(quoted("Super", "fr-FR"), "«\u202FSuper\u202F»");
  assert.equal(quoted("すごい", "ja"), "「すごい」");
  assert.equal(quoted("“Already quoted”", "de"), "“Already quoted”");
  assert.equal(quoted("", "en"), "");
});

test("a solid background is judged by the one colour it paints", () => {
  // A solid background lists more colours when it was a gradient before; only the first is drawn.
  assert.ok(backgroundLuminance({ type: "solid", colors: ["#000000", "#FFFFFF"] }) < 0.01);
  assert.ok(backgroundLuminance({ type: "solid", colors: ["#FFFFFF", "#000000"] }) > 0.99);
  assert.equal(backgroundLuminance({ type: "gradient", colors: ["#000000", "#FFFFFF"] }), 0.5);
});

test("a landscape screenshot is drawn in a device on its side", () => {
  const wide = shots.find((shot) => shot.name === "wide")!;
  const shape = deviceShape(wide, {}, "iphone");
  assert.equal(shape.turned, true);
  assert.equal(shape.aspect, "2868/1320");
  assert.ok(shape.ratio < 0.5 && shape.ratio > 0.45, String(shape.ratio));
  const upright = deviceShape(shots.find((shot) => shot.name === "home" && shot.device === "iphone"), {}, "iphone");
  assert.equal(upright.turned, false);
  assert.ok(upright.ratio > 2);
  // The bezels shrink with the width, which is now the long side.
  assert.ok(shape.geometry.bezel < upright.geometry.bezel);
});

test("an iPhone with a home button gets its own frame", async () => {
  const classic = shots.find((shot) => shot.name === "classic")!;
  assert.equal(deviceShape(classic, {}, "iphone").model, "iphone-home");
  const [plain, landscape] = await draw([
    { layout: "device-bottom", screenshot: "classic" },
    { layout: "device-bottom", screenshot: "wide" },
  ]);
  const [device] = devices(plain!);
  assert.match(device!.classes, /^iphone home\b/);
  assert.match(device!.style, /--bezy:0\.235/);
  assert.match(plain!, /<i class="speaker"><\/i><i class="home-btn"><\/i>/);
  assert.doesNotMatch(plain!, /class="island"/);
  assert.match(devices(landscape!)[0]!.classes, /^iphone land\b/);
  assert.match(landscape!, /class="btn b" style="left:/);
});

test("what a slide names and nobody uploaded is drawn as a placeholder or left out", async () => {
  const [device, features] = await draw([
    { layout: "device-bottom", screenshot: "nowhere", logo: { image: "gone" }, images: [{ image: "lost" }] },
    { layout: "features", features: [{ title: "Pictured", screenshot: "absent" }, { title: "Drawn", image: "lost" }] },
  ]);
  assert.match(device!, /<div class="placeholder"><span>Upload a screenshot named<br><b>nowhere<\/b>/);
  assert.doesNotMatch(device!, /class="logo|<img/);
  assert.doesNotMatch(features!, /<img/);
});

test("an asset is looked up only among the project's own", async () => {
  const project = await updateProject(space, id, { creatives: {} });
  for (const placement of ["header", "constructor", "__proto__"]) {
    await assert.rejects(creativeHtml({ space, project, shots, placement: placement as PlacementId, locale: "en", images: [] }), (error: Error) => error.constructor === Error);
  }
});

test("phones and tablets in one asset stand equally tall", async () => {
  const width = (device: { style: string }) => Number(device.style.match(/--dw:([\d.]+)px/)![1]);
  const draw = async (screenshots: string[]) => {
    const project = await updateProject(space, id, { creatives: { header: { layout: "fan", screenshots } } });
    return devices(await creativeHtml({ space, project, shots, placement: "header", locale: "en", images: [] }));
  };
  // Two iPhones share one width, whatever their screens.
  const phones = await draw(["home", "classic"]);
  assert.equal(width(phones[0]!), width(phones[1]!));
  // An iPhone and an iPad: the tablet is wider, and as tall as the phone.
  const mixed = await draw(["home", "tablet"]);
  const ratios = [shots.find((shot) => shot.name === "home" && shot.device === "iphone"), shots.find((shot) => shot.name === "tablet")].map((shot) => deviceShape(shot, {}, "iphone").ratio);
  assert.ok(width(mixed[1]!) > width(mixed[0]!));
  assert.ok(Math.abs(width(mixed[0]!) * ratios[0]! - width(mixed[1]!) * ratios[1]!) < 1);
});

test("a page says when it is ready, and what it could not show", renderTier, async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const state = async (html: string) => {
      await page.setContent(html);
      await page.waitForFunction(() => document.body.dataset.ready);
      return page.evaluate(() => ({ ready: document.body.dataset.ready, error: document.body.dataset.error ?? null }));
    };
    const pages = await draw([
      { layout: "statement", headline: "Ready" },
      // Names nothing was uploaded under are drawn as placeholders or left out, which the render has warned about already.
      { layout: "device-bottom", headline: "Placeholder", screenshot: "nowhere", logo: { image: "gone" }, images: [{ image: "lost" }] },
      { layout: "features", features: [{ title: "Pictured", screenshot: "absent" }, { title: "Drawn", image: "lost" }] },
    ]);
    for (const html of pages) assert.deepEqual(await state(html), { ready: "1", error: null });
    const broken = await state(`<body><img src="/files/none/shots/home.png" alt="" data-shot="home"><script>${READY_SCRIPT}</script></body>`);
    assert.equal(broken.ready, "error");
    assert.match(broken.error!, /^screenshot:home (missing|undecodable)$/);
  } finally {
    await browser.close();
  }
});

test("a long stat figure stays inside its box's padding", renderTier, async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const align of ["center", "left"] as const) {
      const [html] = await draw([{ layout: "stat", headline: "Saved", align, features: [{ value: "1,234,567,890+", title: "Hours" }] }]);
      await page.setContent(html!);
      await page.waitForFunction(() => document.body.dataset.ready);
      const room = await page.evaluate(() => {
        const box = document.querySelector<HTMLElement>(".stat")!;
        const style = getComputedStyle(box);
        const figure = document.querySelector<HTMLElement>(".st-value")!;
        return { inner: box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), figure: figure.scrollWidth };
      });
      assert.ok(room.figure <= room.inner, `${align}: ${room.figure} > ${room.inner}`);
    }
  } finally {
    await browser.close();
  }
});
