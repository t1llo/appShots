import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { freePort, startServer, type TestServer } from "../helpers/spawn-server.ts";
import { tmpData } from "../helpers/tmp-data.ts";

// The renderer from outside: what it writes, compared with what a browser draws of the same pages the plain way,
// and what it lets the pages reach.

const RENDER = process.env.RENDER_TESTS === "1";
const renderTier = { skip: RENDER ? false : "draws with Chromium; run with RENDER_TESTS=1" };

const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** A made-up app screen: shapes in a few colours, so a picture drawn any differently shows. */
function screen(width: number, height: number, hue: number): Promise<Buffer> {
  const rows = Array.from({ length: 6 }, (_, i) => {
    const y = Math.round(height * (0.18 + i * 0.12));
    return `<rect x="${width * 0.06}" y="${y}" width="${width * 0.88}" height="${height * 0.1}" rx="${width * 0.04}" fill="hsl(${(hue + i * 20) % 360} 60% ${86 - i * 5}%)"/>
      <circle cx="${width * 0.17}" cy="${y + height * 0.05}" r="${width * 0.06}" fill="hsl(${(hue + 180) % 360} 70% 50%)"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="hsl(${hue} 60% 95%)"/>${rows}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("rendering, compared with a plain browser", renderTier, () => {
  let server: TestServer;
  let id: string;
  const call = async (route: string, init: RequestInit = {}) => {
    const response = await server.fetch(route, init);
    const text = await response.text();
    return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  };
  const file = async (route: string) => new Uint8Array(await (await server.fetch(route)).arrayBuffer());

  before(async () => {
    server = await startServer({ env: { RENDER_PREWARM: "on" } });
    const created = await call("/api/projects", send("POST", { name: "Same", locales: ["en", "de"], targets: ["iphone-6.9", "iphone-6.3", "iphone-6.5", "iphone-6.1", "ipad-13", "ipad-10.5"] }));
    id = created.body.id;
    const slides = [
      { layout: "device-bottom", headline: { en: "Plan your *week*", de: "Plane deine *Woche*" }, subheadline: { en: "All in one place", de: "Alles an einem Ort" }, screenshot: "home" },
      { layout: "duo", headline: { en: "Details *at a glance*", de: "Details *auf einen Blick*" }, screenshot: "home", screenshot2: "list" },
      { layout: "statement", headline: { en: "Less *noise*.\nMore done.", de: "Weniger *Lärm*.\nMehr erledigt." } },
    ];
    await call(`/api/projects/${id}`, send("PUT", { slides, theme: { background: "auto" } }));
    for (const [name, hue] of [["home", 210], ["list", 150]] as const) {
      await server.fetch(`/api/projects/${id}/shots/${name}`, { method: "PUT", body: new Uint8Array(await screen(1320, 2868, hue)) });
      await server.fetch(`/api/projects/${id}/shots/${name}?device=ipad`, { method: "PUT", body: new Uint8Array(await screen(2064, 2752, hue)) });
    }
  });
  after(async () => {
    await server?.stop();
  });

  test("each size is what the browser draws of its page, and a scaled size that picture scaled", async () => {
    // Started with the server, not by the first render.
    for (let tries = 0; tries < 200 && !server.output().includes("The renderer draws with Chromium"); tries++) await sleep(50);
    assert.match(server.output(), /The renderer draws with Chromium \d+/);
    const answer = await call(`/api/projects/${id}/render`, send("POST", { locales: ["en"] }));
    assert.equal(answer.status, 200, JSON.stringify(answer.body));

    // The way the renderer has always drawn: a window of the size, a page at a time, the picture without its alpha
    // channel at the highest compression, and sizes of the same shape scaled from that file.
    const browser = await chromium.launch();
    try {
      const drawn = async (target: string, width: number, height: number) => {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const pictures: Buffer[] = [];
        for (const index of [0, 1, 2]) {
          await page.goto(`${server.url}/render/${id}/${index}?target=${target}&locale=en`, { waitUntil: "load" });
          await page.waitForFunction(() => document.body.dataset.ready === "1", undefined, { timeout: 20_000 });
          const raw = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
          pictures.push(await sharp(raw).removeAlpha().png({ compressionLevel: 9 }).toBuffer());
        }
        await context.close();
        return pictures;
      };
      const scaled = (picture: Buffer, width: number, height: number) => sharp(picture).resize(width, height, { fit: "fill" }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();

      const iphone = await drawn("iphone-6.9", 1320, 2868);
      // 6.5" is some ten pixels off the shape of 6.9", so it is drawn at its own size rather than squeezed, and 6.1" is
      // scaled from it.
      const iphone65 = await drawn("iphone-6.5", 1284, 2778);
      const ipad = await drawn("ipad-13", 2064, 2752);
      for (const [i, name] of ["01.png", "02.png", "03.png"].entries()) {
        assert.equal(sha(await file(`/files/${id}/out/en/iphone-6.9/${name}`)), sha(iphone[i]!), `iphone-6.9/${name}`);
        assert.equal(sha(await file(`/files/${id}/out/en/iphone-6.3/${name}`)), sha(await scaled(iphone[i]!, 1206, 2622)), `iphone-6.3/${name}`);
        assert.equal(sha(await file(`/files/${id}/out/en/iphone-6.5/${name}`)), sha(iphone65[i]!), `iphone-6.5/${name}`);
        assert.notEqual(sha(await file(`/files/${id}/out/en/iphone-6.5/${name}`)), sha(await scaled(iphone[i]!, 1284, 2778)), `iphone-6.5/${name} is not 6.9" scaled`);
        assert.equal(sha(await file(`/files/${id}/out/en/iphone-6.1/${name}`)), sha(await scaled(iphone65[i]!, 1170, 2532)), `iphone-6.1/${name}`);
        assert.equal(sha(await file(`/files/${id}/out/en/ipad-13/${name}`)), sha(ipad[i]!), `ipad-13/${name}`);
        assert.equal(sha(await file(`/files/${id}/out/en/ipad-10.5/${name}`)), sha(await scaled(ipad[i]!, 1668, 2224)), `ipad-10.5/${name}`);
      }

      // The contact sheet, as it was stitched from the files of the set.
      const gap = 28;
      const height = Math.round(Math.min(620, ((2000 - gap * 4) / 3) * (2868 / 1320)));
      const width = Math.round(height * (1320 / 2868));
      const tiles = await Promise.all(iphone.map(async (picture, i) => ({ input: await sharp(picture).resize(width, height).toBuffer(), left: gap + i * (width + gap), top: gap })));
      const sheet = await sharp({ create: { width: gap + 3 * (width + gap), height: height + gap * 2, channels: 3, background: "#141416" } })
        .composite(tiles)
        .jpeg({ quality: 84 })
        .toBuffer();
      assert.equal(sha(await file(`/files/${id}/out/en/iphone-6.9/sheet.jpg`)), sha(sheet));
      // One sheet per device: the 6.5" set looks the same as the 6.9" one.
      assert.equal((await server.fetch(`/files/${id}/out/en/iphone-6.5/sheet.jpg`)).status, 404);
    } finally {
      await browser.close();
    }
  });

  test("sizes and languages drawn from an older design are not listed or exported", async () => {
    assert.equal((await call(`/api/projects/${id}/render`, send("POST", {}))).status, 200);
    const listed = async () => ((await call(`/api/projects/${id}`)).body.outputs as { locale: string; target: string }[]).map((set) => `${set.locale}/${set.target}`).sort();
    assert.deepEqual(await listed(), [
      "de/ipad-10.5",
      "de/ipad-13",
      "de/iphone-6.1",
      "de/iphone-6.3",
      "de/iphone-6.5",
      "de/iphone-6.9",
      "en/ipad-10.5",
      "en/ipad-13",
      "en/iphone-6.1",
      "en/iphone-6.3",
      "en/iphone-6.5",
      "en/iphone-6.9",
    ]);

    // The English iPhone headline changes, and only the 6.9" size is drawn again: the other English iPhone sets show the old one.
    const { body } = await call(`/api/projects/${id}`);
    const slides = body.project.slides;
    slides[0].headline.en = "Plan your *month*";
    await call(`/api/projects/${id}`, send("PUT", { slides }));
    assert.equal((await call(`/api/projects/${id}/render`, send("POST", { targets: ["iphone-6.9"] }))).status, 200);
    assert.deepEqual(await listed(), ["de/ipad-10.5", "de/ipad-13", "de/iphone-6.1", "de/iphone-6.3", "de/iphone-6.5", "de/iphone-6.9", "en/ipad-10.5", "en/ipad-13", "en/iphone-6.9"]);
    const zip = Buffer.from(await (await server.fetch(`/api/projects/${id}/export.zip`)).arrayBuffer()).toString("latin1");
    assert.ok(zip.includes("en/iphone-6.9/01.png"));
    for (const size of ["6.3", "6.5", "6.1"]) assert.ok(!zip.includes(`en/iphone-${size}/`), size);

    // A language the project no longer has goes with the next render.
    await call(`/api/projects/${id}`, send("PUT", { locales: ["en"] }));
    assert.equal((await call(`/api/projects/${id}/render`, send("POST", { targets: ["iphone-6.9"] }))).status, 200);
    assert.deepEqual(await listed(), ["en/ipad-10.5", "en/ipad-13", "en/iphone-6.9"]);

    // A slide is deleted and one slide of one size drawn again: no size keeps the deleted slide, the iPad's neither.
    await call(`/api/projects/${id}`, send("PUT", { slides: slides.slice(0, 2) }));
    assert.equal((await call(`/api/projects/${id}/render`, send("POST", { slides: [0], targets: ["iphone-6.9"] }))).status, 200);
    const sets = (await call(`/api/projects/${id}`)).body.outputs as { locale: string; target: string; files: string[] }[];
    assert.deepEqual(
      sets.map((set) => `${set.target} ${set.files.join(" ")}`),
      ["ipad-10.5 01.png 02.png", "ipad-13 01.png 02.png", "iphone-6.9 01.png 02.png"],
    );
    assert.equal((await server.fetch(`/files/${id}/out/en/ipad-13/03.png`)).status, 404);
  });

  test("the same mockup asked for many times at once is drawn once, at the width asked for", async () => {
    const route = `/api/projects/${id}/mockups/home.iphone.png?width=480`;
    // More than the four mockups an account may have waiting: the same one asked again waits for the first.
    const answers = await Promise.all(Array.from({ length: 6 }, () => server.fetch(route)));
    assert.deepEqual(
      answers.map((answer) => answer.status),
      [200, 200, 200, 200, 200, 200],
    );
    const pictures = await Promise.all(answers.map(async (answer) => new Uint8Array(await answer.arrayBuffer())));
    assert.equal(new Set(pictures.map(sha)).size, 1);
    const { width, hasAlpha } = await sharp(pictures[0]!).metadata();
    assert.equal(width, 480);
    assert.equal(hasAlpha, true);
  });
});

describe("what the pages can reach", renderTier, () => {
  test("the browser reaches this server at its own address and port, and nothing else", async () => {
    const data = await tmpData("reach");
    // Another server on this machine, on every address it has: nothing may arrive here.
    const reached: string[] = [];
    const other = http.createServer((req, res) => {
      reached.push(`${req.headers.host}${req.url}`);
      res.end();
    });
    await new Promise<void>((resolve) => other.listen(0, "::", resolve));
    const otherPort = (other.address() as { port: number }).port;

    // A stand-in for this server: a page with pictures from everywhere.
    const port = await freePort();
    const served: string[] = [];
    const pixel = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000" } }).png().toBuffer();
    const own = http.createServer((req, res) => {
      served.push(req.url!);
      if (req.url !== "/") return void res.writeHead(200, { "Content-Type": "image/png" }).end(pixel);
      const sources = [
        `http://127.0.0.1:${port}/own.png`,
        `http://localhost:${port}/own-by-name.png`,
        `http://127.0.0.1:${otherPort}/numbers.png`,
        `http://localhost:${otherPort}/name.png`,
        `http://[::1]:${otherPort}/v6.png`,
        "http://appshots.example.com/remote.png",
      ];
      res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><body>${sources.map((src) => `<img src="${src}">`).join("")}</body>`);
    });
    await new Promise<void>((resolve) => own.listen(port, "127.0.0.1", resolve));

    // The renderer's own browser, set up for a server on that port.
    process.env.PORT = String(port);
    process.env.DATA_DIR = data.dir;
    const engine = await import("../../src/render/engine.ts");
    try {
      const browser = await engine.getBrowser();
      const page = await browser.newPage();
      const failed: string[] = [];
      page.on("requestfailed", (request) => failed.push(`${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await page.close();

      assert.deepEqual(reached, []);
      assert.deepEqual(served.sort(), ["/", "/own.png"]);
      assert.deepEqual(failed.sort(), ["/name.png", "/numbers.png", "/own-by-name.png", "/remote.png", "/v6.png"].map((path) => `${path} net::ERR_NAME_NOT_RESOLVED`));
    } finally {
      await engine.closeBrowser();
      await new Promise((resolve) => other.close(resolve));
      await new Promise((resolve) => own.close(resolve));
      await data.remove();
    }
  });
});
