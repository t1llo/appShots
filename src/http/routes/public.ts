import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import express, { type Router } from "express";
import { FONTS, ICON_IDS } from "../../design.ts";
import { ICONS } from "../../icons.ts";
import { baseUrl, claimedUrl } from "../security.ts";

const root = path.resolve(import.meta.dirname, "..", "..", "..");

/** One stylesheet for every bundled face; the browser only fetches the files a slide actually uses. */
async function buildFontCss(): Promise<string> {
  const sheets = await Promise.all(
    Object.entries(FONTS).map(async ([id, font]) => {
      const css = await readFile(path.join(root, "node_modules", font.pkg, font.css), "utf8");
      // `block` instead of `swap`: a screenshot must never catch the fallback face mid-swap.
      return css.replaceAll("url(./files/", `url(/fonts/${id}/`).replaceAll("font-display: swap", "font-display: block");
    }),
  );
  return sheets.join("\n");
}

/** A short hash: how a Mac learns that its copy of a file is behind without fetching it. */
const stamp = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** A file read at startup, and again only once it has changed on disk, with the hash of what was read. */
async function keptFile(file: string): Promise<() => Promise<{ text: string; stamp: string }>> {
  const read = async () => {
    const [text, { mtimeMs }] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return { text, stamp: stamp(text), mtimeMs };
  };
  let kept = await read();
  return async () => {
    if ((await stat(file)).mtimeMs !== kept.mtimeMs) kept = await read();
    return kept;
  };
}

/** The hash of a file as it is served, with the server's address filled in. Worked out again only when either changes. */
function servedStamp(): (text: string, server: string) => string {
  let last = { text: "", server: "", stamp: "" };
  return (text, server) => {
    if (last.text !== text || last.server !== server) last = { text, server, stamp: stamp(text.replaceAll("{{SERVER}}", server)) };
    return last.stamp;
  };
}

/** How a reference file of the skill is named: on disk, in its address and in /skill.json. */
const REFERENCE = /^[a-z0-9-]+\.md$/;

interface Reference {
  read: Awaited<ReturnType<typeof keptFile>>;
  stamped: ReturnType<typeof servedStamp>;
}

/**
 * The skill's reference files: each step in full, beside a SKILL.md short enough for a small model to follow.
 * A checkout without the folder has none, and its skill is the one file.
 */
async function keptReferences(dir: string): Promise<Map<string, Reference>> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => REFERENCE.test(name)).sort();
  return new Map(await Promise.all(names.map(async (name): Promise<[string, Reference]> => [name, { read: await keptFile(path.join(dir, name)), stamped: servedStamp() }])));
}

/** What anybody may fetch: the health check, what a Mac needs to work with this server, the fonts and the icons. */
export async function publicRoutes(): Promise<Router> {
  const routes = express.Router();

  routes.get("/healthz", (_req, res) => {
    res.type("text").send("ok");
  });

  // What a Mac needs to work with this server: the skill that runs the whole flow in a coding agent, the CLI that
  // captures and uploads, and the script that installs both and connects the agent (`curl <server>/install.sh | sh`).
  // None of them holds a secret, so they are public. The server fills in its own address.
  const skill = await keptFile(path.join(root, "skill", "SKILL.md"));
  const cli = await keptFile(path.join(root, "cli", "appshots.mjs"));
  const references = await keptReferences(path.join(root, "skill", "references"));
  const installer = await readFile(path.join(root, "cli", "install.sh"), "utf8");
  routes.get("/skill.md", async (req, res) => {
    res.type("text/markdown").set("Cache-Control", "no-cache").send((await skill()).text.replaceAll("{{SERVER}}", baseUrl(req)));
  });
  // The files SKILL.md sends the agent to, which setup and update install in the skill's references folder.
  routes.get("/skill/:name", async (req, res) => {
    const reference = references.get(req.params.name);
    if (!reference) return void res.status(404).set("Cache-Control", "no-store").end();
    res.type("text/markdown").set("Cache-Control", "private, no-cache").send((await reference.read()).text.replaceAll("{{SERVER}}", baseUrl(req)));
  });
  routes.get("/install.sh", (req, res) => {
    // The address ends up inside a shell script, and one that points somewhere other than where it was asked is no
    // use: an odd Host gets no script rather than one for the server's local address.
    const server = claimedUrl(req);
    if (!server) return void res.status(400).type("text").send("Set PUBLIC_URL to use the installer.\n");
    res.type("text/plain").set("Cache-Control", "no-cache").send(installer.replaceAll("{{SERVER}}", server));
  });
  routes.get("/cli/appshots.mjs", (_req, res) => {
    res.set("Content-Disposition", 'attachment; filename="appshots.mjs"').sendFile("appshots.mjs", { root: path.join(root, "cli") });
  });
  // The skill's hash depends on the address filled into it, which is the same for nearly every request. The
  // reference files have a key of their own, so that `skill` and `cli` mean what a Mac has always compared them with.
  const skillStamp = servedStamp();
  routes.get("/skill.json", async (req, res) => {
    const [{ text }, { stamp: cliStamp }, kept] = await Promise.all([skill(), cli(), Promise.all([...references.values()].map(({ read }) => read()))]);
    const server = baseUrl(req);
    const stamps = Object.fromEntries([...references].map(([name, { stamped }], index) => [name, stamped(kept[index].text, server)]));
    res.set("Cache-Control", "no-cache").json({ skill: skillStamp(text, server), cli: cliStamp, references: stamps });
  });

  const fontCss = await buildFontCss();
  routes.get("/fonts/fonts.css", (_req, res) => {
    res.type("css").set("Cache-Control", "public, max-age=86400").send(fontCss);
  });
  routes.get("/fonts/:font/:file", (req, res) => {
    // Own keys only: "constructor" or "toString" would find what every object has.
    const font = Object.hasOwn(FONTS, req.params.font) ? FONTS[req.params.font as keyof typeof FONTS] : undefined;
    if (!font || !/^[a-z0-9-]+\.woff2?$/.test(req.params.file)) return void res.status(404).set("Cache-Control", "no-store").end();
    res.set("Cache-Control", "public, max-age=31536000, immutable").sendFile(req.params.file, { root: path.join(root, "node_modules", font.pkg, "files") });
  });

  // Every icon as a symbol, for the Studio's picker: <use href="/icons.svg#rocket">.
  const iconSprite = `<svg xmlns="http://www.w3.org/2000/svg">${ICON_IDS.map((id) => `<symbol id="${id}" viewBox="0 0 256 256">${ICONS[id]}</symbol>`).join("")}</svg>`;
  routes.get("/icons.svg", (_req, res) => {
    res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400").send(iconSprite);
  });

  return routes;
}
