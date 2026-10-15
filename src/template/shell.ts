import { type FontDef, FONT_CSS_URL } from "./design.ts";
import { inkOn } from "./parts/background.ts";
import { directionOf, esc } from "./parts/text.ts";

/** The variables a slide or a creative sets its type in, and the colours of its copy. */
export function themeVars(font: FontDef, body: FontDef, text: string, accent: string | undefined): string[] {
  return [
    `--fs:${font.scale}`,
    `--hw:${font.weight}`,
    `--track:${font.tracking}`,
    `--text:${text}`,
    `--accent:${accent ?? text}`,
    // What the accent colour is drawn on needs ink that reads on it.
    `--mi:${inkOn(accent ?? text)}`,
    `--star:${accent ?? "#FFB61E"}`,
    `--font:'${font.family}','Inter Variable',system-ui,sans-serif`,
    `--body:'${body.family}','Inter Variable',system-ui,sans-serif`,
  ];
}

/** The faces a page waits for before it measures its copy, as the fit script reads them. */
export const fontsToLoad = (font: FontDef, body: FontDef) =>
  JSON.stringify([`${font.weight} 40px '${font.family}'`, `500 40px '${body.family}'`, `700 40px '${body.family}'`]);

/** A whole page: the language it is in and the way that language reads, the fonts, the styles, what is drawn and the script that readies it. */
export function pageHtml(page: { title: string; locale?: string; css: string; body: string; script: string; bodyStyle?: string }): string {
  const lang = page.locale ? ` lang="${esc(page.locale)}"${directionOf(page.locale) === "rtl" ? ' dir="rtl"' : ""}` : "";
  return `<!doctype html>
<html${lang}>
<head>
<meta charset="utf-8">
<title>${esc(page.title)}</title>
<link rel="stylesheet" href="${FONT_CSS_URL}">
<style>${page.css}</style>
</head>
<body${page.bodyStyle ? ` style="${page.bodyStyle}"` : ""}>
${page.body}
<script>${page.script}</script>
</body>
</html>`;
}
