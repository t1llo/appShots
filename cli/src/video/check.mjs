import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fail } from "../fail.mjs";
import { writeAtomic } from "../update.mjs";
import { findFfmpeg } from "./ffmpeg.mjs";
import { audioStreams, durationOf, numberOf, playedSize, probe, rateOf, videoStreams } from "./probe.mjs";
import { displayForSize, PREVIEW_FORMAT, PREVIEW_SPECS } from "./specs.mjs";
import { timecode } from "./timecode.mjs";

/**
 * @typedef {{ rule: string, value: string | number, expected: string }} Rule One finding: what was measured,
 *   and what Apple takes.
 * @typedef {{ display: string | null, errors: Rule[], warnings: Rule[], passed: Rule[] }} Verdict
 *
 * @typedef {object} Layer One layer of the server's set, as its manifest lists it.
 * @property {string} id
 * @property {string | null} locale
 * @property {string} kind
 * @property {number} [fit] How far the server had to shrink the text to fit, 1 for not at all.
 * @property {boolean} [fallback] Whether the text is another language's, as this one has none.
 *
 * @typedef {object} Manifest
 * @property {Layer[]} layers
 * @property {Array<{ locale: string | null, layer: string, kind: string, detail: string }>} [warnings]
 */

/** What each rule is called in the report, in the order it is reported. */
export const RULE_LABELS = {
  "video-streams": "video stream",
  codec: "codec",
  profile: "profile",
  level: "level",
  "pix-fmt": "pixel format",
  size: "size",
  sar: "pixel shape",
  "field-order": "scan",
  "frame-rate": "frame rate",
  frames: "frames",
  duration: "length",
  "file-size": "file size",
  audio: "audio track",
  "audio-codec": "audio codec",
  "audio-channels": "audio channels",
  "audio-rate": "sample rate",
  "audio-default": "default track",
  draft: "draft",
  "duration-margin": "length margin",
  bitrate: "video bitrate",
  "audio-bitrate": "audio bitrate",
  color: "colour tags",
  faststart: "index first",
  "audio-length": "audio length",
  cards: "intro and outro",
  "first-app-frame": "first app frame",
  "caption-style": "caption style",
  "caption-fit": "caption fit",
  "caption-fallback": "caption language",
  previews: "previews",
};

/** Silent AAC comes out at about 2 kbps; no track with sound in it is that small. */
const SILENT_AUDIO = 16000;
/** Under this, a track with sound in it is thin next to the 256 kbps Apple asks for. */
const THIN_AUDIO = 128000;
/** How far the two tracks may end apart: a frame, and the tail of one AAC frame. */
const TRACKS_APART = 1 / 30 + 1024 / 48000;

/** @param {number} seconds */
const secondsText = (seconds) => `${seconds.toFixed(2)} s`;
/** @param {number} bytes */
const megabytes = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
/** @param {[number, number] | null} size */
const sizeText = (size) => (size ? `${size[0]}x${size[1]}` : "");

/**
 * The sizes a display takes, as the report says them.
 * @param {string} display
 */
const sizesOf = (display) => {
  const spec = PREVIEW_SPECS[display];
  return [spec.portrait, spec.landscape].filter((size) => size !== null).map((size) => sizeText(size)).join(" or ");
};

/**
 * Checks what ffprobe says of a file against Apple's specification for app previews. Pure, so the tests run it
 * on stored probes. Errors are what App Store Connect refuses or plays wrongly; warnings are what passes but is
 * worth a look.
 *
 * A draft (compose --draft) is fast and small, so it is always an error, and its bitrate is not judged.
 * @param {import("./probe.mjs").Probe} probe
 * @param {string | null | undefined} display The display the file is for, or nothing to go by its size.
 * @param {{ draft?: boolean, file?: string }} [options] file: the file's name, as ProRes is only taken in a .mov.
 * @returns {Verdict}
 */
export function checkProbe(probe, display, { draft = false, file } = {}) {
  if (display && !Object.hasOwn(PREVIEW_SPECS, display)) fail(`No app preview display "${display}". The displays are ${Object.keys(PREVIEW_SPECS).join(", ")}.`);
  /** @type {Verdict} */
  const verdict = { display: display ?? null, errors: [], warnings: [], passed: [] };
  /**
   * @param {string} rule
   * @param {boolean} ok
   * @param {string | number} value
   * @param {string} expected
   * @param {"error" | "warning"} [severity]
   */
  const judge = (rule, ok, value, expected, severity = "error") => {
    (ok ? verdict.passed : severity === "error" ? verdict.errors : verdict.warnings).push({ rule, value, expected });
  };

  const videos = videoStreams(probe);
  judge("video-streams", videos.length === 1, videos.length, "1");
  const [video] = videos;
  const prores = video?.codec_name === "prores";
  if (video) {
    const movie = !file || /\.mov$/i.test(file);
    const codec = [video.codec_name ?? "none", prores ? video.profile : null].filter(Boolean).join(" ");
    judge("codec", video.codec_name === "h264" || (prores && video.profile === "HQ" && movie), codec, "h264, or ProRes 422 HQ in a .mov");
    // Profiles and levels are named and numbered per codec; these are H.264's, and any other codec is refused above.
    if (video.codec_name === "h264") {
      judge("profile", PREVIEW_FORMAT.profiles.includes(video.profile ?? ""), video.profile ?? "none", "High, Main or Baseline");
      const level = video.level ?? -99;
      // ffprobe says -99 for a level it cannot read; that is not one above 4.0.
      judge("level", level <= PREVIEW_FORMAT.level, level > 0 ? (level / 10).toFixed(1) : "unknown", "4.0 or lower");
    }
    const format = prores ? "yuv422p10le" : "yuv420p";
    judge("pix-fmt", video.pix_fmt === format, video.pix_fmt ?? "none", format);

    const played = playedSize(video);
    const sized = display ?? displayForSize(...played);
    verdict.display = sized;
    const fits = sized !== null && [PREVIEW_SPECS[sized].portrait, PREVIEW_SPECS[sized].landscape].some((size) => size && size[0] === played[0] && size[1] === played[1]);
    const every = Object.keys(PREVIEW_SPECS).map((key) => `${sizesOf(key)} (${key})`).join(", ");
    judge("size", fits, sizeText(played), sized ? `${sizesOf(sized)} for ${sized}` : `a preview size: ${every}`);

    const sar = video.sample_aspect_ratio;
    // No ratio at all, or 0:1, is a file that says nothing about it, and its pixels are square.
    judge("sar", !sar || sar === "1:1" || sar === "0:1" || sar === "N/A", sar ?? "1:1", "1:1");
    const order = video.field_order;
    judge("field-order", !order || order === "progressive" || order === "unknown", order ?? "progressive", "progressive");

    const real = rateOf(video.r_frame_rate);
    const average = rateOf(video.avg_frame_rate);
    const steady = real !== null && Math.abs(real - PREVIEW_FORMAT.fps) < 0.001 && (average === null || Math.abs(average - PREVIEW_FORMAT.fps) < 0.005);
    const rates = average !== null && video.avg_frame_rate !== video.r_frame_rate ? `${video.r_frame_rate}, average ${average.toFixed(3)}` : video.r_frame_rate ?? "unknown";
    judge("frame-rate", steady, rates, `${PREVIEW_FORMAT.fps}/1, constant`);

    const counted = numberOf(video.nb_read_frames);
    const length = numberOf(video.duration) ?? durationOf(probe);
    if (counted !== null && length !== null) {
      const due = Math.round(length * PREVIEW_FORMAT.fps);
      judge("frames", Math.abs(counted - due) <= 1, counted, `${due} ± 1 for ${secondsText(length)} at ${PREVIEW_FORMAT.fps} fps`);
    }
  }

  const seconds = durationOf(probe);
  const [shortest, longest] = PREVIEW_FORMAT.seconds;
  if (seconds === null) judge("duration", false, "unknown", `${shortest} to ${longest} s`);
  else judge("duration", seconds >= shortest && seconds <= longest, secondsText(seconds), `${shortest} to ${longest} s`);
  const bytes = numberOf(probe.format.size);
  if (bytes !== null) judge("file-size", bytes <= PREVIEW_FORMAT.maxBytes, megabytes(bytes), `at most ${megabytes(PREVIEW_FORMAT.maxBytes)}`);

  const [audio] = audioStreams(probe);
  const { audio: sound } = PREVIEW_FORMAT;
  judge("audio", audio !== undefined, audio ? "1 track" : "none", "a stereo AAC track, silent if need be");
  if (audio) {
    judge("audio-codec", audio.codec_name === "aac", audio.codec_name ?? "none", "aac");
    judge("audio-channels", audio.channels === sound.channels, audio.channels ?? "unknown", String(sound.channels));
    const rate = numberOf(audio.sample_rate);
    judge("audio-rate", rate !== null && sound.rates.includes(rate), rate ?? "unknown", sound.rates.join(" or "));
    judge("audio-default", audio.disposition?.default === 1, audio.disposition?.default === 1 ? "default" : "not default", "default");
  }
  if (draft) judge("draft", false, "draft", "a final encode: compose without --draft");

  if (seconds !== null && seconds <= longest) judge("duration-margin", seconds <= 29.9, secondsText(seconds), "29.9 s or less, as Apple rounds", "warning");
  if (video && !prores && !draft) {
    const own = numberOf(video.bit_rate);
    const whole = numberOf(probe.format.bit_rate);
    const rate = own ?? (whole !== null ? whole - (numberOf(audio?.bit_rate) ?? 0) : null);
    const [low, high] = PREVIEW_FORMAT.bitrate;
    if (rate !== null) judge("bitrate", rate >= low && rate <= high, `${(rate / 1e6).toFixed(1)} Mbps`, `${low / 1e6} to ${high / 1e6} Mbps`, "warning");
  }
  if (audio) {
    const rate = numberOf(audio.bit_rate);
    // Silence costs AAC almost nothing, so a silent track is not judged by its bitrate.
    if (rate !== null && rate >= SILENT_AUDIO) judge("audio-bitrate", rate >= THIN_AUDIO, `${Math.round(rate / 1000)} kbps`, `about ${sound.bitrate / 1000} kbps`, "warning");
  }
  if (video) {
    const tags = [video.color_primaries, video.color_transfer, video.color_space];
    const named = tags.map((tag) => tag ?? "unknown").join(", ");
    judge("color", tags.every((tag) => tag === "bt709"), named, "bt709 primaries, transfer and matrix", "warning");
  }
  if (probe.boxes) {
    const index = probe.boxes.indexOf("moov");
    const media = probe.boxes.indexOf("mdat");
    if (index >= 0 && media >= 0) judge("faststart", index < media, index < media ? "before the media" : "after the media", "before the media (-movflags +faststart)", "warning");
  }
  const pictureEnds = numberOf(video?.duration);
  const soundEnds = numberOf(audio?.duration);
  if (pictureEnds !== null && soundEnds !== null) {
    const apart = Math.abs(pictureEnds - soundEnds);
    judge("audio-length", apart <= TRACKS_APART, `${apart.toFixed(3)} s apart`, "the two tracks end together", "warning");
  }
  return verdict;
}

/**
 * The warnings that come from how a preview is cut rather than from the file: long cards, a late first app
 * frame, the band caption style, captions the server had to squeeze or take from another language, and more
 * previews than a display holds. The compose knows these; the file does not.
 * @param {object} cut
 * @param {number} [cut.intro] Seconds of the intro card; 0 or nothing without one.
 * @param {number} [cut.outro]
 * @param {number} [cut.firstApp] Seconds into the preview of the first frame of the app.
 * @param {string} [cut.captionStyle]
 * @param {Manifest} [cut.layers] The layer set the captions came from.
 * @param {string} [cut.locale] The language of this preview, to pick its layers.
 * @param {number} [cut.previews] How many previews the folder of this display and language holds.
 * @returns {Rule[]}
 */
export function checkCut({ intro = 0, outro = 0, firstApp, captionStyle, layers, locale, previews } = {}) {
  /** @type {Rule[]} */
  const warnings = [];
  if (intro + outro > 4) warnings.push({ rule: "cards", value: secondsText(intro + outro), expected: "4 s or less for the intro and outro together" });
  if (firstApp !== undefined && firstApp > 2) warnings.push({ rule: "first-app-frame", value: secondsText(firstApp), expected: "the app within the first 2 s" });
  if (captionStyle === "band") warnings.push({ rule: "caption-style", value: "band", expected: "panel or shadow: Apple has refused framing around the screen recording" });
  if (layers) {
    const mine = layers.layers.filter((layer) => layer.kind === "caption" && (locale === undefined || layer.locale === locale));
    /** @type {Map<string, string>} */
    const squeezed = new Map();
    for (const layer of mine) if (typeof layer.fit === "number" && layer.fit < 0.7) squeezed.set(layer.id, `shrunk to ${Math.round(layer.fit * 100)} %`);
    for (const note of layers.warnings ?? []) {
      if ((locale === undefined || note.locale === locale) && note.layer.startsWith("caption-") && note.kind !== "fallback") squeezed.set(note.layer, note.detail);
    }
    for (const [layer, detail] of squeezed) warnings.push({ rule: "caption-fit", value: `${layer}: ${detail}`, expected: "70 % of the size or more, on at most two lines" });
    const borrowed = new Set(mine.filter((layer) => layer.fallback).map((layer) => layer.id));
    for (const note of layers.warnings ?? []) if ((locale === undefined || note.locale === locale) && note.kind === "fallback") borrowed.add(note.layer);
    for (const layer of borrowed) warnings.push({ rule: "caption-fallback", value: `${layer}: another language's text`, expected: `a caption in ${locale ?? "each language"}` });
  }
  if (previews !== undefined && previews > 3) warnings.push({ rule: "previews", value: previews, expected: "at most 3 previews for one display and language" });
  return warnings;
}

/**
 * How many previews a folder of out/<locale>/<display>/ holds.
 * @param {string} folder
 */
export function previewsIn(folder) {
  try {
    return readdirSync(folder).filter((name) => /\.(mp4|mov|m4v)$/i.test(name)).length;
  } catch {
    return 0;
  }
}

/**
 * Where the record of a preview's check is kept: <name>.check.json beside <name>.mp4.
 * @param {string} file
 */
export const checkFileOf = (file) => `${file.replace(/\.(mp4|mov|m4v)$/i, "")}.check.json`;

/**
 * @typedef {object} CheckRecord What the compose leaves beside a preview, for 'video check', 'video poster' and
 *   'video push'. What else it holds, such as the key the compose knows its inputs by, is kept when 'video poster'
 *   writes it again.
 * @property {1} version
 * @property {string} file The preview's name in its folder.
 * @property {number} bytes Its size when it was checked: a record of another file of the same name is not its.
 * @property {string | null} display
 * @property {boolean} draft
 * @property {{ seconds: number, timecode: string, chosen?: boolean }} [poster] chosen: set with 'video poster --at'.
 * @property {Rule[]} errors
 * @property {Rule[]} warnings
 * @property {Rule[]} [cut] The warnings of checkCut, which a later check of the file alone cannot see.
 * @property {import("./probe.mjs").Probe} probe
 * @property {string} checkedAt
 */

/**
 * The check record beside a preview, or null when there is none or it belongs to an earlier file of that name.
 * A record that does not say its bytes is told by its probe's, which are the same; one that keeps the poster's
 * time as `at` and its findings under `result` is read as though it said them the way this module writes them.
 * @param {string} file
 * @returns {CheckRecord | null}
 */
export function readCheckRecord(file) {
  let record;
  try {
    record = JSON.parse(readFileSync(checkFileOf(file), "utf8"));
    const bytes = typeof record?.bytes === "number" ? record.bytes : numberOf(record?.probe?.format?.size);
    if (record?.version !== 1 || bytes !== statSync(file).size) return null;
  } catch {
    return null;
  }
  const { poster, ...rest } = record;
  const seconds = typeof poster?.seconds === "number" ? poster.seconds : poster?.at;
  return {
    ...rest,
    errors: record.errors ?? record.result?.errors ?? [],
    warnings: record.warnings ?? record.result?.warnings ?? [],
    ...(typeof seconds === "number" && Number.isFinite(seconds) ? { poster: { seconds, timecode: poster.timecode ?? timecode(seconds), ...(poster.chosen ? { chosen: true } : {}) } } : {}),
  };
}

/**
 * Writes the check record beside a preview, whole or not at all.
 * @param {string} file
 * @param {Omit<CheckRecord, "version" | "file" | "bytes" | "checkedAt">} record
 */
export function writeCheckRecord(file, record) {
  const whole = { version: 1, file: path.basename(file), bytes: statSync(file).size, ...record, checkedAt: new Date().toISOString() };
  writeAtomic(checkFileOf(file), `${JSON.stringify(whole, null, 2)}\n`);
  return /** @type {CheckRecord} */ (whole);
}

/**
 * The report of one file: a line that says what it is, a line per rule, and the outcome.
 * @param {string} file
 * @param {Verdict} verdict
 * @param {import("./probe.mjs").Probe} [probed]
 */
export function formatCheck(file, verdict, probed) {
  const order = Object.keys(RULE_LABELS);
  const all = [
    ...verdict.errors.map((rule) => ({ ...rule, mark: "error" })),
    ...verdict.warnings.map((rule) => ({ ...rule, mark: "warning" })),
    ...verdict.passed.map((rule) => ({ ...rule, mark: "OK" })),
  ].sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
  const video = probed ? videoStreams(probed)[0] : undefined;
  const seconds = probed ? durationOf(probed) : null;
  const about = [verdict.display ?? "no display", video ? sizeText(playedSize(video)) : "no video", seconds !== null ? secondsText(seconds) : null].filter(Boolean).join(", ");
  const width = Math.max(...all.map((rule) => (RULE_LABELS[/** @type {keyof typeof RULE_LABELS} */ (rule.rule)] ?? rule.rule).length));
  const lines = [`${file}: ${about}`];
  for (const rule of all) {
    const label = (RULE_LABELS[/** @type {keyof typeof RULE_LABELS} */ (rule.rule)] ?? rule.rule).padEnd(width);
    lines.push(`  ${rule.mark.padEnd(7)}  ${label}  ${rule.value}${rule.mark === "OK" ? "" : `; expected ${rule.expected}`}`);
  }
  const count = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const { errors, warnings } = verdict;
  if (errors.length > 0) lines.push(`${count(errors.length, "error")}, ${count(warnings.length, "warning")}: App Store Connect does not take this file as it is.`);
  else if (warnings.length > 0) lines.push(`${count(warnings.length, "warning")}, no errors: App Store Connect takes it; the warnings are worth a look.`);
  else lines.push("Every rule passes.");
  return lines;
}

/**
 * 'appshots video check <file…>': checks each file, prints a block for each (or JSON with --json), and ends
 * with 1 when any file has an error. A preview the compose made is checked with what its record says: its
 * display, unless --display names another, whether it is a draft, and the warnings of its cut.
 * @param {string[]} files
 * @param {{ display?: string, json?: boolean, root?: string }} [options]
 */
export async function checkFiles(files, { display, json = false, root } = {}) {
  if (files.length === 0) fail("Name the video to check: appshots video check <file…>");
  if (display && !Object.hasOwn(PREVIEW_SPECS, display)) fail(`--display takes one of ${Object.keys(PREVIEW_SPECS).join(", ")}.`);
  for (const file of files) if (!existsSync(file)) fail(`There is no video at ${file}.`);
  const tools = await findFfmpeg({ root, need: "probe" });
  const results = [];
  for (const file of files) {
    const probed = await probe(file, tools);
    const record = readCheckRecord(file);
    // The display the compose made it for, which the size alone cannot tell where two displays share it.
    const recorded = record?.display && Object.hasOwn(PREVIEW_SPECS, record.display) ? record.display : null;
    const verdict = checkProbe(probed, display ?? recorded, { draft: record?.draft === true, file });
    verdict.warnings.push(...(record?.cut ?? []));
    results.push({ file, ...verdict, ...(record?.poster ? { poster: record.poster } : {}) });
    if (!json) {
      if (results.length > 1) console.log("");
      for (const line of formatCheck(file, verdict, probed)) console.log(line);
    }
  }
  if (json) console.log(JSON.stringify({ files: results }, null, 2));
  if (results.some((result) => result.errors.length > 0)) process.exitCode = 1;
  return results;
}
