// 'appshots video push': puts the previews of out/ into the version of the app that is being prepared in App
// Store Connect, through the app's asset library (store/library.mjs). Each file is uploaded once, waited for
// while Apple processes it, and placed onto the page of its language, in the group of displays its size is for.
// Every finished step goes into out/.push-state.json, so that --resume carries on after --no-wait, or after a run
// that stopped, without uploading again.
//
// Nothing is changed until every file has passed its check and every page has room. Nothing is submitted for
// review or released, and nothing the user put on a page is taken off: --replace takes off only an earlier
// upload of the same preview by appShots.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fail } from "../fail.mjs";
import { confirm } from "../prompt.mjs";
import { writeAtomic } from "../update.mjs";
import { pause, readJson } from "../util.mjs";
import { STORE_OPEN, plainState, storeAccount, storeApp, storeVersions, versionLanguages, versionState } from "../store/asc.mjs";
import { STORE_PLATFORMS } from "../store/displays.mjs";
import {
  BROKEN,
  POSTER_MOVABLE,
  REFERENCE_PREFIX,
  assetLibrary,
  isReady,
  orderPlacements,
  placePreview,
  previewGroup,
  previewPlacements,
  referenceData,
  removePlacement,
  setPosterTime,
  specProblems,
  uploadVideo,
  videoStates,
  videosNamed,
} from "../store/library.mjs";
import { sameLanguage, storeLocale } from "../store/locales.mjs";
import { languageFlag, listFlag } from "../store/push.mjs";
import { checkProbe } from "./check.mjs";
import { PREVIEW_SPECS } from "./specs.mjs";
import { timecode } from "./timecode.mjs";

/** How long the push waits for Apple to process what it uploaded, and how often it asks. Tests shorten these. */
export const PUSH_TIMING = { wait: 20 * 60000, first: 5000, most: 30000 };

const STATE_VERSION = 1;

/**
 * @typedef {object} Preview A file of out/ that is to go to App Store Connect.
 * @property {string} key <locale>/<display>/<name>: what the push state knows it by.
 * @property {string} locale The plan's language of the file, its folder.
 * @property {string} display
 * @property {string} file
 * @property {string} shown The file as messages name it.
 * @property {number} bytes
 * @property {number} width
 * @property {number} height
 * @property {number | null} seconds
 * @property {string | null} timecode The poster frame the check record names.
 * @property {string} hash
 * @property {string} referenceName What the video is called in the library: appshots <name> <locale> <display> <hash8>.
 * @property {string} earlier What the reference names of the earlier uploads of this preview start with.
 * @property {string[] | null} targets The store languages --lang puts it onto, where it names them.
 * @property {import("../store/library.mjs").Group} [group]
 *
 * @typedef {object} Target One preview on the page of one language.
 * @property {Preview} preview
 * @property {{ id: string, number: string, platform: string, state: string }} version
 * @property {string} code The store language.
 * @property {string} localization
 * @property {string} label
 * @property {"there" | "add" | "replace" | "full"} action
 * @property {import("../store/library.mjs").Placement[]} placements
 *
 * @typedef {{ hash: string, referenceName: string, video: string | null, placements: Record<string, string> }} Pushed
 * @typedef {{ version: 1, app: string, previews: Record<string, Pushed> }} PushState
 */

/** @param {string} file */
const shown = (file) => path.relative(process.cwd(), file) || file;

/** @param {number} bytes */
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/** @param {number} count @param {string} word */
const counted = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** @param {string} display */
const platformOf = (display) => (display === "mac" ? "MAC_OS" : "IOS");

/** @param {string} file */
const hashOf = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });

/**
 * Whether App Store Connect would take a preview, from the check record the compose left beside it, and what
 * the push needs of it. The record's probe is checked again here, against the rules as they are now, and it has
 * to be of this very file.
 * @param {string} file
 * @param {string} display
 * @returns {{ problem: string } | { width: number, height: number, seconds: number | null, timecode: string | null }}
 */
function checked(file, display) {
  const record = readJson(file.replace(/\.mp4$/, ".check.json"));
  const probe = record?.probe;
  if (!Array.isArray(probe?.streams)) return { problem: "has no check record beside it, so nothing says App Store Connect takes it. Compose it again: appshots video compose" };
  if ((typeof record.bytes === "number" ? record.bytes : Number(probe.format?.size)) !== statSync(file).size) return { problem: "changed after it was checked. Compose it again: appshots video compose" };
  if (record.draft === true) return { problem: "is a draft, which App Store Connect does not take. Compose it without --draft." };
  const { errors } = checkProbe(probe, display, { file });
  if (errors.length > 0) return { problem: `does not pass Apple's specification: ${errors.map((rule) => `${rule.rule} ${rule.value}, expected ${rule.expected}`).join("; ")}.` };
  const video = probe.streams.find((/** @type {any} */ stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  const seconds = Number(probe.format?.duration);
  // The compose and 'video poster' keep the poster's time; App Store Connect takes it as a timecode.
  const poster = record.poster?.seconds ?? record.poster?.at;
  return { width: video.width, height: video.height, seconds: Number.isFinite(seconds) ? seconds : null, timecode: typeof poster === "number" && Number.isFinite(poster) ? timecode(poster) : null };
}

/**
 * The previews out/ holds for the plan, narrowed by --lang and --display. A file without a check, a draft, or a
 * file that does not pass Apple's specification stops the push here, before App Store Connect is asked anything.
 * @param {any} plan
 * @param {Record<string, string | true>} flags
 * @param {string} out
 * @returns {Promise<Preview[]>}
 */
async function previewsOf(plan, flags, out) {
  const name = plan.name ?? "preview";
  const languages = languageFlag(flags);
  const displays = listFlag(flags, "display", "iphone,ipad");
  for (const display of displays ?? []) if (!Object.hasOwn(PREVIEW_SPECS, display)) fail(`--display takes ${Object.keys(PREVIEW_SPECS).join(", ")}.`);
  if (!existsSync(out)) fail(`There are no previews in ${shown(out)}. Make them first: appshots video compose`);
  /** @param {string} dir */
  const folders = (dir) => readdirSync(dir).filter((entry) => !entry.startsWith(".") && statSync(path.join(dir, entry)).isDirectory()).sort();
  const planLocales = Array.isArray(plan.locales) ? plan.locales : null;
  const planDisplays = Array.isArray(plan.displays) ? plan.displays : null;
  const locales = folders(out).filter((locale) => !planLocales || planLocales.includes(locale));
  /** @param {string} a @param {string} b */
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  /** @type {Preview[]} */
  const previews = [];
  const refused = [];
  for (const locale of locales) {
    // --lang names a folder by its code, or by another code of its language where no folder has that one.
    const picked = languages?.filter((entry) => same(entry.from, locale) || (sameLanguage(entry.from, locale) && !locales.some((other) => same(entry.from, other))));
    if (languages && picked?.length === 0) continue;
    // A code that names a region the folder does not, such as en-GB for en, says where it goes.
    const onto = /** @type {string[]} */ ((picked ?? []).map((entry) => entry.to ?? (entry.from.includes("-") && !locale.includes("-") ? entry.from : null)).filter(Boolean));
    for (const display of folders(path.join(out, locale))) {
      if (!Object.hasOwn(PREVIEW_SPECS, display) || (planDisplays && !planDisplays.includes(display)) || (displays && !displays.includes(display))) continue;
      const file = path.join(out, locale, display, `${name}.mp4`);
      if (!existsSync(file)) continue;
      const result = checked(file, display);
      if ("problem" in result) {
        refused.push(`${shown(file)} ${result.problem}`);
        continue;
      }
      const hash = /** @type {string} */ (await hashOf(file));
      const earlier = `${REFERENCE_PREFIX}${name} ${locale} ${display} `;
      previews.push({
        key: `${locale}/${display}/${name}`,
        locale,
        display,
        file,
        shown: shown(file),
        bytes: statSync(file).size,
        ...result,
        hash,
        referenceName: `${earlier}${hash.slice(0, 8)}`,
        earlier,
        targets: onto.length > 0 ? [...new Set(onto)] : null,
      });
    }
  }
  if (refused.length > 0) fail(`${refused.join("\n")}\nNothing was changed.`);
  const missing = (languages ?? []).map((entry) => entry.from).filter((code) => !previews.some((preview) => sameLanguage(code, preview.locale)));
  if (missing.length > 0) fail(`There is no ${name}.mp4 for ${missing.join(", ")} in ${shown(out)}. Compose it first: appshots video compose --lang ${missing.join(",")}`);
  if (previews.length === 0) fail(`There is no ${name}.mp4 in ${shown(out)}${displays ? ` for ${displays.join(", ")}` : ""}. Compose the previews first: appshots video compose`);
  return previews;
}

/**
 * @param {string} file
 * @returns {PushState | null}
 */
function readState(file) {
  const state = readJson(file);
  return state?.version === STATE_VERSION && typeof state.app === "string" && state.previews && typeof state.previews === "object" ? state : null;
}

/**
 * Written whole or not at all, after each step, so a run that stops leaves what it finished.
 * @param {string} file
 * @param {PushState} state
 */
const saveState = (file, state) => writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`);

/**
 * Whether the poster frame of a video in App Store Connect moves to the one the check record names. A video that
 * is in review, or on the App Store, keeps its own: that is for App Store Connect to change, and a note says so.
 * @param {import("../store/library.mjs").Video | null | undefined} video
 * @param {Preview} preview
 * @param {Set<string>} notes
 */
function posterMoves(video, preview, notes) {
  if (!video || !preview.timecode || video.timecode === preview.timecode) return false;
  if (POSTER_MOVABLE.has(video.state)) return true;
  notes.add(`${preview.shown}: Apple has the poster frame at ${video.timecode ?? "its own choice"}, and the video is ${plainState(video.state)}, so it stays there. Change it in App Store Connect.`);
  return false;
}

/**
 * The version of a platform being prepared, which previews go into. This command makes no version.
 * @param {import("../store/asc.mjs").Account} account
 * @param {import("../store/asc.mjs").App} app
 * @param {string} platform
 * @param {Record<string, string | true>} flags
 */
async function openVersion(account, app, platform, flags) {
  if (flags.version === true) fail("--version needs a number, such as --version 1.3.");
  const wanted = typeof flags.version === "string" ? flags.version.trim() : "";
  const system = STORE_PLATFORMS[/** @type {keyof typeof STORE_PLATFORMS} */ (platform)];
  const versions = await storeVersions(account, app, platform);
  const open = versions.find((version) => STORE_OPEN.has(versionState(version)));
  /** @param {any} version */
  const say = (version) => `${version.attributes.versionString} (${plainState(versionState(version))})`;
  if (!open) {
    const latest = versions[0] ? `: the latest is ${say(versions[0])}` : "";
    fail(`No version of ${app.name} for ${system} is being prepared${latest}. Previews go into a version being prepared, and this command makes none: create the next one in App Store Connect, or with 'appshots store push <project> --version <number>'. Nothing was changed.`);
  }
  if (wanted && open.attributes.versionString !== wanted) {
    const named = versions.find((version) => version.attributes.versionString === wanted);
    fail(`${named ? `Version ${say(named)}` : `There is no version ${wanted}`} of ${app.name} for ${system} ${named ? "can no longer be changed" : "in App Store Connect"}. The one being prepared is ${open.attributes.versionString}: leave out --version to use it. Nothing was changed.`);
  }
  return { id: open.id, number: open.attributes.versionString, platform, state: versionState(open) };
}

/**
 * Asks Apple how far it is with each video until all are processed, or refused, or the wait is over.
 * @param {import("../store/asc.mjs").Account} account
 * @param {string} library
 * @param {Map<string, Preview>} pending By video id.
 */
async function processing(account, library, pending) {
  /** @type {Array<{ preview: Preview, video: string, details: string[] }>} */
  const refused = [];
  /** @type {Set<string>} */
  const ready = new Set();
  let waiting = [...pending.keys()];
  const until = Date.now() + PUSH_TIMING.wait;
  for (let tries = 1; waiting.length > 0; tries++) {
    const answers = await videoStates(account, library, waiting);
    const still = [];
    for (const answer of answers) {
      const preview = /** @type {Preview} */ (pending.get(answer.id));
      if (isReady(answer.state)) ready.add(answer.id);
      else if (BROKEN.has(answer.state)) refused.push({ preview, video: answer.id, details: answer.details });
      else still.push(answer.id);
    }
    waiting = still;
    if (waiting.length === 0 || Date.now() >= until) break;
    await pause(Math.min(PUSH_TIMING.most, PUSH_TIMING.first * tries));
  }
  return { ready, refused, late: waiting };
}

/**
 * 'appshots video push': places the plan's previews into the version being prepared in App Store Connect.
 * @param {any} plan The plan as readPlan returns it.
 * @param {Record<string, string | true>} flags --plan, --app, --version, --lang, --display, --replace, --dry-run, --no-wait, --resume.
 */
export async function videoPush(plan, flags) {
  if (flags.plan === true) fail("--plan needs the plan file, such as --plan appshots.video.json.");
  const dry = Boolean(flags["dry-run"]);
  // readPlan says which folder the plan is in; the work folder is beside it.
  const root = typeof plan.root === "string" ? plan.root : path.dirname(path.resolve(typeof flags.plan === "string" ? flags.plan : "appshots.video.json"));
  const out = path.join(root, "appshots-video", "out");
  const stateFile = path.join(out, ".push-state.json");
  const notes = new Set();
  let previews = await previewsOf(plan, flags, out);
  const saved = readState(stateFile);
  if (flags.resume) {
    if (!saved) fail(`Nothing to resume: there is no ${shown(stateFile)}. Run it without --resume.`);
    for (const preview of previews) if (saved.previews[preview.key] && saved.previews[preview.key].hash !== preview.hash) notes.add(`${preview.shown} changed after the last push. Run it without --resume to upload it.`);
    previews = previews.filter((preview) => saved.previews[preview.key]?.hash === preview.hash && saved.previews[preview.key].video);
    if (previews.length === 0) fail("Nothing to resume: the last push uploaded none of these previews as they are now. Run it without --resume.");
  }

  const account = storeAccount(flags);
  const app = await storeApp(account, flags.app ?? plan.app?.bundleId);
  if (flags.resume && saved?.app !== app.id) fail(`The last push went to another app than ${app.name}. Run it without --resume.`);
  /** @type {PushState} */
  const state = saved?.app === app.id ? saved : { version: STATE_VERSION, app: app.id, previews: {} };

  // Every version, the library and what it takes are settled before anything changes.
  const versions = new Map();
  for (const platform of new Set(previews.map((preview) => platformOf(preview.display)))) versions.set(platform, await openVersion(account, app, platform, flags));
  const library = await assetLibrary(account, app);
  const ref = await referenceData(account);
  const refused = [];
  for (const preview of previews) {
    const group = previewGroup(ref, preview);
    if (!group) {
      refused.push(`${preview.shown}: no group of displays in App Store Connect takes previews of ${preview.width} x ${preview.height} for ${STORE_PLATFORMS[/** @type {keyof typeof STORE_PLATFORMS} */ (platformOf(preview.display))]}.`);
      continue;
    }
    const problems = specProblems(group.spec, preview);
    if (problems.length > 0) refused.push(`${preview.shown}: ${problems.join("; ")}.`);
    preview.group = group;
  }
  if (refused.length > 0) fail(`${refused.join("\n")}\nNothing was changed.`);

  // Which language of the page each file goes onto. A language the page does not have is left out with a line.
  /** @type {Target[]} */
  const targets = [];
  const choices = new Set();
  const seen = new Map();
  let skipped = false;
  for (const [platform, version] of versions) {
    const listed = await versionLanguages(account, version);
    const codes = listed.map((entry) => entry.attributes.locale);
    const system = STORE_PLATFORMS[/** @type {keyof typeof STORE_PLATFORMS} */ (platform)];
    for (const preview of previews.filter((entry) => platformOf(entry.display) === platform)) {
      for (const to of preview.targets ?? [undefined]) {
        const found = storeLocale(preview.locale, codes, { primary: app.primaryLocale, to });
        if (!found.listed || !found.code) {
          skipped = true;
          if (found.others && !found.listed) notes.add(`${preview.locale}: version ${version.number} for ${system} has ${found.others.join(" and ")}, and either could be meant. Say which with --lang ${preview.locale}=${found.others[0]}.`);
          else notes.add(`${preview.locale}: version ${version.number} for ${system} has no such language on its store page. It has ${codes.join(", ")}. 'appshots store push <project> --add-languages' adds it${found.code && found.code !== preview.locale ? ` as ${found.code}` : ""}.`);
          continue;
        }
        const code = found.code;
        const where = `${platform} ${code} ${preview.display}`;
        if (seen.has(where)) fail(`${seen.get(where)} and ${preview.shown} would both go onto ${code}. Leave one out with --lang. Nothing was changed.`);
        seen.set(where, preview.shown);
        if (code !== preview.locale) choices.add(`${preview.locale} goes onto ${code}${found.others ? `; the store page has ${found.others.join(" and ")} as well, which --lang ${preview.locale}=${found.others[0]} picks` : ""}`);
        const localization = listed.find((entry) => entry.attributes.locale === code).id;
        targets.push({ preview, version, code, localization, label: `${code.padEnd(8)} ${preview.display.padEnd(10)}`, action: "add", placements: [] });
      }
    }
  }

  // What is on each page now, and what this push would do there.
  for (const target of targets) {
    const { preview } = target;
    const group = /** @type {import("../store/library.mjs").Group} */ (preview.group);
    target.placements = await previewPlacements(account, target.localization, group.group);
    const there = target.placements.some((placement) => placement.video?.referenceName === preview.referenceName);
    const earlier = target.placements.some((placement) => placement.video?.referenceName.startsWith(preview.earlier));
    target.action = there ? "there" : earlier ? "replace" : target.placements.length < group.limit ? "add" : "full";
  }
  const full = targets.filter((target) => target.action === "full");
  const replacing = targets.filter((target) => target.action === "replace");
  const fullLines = full.map((target) => `${target.label}  ${target.preview.group?.group} holds ${target.placements.length} previews already, the most a version takes, and none of them is appShots' earlier upload of this one. Take one off in App Store Connect first.`);
  if (full.length > 0 && !dry) fail(`${fullLines.join("\n")}\nNothing was changed.`);
  let replace = Boolean(flags.replace);
  if (replacing.length > 0 && !replace && !dry) {
    const pages = replacing.map((target) => target.label.trim().replace(/\s+/, " ")).join(", ");
    replace = await confirm(`${pages}: ${replacing.length === 1 ? "this page holds" : "these pages hold"} an earlier upload of this preview by appShots. Take it off and put the new one in its place?`);
    if (!replace) fail(`${pages}: ${replacing.length === 1 ? "this page holds" : "these pages hold"} an earlier upload of this preview by appShots. Ask the user whether appShots may take it off and put the new one in its place; then run it again with --replace. Nothing was changed.`);
  }

  // A preview uploaded before, by an earlier push or by one that stopped, is placed without being sent again. One
  // still awaiting its upload is a reservation whose file never arrived: it is uploaded anew.
  const needed = previews.filter((preview) => targets.some((target) => target.preview === preview && target.action !== "there"));
  /** @type {Map<string, import("../store/library.mjs").Video | null>} */
  const before = new Map();
  for (const preview of needed) {
    const usable = (await videosNamed(account, library, preview.referenceName)).filter((video) => !BROKEN.has(video.state) && video.state !== "AWAITING_UPLOAD");
    before.set(preview.key, usable.find((video) => video.id === state.previews[preview.key]?.video) ?? usable[0] ?? null);
  }

  if (dry) console.log("Dry run: nothing is changed.");
  for (const version of versions.values()) console.log(`${app.name} ${version.number} for ${STORE_PLATFORMS[/** @type {keyof typeof STORE_PLATFORMS} */ (version.platform)]} (${plainState(version.state)})`);
  for (const line of choices) console.log(line);

  if (dry) {
    const sending = new Set();
    /** @type {Set<string>} */
    const moving = new Set();
    /** @param {import("../store/library.mjs").Video | null | undefined} video @param {Preview} preview */
    const moves = (video, preview) => {
      if (!video || moving.has(video.id) || !posterMoves(video, preview, notes)) return "";
      moving.add(video.id);
      return `; its poster frame would move to ${preview.timecode}`;
    };
    for (const target of targets) {
      const { preview } = target;
      const group = /** @type {import("../store/library.mjs").Group} */ (preview.group);
      if (target.action === "there") {
        const placed = target.placements.find((placement) => placement.video?.referenceName === preview.referenceName);
        console.log(`${target.label}  ${preview.shown} is there already, in ${group.group}${moves(placed?.video, preview)}`);
        continue;
      }
      if (target.action === "full") continue;
      const uploaded = before.get(preview.key);
      const sends = uploaded
        ? `would place ${preview.shown}, uploaded before,`
        : sending.has(preview.key)
          ? `would place the same upload of ${preview.shown}`
          : `would upload ${preview.shown} (${megabytes(preview.bytes)}, ${preview.seconds?.toFixed(1) ?? "?"} s, poster at ${preview.timecode ?? "Apple's choice"}) and place it`;
      sending.add(preview.key);
      const how = target.action === "replace" ? `in place of appShots' earlier upload${replace ? "" : " (with --replace)"}` : `as preview ${target.placements.length + 1} of at most ${group.limit}`;
      console.log(`${target.label}  ${sends} in ${group.group}, ${how}${moves(uploaded, preview)}`);
    }
    for (const line of fullLines) console.log(`  ! ${line}`);
    if (replacing.length > 0 && !replace) notes.add("appShots takes its earlier uploads off a page only with --replace. Ask the user before adding it.");
    for (const note of notes) console.log(`  ! ${note}`);
    if (skipped || full.length > 0) process.exitCode = 1;
    return console.log("Run it again without --dry-run to do it.");
  }

  // Upload what is not in the library yet, and move the poster of what is, where the record names another.
  /** @type {Map<string, string>} video id of each preview, by key */
  const videos = new Map();
  const labelOf = (/** @type {Preview} */ preview) => (targets.find((target) => target.preview === preview)?.label ?? `${preview.locale.padEnd(8)} ${preview.display.padEnd(10)}`);
  const pending = new Map();
  let sent = 0;
  for (const preview of needed) {
    let video = before.get(preview.key);
    if (video) {
      console.log(`${labelOf(preview)}  ${preview.shown} was uploaded before, and is not sent again`);
    } else {
      const id = await uploadVideo(account, library, preview);
      video = { id, referenceName: preview.referenceName, state: "UPLOAD_COMPLETE", timecode: preview.timecode };
      sent++;
      console.log(`${labelOf(preview)}  uploaded ${preview.shown} (${megabytes(preview.bytes)})`);
    }
    const known = state.previews[preview.key];
    state.previews[preview.key] = { hash: preview.hash, referenceName: preview.referenceName, video: video.id, placements: known?.hash === preview.hash && known.video === video.id ? known.placements : {} };
    saveState(stateFile, state);
    videos.set(preview.key, video.id);
    if (!isReady(video.state)) pending.set(video.id, preview);
  }
  /** @type {Set<string>} */
  const moved = new Set();
  for (const target of targets) {
    const { preview } = target;
    const placed = target.placements.find((placement) => placement.video?.referenceName === preview.referenceName)?.video;
    const id = videos.get(preview.key);
    const video = placed ?? (id ? (before.get(preview.key) ?? { id, referenceName: preview.referenceName, state: "UPLOAD_COMPLETE", timecode: preview.timecode }) : null);
    if (!video || moved.has(video.id) || !posterMoves(video, preview, notes)) continue;
    moved.add(video.id);
    await setPosterTime(account, video.id, preview.timecode);
    console.log(`${target.label}  moved the poster frame of ${preview.shown} to ${preview.timecode}`);
  }

  // Apple processes each upload before it can be placed.
  let late = 0;
  if (pending.size > 0 && flags["no-wait"]) {
    late = pending.size;
  } else if (pending.size > 0) {
    console.log(`Waiting for Apple to process ${counted(pending.size, "preview")}. That takes some minutes; --no-wait stops after the upload.`);
    const result = await processing(account, library, pending);
    for (const { preview, video, details } of result.refused) {
      console.log(`  ! ${labelOf(preview)}  Apple did not take ${preview.shown}: ${details.join(" ") || "it gave no reason"}`);
      // The next push uploads it anew; the refused video stays in the library, where the user can delete it.
      if (state.previews[preview.key]?.video === video) state.previews[preview.key].video = null;
      videos.delete(preview.key);
    }
    for (const id of result.late) videos.delete(/** @type {Preview} */ (pending.get(id)).key);
    late = result.late.length;
    if (result.refused.length > 0) process.exitCode = 1;
    saveState(stateFile, state);
  }

  // Place each one that is ready. Where the group is full the earlier upload makes room first; otherwise it stays
  // until the new one is on the page, so that a placement Apple refuses leaves the page as it was.
  let placed = 0;
  let there = 0;
  for (const target of targets) {
    const { preview } = target;
    const group = /** @type {import("../store/library.mjs").Group} */ (preview.group);
    if (target.action === "there") {
      there++;
      continue;
    }
    const video = videos.get(preview.key);
    if (!video || (pending.has(video) && flags["no-wait"])) continue;
    const page = await previewPlacements(account, target.localization, group.group);
    if (page.some((placement) => placement.video?.referenceName === preview.referenceName)) {
      there++;
      continue;
    }
    const earlier = replace ? page.filter((placement) => placement.video?.referenceName.startsWith(preview.earlier)) : [];
    const first = earlier.length > 0 ? page.indexOf(earlier[0]) : page.length;
    const at = page.slice(0, first).filter((placement) => !earlier.includes(placement)).length;
    const room = page.length < group.limit;
    if (!room) for (const old of earlier) await removePlacement(account, old);
    const id = await placePreview(account, { localization: target.localization, group: group.group, video });
    if (room) for (const old of earlier) await removePlacement(account, old);
    const now = (await previewPlacements(account, target.localization, group.group)).map((placement) => placement.id);
    const rest = now.filter((each) => each !== id);
    const wanted = [...rest.slice(0, at), id, ...rest.slice(at)];
    if (wanted.join(" ") !== now.join(" ")) await orderPlacements(account, { localization: target.localization, group: group.group, ids: wanted });
    state.previews[preview.key].placements[target.localization] = id;
    saveState(stateFile, state);
    placed++;
    console.log(`${target.label}  placed in ${group.group}${earlier.length > 0 ? ", in place of appShots' earlier upload" : ""}, preview ${at + 1} of ${wanted.length}`);
  }

  const summary = [placed > 0 ? `${counted(placed, "preview")} placed` : "", sent > 0 ? `${sent} uploaded` : "", there > 0 ? `${there} there already` : ""].filter(Boolean);
  console.log(`${summary.length > 0 ? summary.join(", ") : "Nothing placed"}.`);
  if (late > 0) console.log(`Apple is still processing ${counted(late, "preview")}. Run 'appshots video push --resume' later to place ${late === 1 ? "it" : "them"}; nothing is uploaded again.`);
  for (const note of notes) console.log(`  ! ${note}`);
  // A language left out is a page that is not what the files say, so the command does not end as if it were.
  if (skipped) process.exitCode = 1;
  console.log(`Nothing was submitted for review. Apple can take up to 24 hours before a preview plays in App Store Connect. Look the version over and submit it yourself: https://appstoreconnect.apple.com/apps/${app.id}`);
}
