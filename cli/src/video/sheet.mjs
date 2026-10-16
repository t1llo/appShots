import { renameSync, rmSync } from "node:fs";
import { fail } from "../fail.mjs";
import { run } from "../proc.mjs";
import { toolEnv } from "./ffmpeg.mjs";
import { durationOf, playedSize, probe, videoStreams } from "./probe.mjs";

/** The longer side of a picture on the sheet, in pixels: enough to spot a wrong screen or real data. */
const CELL = 360;
/** The space around and between pictures, in the colour of the sheet. */
const GAP = 4;
/** How wide a row may get before it wraps, and how many pictures it holds at most. */
const ROW_WIDTH = 2000;
const MOST_COLUMNS = 10;
const BACKGROUND = "0x2b2b2b";

/**
 * @typedef {object} SheetLayout
 * @property {[number, number]} cell The size each picture is fitted into.
 * @property {number} columns
 * @property {Array<{ frames: number, rows: number, height: number }>} files For each file, in order: how many
 *   pictures it gives, on how many rows, and how tall its block is.
 * @property {number} width
 * @property {number} height
 */

/**
 * Where the pictures of a contact sheet go. Every file gets a block of rows of its own, one picture every
 * `every` seconds from its start, all in cells of one size so the blocks line up.
 * @param {Array<{ size: [number, number], seconds: number }>} videos
 * @param {number} every
 * @returns {SheetLayout}
 */
export function sheetLayout(videos, every) {
  const scaled = videos.map(({ size: [width, height] }) => {
    const scale = CELL / Math.max(width, height);
    return [Math.max(2, Math.round((width * scale) / 2) * 2), Math.max(2, Math.round((height * scale) / 2) * 2)];
  });
  const cell = /** @type {[number, number]} */ ([Math.max(...scaled.map((size) => size[0])), Math.max(...scaled.map((size) => size[1]))]);
  const columns = Math.max(1, Math.min(MOST_COLUMNS, Math.floor((ROW_WIDTH - GAP) / (cell[0] + GAP))));
  const files = videos.map(({ seconds }) => {
    // ffmpeg's fps filter gives a picture at 0, every, 2 × every… while the video lasts.
    const frames = Math.max(1, Math.ceil(seconds / every - 1e-6));
    const rows = Math.ceil(frames / columns);
    return { frames, rows, height: rows * cell[1] + (rows + 1) * GAP };
  });
  return {
    cell,
    columns,
    files,
    width: columns * cell[0] + (columns + 1) * GAP,
    height: files.reduce((sum, file) => sum + file.height, 0),
  };
}

/**
 * A contact sheet: one PNG with a picture every `every` seconds of each video, a block of rows per video, in the
 * order given. For looking over recordings and previews before they are cut or sent: a wrong screen, a keyboard
 * that is up, a spinner, real data. There is no text on it (Homebrew's ffmpeg draws none), so the caller says
 * which block is which.
 * @param {string[]} files
 * @param {string} out
 * @param {{ every?: number }} options
 * @param {import("./ffmpeg.mjs").Tools} tools
 */
export async function contactSheet(files, out, { every = 1 }, tools) {
  if (files.length === 0) fail("There is no video to make a contact sheet of.");
  if (!Number.isFinite(every) || every <= 0) fail("--every takes the seconds between pictures, such as --every 1 or --every 0.5.");
  const videos = [];
  for (const file of files) {
    const probed = await probe(file, tools, { count: false });
    const [video] = videoStreams(probed);
    const seconds = durationOf(probed);
    if (!video || !seconds) fail(`${file} has no video to take pictures of.`);
    videos.push({ file, size: playedSize(video), seconds });
  }
  const layout = sheetLayout(videos, every);
  const [width, height] = layout.cell;
  const chains = layout.files.map(({ rows }, at) =>
    // A whole block of rows is one tile, and the last one is padded with the background where pictures run out.
    `[${at}:v]fps=1/${every},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${BACKGROUND},setsar=1,format=rgb24,tile=${layout.columns}x${rows}:padding=${GAP}:margin=${GAP}:color=${BACKGROUND}[block${at}]`,
  );
  const blocks = layout.files.map((_, at) => `[block${at}]`).join("");
  const graph = files.length > 1 ? `${chains.join(";")};${blocks}vstack=inputs=${files.length}[sheet]` : chains[0].replace(/\[block0\]$/, "[sheet]");
  const temporary = `${out}.${process.pid}.png`;
  const args = ["-nostdin", "-hide_banner", "-v", "error", "-y", ...files.flatMap((file) => ["-i", file]), "-filter_complex", graph, "-map", "[sheet]", "-frames:v", "1", "-update", "1", temporary];
  const result = await run(tools.ffmpeg, args, { env: toolEnv(tools), timeout: 300000 });
  if (result.status !== 0) {
    rmSync(temporary, { force: true });
    const said = (result.stderr || result.error?.message || "").trim().split("\n").pop();
    fail(`ffmpeg did not make the contact sheet${said ? `: ${said}` : ""}.`);
  }
  renameSync(temporary, out);
  return {
    file: out,
    width: layout.width,
    height: layout.height,
    columns: layout.columns,
    every,
    blocks: videos.map(({ file }, at) => ({ file, frames: layout.files[at].frames, rows: layout.files[at].rows })),
  };
}
