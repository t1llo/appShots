import assert from "node:assert/strict";
import { test } from "node:test";
import { type FitReport, findPhrases, fitSummary, lineLimit, lintCreative, lintFit, lintSlide, lintTexts, readFit, SCALE_LIMIT } from "../../src/domain/lint.ts";
import { creativeSchema, slideSchema } from "../../src/schema.ts";

// What a set breaks of the rules App Review applies to store images, and how its copy came out once fitted.

const slide = (fields: Record<string, unknown>) => slideSchema.parse(fields);
const creative = (fields: Record<string, unknown>) => creativeSchema.parse(fields);
const rules = (text: string) => findPhrases(text).map(({ rule, match }) => `${rule}: ${match}`);

test("Apple's own recognitions are found in the languages the store shows them in", () => {
  assert.deepEqual(rules("Editors’ Choice"), ["apple-recognition: Editors’ Choice"]);
  assert.deepEqual(rules("Editor's choice 2025"), ["apple-recognition: Editor's choice"]);
  assert.deepEqual(rules("An *App of the Day*"), ["apple-recognition: App of the Day"]);
  assert.deepEqual(rules("Apple Design Award finalist"), ["apple-recognition: Apple Design Award"]);
  assert.deepEqual(rules("App des Tages"), ["apple-recognition: App des Tages"]);
  assert.deepEqual(rules("App du jour"), ["apple-recognition: App du jour"]);
  assert.deepEqual(rules("The app of the dayly planner"), []);
});

test("a price, a discount and a claim that it costs nothing are found", () => {
  assert.deepEqual(rules("Only $4.99"), ["price: $4.99"]);
  assert.deepEqual(rules("Nur 4,99 €"), ["price: 4,99 €"]);
  assert.deepEqual(rules("50% off this week"), ["price: 50% off"]);
  assert.deepEqual(rules("19 USD a year"), ["price: 19 USD"]);
  assert.deepEqual(rules("Free"), ["free: Free"]);
  assert.deepEqual(rules("Try it free"), ["free: free"]);
  assert.deepEqual(rules("Kostenlos testen"), ["free: Kostenlos"]);
  assert.deepEqual(rules("無料で始める"), ["free: 無料"]);
});

test("free in its other senses, and figures that are no price, pass", () => {
  for (const text of ["Ad-free", "Hands-free calls", "Feel free to explore", "Free up space", "Free of tracking", "Your free time", "100% private", "Save 5 minutes a day", "24/7 support", "C# and Swift", "Track 3 habits"]) {
    assert.deepEqual(findPhrases(text), [], text);
  }
});

test("rankings and dates are found, a bare figure is not", () => {
  assert.deepEqual(rules("#1 budget app"), ["ranking: #1"]);
  assert.deepEqual(rules("No. 1 in Germany"), ["ranking: No. 1"]);
  assert.deepEqual(rules("Top-rated by readers"), ["ranking: Top-rated"]);
  assert.deepEqual(rules("Platz 1 der Charts"), ["ranking: Platz 1"]);
  assert.deepEqual(rules("New in 2026"), ["date: in 2026"]);
  assert.deepEqual(rules("Since 2019"), ["date: Since 2019"]);
  assert.deepEqual(rules("The 2026 edition"), ["date: 2026 edition"]);
  assert.deepEqual(rules("Out on March 3rd"), ["date: March 3rd"]);
  assert.deepEqual(rules("Ab 3. März"), ["date: 3. März"]);
  assert.deepEqual(rules("2048 colours"), []);
  assert.deepEqual(rules("May the plan hold"), []);
});

test("a slide is checked in each language, with the field and the words found", () => {
  const found = lintSlide(slide({ headline: { en: "App of the Day", de: "App des Tages", fr: "Une app calme" }, badges: [{ title: "4.9", subtitle: { en: "Free", de: "Gratis", fr: "Note" } }] }), { slide: 1 }, ["en", "de", "fr"], "en");
  assert.deepEqual(
    found.map(({ rule, locale, slide, field, match }) => ({ rule, locale, slide, field, match })),
    [
      { rule: "apple-recognition", locale: "en", slide: 1, field: "headline", match: "App of the Day" },
      { rule: "free", locale: "en", slide: 1, field: "badges[0].subtitle", match: "Free" },
      { rule: "apple-recognition", locale: "de", slide: 1, field: "headline", match: "App des Tages" },
      { rule: "free", locale: "de", slide: 1, field: "badges[0].subtitle", match: "Gratis" },
    ],
  );
  assert.match(found[0]!.text, /^Slide 2 \(en\): the headline names "App of the Day", one of Apple's own recognitions\./);
});

test("a language without its own copy is checked in the copy it falls back to", () => {
  const found = lintSlide(slide({ headline: { en: "Free forever" } }), { slide: 0 }, ["en", "de-DE"], "en");
  assert.deepEqual(found.map((warning) => warning.locale), ["en", "de-DE"]);
});

test("logos: Apple's and other platforms' anywhere, a brand where it reads as an endorsement", () => {
  const logos = (fields: Record<string, unknown>) => lintSlide(slide(fields), { slide: 0 }, ["en"], "en").map(({ rule, field, match, locale }) => ({ rule, field, match, locale }));
  assert.deepEqual(logos({ iconRow: { icons: ["slack", "notion"], label: "Works with" } }), []);
  assert.deepEqual(logos({ iconRow: { icons: ["slack", "notion", "google-play", "apple"] } }), [
    { rule: "apple-artwork", field: "iconRow", match: "apple", locale: undefined },
    { rule: "other-platform", field: "iconRow", match: "google-play", locale: undefined },
    { rule: "third-party-logo", field: "iconRow", match: "slack,notion", locale: undefined },
  ]);
  assert.deepEqual(logos({ badges: [{ title: "Top 10", icon: "spotify" }] }), [{ rule: "third-party-logo", field: "badges[0].icon", match: "spotify", locale: undefined }]);
  assert.deepEqual(logos({ features: [{ title: "Syncs your playlists", icon: "spotify" }, { title: "On Android too", icon: "android" }] }), [
    { rule: "other-platform", field: "features[1].icon", match: "android", locale: undefined },
  ]);
  assert.deepEqual(logos({ features: [{ title: "Private", icon: "lock" }] }), []);
  const said = lintSlide(slide({ iconRow: { icons: ["slack", "github"] } }), { slide: 0 }, ["en"], "en")[0]!.text;
  assert.match(said, /^Slide 1: the icon row shows Slack and GitHub without a label\./);
});

test("store assets take no other company's logo; a banner is not held to the store's rules", () => {
  const asset = creative({ headline: "Free for a week", iconRow: undefined, badges: [{ title: "Works with", icon: "slack" }] });
  const header = lintCreative(asset, "header", ["en"], "en");
  assert.deepEqual(header.map(({ rule, placement }) => `${rule} ${placement}`), ["third-party-logo header", "free header"]);
  assert.match(header[0]!.text, /^Product page header: badge 1 shows Slack\. Apple allows no other company's logo/);
  assert.deepEqual(lintCreative(asset, "readme", ["en"], "en"), []);
});

test("a slide of a device's own set says which device", () => {
  const [found] = lintSlide(slide({ headline: "Only $2.99" }), { ownSet: "ipad", slide: 2 }, ["en"], "en");
  assert.equal(found!.ownSet, "ipad");
  assert.match(found!.text, /^iPad slide 3 \(en\): the headline shows a price, "\$2\.99"\./);
});

test("the measurements a page reports are read, and anything else is ignored", () => {
  assert.deepEqual(readFit('{"scale":0.6,"fits":true,"lines":2,"outside":false}'), { scale: 0.6, fits: true, lines: 2, outside: false });
  assert.equal(readFit(undefined), undefined);
  assert.equal(readFit("not json"), undefined);
  assert.equal(readFit('{"scale":"small"}'), undefined);
});

test("a headline takes up to three lines, four in a column or on a statement, two on a store asset", () => {
  assert.equal(lineLimit("device-bottom", undefined), 3);
  assert.equal(lineLimit("statement", undefined), 4);
  assert.equal(lineLimit("device-right", undefined), 4);
  assert.equal(lineLimit(undefined, "search"), 2);
  assert.equal(lineLimit(undefined, "readme"), 3);
});

const page = (fields: Partial<FitReport>): FitReport => ({ locale: "en", scale: 1, fits: true, lines: 2, outside: false, ...fields });

test("fitting names each language, slide and device once, with its worst size", () => {
  const found = lintFit([
    { report: page({ locale: "de", slide: 2, device: "iphone", target: "iphone-6.9", scale: 0.7 }) },
    { report: page({ locale: "de", slide: 2, device: "iphone", target: "iphone-6.5", scale: 0.6 }) },
    { report: page({ locale: "en", slide: 2, device: "iphone", target: "iphone-6.9", scale: 0.95 }) },
    { report: page({ locale: "fr", slide: 2, device: "iphone", target: "iphone-6.9", scale: 0.5, fits: false }) },
    { report: page({ locale: "fr", slide: 0, device: "iphone", target: "iphone-6.9", lines: 5 }), layout: "device-bottom" },
    { report: page({ locale: "fr", slide: 0, device: "ipad", target: "ipad-13", lines: 4 }), layout: "statement" },
    { report: page({ locale: "en", placement: "header", outside: true }) },
  ]);
  assert.deepEqual(
    found.map(({ rule, locale, slide, placement, target, value }) => [rule, locale, slide ?? placement, target, value]),
    [
      ["headline-scaled", "de", 2, "iphone-6.5", 0.6],
      ["copy-overflow", "fr", 2, "iphone-6.9", 0.5],
      ["headline-lines", "fr", 0, "iphone-6.9", 5],
      ["safe-area", "en", "header", undefined, undefined],
    ],
  );
  assert.equal(found[0]!.limit, SCALE_LIMIT);
  assert.match(found[0]!.text, /^Slide 3 on iPhone: the copy was set at de 60% of its size to fit\./);
  assert.match(found[3]!.text, /^Product page header \(en\): text runs outside the safe area/);
});

test("a render's warnings say each finding once, with the languages it is in", () => {
  const set = slide({ headline: { en: "App of the Day", de: "App des Tages", fr: "App du jour" } });
  const found = [
    ...lintSlide(set, { slide: 0 }, ["en", "de", "fr"], "en"),
    ...lintFit([{ report: page({ locale: "de", slide: 1, device: "iphone", scale: 0.62 }) }, { report: page({ locale: "fr", slide: 1, device: "iphone", scale: 0.71 }) }]),
  ];
  assert.deepEqual(lintTexts(found, ["en", "de", "fr"]), [
    `Slide 1: the headline names "App of the Day" (en), "App des Tages" (de), "App du jour" (fr), one of Apple's own recognitions. App Review does not accept them in store images.`,
    "Slide 2 on iPhone: the copy was set at de 62%, fr 71% of its size to fit. Shorten it there, or it reads smaller than the rest of the set.",
  ]);
  // The same words in only some of the languages name those.
  assert.match(lintTexts(lintSlide(slide({ headline: { en: "Free", de: "Ruhig" } }), { slide: 0 }, ["en", "de"], "en"), ["en", "de"])[0]!, /^Slide 1 \(en\): the headline says "Free"\./);
});

test("the fit summary names the smallest each language was set, and where", () => {
  assert.deepEqual(fitSummary([page({ locale: "en", slide: 0 }), page({ locale: "de", slide: 3, device: "iphone", scale: 0.55 }), page({ locale: "de", slide: 1, fits: false, scale: 0.5 })]), [
    "How the copy fits, per language: the smallest it was set, as a share of its designed size.",
    "  en  100%",
    "  de   50%  Slide 2, and 1 page where it does not fit",
  ]);
  assert.deepEqual(fitSummary([]), []);
});
