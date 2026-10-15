import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import express, { type Router } from "express";
import { FONTS, ICON_IDS } from "../../design.ts";
import { ICONS } from "../../icons.ts";
import { baseUrl } from "../security.ts";

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
  const installer = await readFile(path.join(root, "cli", "install.sh"), "utf8");
  routes.get("/skill.md", async (req, res) => {
    res.type("text/markdown").set("Cache-Control", "no-cache").send((await skill()).text.replaceAll("{{SERVER}}", baseUrl(req)));
  });
  routes.get("/install.sh", (req, res) => {
    const server = baseUrl(req);
    // The address ends up inside a shell script, and without PUBLIC_URL it is whatever Host the request claimed.
    if (!/^https?:\/\/[\w.:[\]-]+(\/[\w./~-]*)?$/.test(server)) return void res.status(400).type("text").send("Set PUBLIC_URL to use the installer.\n");
    res.type("text/plain").set("Cache-Control", "no-cache").send(installer.replaceAll("{{SERVER}}", server));
  });
  routes.get("/cli/appshots.mjs", (_req, res) => {
    res.set("Content-Disposition", 'attachment; filename="appshots.mjs"').sendFile("appshots.mjs", { root: path.join(root, "cli") });
  });
  // The skill's hash depends on the address filled into it, which is the same for nearly every request.
  let skillStamp = { text: "", server: "", stamp: "" };
  routes.get("/skill.json", async (req, res) => {
    const [{ text }, { stamp: cliStamp }] = await Promise.all([skill(), cli()]);
    const server = baseUrl(req);
    if (skillStamp.text !== text || skillStamp.server !== server) skillStamp = { text, server, stamp: stamp(text.replaceAll("{{SERVER}}", server)) };
    res.set("Cache-Control", "no-cache").json({ skill: skillStamp.stamp, cli: cliStamp });
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
