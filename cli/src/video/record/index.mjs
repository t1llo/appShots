import { existsSync } from "node:fs";
import path from "node:path";
import { fail } from "../../fail.mjs";
import { confirm } from "../../prompt.mjs";
import { findFfmpeg } from "../ffmpeg.mjs";
import { planHash } from "../plan.mjs";
import { deviceSource } from "./device.mjs";
import { needsPerson } from "./drive.mjs";
import { macSource } from "./mac.mjs";
import {
  Interrupted,
  checkStop,
  footageDisplay,
  interruption,
  keepTake,
  movieOf,
  rawDir,
  recordTake,
  sidecar,
  storedSidecar,
  touchFolder,
  withInterrupt,
  workingFile,
  writeJson,
} from "./session.mjs";
import { appState, simSource } from "./sim.mjs";
import { webSource } from "./web.mjs";

/**
 * Recording, for 'appshots video record': every scene of the plan in every language and on every display that
 * has no recording yet, each as a movie and a sidecar under appshots-video/raw/<display>/<language>/. The
 * sources each have a module: the simulator, a physical device, a Mac window and a web page in Chromium.
 *
 * @typedef {object} Source Where a display's footage comes from, opened once for all of its scenes.
 * @property {"sim" | "device" | "mac" | "web"} kind
 * @property {string} label What the messages call it.
 * @property {string} model
 * @property {string} os
 * @property {string} extension The kind of movie it makes.
 * @property {boolean} padded Whether its movies drop still frames, so the clock has to restore their length.
 * @property {(size: [number, number]) => number} scale Pixels a point, given the size of a recording.
 * @property {{ name: string, udid: string }} [simulator]
 * @property {<T>(work: () => Promise<T>) => Promise<T>} around Runs all of the display's scenes: a clean status
 *   bar, a browser, and put back as it was afterwards.
 * @property {(scene: any, locale: string) => Promise<void>} open Starts the app on the scene in the language.
 * @property {(file: string, options: { seconds: number }) => Promise<import("./spawn.mjs").Recorder>} [record]
 * @property {(scene: any) => Promise<import("./drive.mjs").UiTests>} [tests] Builds what a UI test needs.
 * @property {(job: WebJob) => Promise<import("./session.mjs").Take>} [take] Records and drives in one, for a
 *   page whose time it runs itself.
 * @property {string} [help] What to do when its recorder fails, said after why.
 *
 * @typedef {object} WebJob
 * @property {any} scene
 * @property {string} locale
 * @property {string} file
 * @property {number} seconds
 * @property {number} settle
 * @property {AbortSignal} signal
 */

/**
 * The work folder: appshots-video/ next to the plan.
 * @param {Record<string, string | true | undefined>} flags
 */
export function workFolder(flags) {
  return path.join(planFolder(flags), "appshots-video");
}

/** @param {Record<string, string | true | undefined>} flags */
const planFolder = (flags) => path.dirname(path.resolve(typeof flags.plan === "string" ? flags.plan : "appshots.video.json"));

/**
 * The recording of a scene in a language on a display, as its sidecar says, with `file`, the movie it is
 * about. A language that uses another one's footage gets that one's recording under its own language. Null when
 * there is no recording, or no movie to go with its sidecar.
 * @param {string} root The work folder, or the plan's folder that holds it.
 * @param {string} display
 * @param {string} locale
 * @param {string} scene
 * @returns {(import("./session.mjs").Sidecar & { file: string }) | null}
 */
export function readSidecar(root, display, locale, scene) {
  const own = ownSidecar(root, display, locale, scene, true);
  if (!own || !own.reuse) return own;
  const used = ownSidecar(root, display, own.reuse, scene, false);
  return used && { ...used, locale, reuse: own.reuse };
}

/**
 * @param {string} root
 * @param {string} display
 * @param {string} locale
 * @param {string} scene
 * @param {boolean} reuse Whether a sidecar that points elsewhere counts.
 * @returns {any}
 */
function ownSidecar(root, display, locale, scene, reuse) {
  const dir = rawDir(root, display, locale);
  const data = storedSidecar(path.join(dir, `${scene}.json`));
  if (!data) return null;
  if (data.reuse) return reuse ? data : null;
  const file = movieOf(dir, scene);
  return file ? { ...data, file } : null;
}

/**
 * The values of a list flag, as in --lang en,de; null when it is not given.
 * @param {Record<string, string | true | undefined>} flags
 * @param {string} name
 * @param {string} example
 */
function listFlag(flags, name, example) {
  const value = flags[name];
  if (value === undefined) return null;
  if (typeof value !== "string") fail(`--${name} needs a value, such as --${name} ${example}.`);
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * What a run records, settled before anything starts: the displays and their source, the languages, the
 * scenes, and which language's footage the others use.
 * @param {any} plan
 * @param {Record<string, string | true | undefined>} flags
 */
export function selection(plan, flags) {
  const scenes = /** @type {any[]} */ (plan.scenes ?? []);
  const sceneIds = listFlag(flags, "scene", "inbox,search");
  for (const id of sceneIds ?? []) if (!scenes.some((scene) => scene.id === id)) fail(`The plan has no scene "${id}". Its scenes: ${scenes.map((scene) => scene.id).join(", ")}`);
  const displays = listFlag(flags, "display", "iphone,ipad") ?? plan.displays ?? [];
  for (const display of displays) if (!(plan.displays ?? []).includes(display)) fail(`The plan has no display "${display}". Its displays: ${(plan.displays ?? []).join(", ")}`);
  const languages = /** @type {string[] | undefined} */ (plan.locales);
  const locales = listFlag(flags, "lang", "en,de") ?? languages;
  if (!locales || locales.length === 0) fail(`The plan lists no languages. Put them into its "locales", the first being the primary one, or name them with --lang.`);
  if (languages) for (const locale of locales) if (!languages.includes(locale)) fail(`The plan has no language "${locale}". Its languages: ${languages.join(", ")}`);
  const primary = languages?.[0] ?? locales[0];
  const reuse = plan.footage === "primary" || Boolean(flags["reuse-footage"]);
  const seconds = flags.seconds === undefined ? null : typeof flags.seconds === "string" ? Number(flags.seconds) : NaN;
  if (seconds !== null && !(seconds >= 1 && seconds <= 120)) fail("--seconds needs a number of seconds from 1 to 120, as in: --seconds 8");
  return {
    // The older iPhone and iPad sizes are cut from the current ones' footage, so it is recorded once.
    footage: [...new Set(displays.map(footageDisplay))],
    locales,
    primary,
    reuse,
    // With one language's footage for all, that one is recorded and the others point at it.
    recorded: reuse ? [primary] : locales,
    scenes: sceneIds ? scenes.filter((scene) => sceneIds.includes(scene.id)) : scenes,
    seconds,
  };
}

/**
 * Where a display's footage comes from: a web page for a web app, a window for a Mac app, a connected device
 * with --device, a simulator otherwise.
 * @param {any} plan
 * @param {string} display
 * @param {Record<string, string | true | undefined>} flags
 */
export function sourceKind(plan, display, flags) {
  const platform = plan.app?.platform ?? "ios";
  if (flags.web || platform === "web") return "web";
  if (display === "mac") {
    if (platform !== "mac" && !flags.mac) fail(`The mac display is recorded from a Mac app's window or a web app's page, and this plan's app is for ${platform}.`);
    return "mac";
  }
  if (platform === "mac" || flags.mac) fail(`A Mac app is recorded for the mac display only, and the plan asks for ${display}.`);
  return flags.device ? "device" : "sim";
}

/**
 * Seconds a scene records for at most, and how long the app is left to settle first. A scene that nothing
 * drives is recorded for as long as the plan estimates it, unless it says otherwise.
 * @param {any} scene
 * @param {number | null} seconds --seconds, which goes for every scene.
 */
const timing = (scene, seconds) => ({ seconds: seconds ?? scene.record?.seconds ?? (scene.drive === undefined ? 6 : 12), settle: scene.record?.settle ?? 1.5 });

/**
 * Records every scene × language × display the flags pick that has no recording yet, or all of them with
 * --again, and returns the sidecars it wrote. Ctrl+C stops it at any moment: the recording in progress is
 * finished and deleted, the simulator put back as it was, and the command ends with 130.
 * @param {any} plan The plan as readPlan gives it, its defaults filled in.
 * @param {Record<string, string | true | undefined>} flags
 * @returns {Promise<Array<import("./session.mjs").Sidecar & { file?: string }>>}
 */
export async function recordScenes(plan, flags) {
  const root = workFolder(flags);
  const cwd = planFolder(flags);
  const picked = selection(plan, flags);
  const again = Boolean(flags.again);
  /** @type {Array<{ display: string, kind: string, jobs: Array<{ scene: any, locale: string }> }>} */
  const work = picked.footage.map((display) => ({
    display,
    kind: sourceKind(plan, display, flags),
    jobs: picked.recorded.flatMap((locale) => picked.scenes.filter((scene) => again || !readSidecar(root, display, locale, scene.id)).map((scene) => ({ scene, locale }))),
  }));
  // What needs a person, or cannot be driven where it is recorded, is said before anything is recorded.
  for (const { kind, jobs } of work) {
    for (const { scene } of jobs) {
      const drive = flags.manual ? "manual" : scene.drive;
      needsPerson(drive, scene.id);
      if (drive && typeof drive === "object" && "web" in drive && kind !== "web") fail(`The scene ${scene.id} has web steps, and this display records ${kind === "sim" ? "a simulator" : kind === "device" ? "a device" : "a Mac window"}.`);
      if (drive && typeof drive === "object" && "uitest" in drive && kind !== "sim") fail(`The scene ${scene.id} runs a UI test, which drives a simulator, and this display records ${kind === "web" ? "a web page" : kind === "device" ? "a device" : "a Mac window"}.`);
      if (kind === "web" && (drive === "manual" || (drive && typeof drive === "object" && ("command" in drive || "uitest" in drive)))) fail(`The scene ${scene.id} of a web app is driven by web steps or a wait; its page is drawn without a window, which nothing else can reach.`);
    }
  }
  const pending = work.reduce((sum, each) => sum + each.jobs.length, 0);
  const tools = pending > 0 ? await findFfmpeg({ root, ask: confirm }) : null;
  const hash = planHash(plan);
  /** @type {Array<import("./session.mjs").Sidecar & { file?: string }>} */
  const written = [];
  try {
    await withInterrupt(async (signal) => {
      const logs = touchFolder();
      const state = appState();
      try {
        for (const { display, kind, jobs } of work) {
          if (jobs.length === 0) continue;
          checkStop(signal);
          const source =
            kind === "web" ? await webSource(display, plan, flags, tools) : kind === "mac" ? await macSource(plan, flags) : kind === "device" ? await deviceSource(display, plan, flags) : await simSource(display, plan, flags, state);
          await source.around(async () => {
            for (const { scene, locale } of jobs) {
              checkStop(signal);
              const { seconds, settle } = timing(scene, picked.seconds);
              const drive = flags.manual ? "manual" : scene.drive;
              // A recorder that records for a set length gets no more than the scene's driver takes.
              const length = drive && typeof drive === "object" && "wait" in drive ? Math.min(seconds, drive.wait + 0.5) : seconds;
              const file = workingFile(root, display, locale, scene.id, source.extension);
              // A UI test is built before the app is started for it, as the build takes a while.
              const tests = drive && typeof drive === "object" && "uitest" in drive && source.tests ? await source.tests(scene) : undefined;
              console.log(`Recording ${scene.id} (${locale}, ${display}) on ${source.label}…`);
              await source.open(scene, locale);
              const touchLog = path.join(logs.dir, `${display}-${locale}-${scene.id}.log`);
              const take = source.take
                ? await source.take({ scene, locale, file, seconds, settle, signal })
                : await recordTake({
                    file,
                    record: (into) => /** @type {NonNullable<Source["record"]>} */ (source.record)(into, { seconds: length }),
                    name: source.kind === "sim" ? "simctl" : source.kind === "device" ? "devicectl" : "screencapture",
                    drive,
                    context: {
                      scene: scene.id,
                      locale,
                      display,
                      cwd,
                      touchLog,
                      seconds,
                      simulator: source.simulator,
                      tests,
                    },
                    settle,
                    signal,
                    help: source.help,
                  });
              const kept = await keepTake(take, { root, scene: scene.id, locale, display, source: source.kind, model: source.model, os: source.os, scale: source.scale, orientation: display === "mac" ? "landscape" : (plan.orientation ?? "portrait"), padded: source.padded, trim: scene.trim === "auto", planHash: hash, help: source.help }, /** @type {any} */ (tools));
              written.push(kept);
              const touches = kept.touches.length > 0 ? `, ${kept.touches.length} touch${kept.touches.length === 1 ? "" : "es"}` : "";
              const trim = kept.trim ? `, trimmed to ${kept.trim[0]}–${kept.trim[1]} s` : "";
              console.log(`Recorded ${scene.id} (${locale}, ${display}): ${kept.wall} s${trim}${touches} -> ${path.relative(process.cwd(), kept.file) || kept.file}`);
            }
          });
        }
      } finally {
        logs.remove();
      }
    });
  } catch (error) {
    if (!(error instanceof Interrupted)) throw error;
    console.error(error.message);
    interruption.exit(error.code);
    throw error;
  }
  if (picked.reuse) written.push(...pointAtPrimary(root, { displays: picked.footage, scenes: picked.scenes.map((scene) => scene.id), locales: picked.locales, primary: picked.primary }, again));
  const reused = written.filter((each) => each.reuse).length;
  console.log(written.length - reused > 0 || reused > 0 ? `Recorded ${written.length - reused} scene${written.length - reused === 1 ? "" : "s"}${reused > 0 ? `, ${reused} reusing the ${picked.primary} footage` : ""}. Next: appshots video sheet --raw` : "Every scene has a recording already. --again records them once more.");
  return written;
}

/**
 * Writes the sidecars of the languages that use the primary language's footage: each points at it, and is
 * otherwise a copy of what that footage's sidecar said when it was written.
 * @param {string} root
 * @param {{ displays: string[], scenes: string[], locales: string[], primary: string }} which
 * @param {boolean} again Whether a language that has footage of its own is pointed at the primary one too.
 */
export function pointAtPrimary(root, { displays, scenes, locales, primary }, again) {
  const written = [];
  for (const display of displays) {
    for (const scene of scenes) {
      const used = readSidecar(root, display, primary, scene);
      if (!used || used.reuse) continue;
      for (const locale of locales) {
        if (locale === primary) continue;
        const dir = rawDir(root, display, locale);
        if (!again && existsSync(path.join(dir, `${scene}.json`))) continue;
        const { file, ...fields } = used;
        const data = sidecar({ ...fields, locale, reuse: primary });
        writeJson(path.join(dir, `${scene}.json`), data);
        written.push(data);
      }
    }
  }
  return written;
}
