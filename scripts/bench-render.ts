#!/usr/bin/env node
// Times the renderer on a made-up project: six slides at the four standard iPhone sizes, the same in three languages,
// and one heavy mockup. Every picture in it is drawn here, nothing is read from data/.
//
//   node scripts/bench-render.ts [--root <checkout>] [--port 3251] [--runs 3] [--hashes <file.json>] [--keep <dir>]
//
// --root runs the server of another checkout, so two versions can be timed on the same machine one after the other.
// --hashes writes the sha256 of every rendered file, to compare the pictures two versions draw.
// --keep copies the rendered files to a folder, to look at them.

import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";

const { values: args } = parseArgs({
  options: {
    root: { type: "string", default: path.resolve(import.meta.dirname, "..") },
    port: { type: "string", default: "3251" },
    runs: { type: "string", default: "3" },
    hashes: { type: "string" },
    keep: { type: "string" },
  },
});
const root = path.resolve(args.root);
const port = Number(args.port);
const runs = Math.max(1, Number(args.runs));
const base = `http://127.0.0.1:${port}`;

/** Settings the server reads, which the shell this runs in must not hand it: sign-in stays off. */
const SERVER_SETTINGS = /^(GOOGLE_|UMAMI_|USER_|RENDER_)|^(ADMIN_EMAIL|PUBLIC_URL|CLIENT_IP_HEADER|CONTACT_EMAIL|OPERATOR_NAME|DATA_DIR|PORT)$/;

async function startServer(dataDir: string): Promise<ChildProcess> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !SERVER_SETTINGS.test(name)));
  const child = spawn(process.execPath, ["src/server.ts"], { cwd: root, env: { ...env, DATA_DIR: dataDir, PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"] });
  for (let tries = 0; tries < 300; tries++) {
    if (child.exitCode != null) throw new Error(`The server at ${root} stopped (exit code ${child.exitCode}).`);
    const ok = await fetch(`${base}/healthz`).then(
      (response) => response.ok,
      () => false,
    );
    if (ok) return child;
    await sleep(100);
  }
  child.kill("SIGKILL");
  throw new Error("The server did not answer /healthz.");
}

async function call(route: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${base}${route}`, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route} answered ${response.status}: ${text.slice(0, 300)}`);
  return response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** A screen of an app that does not exist: a bar, a few cards and some text, in its own colours. */
function screen(title: string, hue: number): Promise<Buffer> {
  const [width, height] = [1320, 2868];
  const cards = Array.from({ length: 6 }, (_, i) => {
    const y = 520 + i * 360;
    return `<rect x="80" y="${y}" width="1160" height="300" rx="48" fill="hsl(${(hue + i * 18) % 360} 60% ${88 - i * 4}%)"/>
      <circle cx="220" cy="${y + 150}" r="80" fill="hsl(${(hue + 180) % 360} 70% 50%)"/>
      <text x="340" y="${y + 130}" font-family="sans-serif" font-size="64" font-weight="700" fill="#1b1b22">${title} item ${i + 1}</text>
      <text x="340" y="${y + 210}" font-family="sans-serif" font-size="44" fill="#55556a">Detail line for row ${i + 1}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 96%)"/><stop offset="1" stop-color="hsl(${hue} 50% 86%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="80" y="420" font-family="sans-serif" font-size="110" font-weight="800" fill="#111">${title}</text>
    ${cards}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const t = (en: string, de: string, fr: string) => ({ en, de, fr });

const SLIDES = [
  { layout: "device-bottom", headline: t("Plan your *week*", "Plane deine *Woche*", "Planifiez votre *semaine*"), subheadline: t("Everything in one place", "Alles an einem Ort", "Tout au même endroit"), screenshot: "home" },
  { layout: "tilted", headline: t("Lists that *move*", "Listen, die *mitgehen*", "Des listes qui *bougent*"), screenshot: "list" },
  { layout: "duo", headline: t("Details *at a glance*", "Details *auf einen Blick*", "Les détails *en un coup d'œil*"), screenshot: "detail", screenshot2: "home" },
  {
    layout: "features",
    headline: t("Built for *focus*", "Gemacht für *Fokus*", "Conçu pour la *concentration*"),
    features: [
      { icon: "bolt", title: t("Fast", "Schnell", "Rapide"), text: t("Opens in an instant", "Sofort offen", "S'ouvre en un instant") },
      { icon: "lock", title: t("Private", "Privat", "Privé"), text: t("Stays on your phone", "Bleibt auf dem Telefon", "Reste sur votre téléphone") },
      { icon: "cloud", title: t("Synced", "Synchron", "Synchronisé"), text: t("On every device", "Auf jedem Gerät", "Sur chaque appareil") },
      { icon: "bell", title: t("Reminders", "Erinnerungen", "Rappels"), text: t("Right on time", "Pünktlich", "Pile à l'heure") },
    ],
  },
  { layout: "statement", headline: t("Less *noise*.\nMore done.", "Weniger *Lärm*.\nMehr erledigt.", "Moins de *bruit*.\nPlus de fait.") },
  {
    layout: "device-right",
    headline: t("Make it *yours*", "Mach es zu *deinem*", "Faites-le *vôtre*"),
    features: [{ title: t("Themes", "Themen", "Thèmes") }, { title: t("Widgets", "Widgets", "Widgets") }, { title: t("Shortcuts", "Kurzbefehle", "Raccourcis") }],
    screenshot: "settings",
  },
];

const IPHONE = ["iphone-6.9", "iphone-6.3", "iphone-6.5", "iphone-6.1"];

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = performance.now();
  const result = await work();
  return { ms: Math.round(performance.now() - start), result };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function main(): Promise<void> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "appshots-bench-"));
  const server = await startServer(dataDir);
  try {
    const { id } = await call("/api/projects", json("POST", { name: "Bench", locales: ["en", "de", "fr"], targets: IPHONE }));
    await call(`/api/projects/${id}`, json("PUT", { slides: SLIDES, theme: { background: "auto" } }));
    for (const [name, hue] of [["home", 210], ["list", 150], ["detail", 30], ["settings", 280]] as const) {
      await call(`/api/projects/${id}/shots/${name}`, { method: "PUT", body: new Uint8Array(await screen(name[0]!.toUpperCase() + name.slice(1), hue)) });
    }

    const results: Record<string, number | number[]> = {};
    // The first render after the server answers: the browser may still be starting.
    results.firstRender = (await timed(() => call(`/api/projects/${id}/render`, json("POST", { locales: ["en"] })))).ms;
    const oneLocale: number[] = [];
    for (let i = 0; i < runs; i++) oneLocale.push((await timed(() => call(`/api/projects/${id}/render`, json("POST", { locales: ["en"] })))).ms);
    results["6 slides x 4 iPhone sizes, 1 locale"] = oneLocale;
    const threeLocales: number[] = [];
    for (let i = 0; i < runs; i++) threeLocales.push((await timed(() => call(`/api/projects/${id}/render`, json("POST", {})))).ms);
    results["6 slides x 4 iPhone sizes x 3 locales"] = threeLocales;
    const mockup: number[] = [];
    for (let i = 0; i < runs; i++) {
      // A width of its own each time, so no run is answered from the cache of drawn mockups.
      const settings = JSON.stringify({ device: { shadow: "strong", perspective: "left" }, width: 4000 - i });
      mockup.push((await timed(() => fetch(`${base}/api/projects/${id}/mockups/home.iphone.png?settings=${encodeURIComponent(settings)}`).then((response) => response.arrayBuffer()))).ms);
    }
    results["heavy mockup (width 4000, strong shadow, perspective)"] = mockup;

    const summary = Object.fromEntries(Object.entries(results).map(([name, value]) => [name, Array.isArray(value) ? { median: median(value), runs: value } : value]));
    console.log(JSON.stringify({ root, node: process.version, cpus: os.cpus().length, results: summary }, null, 2));

    if (args.hashes) {
      const out = path.join(dataDir, "projects", id, "out");
      const hashes: Record<string, string> = {};
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else hashes[path.relative(out, full)] = createHash("sha256").update(await readFile(full)).digest("hex");
        }
      };
      await walk(out);
      await writeFile(args.hashes, JSON.stringify(Object.fromEntries(Object.entries(hashes).sort()), null, 2));
    }
    if (args.keep) await cp(path.join(dataDir, "projects", id, "out"), args.keep, { recursive: true });
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

await main();
