import assert from "node:assert/strict";
import { test } from "node:test";
import { artboardsOf, type Draft, layerPage, type LocaleCopy, plain, touchSize } from "../../src/video/cards.ts";
import { MAX_CAPTIONS, MAX_LANGUAGES, normaliseRequest, videoLayersBody, type VideoLayersBody } from "../../src/video/request.ts";

// What a request for video layers settles to before anything is looked up or drawn, and the page each language's
// layers are drawn from.

const project = { locales: ["en", "de", "ar"] };
const settle = (body: VideoLayersBody) => normaliseRequest(project, videoLayersBody.parse(body));
const refused = (body: unknown) => !videoLayersBody.safeParse(body).success;

test("a display settles to Apple's size for it and the slides it is cut from", () => {
  const cases: [VideoLayersBody, [number, number], string | null, string][] = [
    [{ display: "iphone" }, [886, 1920], "iphone", "iphone"],
    [{ display: "iphone", orientation: "landscape" }, [1920, 886], "iphone", "iphone"],
    [{ display: "iphone-4.7" }, [750, 1334], "iphone-4.7", "iphone"],
    [{ display: "ipad-9.7", orientation: "landscape" }, [1200, 900], "ipad-9.7", "ipad"],
    [{ display: "mac" }, [1920, 1080], "mac", "mac"],
    [{ display: "mac", size: [1920, 1080] }, [1920, 1080], "mac", "mac"],
    // A size names its display when Apple has one of it, and otherwise takes the slides of its shape.
    [{ size: [1920, 1080] }, [1920, 1080], "mac", "mac"],
    [{ size: [1600, 1200] }, [1600, 1200], "ipad", "ipad"],
    [{ size: [1000, 800] }, [1000, 800], null, "mac"],
    [{ size: [800, 1000], orientation: "portrait" }, [800, 1000], null, "iphone"],
  ];
  for (const [body, size, display, device] of cases) {
    const request = settle(body);
    assert.deepEqual([request.size, request.display, request.device], [size, display, device], JSON.stringify(body));
  }
});

test("a size that does not go with its display or orientation is refused with both named", () => {
  assert.throws(() => settle({}), /Give the display/);
  assert.throws(() => settle({ display: "mac", orientation: "portrait" }), /A Mac preview is landscape only/);
  assert.throws(() => settle({ display: "iphone", size: [1080, 1920] }), /886×1920, not 1080×1920/);
  assert.throws(() => settle({ display: "iphone", orientation: "landscape", size: [886, 1920] }), /landscape .* is 1920×886/);
  assert.throws(() => settle({ size: [1000, 800], orientation: "portrait" }), /1000×800 is not portrait/);
});

test("what is left out is filled in, and small print is asked for once", () => {
  const request = settle({ display: "iphone", captions: [{ id: "a", text: "A" }], intro: {}, outro: { disclosure: ["iap", "subscription", "iap"] } });
  assert.deepEqual(request.locales, ["en", "de", "ar"]);
  assert.equal(request.captionStyle, "panel");
  assert.deepEqual(request.captions, [{ id: "a", text: "A", position: "top" }]);
  assert.deepEqual(request.intro, { logo: true });
  assert.deepEqual(request.outro, { lines: [], logo: true, disclosure: ["iap", "subscription"] });
  assert.equal(request.plate, true);
  assert.equal(request.touch, false);

  const none = settle({ display: "iphone", locales: ["de"], intro: false, outro: false, plate: false, touch: true });
  assert.deepEqual([none.locales, none.intro, none.outro, none.plate, none.touch], [["de"], null, null, false, true]);
  assert.throws(() => settle({ display: "iphone", locales: ["fr"] }), /no language "fr"/);
  // Languages come in the project's order whatever order they were asked in, each once.
  assert.deepEqual(settle({ display: "iphone", locales: ["ar", "EN", "de-DE", "en"] }).locales, ["en", "de", "ar"]);
});

test("the body has limits, and takes a plan's card timing as it is", () => {
  const caption = (id: string) => ({ id, text: "Copy" });
  assert.equal(refused({ display: "iphone", captions: Array.from({ length: MAX_CAPTIONS }, (_, i) => caption(`c${i}`)) }), false);
  assert.equal(refused({ display: "iphone", captions: Array.from({ length: MAX_CAPTIONS + 1 }, (_, i) => caption(`c${i}`)) }), true);
  assert.equal(refused({ display: "iphone", captions: [caption("same"), caption("same")] }), true, "an id twice");
  assert.equal(refused({ display: "iphone", captions: [caption("Plan!")] }), true, "an id the files cannot be named by");
  assert.equal(refused({ display: "iphone", captions: [{ id: "a", text: "" }] }), true, "empty copy");
  assert.equal(refused({ display: "iphone", captions: [{ id: "a", text: { slide: 11 } }] }), true, "a slide past ten");
  assert.equal(refused({ display: "iphone", captions: [{ id: "a", text: { slide: 1, field: "title" } }] }), true, "a field slides do not have");
  assert.equal(refused({ size: [887, 1920] }), true, "an odd size");
  assert.equal(refused({ size: [300, 1920] }), true, "too small");
  assert.equal(refused({ size: [886, 4000] }), true, "too large");
  assert.equal(refused({ display: "iphone-6.9" }), true, "a screenshot size is no preview display");
  assert.equal(refused({ display: "iphone", locales: Array.from({ length: MAX_LANGUAGES + 1 }, () => "en") }), true);
  assert.equal(refused({ display: "iphone", outro: { lines: ["a", "b", "c", "d"] } }), true, "four outro lines");
  assert.equal(refused({ display: "iphone", outro: { disclosure: ["ads"] } }), true);
  assert.equal(refused({ display: "iphone", music: true }), true, "a key it does not know");
  assert.equal(refused({ display: "iphone", intro: { seconds: 2.5, headline: { slide: 1 } }, outro: { seconds: 3, lines: [{ en: "Get it", de: "Hol sie dir" }] } }), false);
  assert.equal(refused({ display: "iphone", intro: { seconds: 11 } }), true);
  assert.equal(refused({ display: "iphone", intro: true }), true, "true is not a card");
});

const copy = (text: string): LocaleCopy => ({
  captions: [
    { id: "plan", position: "top", text: { text } },
    { id: "share", position: "bottom", text: { text: "Share", from: "en" } },
  ],
  intro: { headline: { text }, logo: false },
  outro: { lines: [{ text: "Get it" }, { text: "Free" }], logo: false, disclosure: [{ text: "Offers in-app purchases." }] },
});

const draft = (over: Partial<Draft> = {}): Draft => ({
  projectId: "layers",
  size: [886, 1920],
  display: "iphone",
  captionStyle: "panel",
  style: { font: "inter", text: "#FFFFFF", accent: "#F59E0B", emphasis: "tint", background: { type: "solid", colors: ["#101828"] } },
  logo: null,
  plate: true,
  touch: true,
  locales: ["en", "ar"],
  copy: { en: copy("Plan your *week*"), ar: copy("خطط *أسبوعك*") },
  warnings: [],
  ...over,
});

test("the layers every language shares are drawn on the first language's page only", () => {
  const en = artboardsOf(draft(), "en");
  assert.deepEqual(
    en.map((board) => [board.id, board.locale, board.width, board.height, board.opaque]),
    [
      ["plate", null, 886, 1920, true],
      ["caption-plan", "en", 886, 1920, false],
      ["caption-share", "en", 886, 1920, false],
      ["intro-text", "en", 886, 1920, false],
      ["outro-text", "en", 886, 1920, false],
      ["touch", null, 80, 80, false],
    ],
  );
  assert.deepEqual(
    artboardsOf(draft(), "ar").map((board) => board.id),
    ["caption-plan", "caption-share", "intro-text", "outro-text"],
  );
  assert.deepEqual(
    artboardsOf(draft({ plate: false, touch: false }), "en").map((board) => board.kind),
    ["caption", "caption", "intro-text", "outro-text"],
  );
  assert.deepEqual(artboardsOf(draft(), "fr"), []);
  assert.equal(touchSize([1920, 1080]), 98);
  assert.equal(touchSize([886, 1920]) % 2, 0);
});

test("a language's page is set in its direction, escapes its copy and gives each artboard its size", () => {
  const ar = layerPage(draft(), "ar", "Layers");
  assert.match(ar, /<html lang="ar" dir="rtl">/);
  assert.equal((ar.match(/<section class="ab /g) ?? []).length, 4);
  assert.ok(!ar.includes('data-layer="plate"'), "the plate is on the first page");

  const en = layerPage(draft({ copy: { en: copy('Plan <b>"bold"</b> & *week*'), ar: copy("x") } }), "en", "Layers");
  assert.match(en, /<html lang="en">/);
  assert.ok(!en.includes("<b>"), "copy is escaped");
  assert.match(en, /&lt;b&gt;/);
  assert.match(en, /<em>week<\/em>/);
  assert.match(en, /data-layer="touch" data-kind="touch" style="width:80px;height:80px"/);
  assert.match(en, /data-layer="caption-share" data-kind="caption" style="width:886px;height:1920px"/);
  assert.match(en, /class="ab cap-board style-panel at-bottom em-tint"/);
  // A card shows the part of its own layer and keeps the rest of the card's layout.
  assert.match(en, /data-layer="outro-text"[^>]*><div class="card"><div class="card-copy" data-box><p class="headline card-line"/);
  assert.match(en, /<p class="card-print" data-fit="2">Offers in-app purchases\.<\/p>/);

  const shadow = layerPage(draft({ captionStyle: "shadow" }), "en", "Layers");
  assert.match(shadow, /style-shadow at-top em-tint" data-layer="caption-plan" data-kind="caption" style="width:886px;height:1920px;--text:#FFFFFF"/);
});

test("the manifest's copy is the text without its emphasis marks", () => {
  assert.equal(plain("Plan your *week*, then *share* it"), "Plan your week, then share it");
  assert.equal(plain("5 * 3 = 15"), "5 * 3 = 15");
});
