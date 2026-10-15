// The public pages besides the home page: the documentation under /docs, the privacy policy and the terms, and
// what search engines and agents ask a site for (robots.txt, sitemap.xml, llms.txt).
//
// Every page is a Markdown file in docs/. It is shown inside the shell that Vite builds from web/docs.html, and
// handed out as plain Markdown too, at the page's address with .md on the end, for readers that prefer that.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { Marked } from "marked";
import { config } from "./config.ts";
import {
  BACKGROUNDS,
  BADGE_TONES,
  BADGE_TYPES,
  BADGES_SHOWN,
  CARD_ICONS,
  CARD_LOOKS,
  CREATIVE_LAYOUTS,
  DEVICE_COLOR_IDS,
  DEVICE_STYLES,
  EMPHASIS,
  FEATURE_STYLES,
  FONT_GROUPS,
  FONTS,
  ICON_GROUPS,
  ICON_IDS,
  ICON_ROW_STYLES,
  ICON_ROW_TONES,
  LAYOUT_SHOTS,
  LAYOUTS,
  LOGO_SHAPES,
  POINT_STYLES,
  REVIEWS_SHOWN,
  STATUS_BARS,
} from "./design.ts";
import { PLACEMENTS, placementsOf, TARGETS } from "./sizes.ts";

const root = path.resolve(import.meta.dirname, "..");
const docsDir = path.join(root, "docs");
const webDir = path.join(root, "web", "dist");

/** The sidebar, top to bottom. A page is the file docs/<name>.md. */
const SECTIONS: { title: string; pages: string[] }[] = [
  { title: "Start", pages: ["index", "quick-start", "connect", "update"] },
  { title: "Make a set", pages: ["skill", "screens", "mac", "web-apps", "studio", "images", "languages", "export", "app-store-connect", "mockups", "banners", "app-review"] },
  { title: "Reference", pages: ["slides", "store-assets", "sizes", "cli", "mcp", "api"] },
  { title: "Help", pages: ["accounts", "troubleshooting", "faq"] },
  { title: "Legal", pages: ["privacy", "terms"] },
];

/** The pages that live outside /docs, where people look for them. */
const TOP_LEVEL = new Set(["privacy", "terms"]);

const urlOf = (name: string) => (name === "index" ? "/docs" : TOP_LEVEL.has(name) ? `/${name}` : `/docs/${name}`);
const sourceOf = (name: string) => (TOP_LEVEL.has(name) ? `/${name}.md` : `/docs/${name}.md`);

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

// ---------------------------------------------------------------- what the pages fill in

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: string[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const described = (entries: Record<string, string>, head = "Value") => table([head, "What it is"], Object.entries(entries).map(([id, note]) => [`\`${id}\``, note]));
const codes = (ids: readonly string[]) => ids.map((id) => `\`${id}\``).join(", ");
const fonts = Object.entries(FONTS as Record<string, { family: string; group: string; note: string }>);

/**
 * Written as {{NAME}} in a page. The lists come from the code that draws the slides, so the reference cannot fall
 * behind it. {{SERVER}} is not here: it is this server's address, which is only known once somebody asks.
 */
const VALUES: Record<string, string> = {
  MAX_PROJECTS: String(config.limits.projects),
  MAX_SHOTS: String(config.limits.shots),
  RENDERS: String(config.limits.renders),
  // A name is plain text, whatever characters it has.
  OPERATOR: config.operator.name.replace(/[\\`*_{}[\]<>()#+!|~-]/g, "\\$&"),
  CONTACT: config.operator.email,
  ANALYTICS_HOST: config.umami ? new URL(config.umami.url).host : "",
  LAYOUTS: table(["Layout", "Screenshots", "What it is"], Object.entries(LAYOUTS).map(([id, note]) => [`\`${id}\``, String(LAYOUT_SHOTS[id as keyof typeof LAYOUT_SHOTS]), note])),
  BADGE_TYPES: described(BADGE_TYPES, "Type"),
  BADGE_TONES: described(BADGE_TONES, "Tone"),
  FEATURE_STYLES: described(FEATURE_STYLES, "Style"),
  CARD_LOOKS: described(CARD_LOOKS, "Look"),
  CARD_ICONS: described(CARD_ICONS, "Icons"),
  EMPHASIS: described(EMPHASIS),
  LAYOUT_COUNT: String(Object.keys(LAYOUTS).length),
  BADGES_SHOWN: String(BADGES_SHOWN),
  REVIEWS_SHOWN: String(REVIEWS_SHOWN),
  POINT_STYLES: described(POINT_STYLES, "Style"),
  ICON_ROW_STYLES: described(ICON_ROW_STYLES, "Style"),
  ICON_ROW_TONES: described(ICON_ROW_TONES, "Tone"),
  LOGO_SHAPES: described(LOGO_SHAPES, "Shape"),
  CREATIVE_LAYOUTS: described(CREATIVE_LAYOUTS, "Layout"),
  BACKGROUNDS: codes(Object.keys(BACKGROUNDS)),
  DEVICE_COLORS: codes(DEVICE_COLOR_IDS),
  DEVICE_STYLES: described(DEVICE_STYLES, "Look"),
  STATUS_BARS: described(STATUS_BARS),
  FONT_COUNT: String(fonts.length),
  FONTS: FONT_GROUPS.map((group) => `- **${group}:** ${fonts.filter(([, font]) => font.group === group).map(([id, font]) => `${font.family.replace(/ Variable$/, "")} (\`${id}\`)`).join(", ")}`).join("\n"),
  ICON_COUNT: String(ICON_IDS.length),
  BRAND_COUNT: String(ICON_GROUPS.Brands.length),
  BRANDS: codes(ICON_GROUPS.Brands),
  ICON_GROUPS: Object.entries(ICON_GROUPS as Record<string, readonly string[]>)
    .filter(([group]) => group !== "Brands")
    .map(([group, ids]) => `- **${group}:** ${codes(ids)}`)
    .join("\n"),
  TARGETS: table(
    ["Folder", "Pixels", "Display in App Store Connect", "Exported"],
    Object.entries(TARGETS).map(([id, target]) => [`\`${id}\``, `${target.width} × ${target.height}`, target.slot, "standard" in target ? "Always" : "When you ask"]),
  ),
  PLACEMENTS: table(
    ["Asset", "Pixels", "Safe area", "Used for"],
    placementsOf("store")
      .map((id) => [id, PLACEMENTS[id]] as const)
      .map(([id, place]) => [`\`${id}\``, `${place.width} × ${place.height} (${place.ratio})`, `${place.safe.width} × ${place.safe.height} at ${place.safe.x}, ${place.safe.y}`, place.note]),
  ),
  BANNERS: table(
    ["Banner", "Pixels", "Used for"],
    placementsOf("banner")
      .map((id) => [id, PLACEMENTS[id]] as const)
      .map(([id, place]) => [`\`${id}\``, `${place.width} × ${place.height} (${place.ratio})`, place.note]),
  ),
};

/** What `<!-- if name -->` asks about. */
const FLAGS: Record<string, boolean> = {
  analytics: config.umami != null,
  recorder: config.umami?.recorder === true,
  operator: config.operator.name !== "",
  contact: config.operator.email !== "",
};

/** Keeps the half of every `<!-- if name -->…<!-- else -->…<!-- endif -->` that holds on this server, then fills in the values. */
function fill(source: string): string {
  return source
    .replace(/<!-- if (\w+) -->\n?([\s\S]*?)(?:<!-- else -->\n?([\s\S]*?))?<!-- endif -->\n?/g, (_all, flag: string, yes: string, no = "") => (FLAGS[flag] ? yes : no))
    .replace(/\{\{([A-Z_]+)\}\}/g, (all, name: string) => VALUES[name] ?? all);
}

// ---------------------------------------------------------------- the pages

interface Heading {
  id: string;
  text: string;
}

interface Page {
  name: string;
  url: string;
  source: string;
  section: string;
  title: string;
  /** What the sidebar calls it, where the title is too long for that. */
  label: string;
  description: string;
  /** The day the text last changed, for pages where that matters: 2026-10-11. */
  updated?: string;
  markdown: string;
  html: string;
  headings: Heading[];
}

const anchor = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";

function render(markdown: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const taken = new Set<string>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const plain = text.replace(/[`*]/g, "");
        let id = anchor(plain);
        for (let n = 2; taken.has(id); n++) id = `${anchor(plain)}-${n}`;
        taken.add(id);
        if (depth === 2) headings.push({ id, text: plain });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
    },
  });
  // A wide table scrolls inside its own box instead of pushing the page sideways.
  const html = (marked.parse(markdown) as string).replaceAll("<table>", '<div class="table-wrap"><table>').replaceAll("</table>", "</table></div>");
  return { html, headings };
}

function load(name: string, section: string): Page | null {
  const file = path.join(docsDir, `${name}.md`);
  if (!existsSync(file)) {
    console.warn(`The documentation page docs/${name}.md is missing, so it is left out.`);
    return null;
  }
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(readFileSync(file, "utf8"));
  const meta: Record<string, string> = {};
  for (const line of match?.[1]?.split("\n") ?? []) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (!match || !meta.title || !meta.description) {
    console.warn(`docs/${name}.md has to start with a title and a description between --- lines, so it is left out.`);
    return null;
  }
  const markdown = fill(match[2]!).trim();
  return { name, url: urlOf(name), source: sourceOf(name), section, title: meta.title, label: meta.nav ?? meta.title, description: meta.description, updated: meta.updated, markdown, ...render(markdown) };
}

const pages = SECTIONS.flatMap((section) => section.pages.map((name) => load(name, section.title))).filter((page) => page != null);
const pageByName = new Map(pages.map((page) => [page.name, page]));

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** A page as Markdown, title included, the way an agent reads it. */
const asMarkdown = (page: Page) => `# ${page.title}\n\n${page.updated ? `Last updated: ${day(page.updated)}\n\n` : ""}${page.markdown}\n`;

// ---------------------------------------------------------------- HTML

const SUMMARY = "App Store screenshots for iPhone, iPad and Mac, made by your coding agent over MCP or by hand in the Studio. Device frames, headlines, badges, and every size App Store Connect asks for.";

/** JSON inside a <script> tag: a "<" in it must not be able to end the tag. */
const jsonLd = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;

/** The tags that say where a page lives and what a shared link to it shows. They need the server's own address. */
function shareTags(base: string, page: { url: string; title: string; description: string; article?: boolean; found?: boolean }): string {
  const address = `${base}${page.url}`;
  return [
    page.found === false ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${escapeHtml(address)}" />`,
    `<meta property="og:site_name" content="appShots" />`,
    `<meta property="og:type" content="${page.article ? "article" : "website"}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(address)}" />`,
    `<meta property="og:image" content="${escapeHtml(base)}/og.jpg" />`,
    `<meta property="og:image:width" content="1593" />`,
    `<meta property="og:image:height" content="676" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n    ");
}

/**
 * The tags of the page analytics, for the head of a page, or nothing on a server that has none. With PUBLIC_URL set,
 * only pages opened under that address are counted. The Studio shows people's unreleased apps, and both its title
 * and the part of its address after the # name the project that is open: there the title sent is always the Studio's
 * own, that part of the address stays in the browser, and the recorder is never loaded.
 */
function analyticsTags(studio: boolean): string {
  const umami = config.umami;
  if (!umami) return "";
  const domain = URL.canParse(config.publicUrl) ? ` data-domains="${escapeHtml(new URL(config.publicUrl).hostname)}"` : "";
  const script = (file: string, more = "") => `<script defer src="${escapeHtml(umami.url)}/${file}" data-website-id="${umami.website}"${more}></script>`;
  if (studio) {
    return [
      `<script>window.studioAnalytics = function (type, payload) { payload.title = "appShots Studio"; return payload; };</script>`,
      script("script.js", `${domain} data-tag="studio" data-exclude-hash="true" data-before-send="studioAnalytics"`),
    ].join("\n    ");
  }
  return [script("script.js", domain), ...(umami.recorder ? [script("recorder.js")] : [])].join("\n    ");
}

/**
 * A page of web/dist as text, with the analytics in its head, read again whenever a build has replaced it. Null
 * until the pages are built.
 */
const shells = new Map<string, { at: number; text: string }>();
function shell(name: string): string | null {
  const file = path.join(webDir, name);
  if (!existsSync(file)) return null;
  const at = statSync(file).mtimeMs;
  const kept = shells.get(name);
  if (kept?.at === at) return kept.text;
  const text = readFileSync(file, "utf8").replace("<!--site:analytics-->", () => analyticsTags(name === "index.html"));
  shells.set(name, { at, text });
  return text;
}

/** The Studio's page. Null until the pages are built. */
export const studioPage = (): string | null => shell("index.html");

/** The home page, which has its title already, with its address and the picture for shared links filled in. Null until the pages are built. */
export function homePage(base: string): string | null {
  const page = shell("home.html");
  if (!page) return null;
  const tags = [
    shareTags(base, { url: "/", title: "appShots · App Store screenshots by your agent", description: SUMMARY }),
    jsonLd({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "appShots",
      description: SUMMARY,
      url: `${base}/`,
      image: `${base}/og.jpg`,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, macOS",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    }),
  ].join("\n    ");
  return page.replace("<!--site:head-->", () => tags);
}

function sidebar(current: Page | null): string {
  return SECTIONS.map((section) => {
    const links = pages
      .filter((page) => page.section === section.title)
      .map((page) => `<li><a href="${page.url}"${page === current ? ' aria-current="page"' : ""}>${escapeHtml(page.label)}</a></li>`)
      .join("");
    return `<p>${section.title}</p><ul>${links}</ul>`;
  }).join("\n");
}

function pager(current: Page): string {
  const at = pages.indexOf(current);
  const link = (page: Page | undefined, kind: "Previous" | "Next") => (page ? `<a class="${kind.toLowerCase()}" href="${page.url}"><small>${kind}</small>${escapeHtml(page.label)}</a>` : "<span></span>");
  return `<nav class="docs-pager" aria-label="Previous and next page">${link(pages[at - 1], "Previous")}${link(pages[at + 1], "Next")}</nav>`;
}

function contents(page: Page): string {
  const links = page.headings.map((heading) => `<li><a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`).join("");
  return `${links ? `<p>On this page</p><ul>${links}</ul>` : ""}<a class="docs-source" href="${page.source}">View as Markdown</a>`;
}

function sendDoc(req: Request, res: Response, base: string, page: Page | null): void {
  const frame = shell("docs.html");
  if (!frame) return void res.status(503).type("text").send("The web pages have not been built yet. Run: npm run build");
  const title = !page ? "Page not found · appShots docs" : page.name === "index" ? "appShots documentation" : `${page.title} · appShots docs`;
  const description = page?.description ?? "There is no page at this address.";
  const head = [`<title>${escapeHtml(title)}</title>`, `<meta name="description" content="${escapeHtml(description)}" />`];
  if (page) {
    head.push(
      shareTags(base, { url: page.url, title, description, article: true }),
      `<link rel="alternate" type="text/markdown" href="${page.source}" />`,
      jsonLd({
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: page.title,
        description: page.description,
        url: `${base}${page.url}`,
        ...(page.updated ? { dateModified: page.updated } : {}),
        isPartOf: { "@type": "WebSite", name: "appShots", url: `${base}/` },
      }),
    );
  } else head.push(shareTags(base, { url: req.path, title, description, found: false }));
  const body = page
    ? `<h1>${escapeHtml(page.title)}</h1>\n${page.updated ? `<p class="docs-updated">Last updated ${day(page.updated)}</p>\n` : ""}${page.html}`
    : '<h1>Page not found</h1>\n<p>There is no page at this address. The <a href="/docs">documentation</a> starts here, and the list on the left has every page.</p>';
  const html = frame
    .replace("<!--docs:head-->", () => head.join("\n    "))
    .replace("<!--docs:nav-->", () => sidebar(page))
    .replace("<!--docs:body-->", () => body)
    .replace("<!--docs:pager-->", () => (page ? pager(page) : ""))
    .replace("<!--docs:toc-->", () => (page ? contents(page) : ""))
    .replaceAll("{{SERVER}}", escapeHtml(base));
  res
    .status(page ? 200 : 404)
    .set("Cache-Control", "no-cache")
    .type("html")
    .send(html);
}

// ---------------------------------------------------------------- routes

/** Registers everything above. `baseUrl` gives the address this server is reached at. */
export function siteRoutes(app: Express, baseUrl: (req: Request) => string): void {
  const sendMarkdown = (req: Request, res: Response, page: Page) => {
    res.type("text/markdown").set("Cache-Control", "no-cache").send(asMarkdown(page).replaceAll("{{SERVER}}", baseUrl(req)));
  };
  const send = (req: Request, res: Response, page: Page | null) => {
    // An agent that asks for Markdown gets it at the page's own address too.
    if (page && req.accepts(["html", "text/markdown"]) === "text/markdown") return sendMarkdown(req, res.vary("Accept"), page);
    sendDoc(req, res.vary("Accept"), baseUrl(req), page);
  };

  app.get("/docs", (req, res) => send(req, res, pageByName.get("index") ?? null));
  app.get("/docs/:name", (req, res) => {
    const plain = req.params.name.endsWith(".md");
    const name = plain ? req.params.name.slice(0, -3) : req.params.name;
    const page = pageByName.get(name);
    if (page && plain) return sendMarkdown(req, res, page);
    // One address per page: /docs/index and /docs/privacy are not it.
    if (page && page.url !== `/docs/${name}`) return res.redirect(301, page.url);
    send(req, res, plain ? null : (page ?? null));
  });
  for (const name of TOP_LEVEL) {
    const page = pageByName.get(name);
    if (!page) continue;
    app.get(page.url, (req, res) => send(req, res, page));
    app.get(page.source, (req, res) => sendMarkdown(req, res, page));
  }

  // The example set from the README, which is what a shared link shows.
  app.get("/og.jpg", (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400").sendFile(path.join(docsDir, "example.jpg"));
  });

  app.get("/robots.txt", (req, res) => {
    const lines = ["User-agent: *", "Allow: /", ...["/api/", "/auth/", "/mcp", "/render/", "/files/", "/studio"].map((route) => `Disallow: ${route}`), "", `Sitemap: ${baseUrl(req)}/sitemap.xml`];
    res.type("text").send(`${lines.join("\n")}\n`);
  });

  app.get("/sitemap.xml", (req, res) => {
    const base = escapeHtml(baseUrl(req));
    const entries = [`<url><loc>${base}/</loc></url>`, ...pages.map((page) => `<url><loc>${base}${page.url}</loc>${page.updated ? `<lastmod>${page.updated}</lastmod>` : ""}</url>`)];
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`);
  });

  // llms.txt (llmstxt.org): what the site is and where each page is as Markdown. llms-full.txt is all of them in one file.
  app.get("/llms.txt", (req, res) => {
    const base = baseUrl(req);
    const lines = [
      "# appShots",
      "",
      `> ${SUMMARY}`,
      "",
      `appShots is a web app at ${base}. People sign in with Google and make a set of App Store screenshots in the Studio, its editor, or let a coding agent (Claude Code, Codex, OpenCode, Pi or another) make the whole set through the server's MCP endpoint at ${base}/mcp, the \`appshots\` skill and the \`appshots\` command for the Mac. Every page below is plain Markdown.`,
      ...SECTIONS.flatMap((section) => ["", `## ${section.title}`, "", ...pages.filter((page) => page.section === section.title).map((page) => `- [${page.title}](${base}${page.source}): ${page.description}`)]),
      "",
      "## Optional",
      "",
      `- [Everything in one file](${base}/llms-full.txt): all of the pages above, one after the other`,
      `- [The skill](${base}/skill.md): the instructions an agent follows to make a set from start to finish`,
    ];
    res.type("text/markdown").set("Cache-Control", "no-cache").send(`${lines.join("\n")}\n`);
  });
  app.get("/llms-full.txt", (req, res) => {
    const base = baseUrl(req);
    const all = pages.map((page) => `${asMarkdown(page).replace(/^# .*\n/, (title) => `${title}\nSource: ${base}${page.url}\n`)}`).join("\n---\n\n");
    res
      .type("text/markdown")
      .set("Cache-Control", "no-cache")
      .send(`# appShots documentation\n\n> ${SUMMARY}\n\n---\n\n${all}`.replaceAll("{{SERVER}}", base));
  });
}
