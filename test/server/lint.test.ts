import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium } from "playwright";
import sharp from "sharp";
import { FIT_SCRIPT } from "../../src/template/fit.ts";
import { png } from "../helpers/images.ts";
import { callTool, textOf } from "../helpers/mcp.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";

// What a render says about its copy: the store's rules it breaks, and what the pages measured once they had fitted
// it, as sentences in `warnings` and as data under `lint` and `fit`.

const RENDER = process.env.RENDER_TESTS === "1";
const renderTier = { skip: RENDER ? false : "draws with Chromium; run with RENDER_TESTS=1" };

const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("a page's own measurements", renderTier, () => {
  const state = async (html: string) => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      await page.waitForFunction(() => document.body.dataset.ready);
      return await page.evaluate(() => ({ ready: document.body.dataset.ready, error: document.body.dataset.error ?? null, fit: JSON.parse(document.body.dataset.fit ?? "null") }));
    } finally {
      await browser.close();
    }
  };
  const canvas = (copy: string, extra = "", fonts: string[] = []) =>
    `<body style="margin:0"><div class="canvas" style="position:relative;width:400px;height:200px;--ts:1;--u:1px;font-size:20px" data-copy-max="1" data-fonts="${JSON.stringify(fonts).replace(/"/g, "&quot;")}"${extra}>${copy}</div><script>${FIT_SCRIPT}</script></body>`;

  test("text outside a store asset's safe area is found, and text inside it is not", async () => {
    const at = (left: number) => canvas(`<div class="copy" style="position:absolute;left:${left}px;top:60px;width:120px"><div class="headline">Inside</div></div>`, ' data-safe="100 50 200 100"');
    assert.deepEqual((await state(at(120))).fit, { scale: 1, fits: true, lines: 1, outside: false });
    assert.equal((await state(at(20))).fit.outside, true);
  });

  test("a font that does not load stops the page instead of falling back", async () => {
    const face = "<style>@font-face{font-family:'Broken Face';src:url(data:font/woff2;base64,AAAAAAAA) format('woff2')}</style>";
    const page = await state(face + canvas(`<div class="copy"><div class="headline" style="font-family:'Broken Face'">Text</div></div>`, "", ["600 40px 'Broken Face'"]));
    assert.equal(page.ready, "error");
    assert.equal(page.error, "font:Broken Face");
  });
});

describe("a render's warnings about the copy", renderTier, () => {
  let server: TestServer;
  let id: string;
  let answer: { status: number; body: any };

  before(async () => {
    server = await startServer({ inProcess: true });
    const created = await (await server.fetch("/api/projects", send("POST", { name: "Lint", locales: ["en", "de"], targets: ["iphone-6.9"] }))).json();
    id = created.id;
    const slides = [
      {
        layout: "device-bottom",
        headline: { en: "Plan your *week*", de: "Die Wochenplanungsübersicht für sämtliche Lieblingsprojekte, Termine, Aufgaben und Erinnerungen deiner ganzen Familie in einem einzigen übersichtlichen Kalender" },
        screenshot: "home",
      },
      { layout: "statement", headline: { en: "App of the Day", de: "App des Tages" } },
      { layout: "statement", headline: "Calm and clear" },
    ];
    const creatives = { header: { headline: "Free for a week", badges: [{ title: "Works with", icon: "slack" }] } };
    await server.fetch(`/api/projects/${id}`, send("PUT", { slides, creatives }));
    await server.fetch(`/api/projects/${id}/shots/home`, { method: "PUT", body: new Uint8Array(await png(1320, 2868)) });
    const response = await server.fetch(`/api/projects/${id}/render`, send("POST", {}));
    answer = { status: response.status, body: await response.json() };
  });
  after(async () => {
    await server?.stop();
  });

  test("a recognition of Apple's is said once, with the words found in each language", () => {
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const { warnings, lint } = answer.body;
    assert.ok(warnings.includes(`Slide 2: the headline names "App of the Day" (en), "App des Tages" (de), one of Apple's own recognitions. App Review does not accept them in store images.`), warnings.join("\n"));
    assert.deepEqual(
      lint.filter((each: any) => each.rule === "apple-recognition").map((each: any) => [each.locale, each.slide, each.field, each.match]),
      [
        ["en", 1, "headline", "App of the Day"],
        ["de", 1, "headline", "App des Tages"],
      ],
    );
  });

  test("a header asset with a claim of free and another company's logo is warned about", () => {
    const header = answer.body.lint.filter((each: any) => each.placement === "header").map((each: any) => each.rule);
    assert.ok(header.includes("free") && header.includes("third-party-logo"), header.join(", "));
  });

  test("the German headline that had to shrink is named, the English one is not", () => {
    const { lint, fit, warnings } = answer.body;
    const long = lint.filter((each: any) => ["headline-scaled", "copy-overflow", "headline-lines"].includes(each.rule) && each.slide === 0);
    assert.ok(long.length > 0, JSON.stringify(fit));
    assert.ok(long.every((each: any) => each.locale === "de" && each.device === "iphone" && each.target === "iphone-6.9"), JSON.stringify(long));
    assert.ok(warnings.some((warning: string) => warning.startsWith("Slide 1 on iPhone") || warning.startsWith("Slide 1 (de)")), warnings.join("\n"));

    // Every page drawn reports, the asset's included.
    assert.equal(fit.length, 2 * 3 + 2);
    const english = fit.find((each: any) => each.locale === "en" && each.slide === 0);
    const german = fit.find((each: any) => each.locale === "de" && each.slide === 0);
    assert.equal(english.scale, 1);
    assert.equal(english.fits, true);
    assert.ok(german.scale < english.scale || german.lines > 3, JSON.stringify(german));
  });

  test("render with previews off answers in words alone", async () => {
    const result = await callTool(server, "render", { project: id, slides: [1, 2], previews: false });
    assert.notEqual(result.isError, true, textOf(result));
    assert.deepEqual(result.content.map((part) => part.type), ["text"]);
    const text = textOf(result);
    assert.match(text, /Warnings:\n- /);
    assert.match(text, /How the copy fits, per language/);
    assert.match(text, /\n {2}de +\d+%/);
    assert.match(text, /Contact sheets: /);
  });

  test("render with the store preview answers with one picture of the listing", async () => {
    const result = await callTool(server, "render", { project: id, creatives: [], preview: "store", locales: ["en"] });
    assert.notEqual(result.isError, true, textOf(result));
    assert.match(textOf(result), /The store preview shows the first three slides of iphone-6\.9, en/);
    const images = result.content.filter((part) => part.type === "image");
    assert.equal(images.length, 1);
    const { width, height } = await sharp(Buffer.from(images[0]!.data!, "base64")).metadata();
    assert.ok(width! > height!, `${width}×${height}`);
  });
});
