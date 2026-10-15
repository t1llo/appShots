import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import { homePage, siteRoutes as docsRoutes, studioPage } from "../../site.ts";
import { identify } from "../auth.ts";
import { baseUrl } from "../security.ts";

/** The Studio and the home page, built from web/ by `npm run build`. */
export const webDir = path.resolve(import.meta.dirname, "..", "..", "..", "web", "dist");

/** A page of web/dist as src/site.ts filled it in, with what only the server knows: its address, its analytics. */
function sendPage(res: Response, page: string | null): void {
  if (page == null) return void res.status(503).type("text").send("The web pages have not been built yet. Run: npm run build");
  res.set("Cache-Control", "no-cache").type("html").send(page);
}

/** The home page carries its own address, for search engines and shared links. */
const sendHome = (req: Request, res: Response) => sendPage(res, homePage(baseUrl(req)));

/** The home page, the Studio's page, the documentation and the legal pages: everything a browser opens by address. */
export function siteRoutes(app: Express): void {
  // The built scripts and styles carry no data and have content hashes in their names, so they are public and cached for good.
  app.use("/assets", express.static(path.join(webDir, "assets"), { immutable: true, maxAge: "1y" }));

  /** One address, two pages: the Studio for whoever is signed in, the public home page for everybody else. */
  app.get("/", (req, res) => (identify(req) ? sendPage(res, studioPage()) : sendHome(req, res)));
  // The home page under its own address too, so it can be looked at while signed in or with sign-in off.
  app.get("/home", sendHome);
  // The documentation, the privacy policy and the terms, which anybody can read.
  docsRoutes(app, baseUrl);
  // Where every "Open Studio" button points: straight in for whoever is signed in, through Google for everybody else.
  app.get("/studio", (req, res) => res.redirect(identify(req) ? "/" : "/auth/google"));
  // Addresses from before the home page did the signing in.
  app.get(["/login", "/signup", "/reset"], (_req, res) => res.redirect("/"));
}
