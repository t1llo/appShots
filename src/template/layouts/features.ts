import type { Feature, FeatureCards } from "../../schema.ts";
import type { FeatureStyleId } from "../design.ts";
import { tintedIcon } from "../parts/icons.ts";
import { imageUrl } from "../parts/images.ts";
import { esc, pick, rich, round } from "../parts/text.ts";
import { colorVars, featureImage, featureShot, type Scene } from "./scene.ts";

/** Where one card sits in the grid, as CSS grid lines. */
interface Cell {
  column: string;
  row: string;
  kind?: "hero" | "wide" | "tall";
}

const cell = (column: number, span: number, row: number, rows = 1, kind?: Cell["kind"]): Cell => ({ column: `${column}/span ${span}`, row: `${row}/span ${rows}`, kind });

/** Row heights of the bento grid, per unit of column width. */
const BENTO = { hero: 0.92, row: 0.74, wide: 0.5 };

/** Two columns: a hero across the top, then a tall card beside two stacked ones, the tall one changing sides each time. */
function bentoCells(count: number): { cells: Cell[]; rows: number[] } {
  const cells = [cell(1, 2, 1, 1, "hero")];
  const rows = [BENTO.hero];
  let left = count - 1;
  let tall = 1;
  while (left > 0) {
    const row = rows.length + 1;
    if (left === 1) {
      cells.push(cell(1, 2, row, 1, "wide"));
      rows.push(BENTO.wide);
      left -= 1;
    } else if (left === 2) {
      cells.push(cell(1, 1, row), cell(2, 1, row));
      rows.push(BENTO.row);
      left -= 2;
    } else {
      const other = 3 - tall;
      cells.push(cell(tall, 1, row, 2, "tall"), cell(other, 1, row), cell(other, 1, row + 1));
      rows.push(BENTO.row, BENTO.row);
      left -= 3;
      tall = other;
    }
  }
  return { cells, rows };
}

/** On a landscape canvas: the hero on the left over both rows, the other cards in two rows beside it. */
function wideBentoCells(count: number): { cells: Cell[]; tracks: number; rows: number } {
  const rest = count - 1;
  if (rest <= 0) return { cells: [cell(1, 1, 1, 1, "hero")], tracks: 1, rows: 1 };
  const rows = rest > 1 ? 2 : 1;
  const columns = Math.ceil(rest / rows);
  const cells = [cell(1, 2, 1, rows, "hero")];
  for (let i = 0; i < rest; i++) {
    const at = i % columns;
    // The last card of a shorter second row widens to close it.
    const span = i === rest - 1 ? columns - at : 1;
    cells.push(cell(3 + at, span, Math.floor(i / columns) + 1, 1, span > 1 ? "wide" : undefined));
  }
  return { cells, tracks: 2 + columns, rows };
}

/** Even cards in rows; the cards of a last, shorter row widen to fill it. */
function gridCells(count: number, columns: number): { cells: Cell[]; rows: number } {
  const rest = count % columns;
  const cells = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns) + 1;
    if (i < count - rest) return cell((i % columns) * 6 + 1, 6, row);
    const span = (columns * 6) / rest;
    return cell((i - (count - rest)) * span + 1, span, row, 1, "wide");
  });
  return { cells, rows: Math.ceil(count / columns) };
}

/** On a tablet's canvas: the hero two thirds wide beside two stacked cards, then rows of three. A shorter last row widens to close it. */
function tabletBentoCells(count: number): { cells: Cell[]; rows: number[] } {
  if (count === 1) return { cells: [cell(1, 6, 1, 1, "hero")], rows: [1.2] };
  const cells = [cell(1, 4, 1, 2, "hero")];
  const rows = [BENTO.row, BENTO.row];
  if (count === 2) cells.push(cell(5, 2, 1, 2, "tall"));
  else cells.push(cell(5, 2, 1), cell(5, 2, 2));
  let left = count - 3;
  while (left > 0) {
    const row = rows.length + 1;
    // Four make two rows of two; a row of three would leave one card alone.
    const across = left === 4 ? 2 : Math.min(left, 3);
    for (let i = 0; i < across; i++) cells.push(cell((i * 6) / across + 1, 6 / across, row, 1, across === 1 ? "wide" : undefined));
    rows.push(across === 1 ? BENTO.wide : BENTO.row);
    left -= across;
  }
  return { cells, rows };
}

/** The cards of a features slide, and the height they would like to have. They give some of it up when the copy needs the room. */
export function featuresHtml(features: Feature[], style: FeatureStyleId, cards: FeatureCards, scene: Scene, alone: boolean) {
  const { canvas, unit, locale, fallback } = scene;
  const count = features.length;
  const inner = canvas.width - unit * 14;
  let gap = unit * 2.4;
  let tracks = 1;
  let cells: Cell[];
  let rows: number[];
  let stretch = 1.3;
  // A tablet canvas is wide enough for three tiles in a row, and for larger rows.
  const tablet = canvas.width / canvas.height > 0.6;
  // A landscape canvas lays the cards out side by side, where a portrait one stacks them.
  const wide = canvas.width > canvas.height;
  // Rows of an icon beside its text, one or more across.
  let across = 0;
  // Type is sized for a card as wide as half a phone canvas, and follows the card from there.
  let column = unit * 41.8;
  if (style === "bento" && wide) {
    const bento = wideBentoCells(count);
    tracks = bento.tracks;
    column = (inner - gap * (tracks - 1)) / tracks;
    cells = bento.cells;
    rows = Array.from({ length: bento.rows }, () => column * 0.66);
    stretch = 1.4;
  } else if (style === "bento" && tablet) {
    const bento = tabletBentoCells(count);
    column = (inner - gap * 2) / 3;
    cells = bento.cells;
    rows = bento.rows.map((factor) => factor * column);
    tracks = 6;
    stretch = 1.4;
  } else if (style === "bento") {
    const bento = bentoCells(count);
    column = (inner - gap) / 2;
    cells = bento.cells;
    rows = bento.rows.map((factor) => factor * column);
    tracks = 2;
    stretch = 1.4;
  } else if (style === "grid") {
    // Rows come out even where they can: four make two rows of two on a tablet, not three and one.
    const fitting = wide ? (count <= 4 ? count : Math.ceil(count / 2)) : tablet && (count === 3 || count > 4) ? 3 : 2;
    const columns = Math.max(1, Math.min(count, cards.columns ?? fitting));
    const grid = gridCells(count, columns);
    column = (inner - gap * (columns - 1)) / columns;
    cells = grid.cells;
    // Cards that show a screenshot are tall enough for it to be read.
    const pictured = features.some((feature) => feature.screenshot);
    rows = Array.from({ length: grid.rows }, () => (pictured ? Math.min(column * (wide ? 0.92 : 1.42), unit * 76) : Math.min(column * (wide ? 0.66 : 0.8), unit * 52)));
    tracks = columns * 6;
  } else {
    if (style === "list") gap = unit * 1.2;
    const size = tablet ? 1.15 : 1;
    column *= size * size;
    across = Math.min(count, cards.columns ?? (wide && count > 3 ? 2 : 1), 4);
    cells = features.map((_, i) => cell((i % across) + 1, 1, Math.floor(i / across) + 1));
    rows = Array.from({ length: Math.ceil(count / across) }, () => unit * (style === "cards" ? 19 : 15.5) * size);
    tracks = across;
  }

  // A few cards may grow to carry the slide; many keep their size and give way in the page if they must.
  const gaps = gap * (rows.length - 1);
  const natural = rows.reduce((sum, row) => sum + row, 0);
  const grow = Math.min(stretch, Math.max(1, (canvas.height * (alone ? 0.7 : 0.56) - gaps) / natural));
  const height = natural * grow + gaps + (alone ? 0 : unit * 6.5);
  const scale = Math.min(1.7, Math.sqrt(column / (unit * 41.8)) * Math.min(1.3, grow));
  const icons = cards.icons ?? "gradient";

  const tiles = features.map((feature, i) => {
    const { column, row, kind } = cells[i]!;
    const title = pick(feature.title, locale, fallback);
    const detail = pick(feature.text, locale, fallback);
    const value = pick(feature.value, locale, fallback);
    const shot = featureShot(feature, scene);
    const image = featureImage(feature, scene);
    const shotImg = shot ? `<img src="${esc(shot.url)}" alt="" data-shot="${esc(shot.name)}">` : "";
    // A picture takes the icon's place: in a row it stands where the icon would, on a tile it stands under the text.
    let lead = "";
    if (shot) lead = across ? `<div class="f-lead thumb">${shotImg}</div>` : "";
    else if (value) lead = `<div class="f-lead"><span class="f-value">${esc(value)}</span></div>`;
    else if (image) lead = `<div class="f-lead art"><img class="f-img" src="${esc(imageUrl(scene.projectId, image))}" alt="" data-image="${esc(image.name)}"></div>`;
    else if (feature.icon) lead = `<div class="f-lead${icons === "badge" ? " badge" : ""}">${tintedIcon(feature.icon, "f-icon", scene.ids)}</div>`;
    const picture = shot && !across ? `<div class="f-shot${shot.wide ? " land" : ""}"><div class="f-shot-in" style="--sr:${round(shot.corner * 100)}cqw">${shotImg}</div></div>` : "";
    const text = `<div class="f-text"><div class="f-title">${rich(title)}</div>${detail ? `<div class="f-detail">${rich(detail)}</div>` : ""}</div>`;
    // The first card of a bento, and a card with a colour of its own, is washed in that colour.
    const classes = ["f-tile", kind, across ? "row" : "", picture ? "pic" : "", kind === "hero" || feature.color ? "wash" : ""].filter(Boolean).join(" ");
    const vars = [`grid-column:${column}`, `grid-row:${row}`, colorVars(feature)].filter(Boolean).join(";");
    return `<div class="${classes}" style="${vars}">${lead}${text}${picture}</div>`;
  });
  const grid = [`--fz:${round(scale)}`, `gap:${round(gap)}px`, `grid-template-columns:repeat(${tracks},minmax(0,1fr))`, `grid-template-rows:${rows.map((row) => `minmax(0,${round(row)}fr)`).join(" ")}`];
  // Rows side by side need that many times the width a single column of them is held to.
  if (across > 1) grid.push(`max-width:${round(unit * 98 * across + gap * 3)}px`, `column-gap:${round(gap * (style === "list" ? 3 : 1))}px`);
  const classes = ["features", `fs-${style}`, `fl-${cards.look ?? "glass"}`, `fi-${icons}`, alone ? "alone" : ""].filter(Boolean).join(" ");
  return `<div class="${classes}" style="flex-basis:${round(height)}px"><div class="f-grid" style="${grid.join(";")}">${tiles.join("")}</div></div>`;
}
