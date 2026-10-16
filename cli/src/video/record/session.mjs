import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Failure, fail } from "../../fail.mjs";
import { run } from "../../proc.mjs";
import { readJson } from "../../util.mjs";
import { startDriver } from "./drive.mjs";
import { sidecarTouches, touchLog } from "./touches.mjs";

/**
 * What every recording of a scene goes through, whatever made it: the time before it, the recorder and the
 * driver side by side, the check of the movie, the trim, the sidecar, and Ctrl+C at any moment of it.
 */

/** The kinds of movie a scene's recording may be, the one simctl makes first. An import keeps its own. */
export const MOVIES = [".mov", ".mp4", ".m4v", ".mkv", ".webm"];

/**
 * The display whose footage a display uses. The older iPhone and iPad sizes are cut from the same recording as
 * the current ones, so they are recorded once, under the current one's key.
 * @param {string} display
 */
export const footageDisplay = (display) => (display.startsWith("iphone") ? "iphone" : display.startsWith("ipad") ? "ipad" : display);

/**
 * The folder the recordings of one display and language go to. `root` is the work folder, appshots-video/;
 * the plan's own folder is taken as well, as it holds that one.
 * @param {string} root
 * @param {string} display
 * @param {string} locale
 */
export function rawDir(root, display, locale) {
  const work = path.basename(root) !== "appshots-video" && existsSync(path.join(root, "appshots-video")) ? path.join(root, "appshots-video") : root;
  return path.join(work, "raw", footageDisplay(display), locale);
}

/**
 * The movie of a scene in a folder, whichever kind it is, or null.
 * @param {string} dir
 * @param {string} scene
 */
export function movieOf(dir, scene) {
  for (const extension of MOVIES) {
    const file = path.join(dir, `${scene}${extension}`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** @param {number} value */
export const round2 = (value) => Math.round(value * 100) / 100;

/**
 * @typedef {object} Sidecar
 * @property {1} version
 * @property {string} scene
 * @property {string} locale
 * @property {string} display
 * @property {"sim" | "device" | "mac" | "web" | "import"} source
 * @property {string} model
 * @property {string} os
 * @property {[number, number]} size The movie's pixels as recorded.
 * @property {number} scale Pixels a point: what a touch's points were multiplied by.
 * @property {"portrait" | "landscape"} orientation What the plan asked for; the compose turns a buffer that is
 *   the other way round.
 * @property {number} wall Seconds the recording took by the clock, which a movie that drops still frames does not keep.
 * @property {number} driverOffset Seconds from the start of the recording to the start of the driver.
 * @property {Array<[number, number, number]>} touches [seconds into the recording, x, y], in pixels.
 * @property {[number, number] | null} trim The trim "auto" came to; null when the plan does not say "auto".
 * @property {string | null} reuse The language whose footage this one uses, or null for its own.
 * @property {string} planHash
 * @property {string} recordedAt
 */

/**
 * A sidecar with its keys in the order the files have them.
 * @param {Omit<Sidecar, "version" | "recordedAt" | "reuse"> & { reuse?: string | null }} fields
 * @returns {Sidecar}
 */
export function sidecar(fields) {
  return {
    version: 1,
    scene: fields.scene,
    locale: fields.locale,
    display: fields.display,
    source: fields.source,
    model: fields.model,
    os: fields.os,
    size: fields.size,
    scale: fields.scale,
    orientation: fields.orientation,
    wall: round2(fields.wall),
    driverOffset: round2(fields.driverOffset),
    touches: fields.touches,
    trim: fields.trim,
    reuse: fields.reuse ?? null,
    planHash: fields.planHash,
    recordedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

/**
 * Writes JSON in one step: a reader sees the old file or the new one, never half of one. Arrays of numbers stay
 * on one line, as a person reads them.
 * @param {string} file
 * @param {unknown} data
 */
export function writeJson(file, data) {
  const text = JSON.stringify(data, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(", ")}]`);
  mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, `${text}\n`);
  renameSync(part, file);
}

/**
 * Reads a sidecar as it is stored, or null when there is none or it is not one.
 * @param {string} file
 * @returns {Sidecar | null}
 */
export function storedSidecar(file) {
  const data = readJson(file);
  return data && data.version === 1 && typeof data.scene === "string" ? data : null;
}

/**
 * @typedef {object} Tools What ffmpeg.mjs found: the two programs and what they can do.
 * @property {string} ffmpeg
 * @property {string} ffprobe
 */

/**
 * @typedef {object} Movie
 * @property {[number, number]} size Upright, as it plays: turned when the file says it is to be shown turned.
 * @property {number} duration Seconds, as the file says.
 * @property {number} rotation Degrees the file says it is to be shown turned by.
 * @property {number} streams Video streams in it.
 */

/**
 * What a movie is, quickly: its size, length and turn. A recording is looked at once it is written, before
 * anything is built on it.
 * @param {string} file
 * @param {Tools} tools
 * @returns {Promise<Movie | null>} Null for a file ffprobe cannot read.
 */
export async function inspectMovie(file, tools) {
  const result = await run(tools.ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height:stream_side_data=rotation:stream_tags=rotate", "-of", "json", file], { timeout: 60000 });
  if (result.status !== 0) return null;
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const videos = (data.streams ?? []).filter((stream) => stream.codec_type === "video");
  const [video] = videos;
  if (!video) return { size: [0, 0], duration: Number(data.format?.duration) || 0, rotation: 0, streams: 0 };
  const turn = Number(video.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0) || 0;
  const sideways = Math.abs(turn) % 180 === 90;
  return {
    size: sideways ? [video.height, video.width] : [video.width, video.height],
    duration: Number(data.format?.duration) || 0,
    rotation: turn,
    streams: videos.length,
  };
}

/**
 * Where "trim": "auto" cuts a recording: after a still start and before a still end, keeping a moment of each so
 * the cut does not land in the middle of a movement. Null when there is nothing to cut, or too little would be left.
 * @param {string} file
 * @param {{ wall: number, padded: boolean }} timing padded: whether the movie drops still frames and is laid out
 *   on the clock first, as the compose does.
 * @param {Tools} tools
 * @returns {Promise<[number, number] | null>}
 */
export async function autoTrim(file, { wall, padded }, tools) {
  const clock = padded ? `fps=30,tpad=stop_mode=clone:stop_duration=${wall.toFixed(3)},trim=duration=${wall.toFixed(3)},` : "";
  const result = await run(tools.ffmpeg, ["-nostdin", "-hide_banner", "-i", file, "-vf", `${clock}freezedetect=n=0.003:d=0.4`, "-an", "-f", "null", "-"], { timeout: 300000 });
  if (result.status !== 0) fail(`ffmpeg could not look for the still parts of ${path.basename(file)}:\n${result.stderr.trim().split("\n").slice(-10).join("\n")}`);
  /** @type {Array<{ start: number, end: number | null }>} */
  const freezes = [];
  for (const [, key, value] of result.stderr.matchAll(/lavfi\.freezedetect\.freeze_(start|end):\s*([\d.]+)/g)) {
    if (key === "start") freezes.push({ start: Number(value), end: null });
    else if (freezes.length > 0) freezes[freezes.length - 1].end = Number(value);
  }
  const head = freezes[0]?.start <= 0.05 ? freezes[0] : null;
  const last = freezes.at(-1);
  const tail = last && (last.end === null || last.end >= wall - 0.05) && last !== head ? last : null;
  if (head && head.end === null) return null;
  const from = head?.end ? Math.max(0, head.end - 0.2) : 0;
  const to = tail ? Math.min(wall, tail.start + 0.6) : wall;
  if (to - from < 1 || (from === 0 && to === wall)) return null;
  return [round2(from), round2(to)];
}

/** What a Ctrl+C turns into once what was running has been stopped and put away. */
export class Interrupted extends Failure {
  /** @param {number} code The exit code: 130 for Ctrl+C, 143 for a stop asked for by another program. */
  constructor(code) {
    super("Stopped. The recordings made before are kept; the one in progress was deleted.");
    this.code = code;
  }
}

/** How a stopped recording ends the command. A test keeps it from ending the test run. */
export const interruption = { exit: (/** @type {number} */ code) => process.exit(code) };

/**
 * Runs `work` with Ctrl+C taken over: the first one aborts `signal`, so what is running is stopped in order,
 * its half-written files deleted and the status bar put back, and `work` then fails with Interrupted. The
 * recorder and the driver get the same Ctrl+C from the terminal, and are given a moment to stop by themselves.
 * A third Ctrl+C ends the command at once. A stop asked for by another program, such as an agent's time
 * limit, is treated the same way, as the recorder would otherwise go on recording on its own.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withInterrupt(work) {
  const controller = new AbortController();
  let code = 0;
  let presses = 0;
  const stop = (/** @type {number} */ exit) => {
    presses++;
    if (presses === 1) {
      code = exit;
      process.stderr.write("\nStopping: the recording in progress is finished and deleted, and the simulator put back as it was.\n");
      controller.abort();
    } else if (presses >= 3) {
      interruption.exit(exit);
    }
  };
  const onInt = () => stop(130);
  const onTerm = () => stop(143);
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    return await work(controller.signal);
  } catch (error) {
    // Whatever failed once the stop began failed because of it: a build or a program the terminal stopped too.
    // What was stopped below here does not know which signal it was, so the code is set here.
    if (controller.signal.aborted) throw new Interrupted(code);
    throw error;
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
}

/**
 * Fails with Interrupted when the stop has begun.
 * @param {AbortSignal} signal
 */
export function checkStop(signal) {
  if (signal.aborted) throw new Interrupted(130);
}

/**
 * A pause that ends early when the stop begins, then fails with Interrupted.
 * @param {number} ms
 * @param {AbortSignal} signal
 */
export async function pauseUnlessStopped(ms, signal) {
  checkStop(signal);
  await new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve(undefined);
    }
    signal.addEventListener("abort", done, { once: true });
  });
  checkStop(signal);
}

/**
 * Something that ends after `ms`, and a way to call it off so that it keeps nothing running.
 * @param {number} ms
 */
function timer(ms) {
  let handle;
  const promise = new Promise((resolve) => (handle = setTimeout(resolve, Math.max(0, ms))));
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * @param {AbortSignal} signal
 */
function stopped(signal) {
  let listener = () => {};
  const promise = new Promise((resolve) => {
    if (signal.aborted) return resolve(undefined);
    listener = () => resolve(undefined);
    signal.addEventListener("abort", listener, { once: true });
  });
  return { promise, cancel: () => signal.removeEventListener("abort", listener) };
}

/**
 * @typedef {object} Take What a recording of a scene came to, before it is checked.
 * @property {string} file The movie, still under its working name.
 * @property {number} wall Seconds from the start of the recording to its end.
 * @property {number} driverOffset Seconds from the start of the recording to the driver's.
 * @property {number} driverStart When the driver started, as Date.now() has it.
 * @property {import("./touches.mjs").Touch[]} touches As the driver reported them.
 */

/** A moment after the driver is done, so that its last change has reached the recording. */
const TAIL = 500;

/**
 * Records one scene with a recorder that runs as a program: waits for the app to settle, starts the recorder and
 * waits until it records, starts the driver, waits until the driver is done or the scene has run its length,
 * and stops the recorder. A driver that fails, or a recorder that stops by itself, fails the scene; a Ctrl+C
 * stops both and fails it with Interrupted. The movie is deleted on any of these.
 * @param {object} take
 * @param {string} take.file Where the recorder writes, under a working name.
 * @param {(file: string) => Promise<import("./spawn.mjs").Recorder>} take.record
 * @param {string} take.name What the messages call the recorder, as in "simctl".
 * @param {import("./drive.mjs").Drive | undefined} take.drive
 * @param {import("./drive.mjs").DriveContext} take.context
 * @param {number} take.settle Seconds to wait before the recording starts.
 * @param {AbortSignal} take.signal
 * @param {string} [take.help] What to do when the recorder fails, said after why.
 * @returns {Promise<Take>}
 */
export async function recordTake({ file, record, name, drive, context, settle, signal, help }) {
  await pauseUnlessStopped(settle * 1000, signal);
  rmSync(file, { force: true });
  let recorder;
  try {
    recorder = await record(file);
  } catch (error) {
    rmSync(file, { force: true });
    if (signal.aborted) throw new Interrupted(130);
    if (help && error instanceof Failure && !(error instanceof Interrupted)) fail(`${error.message}\n${help}`);
    throw error;
  }
  /** @type {import("./drive.mjs").Driving | null} */
  let driving = null;
  let finished = false;
  try {
    checkStop(signal);
    driving = startDriver(drive, context);
    const length = timer(context.seconds * 1000 - (Date.now() - recorder.started));
    const stop = stopped(signal);
    const outcome = await Promise.race([
      driving.done.then((result) => ({ result })),
      // One that records for a set length ends by itself when its time is up.
      recorder.running.exited.then(() => (recorder.length === undefined ? { lost: true } : { full: true })),
      length.promise.then(() => ({ full: true })),
      stop.promise.then(() => ({ interrupted: true })),
    ]);
    length.cancel();
    stop.cancel();
    if (!("result" in outcome)) await driving.stop();
    const result = await driving.done;
    if ("interrupted" in outcome) throw new Interrupted(130);
    if ("lost" in outcome) fail(`${name} stopped recording by itself.${recorder.running.said() ? `\n${recorder.running.said()}` : ""}${help ? `\n${help}` : ""}`);
    if (result.failed) fail(result.failed);
    if (drive !== undefined && drive !== "manual" && !("wait" in drive) && "result" in outcome) await pauseUnlessStopped(TAIL, signal);
    const exit = await recorder.stop();
    finished = true;
    if (exit.status !== 0) fail(`${name} could not finish the recording${exit.signal ? ` (${exit.signal})` : ` (exit code ${exit.status})`}.${recorder.running.said() ? `\n${recorder.running.said()}` : ""}${help ? `\n${help}` : ""}`);
    return {
      file,
      wall: (exit.stopped - recorder.started) / 1000,
      driverOffset: (driving.started - recorder.started) / 1000,
      driverStart: driving.started,
      touches: [...result.touches, ...touchLog(context.touchLog)],
    };
  } catch (error) {
    if (driving) await driving.stop();
    // After a Ctrl+C the recorder had it too and is finishing by itself; a second SIGINT could cut that short.
    if (!finished) await recorder.stop({ grace: signal.aborted ? 1500 : 0, abandon: true });
    rmSync(file, { force: true });
    if (signal.aborted && !(error instanceof Interrupted)) throw new Interrupted(130);
    throw error;
  }
}

/**
 * A folder of its own for the touch logs of a run, removed with `remove`.
 */
export function touchFolder() {
  const dir = mkdtempSync(path.join(tmpdir(), "appshots-touches-"));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * @typedef {object} Keep Where a take goes and what its sidecar says about where it came from.
 * @property {string} root The work folder.
 * @property {string} scene
 * @property {string} locale
 * @property {string} display
 * @property {Sidecar["source"]} source
 * @property {string} model
 * @property {string} os
 * @property {(size: [number, number]) => number} scale Pixels a point, given the recording's size.
 * @property {"portrait" | "landscape"} orientation
 * @property {boolean} padded Whether the movie drops still frames, so the clock has to restore its length.
 * @property {boolean} trim Whether the plan says "auto".
 * @property {string} planHash
 * @property {string} [help] What to do when the movie is empty, said after why.
 */

/**
 * Looks at a take, cuts it if the plan says "auto", and keeps it: the movie under the scene's name in place of
 * any earlier one, and the sidecar beside it. A movie without a picture is deleted and fails the scene.
 * @param {Take} take
 * @param {Keep} keep
 * @param {Tools} tools
 * @returns {Promise<Sidecar & { file: string }>}
 */
export async function keepTake(take, keep, tools) {
  try {
    const empty = !existsSync(take.file) || statSync(take.file).size === 0;
    const movie = empty ? null : await inspectMovie(take.file, tools);
    if (!movie || movie.streams === 0) {
      fail(
        empty
          ? `The recording of ${keep.scene} came out empty. A recorder stopped any other way than with Ctrl+C or SIGINT leaves no movie; record the scene again.${keep.help ? `\n${keep.help}` : ""}`
          : `The recording of ${keep.scene} holds no video that ffprobe can read. Record the scene again.${keep.help ? `\n${keep.help}` : ""}`,
      );
    }
    if (movie.streams > 1) fail(`The recording of ${keep.scene} holds ${movie.streams} videos, where one is expected.`);
    // A recording that drops still frames is short when little moved, which the clock makes up for. A file
    // that keeps its time and is still this short has nothing in it.
    if (!keep.padded && movie.duration < 0.5) fail(`The recording of ${keep.scene} is only ${round2(movie.duration)} seconds long. Record the scene again.`);
    if (keep.padded && movie.duration < 0.5 && take.wall > 2) console.log(`  ! Little moved on screen while ${keep.scene} recorded. Look at it with 'appshots video sheet --raw'.`);
    // A movie that keeps its time knows its length better than the clock around the recorder does.
    const wall = keep.padded ? take.wall : movie.duration;
    const trim = keep.trim ? await autoTrim(take.file, { wall, padded: keep.padded }, tools) : null;
    const scale = keep.scale(movie.size);
    const data = sidecar({
      scene: keep.scene,
      locale: keep.locale,
      display: footageDisplay(keep.display),
      source: keep.source,
      model: keep.model,
      os: keep.os,
      size: movie.size,
      scale,
      orientation: keep.orientation,
      wall,
      driverOffset: take.driverOffset,
      touches: sidecarTouches(take.touches, { driverStart: take.driverStart, offset: take.driverOffset, scale, wall }),
      trim,
      planHash: keep.planHash,
    });
    const dir = rawDir(keep.root, keep.display, keep.locale);
    mkdirSync(dir, { recursive: true });
    const extension = MOVIES.find((each) => take.file.endsWith(each)) ?? path.extname(take.file);
    const file = path.join(dir, `${keep.scene}${extension}`);
    for (const other of MOVIES) if (other !== extension) rmSync(path.join(dir, `${keep.scene}${other}`), { force: true });
    renameSync(take.file, file);
    writeJson(path.join(dir, `${keep.scene}.json`), data);
    return { ...data, file };
  } catch (error) {
    rmSync(take.file, { force: true });
    throw error;
  }
}

/**
 * The working name a recording is made under until it has been looked at, beside where it goes, so that an
 * earlier recording of the scene stays until there is a better one.
 * @param {string} root
 * @param {string} display
 * @param {string} locale
 * @param {string} scene
 * @param {string} extension
 */
export function workingFile(root, display, locale, scene, extension) {
  const dir = rawDir(root, display, locale);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${scene}.recording${extension}`);
}
