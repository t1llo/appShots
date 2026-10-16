// How each stored probe in fixtures/video/probe/ was made, and what the check says of it. The default tier checks
// the stored probes; the ffmpeg tier (VIDEO_TESTS=1) makes the files again and checks them, so the stored probes
// stay what ffmpeg really writes. What is not worth making (a file of 600 MB, ProRes) is the good file's probe
// with what would differ changed.

/**
 * @typedef {object} Recipe
 * @property {string} size
 * @property {number} rate
 * @property {number} seconds
 * @property {"silent" | "tone" | null} audio
 * @property {string[]} filters After the BT.709 retag, which every preview has.
 * @property {string[]} video Encoder options in place of the final encode's.
 * @property {string[]} sound
 * @property {string[]} extra Anything else, before the output file.
 * @property {boolean} faststart
 */

/** The final encode of §8.3 of the design, sped up: veryfast instead of slow. */
const FINAL = ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-level:v", "4.0", "-pix_fmt", "yuv420p", "-g", "30", "-b:v", "11M", "-minrate", "11M", "-maxrate", "11M", "-bufsize", "22M", "-x264-params", "nal-hrd=cbr:force-cfr=1"];
const AUDIO = ["-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2"];
const TAGS = "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709";

/** @type {Recipe} */
const GOOD = { size: "886x1920", rate: 30, seconds: 16, audio: "silent", filters: [TAGS], video: FINAL, sound: AUDIO, extra: [], faststart: true };

/**
 * Swaps options of an encode for others.
 * @param {Record<string, string>} options
 * @param {string[]} from
 */
const swapIn = (options, from) => {
  const args = [...from];
  for (const [name, value] of Object.entries(options)) {
    const at = args.indexOf(name);
    if (at >= 0) args[at + 1] = value;
    else args.push(name, value);
  }
  return args;
};

/** The final encode at x264's fastest, for every file but the good one; x264 then says Constrained Baseline. */
const FAST = swapIn({ "-preset": "ultrafast" }, FINAL);
/** @param {Record<string, string>} options */
const swap = (options) => swapIn(options, FAST);

/**
 * @param {Partial<Recipe>} change
 * @returns {Recipe}
 */
const like = (change) => ({ ...GOOD, video: FAST, ...change });

/**
 * ProRes 422 HQ as ffprobe says it of prores_ks at the iPhone size, in place of the good file's H.264.
 * @param {any} probe
 */
function asProRes(probe) {
  Object.assign(probe.streams[0], { codec_name: "prores", profile: "HQ", level: -99, pix_fmt: "yuv422p10le", bit_rate: "74255208" });
  probe.format.bit_rate = String(74255208 + 256000);
  probe.format.size = String(((74255208 + 256000) * 16) / 8);
}

/**
 * Every fixture: its recipe, or the fixture whose file it shares (`same`) and what to change in that probe
 * (`edit`); what it is checked as; and the rules it is to break. A fixture breaks exactly these, and passes every
 * other rule that applies to it.
 * @typedef {{ recipe?: Recipe, same?: string, edit?: (probe: any) => void, display?: string, draft?: boolean, file?: string, errors: string[], warnings: string[] }} Fixture
 * @type {Record<string, Fixture>}
 */
export const FIXTURES = {
  good: { recipe: GOOD, errors: [], warnings: [] },
  "good-ipad-landscape": { recipe: like({ size: "1600x1200" }), errors: [], warnings: [] },
  "good-mac": { recipe: like({ size: "1920x1080" }), errors: [], warnings: [] },
  "good-music": { recipe: like({ audio: "tone" }), errors: [], warnings: [] },
  "fps-25": { recipe: like({ rate: 25 }), errors: ["frame-rate", "frames"], warnings: [] },
  // A third of each second dropped and the timestamps kept, as a simulator recording of a still screen has it.
  // The bitrate is raised as x264 counts it by the frames there are, and fewer frames would make it low.
  vfr: { recipe: like({ filters: ["select='not(between(mod(n\\,30)\\,10\\,19))'", TAGS], video: swap({ "-b:v": "15M", "-minrate": "15M", "-maxrate": "15M", "-bufsize": "30M" }), extra: ["-fps_mode", "vfr"] }), errors: ["frame-rate", "frames"], warnings: [] },
  "yuv444": { recipe: like({ video: swap({ "-pix_fmt": "yuv444p", "-profile:v": "high444" }) }), errors: ["profile", "pix-fmt"], warnings: [] },
  "odd-size": { recipe: like({ size: "900x1950" }), errors: ["size"], warnings: [] },
  "too-long": { recipe: like({ seconds: 31 }), errors: ["duration"], warnings: [] },
  "too-short": { recipe: like({ seconds: 14 }), errors: ["duration"], warnings: [] },
  "nearly-30": { recipe: like({ seconds: 29.95 }), errors: [], warnings: ["duration-margin"] },
  mono: { recipe: like({ sound: swapIn({ "-ac": "1" }, AUDIO) }), errors: ["audio-channels"], warnings: [] },
  "no-audio": { recipe: like({ audio: null }), errors: ["audio"], warnings: [] },
  "audio-32k": { recipe: like({ sound: swapIn({ "-ar": "32000" }, AUDIO) }), errors: ["audio-rate"], warnings: [] },
  "audio-mp3": { recipe: like({ audio: "tone", sound: ["-c:a", "libmp3lame", "-b:a", "256k", "-ar", "48000", "-ac", "2"] }), errors: ["audio-codec"], warnings: [] },
  // An MP4 with one audio track always has it as the default, so the first of two is made the other one.
  "audio-not-default": { recipe: like({ extra: ["-map", "0:v", "-map", "1:a", "-map", "1:a", "-disposition:a:0", "0", "-disposition:a:1", "default"] }), errors: ["audio-default"], warnings: [] },
  "audio-thin": { recipe: like({ audio: "tone", sound: swapIn({ "-b:a": "64k" }, AUDIO) }), errors: [], warnings: ["audio-bitrate"] },
  "level-4.2": { recipe: like({ video: swap({ "-level:v": "4.2" }) }), errors: ["level"], warnings: [] },
  interlaced: { recipe: like({ filters: [`${TAGS}:field_mode=tff`], video: swap({ "-x264-params": "nal-hrd=cbr:force-cfr=1:interlaced=1:tff=1" }), extra: ["-flags", "+ildct+ilme"] }), errors: ["field-order"], warnings: [] },
  "square-not": { recipe: like({ filters: [TAGS, "setsar=4/3"] }), errors: ["sar"], warnings: [] },
  "two-videos": { recipe: like({ extra: ["-map", "0:v", "-map", "0:v", "-map", "1:a"] }), errors: ["video-streams"], warnings: [] },
  hevc: { recipe: like({ video: ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-b:v", "11M", "-tag:v", "hvc1", "-x265-params", "log-level=error"] }), errors: ["codec"], warnings: [] },
  "low-bitrate": { recipe: like({ video: swap({ "-b:v": "4M", "-minrate": "4M", "-maxrate": "4M", "-bufsize": "8M" }) }), errors: [], warnings: ["bitrate"] },
  untagged: { recipe: like({ filters: [] }), errors: [], warnings: ["color"] },
  "display-p3": { recipe: like({ filters: ["setparams=color_primaries=smpte432:color_trc=bt709:colorspace=bt709"] }), errors: [], warnings: ["color"] },
  "index-last": { recipe: like({ faststart: false }), errors: [], warnings: ["faststart"] },
  draft: { recipe: like({ video: ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p"] }), draft: true, errors: ["draft"], warnings: [] },
  "wrong-display": { same: "good", display: "ipad", errors: ["size"], warnings: [] },
  "600mb": { same: "good", edit: (probe) => (probe.format.size = String(600 * 1024 * 1024)), errors: ["file-size"], warnings: [] },
  "prores-hq": { same: "good", edit: asProRes, file: "preview.mov", errors: [], warnings: [] },
  "prores-in-mp4": { same: "good", edit: asProRes, file: "preview.mp4", errors: ["codec"], warnings: [] },
};

/**
 * The ffmpeg arguments that make a fixture's file from test patterns.
 * @param {Recipe} recipe
 * @param {string} out
 */
export function recipeArgs(recipe, out) {
  const inputs = ["-f", "lavfi", "-i", `testsrc2=size=${recipe.size}:rate=${recipe.rate}`];
  if (recipe.audio === "silent") inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  if (recipe.audio === "tone") inputs.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000");
  const mapped = recipe.extra.includes("-map") ? [] : ["-map", "0:v", ...(recipe.audio ? ["-map", "1:a"] : [])];
  return [
    "-nostdin", "-hide_banner", "-v", "error", "-y",
    ...inputs,
    ...(recipe.filters.length > 0 ? ["-vf", recipe.filters.join(",")] : []),
    ...mapped,
    ...recipe.video,
    // A variable frame rate keeps the timestamps it has; -r would make them even again.
    ...(recipe.extra.includes("-fps_mode") ? [] : ["-r", String(recipe.rate)]),
    ...(recipe.audio ? recipe.sound : ["-an"]),
    ...recipe.extra,
    ...(recipe.faststart ? ["-movflags", "+faststart"] : []),
    "-map_metadata", "-1",
    "-t", String(recipe.seconds),
    out,
  ];
}
