import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cliHome } from "./helpers.mjs";

const home = await cliHome("video-plan");
after(() => home.remove());
const plans = await import("../../cli/src/video/plan.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");
const { FPS, captionLayerId, joinOffsets, lengthProblem, orientationOf, planHash, posterTime, readPlan, resolvePlan, sceneSeconds, selectedDisplays, selectedLocales, selectedScenes, timeline, validatePlan, workFolders } = plans;

const FIXTURES = path.join(import.meta.dirname, "fixtures", "video");
const example = () => JSON.parse(readFileSync(path.join(FIXTURES, "plan.json"), "utf8"));
const sidecar = JSON.parse(readFileSync(path.join(FIXTURES, "sidecar.json"), "utf8"));

/** The example plan with changes, as validatePlan reads it. */
const checked = (change = (plan) => plan) => validatePlan(change(example()));

/** @param {unknown} raw */
const problemsOf = (raw) => validatePlan(raw).problems;

/** A plan as readPlan gives it, from the example with changes. */
function planOf(change = (plan) => plan) {
  const { plan, problems } = checked(change);
  assert.deepEqual(problems, []);
  return { ...plan, file: path.join(home.home, "appshots.video.json"), root: home.home };
}

/** @param {number} seconds */
const onFrame = (seconds) => Math.round(seconds * FPS) / FPS;

test("the example plan is read with every default filled in", () => {
  const { plan, problems, warnings } = checked();
  assert.deepEqual(problems, []);
  assert.deepEqual(warnings, []);
  assert.equal(plan.name, "preview");
  assert.equal(plan.orientation, "portrait");
  assert.equal(plan.footage, "per-locale");
  assert.equal(plan.style, "store");
  assert.equal(plan.captionStyle, "panel");
  assert.equal(plan.fit, "plate");
  assert.deepEqual(plan.transition, { type: "fade", seconds: onFrame(0.4) });
  assert.equal(plan.target, 26);
  assert.deepEqual(plan.intro, { seconds: 1.5, logo: true, headline: { slide: 1 } });
  assert.deepEqual(plan.outro, { seconds: 2, lines: [{ slide: 4, field: "sub" }], logo: true, disclosure: ["subscription"] });
  const [inbox, search, share] = plan.scenes;
  assert.deepEqual(inbox.record, { seconds: 12, settle: 1.5 });
  assert.equal(inbox.trim, "auto");
  assert.equal(inbox.speed, 1);
  assert.equal(inbox.hold, 0);
  assert.equal(inbox.touches, true);
  assert.equal(inbox.captionPosition, "top");
  assert.deepEqual(inbox.launch, { args: ["-AppshotsDemo", "inbox"] });
  // Before a recording: 6 s for a UI test, the wait for a demo, what a scene is given to record.
  assert.equal(inbox.estimate, 6);
  assert.equal(search.estimate, 6);
  assert.equal(share.estimate, 8);
  assert.equal(share.caption, "Share in one tap");
  assert.equal(share.drive, "manual");
});

test("a caption left out is none, and intro and outro left out are no cards", () => {
  const { plan } = checked((raw) => {
    delete raw.intro;
    raw.outro = false;
    delete raw.scenes[0].caption;
    return raw;
  });
  assert.equal(plan.intro, false);
  assert.equal(plan.outro, false);
  assert.equal(plan.scenes[0].caption, false);
});

test("each problem names its place in the plan", () => {
  const problems = problemsOf({
    version: 1,
    project: "p_example",
    app: { platform: "ios", colour: "red" },
    displays: ["iphone", "tv", "mac"],
    locales: ["en", "english"],
    captionStyle: "neon",
    scenes: [
      { id: "inbox", trim: [5, 2], speed: 3, drive: { web: [{ click: "#new" }] } },
      { id: "inbox", caption: { slide: 0 } },
      { id: "Bad Id", drive: { wait: 90 } },
    ],
    poster: { scene: "nowhere" },
    target: 40,
  });
  for (const expected of [
    "app.colour: is not a field of app",
    'displays[1]: should be "iphone", "iphone-5.5", "iphone-4.7", "ipad", "ipad-9.7" or "mac", not "tv"',
    "displays[2]: mac is not a display of an iPhone or iPad app",
    'locales[1]: "english" is not a language code, such as en or de-DE',
    'captionStyle: should be "panel", "shadow" or "band", not "neon"',
    "scenes[0].trim: the end comes before the start",
    "scenes[0].speed: should be from 1 to 2, not 3",
    "scenes[0].drive.web: web steps drive a web app's pages, and this is an iPhone or iPad app",
    "scenes[1].id: inbox is there twice",
    "scenes[1].caption.slide: should be a slide's number, counted from 1",
    'scenes[2].id: "Bad Id" is not an id of lowercase letters, digits and - (32 at most)',
    "scenes[2].drive.wait: should be from 0.5 to 60, not 90",
    "poster.scene: there is no scene nowhere",
    "target: should be from 15 to 30, not 40",
  ]) {
    assert.ok(problems.includes(expected), `${expected}\nnot among:\n${problems.join("\n")}`);
  }
});

test("a plan that is not one, or of a later version, says so", () => {
  assert.deepEqual(problemsOf([]), ["plan: should be an object"]);
  const problems = problemsOf({ version: 2, project: "p_example", app: { platform: "ios" }, displays: ["iphone"], scenes: [{ id: "a" }] });
  assert.match(problems[0], /^version: this plan is version 2, and this appshots reads version 1/);
  assert.ok(problemsOf({ version: 1 }).includes("project: is missing: the id of the appShots project the captions come from"));
});

test("a web app takes web steps and no UI test, and a platform that is wrong says nothing about the displays", () => {
  const web = {
    version: 1,
    project: "p_example",
    app: { platform: "web", url: "https://appshots.example.com" },
    displays: ["iphone", "mac"],
    scenes: [{ id: "home", drive: { web: [{ goto: "/" }, { type: ["#q", "notes"] }, { wait: 1 }] } }],
  };
  assert.deepEqual(problemsOf(web), []);
  assert.ok(problemsOf({ ...web, scenes: [{ id: "home", drive: { uitest: "A/B/c" } }] }).includes("scenes[0].drive.uitest: a web app's scenes are driven with web steps, not an Xcode UI test"));
  assert.deepEqual(problemsOf({ ...web, app: { platform: "tv" } }), ['app.platform: should be "ios", "mac" or "web", not "tv"']);
});

test("a band caption and narration are warnings, not problems", () => {
  const { problems, warnings } = checked((raw) => ({ ...raw, captionStyle: "band", narration: { en: "en.m4a" } }));
  assert.deepEqual(problems, []);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /band/);
  assert.match(warnings[1], /narration/);
});

test("readPlan fails with every problem and points at init when there is no plan", () => {
  const dir = path.join(home.home, "read");
  mkdirSync(dir, { recursive: true });
  assert.throws(() => readPlan(path.join(dir, "appshots.video.json")), (error) => error instanceof Failure && /'appshots video init <project>' writes one/.test(error.message) && /--plan <file>/.test(error.message));
  writeFileSync(path.join(dir, "broken.json"), "{ not json");
  assert.throws(() => readPlan(path.join(dir, "broken.json")), /broken\.json is not valid JSON/);
  writeFileSync(path.join(dir, "wrong.json"), JSON.stringify({ ...example(), target: 3, captionStyle: "neon" }));
  assert.throws(() => readPlan(path.join(dir, "wrong.json")), (error) => /wrong\.json needs 2 changes:\n {2}captionStyle: .*\n {2}target: /.test(error.message));
  writeFileSync(path.join(dir, "good.json"), JSON.stringify(example()));
  const plan = readPlan(path.join(dir, "good.json"));
  assert.equal(plan.file, path.join(dir, "good.json"));
  assert.equal(plan.root, dir);
});

test("the plan's hash is the same for the same plan, wherever it is and however its keys are ordered", () => {
  const plan = planOf();
  const reordered = Object.fromEntries(Object.entries(plan).reverse());
  assert.match(planHash(plan), /^[0-9a-f]{8}$/);
  assert.equal(planHash(reordered), planHash(plan));
  assert.equal(planHash({ ...plan, file: "/elsewhere/plan.json", root: "/elsewhere" }), planHash(plan));
  assert.notEqual(planHash(planOf((raw) => ({ ...raw, target: 20 }))), planHash(plan));
});

test("a scene lasts its cut over its speed, plus the frame it holds", () => {
  const plan = planOf();
  const [inbox, search, share] = plan.scenes;
  // Before a recording, its estimate.
  assert.equal(sceneSeconds(plan, search, null), 6);
  assert.equal(sceneSeconds(plan, share), 8);
  // The cut "auto" came to, from the sidecar: 0.6 to 7.2 s.
  assert.equal(sceneSeconds(plan, inbox, sidecar), onFrame(6.6));
  // A trim in the plan wins over the sidecar's, and stops where the recording does.
  assert.equal(sceneSeconds(plan, { ...inbox, trim: [1, 20] }, sidecar), onFrame(6.84));
  // Without any trim, the whole recording.
  assert.equal(sceneSeconds(plan, { ...search, trim: null }, { wall: 7.84 }), onFrame(7.84));
  assert.equal(sceneSeconds(plan, { ...search, speed: 2, hold: 0.5 }, { wall: 8 }), 4.5);
  // A whole number of frames.
  assert.equal(Math.round(sceneSeconds(plan, inbox, { wall: 7.01, trim: [0, 7.01] }) * FPS) % 1, 0);
});

test("joins start where the segments before them end, less a transition for each", () => {
  assert.deepEqual(joinOffsets([1.5, 6, 6, 8, 2], { type: "fade", seconds: 0.4 }), { offsets: [1.1, 6.7, 12.3, 19.9], total: 21.9 });
  assert.deepEqual(joinOffsets([6, 6], { type: "none", seconds: 0 }), { offsets: [6], total: 12 });
  assert.deepEqual(joinOffsets([10], 0.5), { offsets: [], total: 10 });
  // O_k = the first k lengths less k transitions.
  const durations = [2, 5.5, 7.25, 3];
  const { offsets, total } = joinOffsets(durations, 0.5);
  for (const [k, offset] of offsets.entries()) assert.equal(offset, onFrame(durations.slice(0, k + 1).reduce((a, b) => a + b, 0) - (k + 1) * 0.5));
  assert.equal(total, onFrame(17.75 - 3 * 0.5));
});

test("the timeline runs intro, scenes and outro, and says which scenes are recorded", () => {
  const plan = planOf();
  const line = timeline(plan, (scene) => (scene.id === "inbox" ? sidecar : null));
  assert.deepEqual(
    line.segments.map(({ kind, id, start, seconds, recorded }) => [kind, id, start, seconds, recorded]),
    [
      ["intro", "intro", 0, 1.5, undefined],
      ["scene", "inbox", 1.1, 6.6, true],
      ["scene", "search", 7.3, 6, false],
      ["scene", "share", 12.9, 8, false],
      ["outro", "outro", 20.5, 2, undefined],
    ],
  );
  assert.equal(line.total, 22.5);
  assert.equal(timeline(planOf((raw) => ({ ...raw, intro: false, outro: false }))).total, onFrame(20 - 2 * 0.4));
});

test("the poster is the first scene a second after its caption, unless the plan says otherwise", () => {
  const plan = planOf((raw) => {
    delete raw.poster;
    return raw;
  });
  const line = timeline(plan);
  // inbox starts at 1.1; its caption is in 0.4 + 0.45 s later; a second after that.
  assert.equal(posterTime(plan, line), onFrame(1.1 + 0.4 + 0.45 + 1));
  const named = planOf((raw) => ({ ...raw, poster: { scene: "search", at: 2 } }));
  assert.equal(posterTime(named, timeline(named)), onFrame(6.7 + 2));
  const timed = planOf((raw) => ({ ...raw, poster: { time: 12.34 } }));
  assert.equal(posterTime(timed, timeline(timed)), onFrame(12.34));
  // Never past its scene.
  const late = planOf((raw) => ({ ...raw, poster: { scene: "inbox", at: 20 } }));
  assert.equal(posterTime(late, timeline(late)), onFrame(1.1 + 6 - 1 / FPS));
});

test("a length outside 15 to 30 seconds says how much to cut or add", () => {
  assert.equal(lengthProblem(15), null);
  assert.equal(lengthProblem(30), null);
  assert.match(lengthProblem(31.24), /runs 31\.2 s, and the App Store takes 30 s at most: cut 1\.3 s/);
  assert.match(lengthProblem(14.5), /takes 15 s at least: add 0\.5 s/);
});

test("captions, orientations and folders are named as the other steps expect", () => {
  const plan = planOf();
  assert.equal(captionLayerId(plan.scenes[0]), "caption-inbox");
  assert.equal(captionLayerId("share"), "caption-share");
  assert.equal(orientationOf(plan, "iphone"), "portrait");
  assert.equal(orientationOf({ orientation: "portrait" }, "mac"), "landscape");
  const folders = workFolders(plan);
  assert.equal(folders.work, path.join(home.home, "appshots-video"));
  assert.equal(folders.raw, path.join(home.home, "appshots-video", "raw"));
  assert.equal(folders.layers, path.join(home.home, "appshots-video", "layers"));
  assert.equal(folders.out, path.join(home.home, "appshots-video", "out"));
});

test("a plan's languages are the project's, or written the way the project writes them", () => {
  const project = { id: "p_example", locales: ["en", "de-DE", "pt-BR"] };
  assert.deepEqual(resolvePlan({}, project).locales, ["en", "de-DE", "pt-BR"]);
  assert.deepEqual(resolvePlan({ locales: ["EN", "pt-br"] }, project).locales, ["en", "pt-BR"]);
  assert.throws(() => resolvePlan({ locales: ["de"] }, project), /locales\[0\]: project p_example has no language de; it has de-DE, so write that/);
  assert.throws(() => resolvePlan({ locales: ["fr"] }, project), /Its languages are en, de-DE, pt-BR; add fr to it first/);
});

test("--lang, --display and --scene pick from the plan in its own order", () => {
  const plan = { ...planOf(), locales: ["en", "de"] };
  assert.deepEqual(selectedLocales(plan, {}), ["en", "de"]);
  assert.deepEqual(selectedLocales(plan, { lang: "DE,en" }), ["en", "de"]);
  assert.throws(() => selectedLocales(plan, { lang: "fr" }), /--lang fr: the plan's languages are en, de/);
  assert.throws(() => selectedLocales(plan, { lang: true }), /--lang needs a value/);
  assert.deepEqual(selectedDisplays(plan, { display: "ipad" }), ["ipad"]);
  assert.throws(() => selectedDisplays(plan, { display: "mac" }), /--display mac: the plan's displays are iphone, ipad/);
  assert.deepEqual(
    selectedScenes(plan, { scene: "share,inbox" }).map((scene) => scene.id),
    ["inbox", "share"],
  );
  assert.throws(() => selectedScenes(plan, { scene: "nowhere" }), /--scene nowhere: the plan's scenes are inbox, search, share/);
});
