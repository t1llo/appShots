import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

// A server with the example project, stood in for; it answers for no other project.
const home = await cliHome("video-command");
after(() => home.remove());
const FIXTURES = path.join(import.meta.dirname, "fixtures", "video");
const project = {
  id: "p_example",
  name: "Notes",
  locales: ["en", "de"],
  slides: [{ headline: "Notes that keep up" }, { headline: { en: "Everything in one place", de: "Alles an einem Ort" } }, { headline: "Find any note in a second" }, { headline: "Your notes", subheadline: "On every device" }],
};
const server = await stubServer(({ method, url }) => {
  if (method === "GET" && url === "/api/projects/p_example") return [200, { project, shots: [] }];
  return [404, { error: "not found" }];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;
process.env.APPSHOTS_TOKEN = "test-token";

const { parseArgs } = await import("../../cli/src/args.mjs");
const { COMMANDS } = await import("../../cli/src/commands.mjs");
const { HELP, VIDEO_HELP, helpFor } = await import("../../cli/src/help.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
const { GUIDE } = await import("../../cli/src/video/guide.mjs");
const { PREVIEW_DISPLAYS } = await import("../../cli/src/video/plan.mjs");
const { VIDEO_ACTIONS, VIDEO_FLAGS, VIDEO_USAGE, ffmpegLine, optionalStep, video } = await import("../../cli/src/video/command.mjs");

const VIDEO = path.join(import.meta.dirname, "..", "..", "cli", "src", "video");

/** The steps other parts of the CLI hold: the module of each and the functions the command calls in it. */
const STEPS = {
  "record/index.mjs": ["recordScenes", "readSidecar"],
  "import.mjs": ["importFootage"],
  "compose.mjs": ["compose"],
  "check.mjs": ["checkFiles"],
  "sheet.mjs": ["contactSheet"],
  "poster.mjs": ["choosePoster"],
  "ffmpeg.mjs": ["findFfmpeg", "ffmpegStatus"],
  "push.mjs": ["videoPush"],
  "remotion.mjs": ["scaffoldRemotion"],
};

/** Runs `appshots video ...` as main() would, and returns what it printed to stdout and stderr. */
async function runVideo(argv) {
  const errors = [];
  const error = console.error;
  console.error = (...parts) => errors.push(parts.join(" "));
  try {
    const printed = await quietly(() => video(parseArgs(argv)));
    return { printed, errors: errors.join("\n") };
  } finally {
    console.error = error;
  }
}

/** A folder with the example plan in it. */
function planFolder(label) {
  const dir = path.join(home.home, label);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "appshots.video.json");
  writeFileSync(file, readFileSync(path.join(FIXTURES, "plan.json")));
  return file;
}

test("appshots video has every step of the playbook, and the CLI takes their flags", () => {
  assert.deepEqual(Object.keys(VIDEO_ACTIONS), ["init", "plan", "record", "import", "layers", "compose", "check", "sheet", "poster", "remotion", "push", "guide"]);
  assert.equal(COMMANDS.video.flags, VIDEO_FLAGS);
  for (const action of Object.values(VIDEO_ACTIONS)) for (const flag of action.flags) assert.ok(VIDEO_FLAGS.includes(flag));
  const { positional, flags } = parseArgs(["video", "record", "--again", "--realtime", "--reuse-footage", "--manual", "--scene", "inbox", "--sim"]);
  assert.deepEqual(positional, ["video", "record"]);
  assert.deepEqual(flags, { again: true, realtime: true, "reuse-footage": true, manual: true, scene: "inbox", sim: true });
  // A flag that never takes a value leaves the word after it to the command.
  assert.deepEqual(parseArgs(["video", "sheet", "--raw", "--draft", "--json", "out.mp4"]).positional, ["video", "sheet", "out.mp4"]);
  for (const flag of ["yes", "no-install", "replace", "no-wait", "resume"]) assert.deepEqual(parseArgs(["video", "push", `--${flag}`, "x"]).flags, { [flag]: true });
});

test("help for video lists each sub-action, and the general help points to it", () => {
  assert.equal(helpFor("video"), VIDEO_HELP);
  assert.equal(helpFor(undefined), HELP);
  assert.equal(helpFor("capture"), HELP);
  assert.match(HELP, /appshots video <command>/);
  for (const action of Object.keys(VIDEO_ACTIONS)) assert.match(VIDEO_HELP, new RegExp(`appshots video ${action}\\b`), action);
});

test("help for video names every flag a sub-action takes, in that sub-action's entry", () => {
  const entries = VIDEO_HELP.split(/\n(?= {2}appshots video )/);
  // --plan, --lang and --display are said once for all of them, above the list.
  const shared = ["plan", "lang", "display"];
  for (const flag of shared) assert.match(entries[0], new RegExp(`--${flag}\\b`), flag);
  for (const [action, { flags }] of Object.entries(VIDEO_ACTIONS)) {
    const entry = entries.find((each) => each.startsWith(`  appshots video ${action}`));
    assert.ok(entry, action);
    for (const flag of flags.filter((each) => !shared.includes(each))) assert.match(entry, new RegExp(`--${flag}\\b`), `${action} --${flag}`);
  }
});

test("an unknown sub-action, or none, gives the usage", async () => {
  for (const argv of [[], ["nope"], ["toString"]]) await assert.rejects(runVideo(argv), (error) => error instanceof Failure && error.message === VIDEO_USAGE);
  assert.match(VIDEO_USAGE, /^Usage: appshots video init \| plan \| record .* \| guide\. 'appshots help video' lists what each one takes\.$/);
  await assert.rejects(runVideo(["plan", "extra"]), (error) => error instanceof Failure && error.message === "Usage: appshots video plan [--plan <file>] [--json]");
  await assert.rejects(runVideo(["init", "a", "b"]), (error) => error instanceof Failure && error.message.startsWith("Usage: appshots video init [project]"));
  await assert.rejects(runVideo(["plan", "--plan"]), (error) => error instanceof Failure && error.message.startsWith("--plan needs a file name"));
});

test("video guide prints the playbook, and a flag of another sub-action is pointed out and left out", async () => {
  const { printed, errors } = await runVideo(["guide", "--again", "--json"]);
  assert.equal(printed, GUIDE);
  assert.equal(errors, "appshots: video guide takes no --again, so it is left out. 'appshots help video' lists what each one takes.\nappshots: video guide takes no --json, so it is left out. 'appshots help video' lists what each one takes.");
  assert.match(GUIDE, /^# App preview videos\n/);
  assert.match(GUIDE, /appshots video init/);
});

test("video plan prints the storyboard with the project's captions, and without the server as far as it can", async () => {
  const file = planFolder("plan");
  const { printed } = await runVideo(["plan", "--plan", file]);
  assert.match(printed, /^Storyboard of appshots\.video\.json: project p_example/);
  assert.match(printed, /inbox +Everything in one place/);
  const json = JSON.parse((await runVideo(["plan", "--plan", file, "--json"])).printed);
  assert.equal(json.scenes[0].caption.text, "Everything in one place");

  // A project the server does not know: the plan names its languages, so the storyboard still comes.
  const other = planFolder("unknown");
  writeFileSync(other, readFileSync(other, "utf8").replace('"p_example"', '"p_unknown"'));
  const offline = await runVideo(["plan", "--plan", other]);
  assert.match(offline.errors, /^appshots: project p_unknown could not be read, so the captions taken from its slides are not shown: /);
  assert.match(offline.printed, /inbox +\(slide 2 headline\)/);
  // Without languages of its own it cannot.
  writeFileSync(other, JSON.stringify({ ...JSON.parse(readFileSync(other, "utf8")), locales: undefined }));
  await assert.rejects(runVideo(["plan", "--plan", other]), (error) => error instanceof Failure && /takes its languages from project p_unknown, and that could not be read/.test(error.message));
});

test("sheet and poster check what they are given before they start", async () => {
  await assert.rejects(runVideo(["sheet", "a.mp4", "b.mp4"]), (error) => error instanceof Failure && /A file or --raw, not both\.$/.test(error.message));
  await assert.rejects(runVideo(["sheet", "a.mp4", "--raw"]), (error) => error instanceof Failure && /A file or --raw, not both\.$/.test(error.message));
  for (const every of ["0", "61", "soon"]) await assert.rejects(runVideo(["sheet", "--every", every]), (error) => error instanceof Failure && error.message.startsWith("--every takes the seconds between pictures"));
  await assert.rejects(runVideo(["poster"]), (error) => error instanceof Failure && error.message.startsWith("Usage: appshots video poster --at <seconds>"));
  await assert.rejects(runVideo(["poster", "--at", "-1"]), (error) => error instanceof Failure && error.message.startsWith("--at takes the seconds into the preview"));
});

// What each sub-action runs when this build has its step, and what it says when it does not.
const NEEDS = [
  ["record", ["record"], "recordScenes"],
  ["import", ["import", "clip.mov", "--scene", "inbox"], "importFootage"],
  ["compose", ["compose"], "compose"],
  ["check", ["check", "preview.mp4"], "checkFiles"],
  ["sheet", ["sheet", "preview.mp4"], "contactSheet"],
  ["poster", ["poster", "--at", "3", "preview.mp4"], "choosePoster"],
  ["remotion", ["remotion"], "scaffoldRemotion"],
  ["push", ["push", "--dry-run"], "videoPush"],
];
for (const [action, argv, name] of NEEDS) {
  const present = await optionalStep(/** @type {any} */ (name));
  test(`video ${action} says it is not in a build without its step`, { skip: present ? "this build has it" : false }, async () => {
    await assert.rejects(runVideo(argv), (error) => error instanceof Failure && error.message === `'appshots video ${action}' is not available in this build of appshots. 'appshots update' brings this CLI up to date with the server's.`);
  });
}

test("a step that is not there is not in this build, and a file a step imports that is not there is said as it is", () => {
  // In a process of its own, a module hook points compose.mjs at a stand-in that imports a file that is not there,
  // and push.mjs at a file that is not there either, whichever of them this build has.
  const dir = path.join(home.home, "broken-step");
  mkdirSync(dir, { recursive: true });
  // Node names the files by their real paths, and the temporary folder is a link on a Mac.
  const real = realpathSync(dir);
  writeFileSync(path.join(dir, "compose.mjs"), 'import "./remotion.mjs";\nexport const compose = () => {};\n');
  const command = pathToFileURL(path.join(VIDEO, "command.mjs")).href;
  const to = { "./compose.mjs": pathToFileURL(path.join(dir, "compose.mjs")).href, "./push.mjs": pathToFileURL(path.join(dir, "push.mjs")).href };
  const hooks = `const to = ${JSON.stringify(to)};\nexport const resolve = (specifier, context, next) => next(context.parentURL === ${JSON.stringify(command)} && to[specifier] ? to[specifier] : specifier, context);`;
  const script = [
    'import { register } from "node:module";',
    `register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hooks)}`)});`,
    `const { optionalStep } = await import(${JSON.stringify(command)});`,
    'for (const name of ["videoPush", "compose"]) await optionalStep(name).then((found) => console.log(name, found), (error) => console.log(name, error.code, error.message));',
  ].join("\n");
  const [push, compose] = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim().split("\n");
  assert.equal(push, "videoPush null");
  assert.ok(compose.startsWith(`compose ERR_MODULE_NOT_FOUND Cannot find module '${path.join(real, "remotion.mjs")}' imported from ${path.join(real, "compose.mjs")}`), compose);
});

test("ffmpeg is not reported by a build without the video steps", { skip: existsSync(path.join(VIDEO, "ffmpeg.mjs")) ? "this build has them" : false }, async () => {
  assert.equal(await ffmpegLine(), null);
});

for (const [file, names] of Object.entries(STEPS)) {
  test(`the command finds ${names.join(" and ")} in ${file}`, { skip: existsSync(path.join(VIDEO, file)) ? false : "not in this build" }, async () => {
    for (const name of names) assert.equal(typeof (await optionalStep(/** @type {any} */ (name))), "function", name);
  });
}

test("video remotion takes every flag of the command it tells an agent to run next", { skip: existsSync(path.join(VIDEO, "remotion.mjs")) ? process.stdin.isTTY && "stdin is a terminal" : "not in this build" }, async () => {
  const plan = planFolder("remotion");
  const caption = path.join(path.dirname(plan), "appshots-video", "remotion", "src", "Caption.tsx");
  /** What a refusal asks an agent to run once the user said yes, for the plan in that folder. */
  const nextOf = async (argv) => {
    let message = "";
    await assert.rejects(runVideo([...argv, "--plan", plan]), (error) => error instanceof Failure && Boolean((message = error.message)));
    const line = /after a yes, run: appshots video (remotion[^\n]*)$/.exec(message)?.[1];
    assert.ok(line, message);
    return [...line.split(" "), "--plan", plan];
  };
  const written = await runVideo(await nextOf(["remotion", "--no-install"]));
  assert.equal(written.errors, "");
  writeFileSync(caption, "// mine\n");
  const replaced = await runVideo(await nextOf(["remotion", "--yes", "--again", "--no-install"]));
  assert.equal(replaced.errors, "");
  assert.match(replaced.printed, /Wrote 1 file into .*: src\/Caption\.tsx/);
  assert.notEqual(readFileSync(caption, "utf8"), "// mine\n");
});

test("the plan takes the displays the preview specification has", { skip: existsSync(path.join(VIDEO, "specs.mjs")) ? false : "not in this build" }, async () => {
  const { PREVIEW_SPECS } = await import(new URL("../../cli/src/video/specs.mjs", import.meta.url).href);
  assert.deepEqual(Object.keys(PREVIEW_DISPLAYS).sort(), Object.keys(PREVIEW_SPECS).sort());
  // A Mac's preview is landscape only, as the plan has it.
  assert.equal(PREVIEW_SPECS.mac.portrait, null);
});
