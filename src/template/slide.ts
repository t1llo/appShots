import path from "node:path";
import { TARGETS, type TargetId } from "../domain/devices.ts";
import { hasBakedIsland } from "../palette.ts";
import { type DeviceStyle, type Project, slidesFor } from "../schema.ts";
import { findShot, listImages, type Shot, shotsDir, type Space, type StoredImage } from "../store.ts";
import { CSS } from "./css.ts";
import { BADGES_SHOWN, bodyFont, type EmphasisId, type FeatureStyleId, type FontId, FONTS, type PointStyleId, REVIEWS_SHOWN } from "./design.ts";
import { FIT_SCRIPT } from "./fit.ts";
import { deviceStage } from "./layouts/devices.ts";
import { featuresHtml } from "./layouts/features.ts";
import { layoutDef, type LayoutId } from "./layouts/index.ts";
import { reviewsHtml } from "./layouts/reviews.ts";
import { type Scene, shapeOf } from "./layouts/scene.ts";
import { statHtml } from "./layouts/stat.ts";
import { stepsHtml } from "./layouts/steps.ts";
import { backgroundCss, backgroundLuminance, inkOn, resolveBackground } from "./parts/background.ts";
import { badgeHtml, DEFS } from "./parts/badges.ts";
import { statusLook } from "./parts/device.ts";
import { iconRowHtml } from "./parts/icons.ts";
import { logoHtml, placedHtml, shotUrl } from "./parts/images.ts";
import { pointsHtml } from "./parts/points.ts";
import { createIds, directionOf, esc, pick, rich, round } from "./parts/text.ts";
import { fontsToLoad, pageHtml, themeVars } from "./shell.ts";

export interface SlideContext {
  space: Space;
  project: Project;
  shots: Shot[];
  index: number;
  target: TargetId;
  locale: string;
  /** The project's images, when the caller has listed them once for a whole job. Read from the project when left out. */
  images?: StoredImage[];
}

export async function slideHtml(ctx: SlideContext): Promise<string> {
  const { project, shots, locale } = ctx;
  const shotsPath = shotsDir(ctx.space, project.id);
  const target = TARGETS[ctx.target];
  const slide = slidesFor(project, target.device)[ctx.index];
  if (!slide) throw new Error(`Slide ${ctx.index + 1} does not exist`);
  const fallback = project.locales[0] ?? "en";
  const theme = project.theme;
  const layout: LayoutId = slide.layout ?? "device-bottom";
  const def = layoutDef(layout);
  // Gradients and pen strokes are numbered per page, so the same slide always comes out the same.
  const ids = createIds();
  const rtl = directionOf(locale) === "rtl";

  const shot = findShot(shots, slide.screenshot, target.device, locale);
  const shot2 = findShot(shots, slide.screenshot2, target.device, locale);
  const shot3 = findShot(shots, slide.screenshot3, target.device, locale);
  const needsIsland = async (s: Shot | undefined) =>
    !s || s.device !== "iphone" || !(await hasBakedIsland(path.join(shotsPath, s.file), s.version, s.width));
  /** What a device needs to know about its screenshot: whether to draw the island, and the colour behind its status bar. */
  const dress = async (s: Shot | undefined) => ({ island: await needsIsland(s), status: await statusLook(s, deviceStyle, shotsPath) });

  const background = await resolveBackground(slide.background ?? theme.background, shotsPath, shot);
  const dark = backgroundLuminance(background) < 0.32;
  const textColor = slide.textColor ?? theme.textColor ?? (dark ? "#FFFFFF" : "#0B0B0F");
  const accent = slide.accentColor ?? theme.accentColor;
  const fontId: FontId = slide.font ?? theme.font ?? "inter";
  const font = FONTS[fontId];
  const body = bodyFont(fontId);
  const hasDevice = [slide.screenshot, slide.screenshot2, slide.screenshot3].slice(0, def.shots).some(Boolean);
  // A column beside the device reads from its start whatever the set's alignment is.
  const side = hasDevice && Boolean(def.side);
  const align = side ? "left" : (slide.align ?? theme.align ?? "center");
  const textScale = slide.textScale ?? theme.textScale ?? 1;
  const deviceStyle: DeviceStyle = { ...theme.device, ...slide.device };

  const eyebrow = pick(slide.eyebrow, locale, fallback);
  const headline = pick(slide.headline, locale, fallback);
  const sub = pick(slide.subheadline, locale, fallback);
  // The reviews layout hangs its review badges on the wall and keeps the others with the copy.
  const reviews = layout === "reviews";
  const wall = reviews ? (slide.badges ?? []).filter((badge) => badge.type === "review").slice(0, REVIEWS_SHOWN) : [];
  const badges = (slide.badges ?? []).filter((badge) => !reviews || badge.type !== "review").slice(0, BADGES_SHOWN);
  const badgePosition = slide.badgePosition ?? (layout === "hero" ? "top" : "bottom");
  // The features, stat and steps layouts draw them as their picture. Any other slide lists them with the copy.
  const own = Boolean(def.features);
  const features = own ? (slide.features ?? []) : [];
  const points = own ? [] : (slide.features ?? []);
  const cardStyle: FeatureStyleId = slide.featureStyle === "chips" ? "list" : (slide.featureStyle ?? "bento");
  const pointStyle: PointStyleId = !slide.featureStyle || slide.featureStyle === "bento" ? "list" : slide.featureStyle;

  const canvas = { width: target.width, height: target.height };
  // A Mac's canvas is wider than it is tall: the copy runs in long lines, and a column beside the device is narrower.
  const wide = canvas.width > canvas.height;
  // Type follows the width of a portrait canvas. A wide one is read from its height, which carries larger type.
  const unit = wide ? canvas.height / 150 : Math.min(canvas.width, canvas.height / 2) / 100;
  const column = wide ? 0.41 : 0.56;

  const badgesHtml = badges.length
    ? `<div class="badges ${badgePosition}">${badges.map((badge) => badgeHtml(badge, locale, fallback)).join("")}</div>`
    : "";
  const placed = slide.images ?? [];
  const needsImages = slide.logo || placed.length || features.some((feature) => feature.image);
  const images = needsImages ? (ctx.images ?? (await listImages(ctx.space, project.id))) : [];
  const headlineHtml = rich(headline);
  const emphasis: EmphasisId = slide.emphasis ?? theme.emphasis ?? "tint";
  // Without an accent colour there is nothing to tint the words with, so the rest of the headline steps back instead.
  const twoTone = emphasis === "tint" && !accent && headlineHtml.includes("<em>");
  // The copy column of a side layout is 56% of the canvas with one margin, or 41% on a wide one; the row is sized for what that leaves.
  const rowHtml = slide.iconRow ? iconRowHtml(slide.iconRow, side ? { width: canvas.width * column + unit * 9 } : canvas, unit, dark, locale, fallback) : "";
  const rowOnTop = slide.iconRow?.position === "top";
  const copyParts = [
    logoHtml(slide.logo, images, project.id),
    badgePosition === "top" ? badgesHtml : "",
    rowOnTop ? rowHtml : "",
    eyebrow ? `<div class="eyebrow${accent ? "" : " muted"}">${esc(eyebrow)}</div>` : "",
    headline ? `<h1 class="headline${twoTone ? " two-tone" : ""}">${headlineHtml}</h1>` : "",
    sub ? `<p class="sub">${rich(sub)}</p>` : "",
    points.length ? pointsHtml(points, pointStyle, !side, locale, fallback) : "",
    rowOnTop ? "" : rowHtml,
    badgePosition === "bottom" ? badgesHtml : "",
  ].join("");
  const copyHtml = copyParts ? `<div class="copy">${copyParts}</div>` : "";

  let stageHtml = "";
  let missing = "";
  if (hasDevice) {
    const group = [
      { shot, wanted: slide.screenshot },
      { shot: shot2, wanted: slide.screenshot2 },
      { shot: shot3, wanted: slide.screenshot3 },
    ].slice(0, def.shots);
    const url = (s: Shot | undefined) => s && shotUrl(project.id, s);
    stageHtml = await deviceStage({ layout, group, style: deviceStyle, target: target.device, canvas, unit, side, wide, rtl, ids, url, dress });
  } else {
    const scene: Scene = { canvas, unit, locale, fallback, projectId: project.id, shots, images, device: target.device, ids, missing: [] };
    if (layout === "stat") stageHtml = statHtml(features, scene);
    else if (layout === "steps") stageHtml = stepsHtml(features, scene);
    else if (reviews) stageHtml = reviewsHtml(wall, scene);
    else if (features.length) stageHtml = featuresHtml(features, cardStyle, slide.featureCards ?? {}, scene, !copyHtml);
    missing = scene.missing.join("");
  }

  const board = !hasDevice && Boolean(stageHtml);
  const filled = hasDevice || board;
  // Badges on a slide with nothing but copy have the room to be the picture.
  const badgeScale = (layout === "hero" ? 1.3 : 1.1) * (badges.length >= 3 ? 0.78 : 1) * (filled ? 1 : 1.3);
  const classes = ["canvas", `layout-${layout}`, `align-${align}`, `em-${emphasis}`, dark ? "dark" : "light", wide ? "wide" : "", side ? "side" : "", board ? "board" : "", filled ? "" : "no-device"]
    .filter(Boolean)
    .join(" ");
  // Feature points need room of their own: each row lets the copy take a little more of the slide before the text shrinks.
  const pointRows = pointStyle === "chips" ? Math.ceil(points.length / 2) * 0.6 : pointStyle === "grid" && !side ? Math.ceil(points.length / 2) : points.length;
  // Badges with the copy of a slide that is all type need room of their own too, or the headline shrinks to make it.
  const badgeRoom = board && badges.length ? (wide ? 0.13 : 0.07) : 0;
  const copyMax = !filled
    ? layout === "statement"
      ? def.copyMax
      : 0.92
    : side
      ? def.copyMax
      : Math.min(0.6, def.copyMax + badgeRoom + (points.length ? 0.03 + pointRows * 0.045 : 0));
  const vars = [
    `width:${target.width}px`,
    `height:${target.height}px`,
    `--u:${round(unit)}px`,
    // The copy column on a tablet canvas is as wide as a whole phone slide, so its type grows with it.
    // A statement is all headline, and a canvas wider than a phone's has the room to set it larger still.
    `--ts:${round(textScale * (side && target.width / target.height > 0.6 ? 1.3 : layout === "statement" ? { phone: 1, tablet: 1.3, wide: 1.2 }[shapeOf(canvas)] : 1))}`,
    `--bs:${round(badgeScale)}`,
    ...themeVars(font, body, textColor, accent),
    `--c:var(--accent)`,
    `--ci:${inkOn(accent ?? textColor)}`,
  ].join(";");
  const noise = typeof background === "object" && background.noise ? `<div class="noise" style="opacity:${round(background.noise * 0.6)}"></div>` : "";

  return pageHtml({
    title: `${project.name} · ${ctx.index + 1}`,
    locale,
    css: CSS,
    body: `<div class="${classes}" style="${vars}" data-copy-max="${round(copyMax)}" data-fonts="${esc(fontsToLoad(font, body))}">
<div class="bg" style="${backgroundCss(background)}"></div>${noise}${DEFS}
${placedHtml(placed, "behind", images, project.id)}
${copyHtml}
${stageHtml}${missing}
${placedHtml(placed, "front", images, project.id)}
</div>`,
    script: FIT_SCRIPT,
  });
}
