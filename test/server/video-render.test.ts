import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { svgLogo } from "../helpers/images.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";

// The layers of an app preview as the browser draws them: their sizes, what is transparent and what is not, and
// what the page reports when copy has to shrink.

const RENDER = process.env.RENDER_TESTS === "1";
const renderTier = { skip: RENDER ? false : "draws with Chromium; run with RENDER_TESTS=1" };

const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("video layers drawn by the browser", renderTier, () => {
  let server: TestServer;
  let id: string;
  const call = async (route: string, init: RequestInit = {}) => {
    const response = await server.fetch(route, init);
    const text = await response.text();
    return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  };
  const picture = async (route: string) => {
    const data = Buffer.from(await (await server.fetch(route)).arrayBuffer());
    const { data: pixels, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => pixels[(y * info.width + x) * 4 + 3]!;
    /** Whether anything is drawn inside [x, y, width, height]. */
    const drawnIn = ([x, y, w, h]: number[]) => {
      for (let row = y!; row < y! + h!; row += 2) for (let column = x!; column < x! + w!; column += 2) if (alpha(column, row) > 0) return true;
      return false;
    };
    return { meta: await sharp(data).metadata(), alpha, drawnIn };
  };

  before(async () => {
    server = await startServer({ inProcess: true });
    const created = await call("/api/projects", send("POST", { name: "Layers", locales: ["en", "de", "ar"] }));
    id = created.body.id;
    const slides = [
      { layout: "statement", headline: { en: "Plan your *week*", de: "Plane deine *Woche*", ar: "خطط *أسبوعك*" } },
      { layout: "statement", headline: { en: "Share in one tap", de: "Mit einem Tipp teilen" }, subheadline: { en: "With anyone", de: "Mit allen" } },
    ];
    await call(`/api/projects/${id}`, send("PUT", { slides, theme: { background: "midnight", font: "fraunces", accentColor: "#F59E0B" } }));
    await server.fetch(`/api/projects/${id}/images/logo`, { method: "PUT", body: new Uint8Array(svgLogo) });
  });
  after(async () => {
    await server?.stop();
  });

  test("every layer has its exact size, captions are transparent around their card and the plate is opaque", async () => {
    const answer = await call(
      `/api/projects/${id}/video-layers`,
      send("POST", {
        display: "iphone",
        captions: [
          { id: "plan", text: { slide: 1 } },
          { id: "share", text: { slide: 2 }, position: "bottom" },
        ],
        intro: { headline: { slide: 1 } },
        outro: { lines: [{ slide: 2 }, { slide: 2, field: "sub" }], disclosure: ["subscription"] },
        touch: true,
      }),
    );
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const { layers, warnings, size } = answer.body;
    assert.deepEqual(size, [886, 1920]);
    assert.equal(answer.body.charged, true);
    const kinds = new Set(layers.map((layer: { kind: string }) => layer.kind));
    assert.deepEqual([...kinds].sort(), ["caption", "intro-logo", "intro-text", "outro-logo", "outro-text", "plate", "touch"]);

    for (const layer of layers) {
      const { meta, alpha, drawnIn } = await picture(layer.file);
      assert.equal(meta.width, layer.width, layer.id);
      assert.equal(meta.height, layer.height, layer.id);
      if (layer.kind === "plate") {
        assert.equal(meta.hasAlpha, false, "the plate has no alpha channel");
        continue;
      }
      assert.equal(meta.hasAlpha, true, `${layer.id} is transparent`);
      assert.equal(alpha(0, 0), 0, `${layer.id} top left`);
      assert.equal(alpha(layer.width - 1, layer.height - 1), 0, `${layer.id} bottom right`);
      if (layer.box) {
        const [x, y, w, h] = layer.box;
        assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= layer.width && y + h <= layer.height, `${layer.id} box ${layer.box}`);
        assert.ok(drawnIn(layer.box), `${layer.id} draws inside its box`);
        // Above and below it, past its shadow, a layer is transparent: each one shows only its own part.
        const shadow = Math.round(Math.min(layer.width, layer.height) * 0.08);
        const above = [0, 0, layer.width, Math.max(0, y - shadow)];
        const below = [0, Math.min(layer.height, y + h + shadow), layer.width, Math.max(0, layer.height - y - h - shadow)];
        if (layer.kind !== "touch") assert.equal(drawnIn(above) || drawnIn(below), false, `${layer.id} draws only its part`);
      }
    }
    const plan = layers.find((layer: { id: string; locale: string }) => layer.id === "caption-plan" && layer.locale === "en");
    assert.equal(plan.text, "Plan your week");
    assert.ok(plan.box[1] >= 1920 * 0.1 - 1, "a top caption stays clear of the Dynamic Island");
    const share = layers.find((layer: { id: string; locale: string }) => layer.id === "caption-share" && layer.locale === "en");
    assert.ok(share.box[1] + share.box[3] <= 1920 * 0.92 + 1, "a bottom caption stays clear of the home indicator");
    // Slide 2 has no Arabic copy: it is drawn in English and said so.
    assert.ok(warnings.some((warning: { locale: string; layer: string; kind: string }) => warning.locale === "ar" && warning.layer === "caption-share" && warning.kind === "fallback"));
    assert.ok(warnings.some((warning: { locale: string; layer: string; kind: string }) => warning.locale === "de" && warning.layer === "outro-text" && warning.kind === "fallback"));
  });

  test("copy too long for two lines shrinks and says so; copy that cannot fit fails the page and costs nothing", async () => {
    const long = "Every list, note and reminder you have written, kept in one calm place";
    const answer = await call(`/api/projects/${id}/video-layers`, send("POST", { display: "iphone", locales: ["en"], plate: false, captions: [{ id: "long", text: long }] }));
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const [layer] = answer.body.layers;
    assert.ok(layer.fit < 0.7, `fit ${layer.fit}`);
    assert.deepEqual(
      answer.body.warnings.map((warning: { layer: string; kind: string }) => [warning.layer, warning.kind]),
      [["caption-long", "fit"]],
    );
    assert.match(answer.body.warnings[0].detail, /shrunk to \d+ %/);

    const endless = Array.from({ length: 30 }, () => "Wonderful").join(" ");
    const refused = await call(`/api/projects/${id}/video-layers`, send("POST", { display: "iphone", locales: ["de"], plate: false, captions: [{ id: "endless", text: endless }] }));
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(refused.body.error, /in de/);
    assert.match(refused.body.error, /fit:caption-endless/);
  });

  test("a right-to-left language and a landscape Mac size draw as well", async () => {
    const answer = await call(`/api/projects/${id}/video-layers`, send("POST", { display: "mac", locales: ["ar"], captionStyle: "band", captions: [{ id: "plan", text: { slide: 1 } }] }));
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.deepEqual(answer.body.size, [1920, 1080]);
    const caption = answer.body.layers.find((layer: { kind: string }) => layer.kind === "caption");
    assert.equal(caption.locale, "ar");
    // A band runs the full width.
    assert.equal(caption.box[0], 0);
    assert.equal(caption.box[2], 1920);
    const { meta } = await picture(caption.file);
    assert.deepEqual([meta.width, meta.height], [1920, 1080]);
  });
});
