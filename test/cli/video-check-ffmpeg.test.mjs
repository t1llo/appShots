import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, afterEach, beforeEach, test } from "node:test";
import { cliHome, quietly, scriptedRunner } from "./helpers.mjs";

// A Mac stood in for by folders of programs that do nothing: what each one answers comes from the scripted
// runner, so no ffmpeg runs and nothing is ever installed.
const home = await cliHome("video-ffmpeg");
after(() => home.remove());

const { setRunner } = await import("../../cli/src/proc.mjs");
const { ffmpegStatus, findFfmpeg, homebrew, lacking, NEEDS, toolEnv } = await import("../../cli/src/video/ffmpeg.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
const { confirm } = await import("../../cli/src/prompt.mjs");

/** ffmpeg's -encoders and -filters lists, shortened, in the layout ffmpeg prints them. */
const ENCODERS = (names) => `Encoders:\n V..... = Video\n A..... = Audio\n ------\n${names.map((name) => ` V....D ${name.padEnd(20)} ${name} encoder`).join("\n")}\n`;
const FILTERS = (names) => `Filters:\n  T.. = Timeline support\n  | = Source or sink filter\n  ------\n${names.map((name) => ` TS ${name.padEnd(16)} V->V       ${name}`).join("\n")}\n`;
const EVERY_FILTER = [...new Set([...NEEDS.compose.filters, ...NEEDS.sheet.filters])];

/** What the stand-in ffmpeg says of itself; a test changes it. */
let said = { version: "9.0.2", encoders: ["libx264", "h264_videotoolbox", "aac", "png"], filters: EVERY_FILTER, starts: true };
/** What `brew install ffmpeg` does, when it is run. */
let installs = () => {};
const script = scriptedRunner((command, args) => {
  if (command.endsWith("/brew")) {
    installs();
    return { status: 0 };
  }
  if (!said.starts) return { status: 1, stderr: "dyld: Library not loaded: libavdevice.62.dylib" };
  if (args.includes("-version")) return { stdout: `${path.basename(command)} version ${said.version} Copyright (c) 2000-2026 the FFmpeg developers\nbuilt with clang\n` };
  if (args.includes("-encoders")) return { stdout: ENCODERS(said.encoders) };
  if (args.includes("-filters")) return { stdout: FILTERS(said.filters) };
  return { status: 1, stderr: `unexpected ${args.join(" ")}` };
});
const before = setRunner(script.runner);
after(() => setRunner(before));

const saved = { PATH: process.env.PATH, bins: homebrew.bins };
/** A folder of its own for each test, so ffmpeg's answers are asked again for the programs in it. */
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(home.home, "mac-"));
  process.env.PATH = path.join(dir, "empty");
  homebrew.bins = [path.join(dir, "homebrew")];
  delete process.env.APPSHOTS_FFMPEG;
  delete process.env.APPSHOTS_FFPROBE;
  said = { version: "9.0.2", encoders: ["libx264", "h264_videotoolbox", "aac", "png"], filters: EVERY_FILTER, starts: true };
  installs = () => {};
  script.calls.length = 0;
});
afterEach(() => {
  process.env.PATH = saved.PATH;
  homebrew.bins = saved.bins;
  delete process.env.APPSHOTS_FFMPEG;
  delete process.env.APPSHOTS_FFPROBE;
});

/**
 * Puts programs that do nothing into a folder.
 * @param {string} folder
 * @param {string[]} names
 */
function programs(folder, ...names) {
  mkdirSync(folder, { recursive: true });
  for (const name of names) {
    writeFileSync(path.join(folder, name), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(folder, name), 0o755);
  }
  return folder;
}

const brewRan = () => script.calls.some((call) => call.includes("/brew "));

/**
 * Runs `work` with a stand-in for process.stdin: a terminal where `answer` is typed, then Return, or for null a
 * pipe, as an agent's shell has. Gives back what it ended with, a value or an error, and what it printed.
 * @param {string | null} answer
 * @param {() => Promise<unknown>} work
 */
async function withStdin(answer, work) {
  const real = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process, "stdin"));
  const stdin = Object.assign(new PassThrough(), { isTTY: answer !== null });
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  try {
    if (answer !== null) setTimeout(() => stdin.write(`${answer}\n`), 20);
    /** @type {any} */
    let outcome = null;
    const printed = await quietly(async () => {
      outcome = await work().then(
        (value) => value,
        (error) => error,
      );
    });
    return { outcome, printed };
  } finally {
    Object.defineProperty(process, "stdin", real);
  }
}

const QUESTION = "ffmpeg is needed to cut the video and is not on this Mac. Install it with Homebrew now (brew install ffmpeg, about 100 MB)? [y/N] ";

test("ffmpeg on the PATH is found with the ffprobe beside it, and says what it can do", async () => {
  const bin = programs(path.join(dir, "bin"), "ffmpeg", "ffprobe");
  programs(path.join(dir, "other"), "ffprobe");
  process.env.PATH = [path.join(dir, "other"), bin].join(path.delimiter);
  const tools = await findFfmpeg({});
  assert.equal(tools.ffmpeg, path.join(bin, "ffmpeg"));
  assert.equal(tools.ffprobe, path.join(bin, "ffprobe"));
  assert.equal(tools.version, "9.0.2");
  assert.equal(tools.from, "PATH");
  assert.equal(tools.h264, "libx264");
  assert.ok(tools.encoders.has("aac") && tools.encoders.has("h264_videotoolbox"));
  assert.ok(tools.filters.has("xfade") && tools.filters.has("tile"));
  assert.ok(!tools.filters.has("=") && !tools.encoders.has("Video"));
  assert.equal(toolEnv(tools), undefined);
});

test("ffmpeg is asked what it is once a run", async () => {
  process.env.PATH = programs(path.join(dir, "bin"), "ffmpeg", "ffprobe");
  await findFfmpeg({});
  const asked = script.calls.length;
  await findFfmpeg({ need: "sheet" });
  assert.equal(script.calls.length, asked);
});

test("Homebrew's folder is looked in when the PATH has no ffmpeg, as an agent's shell often has not", async () => {
  programs(homebrew.bins[0], "ffmpeg", "ffprobe");
  const tools = await findFfmpeg({});
  assert.equal(tools.ffmpeg, path.join(homebrew.bins[0], "ffmpeg"));
  assert.equal(tools.from, "Homebrew");
});

test("APPSHOTS_FFMPEG and APPSHOTS_FFPROBE come first, and one that is not there is said so", async () => {
  programs(homebrew.bins[0], "ffmpeg", "ffprobe");
  const own = programs(path.join(dir, "own"), "ffmpeg", "ffprobe");
  process.env.APPSHOTS_FFMPEG = path.join(own, "ffmpeg");
  const tools = await findFfmpeg({});
  assert.equal(tools.ffmpeg, path.join(own, "ffmpeg"));
  assert.equal(tools.ffprobe, path.join(own, "ffprobe"));
  assert.equal(tools.from, "APPSHOTS_FFMPEG");
  process.env.APPSHOTS_FFMPEG = path.join(dir, "nowhere", "ffmpeg");
  await assert.rejects(findFfmpeg({}), (error) => error instanceof Failure && error.message.includes(`APPSHOTS_FFMPEG is ${path.join(dir, "nowhere", "ffmpeg")}`));
});

test("Remotion's ffmpeg in the work folder is the last place to read a video and take its poster, and runs with its own libraries", async () => {
  const root = path.join(dir, "appshots-video");
  const compositor = programs(path.join(root, "remotion", "node_modules", "@remotion", `compositor-${process.platform}-${process.arch}`), "ffmpeg", "ffprobe");
  const tools = await findFfmpeg({ root, need: "probe" });
  assert.equal(tools.ffmpeg, path.join(compositor, "ffmpeg"));
  assert.equal(tools.from, "Remotion");
  const env = /** @type {NodeJS.ProcessEnv} */ (toolEnv(tools));
  assert.equal(env[process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH"], compositor);
  assert.equal(env.HOME, process.env.HOME);
  // The plan's folder works as well as the work folder in it.
  assert.equal((await findFfmpeg({ root: dir, need: "poster" })).ffmpeg, tools.ffmpeg);
});

test("a compose passes Remotion's ffmpeg over and offers Homebrew's, as the steps that cut run what they are given as it is", async () => {
  const root = path.join(dir, "appshots-video");
  programs(path.join(root, "remotion", "node_modules", "@remotion", `compositor-${process.platform}-${process.arch}`), "ffmpeg", "ffprobe");
  programs(homebrew.bins[0], "brew");
  // Even one that says it has every filter: it would not start without its libraries' folder in its environment.
  const { outcome } = await withStdin(null, () => findFfmpeg({ root, ask: confirm }));
  assert.ok(outcome instanceof Failure);
  assert.equal(outcome.message, "ffmpeg is not installed. Ask the user whether to install it, then run: brew install ffmpeg");
  assert.match(await ffmpegStatus(root), /compositor-[^/]+\/ffmpeg, version 9\.0\.2, Remotion's, which can read a preview and take its poster, but not cut one\. 'brew install ffmpeg' installs one that can/);
  assert.equal(brewRan(), false);
});

test("without ffmpeg and without a terminal, it fails with what to ask the user, and installs nothing", async () => {
  programs(homebrew.bins[0], "brew");
  // The recording and the compose pass the CLI's yes-or-no helper, which says no without a terminal: that is
  // nobody's answer, so the agent is told to ask the user rather than that the user said no.
  for (const ask of [true, confirm]) {
    const { outcome, printed } = await withStdin(null, () => findFfmpeg({ ask }));
    assert.ok(outcome instanceof Failure);
    assert.equal(outcome.message, "ffmpeg is not installed. Ask the user whether to install it, then run: brew install ffmpeg");
    assert.equal(printed, "");
  }
  assert.equal(brewRan(), false);
});

test("a command that only reports never asks, even at a terminal", async () => {
  programs(homebrew.bins[0], "brew");
  const { outcome, printed } = await withStdin("y", () => findFfmpeg({ ask: false }));
  assert.ok(outcome instanceof Failure && /Ask the user whether to install it, then run: brew install ffmpeg/.test(outcome.message));
  assert.equal(printed, "");
  assert.equal(brewRan(), false);
});

test("at a terminal the question is asked there, and Return alone is a no whoever asks", async () => {
  programs(homebrew.bins[0], "brew");
  for (const [answer, ask] of /** @type {const} */ ([["", true], ["n", true], ["", confirm]])) {
    const { outcome, printed } = await withStdin(answer, () => findFfmpeg({ ask }));
    assert.ok(outcome instanceof Failure && /Install it with 'brew install ffmpeg' when you want to/.test(outcome.message), `"${answer}" is a no`);
    assert.ok(printed.includes(QUESTION), printed);
    assert.ok(!printed.includes("[Y/n]"));
  }
  assert.equal(brewRan(), false);
});

test("a yes runs brew install ffmpeg, and the ffmpeg it puts there is used", async () => {
  const brew = path.join(programs(homebrew.bins[0], "brew"), "brew");
  installs = () => programs(homebrew.bins[0], "ffmpeg", "ffprobe");
  const { outcome, printed } = await withStdin("y", () => findFfmpeg({ ask: confirm }));
  assert.ok(printed.includes(QUESTION));
  assert.ok(script.calls.includes(`${brew} install ffmpeg`));
  assert.equal(outcome.ffmpeg, path.join(homebrew.bins[0], "ffmpeg"));
});

test("without Homebrew it fails with where to read how to get ffmpeg", async () => {
  await assert.rejects(findFfmpeg({}), (error) => error instanceof Failure && /no Homebrew/.test(error.message) && /troubleshooting/.test(error.message));
  assert.equal(script.calls.length, 0);
});

test("an ffmpeg without what the compose needs is refused before any work, naming what is missing", async () => {
  programs(homebrew.bins[0], "ffmpeg", "ffprobe");
  said.filters = EVERY_FILTER.filter((name) => name !== "xfade" && name !== "loudnorm");
  await assert.rejects(findFfmpeg({}), (error) => error instanceof Failure && /cannot cut the video: that needs the filters xfade, loudnorm\./.test(error.message) && /brew upgrade ffmpeg/.test(error.message));
  // Reading a file needs none of it.
  assert.equal((await findFfmpeg({ need: "probe" })).version, "9.0.2");
});

test("what a found ffmpeg lacks, by use", () => {
  const tools = { ffmpeg: "ffmpeg", ffprobe: "ffprobe", version: "4.2.7", encoders: new Set(["aac", "png"]), filters: new Set(["fps", "scale", "pad", "tile", "vstack"]), h264: null, from: /** @type {const} */ ("PATH") };
  const compose = lacking(tools, "compose");
  assert.equal(compose[0], "version 4.3 or newer");
  assert.equal(compose[1], "an H.264 encoder (libx264 or h264_videotoolbox)");
  assert.match(compose[2], /^the filters xfade, tpad, setparams/);
  assert.deepEqual(lacking(tools, "sheet"), []);
  assert.deepEqual(lacking(tools, "probe"), []);
  assert.deepEqual(lacking({ ...tools, version: "4.2.7", encoders: new Set() }, "poster"), ["the png encoder"]);
  // VideoToolbox will do when there is no x264, and a build that names no release is judged by what it has.
  assert.deepEqual(lacking({ ...tools, version: null, h264: "h264_videotoolbox", filters: new Set(EVERY_FILTER) }, "compose"), []);
});

test("an ffmpeg that does not start is said so", async () => {
  programs(homebrew.bins[0], "ffmpeg", "ffprobe");
  said.starts = false;
  await assert.rejects(findFfmpeg({}), (error) => error instanceof Failure && /does not start: dyld: Library not loaded/.test(error.message));
});

test("appshots check's line says what there is, and never asks or installs", async () => {
  assert.match(await ffmpegStatus(), /^not installed; only app preview videos need it\. There is no Homebrew/);
  programs(homebrew.bins[0], "brew");
  assert.match(await ffmpegStatus(), /^not installed; only app preview videos need it\. 'brew install ffmpeg' installs it/);
  programs(homebrew.bins[0], "ffmpeg", "ffprobe");
  assert.equal(await ffmpegStatus(), `${path.join(homebrew.bins[0], "ffmpeg")}, version 9.0.2, with libx264 and every filter 'appshots video compose' needs`);
  assert.equal(brewRan(), false);
});

test("appshots check's line names what an ffmpeg lacks", async () => {
  programs(homebrew.bins[0], "ffmpeg", "ffprobe");
  said = { ...said, version: "4.2.7", encoders: ["aac", "png"] };
  const line = await ffmpegStatus();
  assert.match(line, /version 4\.2\.7, which cannot cut a preview: that needs version 4\.3 or newer, an H\.264 encoder/);
  assert.match(line, /'brew upgrade ffmpeg' brings one that can\.$/);
});
