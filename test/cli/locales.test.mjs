import assert from "node:assert/strict";
import { test } from "node:test";
import { ascLocale, sameLanguage, storeLocale } from "../../cli/src/store/locales.mjs";

test("ascLocale gives the code App Store Connect has for a language", () => {
  assert.equal(ascLocale("de"), "de-DE");
  assert.equal(ascLocale("de-AT"), "de-DE");
  assert.equal(ascLocale("EN-gb"), "en-GB");
  assert.equal(ascLocale("en"), "en-US");
  assert.equal(ascLocale("ja-JP"), "ja");
  assert.equal(ascLocale("zh-TW"), "zh-Hant");
  assert.equal(ascLocale("zh-Hant-TW"), "zh-Hant");
  assert.equal(ascLocale("nb"), "no");
  assert.equal(ascLocale("es-419"), "es-MX");
  assert.equal(ascLocale("xx"), null);
});

test("sameLanguage matches a bare code with any region, never two regions", () => {
  assert.equal(sameLanguage("en", "en-GB"), true);
  assert.equal(sameLanguage("en-US", "en-GB"), false);
  assert.equal(sameLanguage("pt-br", "pt-BR"), true);
});

test("an exact code is the page's own, whatever the case", () => {
  assert.deepEqual(storeLocale("en-gb", ["en-US", "en-GB"]), { code: "en-GB", listed: true });
});

test("en goes to the only English page there is, en-GB included", () => {
  assert.deepEqual(storeLocale("en", ["en-GB", "de-DE"]), { code: "en-GB", listed: true });
});

test("en with en-US and en-GB goes to the app's primary language", () => {
  assert.deepEqual(storeLocale("en", ["en-US", "en-GB"], { primary: "en-GB" }), { code: "en-GB", listed: true, others: ["en-US"] });
  assert.deepEqual(storeLocale("en", ["en-GB", "en-US"], { primary: "en-US" }), { code: "en-US", listed: true, others: ["en-GB"] });
});

test("without a primary language among them, en is en-US", () => {
  assert.deepEqual(storeLocale("en", ["en-GB", "en-US"], { primary: "de-DE" }), { code: "en-US", listed: true, others: ["en-GB"] });
});

test("en with only en-AU and en-CA is unclear and says which there are", () => {
  assert.deepEqual(storeLocale("en", ["en-AU", "en-CA"]), { code: null, listed: false, others: ["en-AU", "en-CA"] });
});

test("a language the page lacks is the code it would be added as", () => {
  assert.deepEqual(storeLocale("en-US", ["en-GB"]), { code: "en-US", listed: false });
  assert.deepEqual(storeLocale("fr", ["en-US"]), { code: "fr-FR", listed: false });
  assert.deepEqual(storeLocale("tlh", ["en-US"]), { code: null, listed: false });
});

test("--lang en=en-GB sends en to the page named, listed or not", () => {
  assert.deepEqual(storeLocale("en", ["en-US", "en-GB"], { to: "en-gb" }), { code: "en-GB", listed: true });
  assert.deepEqual(storeLocale("en", ["en-US"], { to: "en-AU" }), { code: "en-AU", listed: false });
});
