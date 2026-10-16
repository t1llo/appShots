import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { displayOfSize, FAMILY_DISPLAYS, PLAN_DISPLAYS } from "../../cli/src/capture-plan/displays.mjs";
import { planJobs, projectLocale, reachLabel, runLocales, runScreens } from "../../cli/src/capture-plan/jobs.mjs";
import { checkPlan, readPlan } from "../../cli/src/capture-plan/read.mjs";
import { Failure } from "../../cli/src/fail.mjs";
import { designTarget, MODELS, TARGETS } from "../../src/domain/devices.ts";

const dir = mkdtempSync(path.join(tmpdir(), "appshots-plan-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = path.join(dir, "appshots.capture.json");

/** @param {unknown} json */
const errorsOf = (json) => checkPlan(json, file).errors;

test("a plan with only screens and an app takes the iPhone, in every language, as the simulator is", () => {
  const { plan, errors } = checkPlan({ app: { bundleId: "com.example.notes" }, screens: [{ id: "home" }, { id: "stats", launch: ["-appshots", "stats"] }] }, file);
  assert.deepEqual(errors, []);
  assert.deepEqual(plan.devices, [{ display: "iphone-6.9", kind: "iphone" }]);
  assert.equal(plan.locales, null);
  assert.equal(plan.appearances, null);
  assert.equal(plan.cleanStatusBar, true);
  assert.equal(plan.out, path.join(dir, "raw-shots"));
  assert.deepEqual(plan.screens[1], { id: "stats", args: ["-appshots", "stats"], wait: null, devices: null });
});

test("every problem is named by where it is in the file, and all of them are said at once", () => {
  const errors = errorsOf({
    project: 3,
    colour: "red",
    app: { bundleId: "notes", scheme: "Notes", extra: 1 },
    devices: ["iphone", "iphone-6.3", "mac", "watch", { display: "ipad", sim: "" }],
    locales: ["en", "EN", "english!"],
    appearances: ["dusk"],
    statusBar: "messy",
    wait: -1,
    screens: [
      { id: "Home" },
      { id: "stats", launch: { args: ["-a", 2], url: "not a link" } },
      { id: "share", uitest: "Only", launch: [] },
      { id: "stats", devices: ["duo"] },
      "settings",
    ],
  });
  for (const expected of [
    /^colour: a plan has no such field/,
    /^project: needs the id of an appShots project/,
    /^app\.extra: app has no such field/,
    /^app\.bundleId: needs the app's bundle id/,
    /^app\.scheme: goes with app\.xcode/,
    /^devices\[1\]: iphone-6\.3 is an iPhone display, like iphone-6\.9 in devices\[0\]/,
    /^devices\[2\]: a plan takes its screens in simulators/,
    /^devices\[3\]: "watch" is no display/,
    /^devices\[4\]\.sim: needs the name or udid of a simulator/,
    /^locales\[1\]: EN is in the list already/,
    /^locales\[2\]: needs a language code/,
    /^appearances: needs "light", "dark" or both/,
    /^statusBar: is "clean"/,
    /^wait: needs a number of seconds/,
    /^screens\[0\]\.id: needs the screenshot's name/,
    /^screens\[1\]\.launch\.args\[1\]: has to be a string/,
    /^screens\[1\]\.launch\.url: needs a link with its scheme/,
    /^screens\[2\]\.uitest: names a UI test as Target\/Class\/method/,
    /^screens\[2\]: takes uitest or launch and app, not both/,
    /^screens\[3\]\.devices\[0\]: "duo" is not one of the plan's devices: iphone-6\.9, ipad-13/,
    /^screens\[4\]: has to be an object/,
  ]) {
    assert.ok(
      errors.some((error) => expected.test(error)),
      `${expected} is not among:\n${errors.join("\n")}`,
    );
  }
});

test("a screen that says nowhere how it is reached is pointed out, and an id is used once", () => {
  assert.deepEqual(errorsOf({ screens: [{ id: "home" }] }), [
    "screens[0]: says nowhere how to reach it. Give the app in app.bundleId or app.xcode, a link in launch.url, or a UI test in uitest.",
  ]);
  // A link, an app of its own, a UI test or an Xcode project to build each say it.
  assert.deepEqual(errorsOf({ screens: [{ id: "a", launch: { url: "https://example.com" } }, { id: "b", app: "com.apple.Preferences" }, { id: "c", uitest: "UITests/Shots/testC" }] }), []);
  assert.deepEqual(errorsOf({ app: { xcode: "." }, screens: [{ id: "home" }] }), []);
  assert.deepEqual(errorsOf({ app: { bundleId: "com.example.notes" }, screens: [{ id: "home" }, { id: "home" }] }), ['screens[1].id: "home" is the id of screens[0] already.']);
});

test("devices are named by family or by display, and a screen can be kept to some of them", () => {
  const { plan, errors } = checkPlan(
    {
      app: { bundleId: "com.example.notes", xcode: "ios/Notes.xcodeproj", args: ["-demo"] },
      devices: [{ display: "iPhone-6.3", sim: "iPhone 17" }, "ipad"],
      appearances: "dark",
      statusBar: "as-is",
      out: "shots",
      screens: [{ id: "board", devices: ["ipad"] }],
    },
    file,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(plan.devices, [
    { display: "iphone-6.3", kind: "iphone", sim: "iPhone 17" },
    { display: "ipad-13", kind: "ipad" },
  ]);
  assert.deepEqual(plan.screens[0].devices, ["ipad-13"]);
  assert.deepEqual(plan.appearances, ["dark"]);
  assert.equal(plan.cleanStatusBar, false);
  assert.equal(plan.out, path.join(dir, "shots"));
  // Paths in a plan start from its own folder, wherever it is run from.
  assert.equal(plan.app.xcode, path.join(dir, "ios", "Notes.xcodeproj"));
  assert.deepEqual(plan.app.args, ["-demo"]);
});

test("readPlan fails with the file's name and every problem in it", () => {
  writeFileSync(file, JSON.stringify({ screens: [{ id: "x" }], wait: "long" }));
  assert.throws(() => readPlan(file), (error) => error instanceof Failure && error.message.startsWith(`${file} is not a capture plan that can be run:\n  wait: needs`) && /\n {2}screens\[0\]: says nowhere/.test(error.message));
  writeFileSync(file, "{ nope");
  assert.throws(() => readPlan(file), (error) => error instanceof Failure && error.message.startsWith(`${file} is not valid JSON:`));
  assert.throws(() => readPlan(path.join(dir, "missing.json")), /No capture plan at .*missing\.json/);
});

test("the plan's displays are the server's export sizes, with the sizes its models take screenshots at", () => {
  for (const [display, { kind, sizes }] of Object.entries(PLAN_DISPLAYS)) {
    const target = TARGETS[/** @type {keyof typeof TARGETS} */ (display)];
    assert.ok(target, `${display} is not a size the server exports`);
    assert.equal(kind, target.device, display);
    // The first size is the one the server exports.
    assert.deepEqual(sizes[0], [target.width, target.height], display);
    const model = MODELS[/** @type {keyof typeof MODELS} */ (display)];
    const upright = [...model.sizes, ...(/** @type {any} */ (model).native ?? [])].filter(([w, h]) => w < h).map(([w, h]) => `${w}x${h}`);
    assert.deepEqual(sizes.map(([w, h]) => `${w}x${h}`).sort(), [...new Set(upright)].sort(), display);
  }
  for (const id of Object.keys(TARGETS)) if (TARGETS[/** @type {keyof typeof TARGETS} */ (id)].device !== "mac") assert.ok(id in PLAN_DISPLAYS, `${id} is missing`);
  for (const [kind, display] of Object.entries(FAMILY_DISPLAYS)) assert.equal(display, designTarget(/** @type {any} */ (kind)));
});

test("a size is the display listed first that has it, upright or turned", () => {
  assert.equal(displayOfSize(1320, 2868), "iphone-6.9");
  assert.equal(displayOfSize(2556, 1179), "iphone-6.3");
  assert.equal(displayOfSize(2048, 2732), "ipad-13");
  assert.equal(displayOfSize(828, 1792), "iphone-6.5");
  assert.equal(displayOfSize(1000, 1000), null);
});

test("languages are the project's own codes, narrowed by --lang", () => {
  const plan = checkPlan({ locales: ["en-US", "de"], app: { bundleId: "com.example.notes" }, screens: [{ id: "a" }] }, file).plan;
  assert.equal(projectLocale(["en", "de-DE"], "de"), "de-DE");
  assert.equal(projectLocale(["en", "de-DE"], "en-GB"), "en");
  assert.equal(projectLocale(["en", "de-DE"], "fr"), null);
  assert.deepEqual(runLocales(plan, "demo", ["en", "de-DE", "fr"], undefined), ["en", "de-DE"]);
  assert.deepEqual(runLocales(plan, "demo", ["en", "de-DE", "fr"], "de"), ["de-DE"]);
  assert.deepEqual(runLocales({ ...plan, locales: null }, "demo", ["en", "fr"], undefined), ["en", "fr"]);
  assert.throws(() => runLocales(plan, "demo", ["en"], undefined), /Project demo has no language "de", which the plan lists\. Its languages are en\./);
  assert.throws(() => runLocales(plan, "demo", ["en", "de"], "fr"), /--lang fr: the plan takes en, de/);
  assert.throws(() => runLocales({ ...plan, locales: ["en-US", "en-GB"] }, "demo", ["en"], undefined), /en-US and en-GB are both en in project demo/);
});

test("--only keeps the screens it names, in the plan's order", () => {
  const plan = checkPlan({ app: { bundleId: "com.example.notes" }, screens: [{ id: "home" }, { id: "stats" }, { id: "share" }] }, file).plan;
  assert.deepEqual(runScreens(plan, "share, home").map((screen) => screen.id), ["home", "share"]);
  assert.throws(() => runScreens(plan, "home,nope"), /--only nope: the plan has no such screen\. Its screens are home, stats, share\./);
  assert.throws(() => runScreens(plan, true), /--only needs the ids of screens/);
});

test("a run goes device by device, then appearance, language and screen, and skips what the project has", () => {
  const plan = checkPlan(
    { app: { bundleId: "com.example.notes", args: ["-demo"] }, devices: ["iphone", "ipad"], appearances: ["light", "dark"], screens: [{ id: "home" }, { id: "board", devices: ["ipad"], launch: { args: ["-tab", "board"], url: "notes://board" } }] },
    file,
  ).plan;
  const shots = [
    { name: "home", device: "iphone" },
    { name: "home-dark", device: "iphone", locale: "de" },
    { name: "home", device: "ipad", locale: "de" },
  ];
  const jobs = planJobs(plan, { screens: plan.screens, locales: ["en", "de"], primary: "en", shots, again: false });
  assert.deepEqual(
    jobs.map((job) => `${job.skip ? "skip" : "take"} ${job.device.display} ${job.appearance} ${job.locale} ${job.name}`),
    [
      "skip iphone-6.9 light en home",
      "take iphone-6.9 light de home",
      "take iphone-6.9 dark en home-dark",
      "skip iphone-6.9 dark de home-dark",
      "take ipad-13 light en home",
      "take ipad-13 light en board",
      "skip ipad-13 light de home",
      "take ipad-13 light de board",
      "take ipad-13 dark en home-dark",
      "take ipad-13 dark en board-dark",
      "take ipad-13 dark de home-dark",
      "take ipad-13 dark de board-dark",
    ],
  );
  assert.equal(jobs[1].file, path.join(dir, "raw-shots", "de", "iphone-6.9", "home.png"));
  assert.equal(reachLabel(plan, jobs[5]), "launch com.example.notes -demo -tab board, then open notes://board");
  assert.ok(planJobs(plan, { screens: plan.screens, locales: ["en", "de"], primary: "en", shots, again: true }).every((job) => !job.skip));
});

test("how a screen is reached reads as what is done", () => {
  const plan = checkPlan(
    {
      app: { xcode: "." },
      screens: [{ id: "a" }, { id: "b", app: "com.apple.mobilesafari", launch: { url: "https://example.com" } }, { id: "c", launch: { url: "https://example.com" } }, { id: "d", uitest: "UITests/Shots/testD" }],
    },
    file,
  ).plan;
  const jobs = planJobs(plan, { screens: plan.screens, locales: ["en"], primary: "en", shots: [], again: false });
  assert.deepEqual(
    jobs.map((job) => reachLabel(plan, job)),
    ["launch <the app the plan builds>", "launch com.apple.mobilesafari, then open https://example.com", "launch <the app the plan builds>, then open https://example.com", "run the UI test UITests/Shots/testD"],
  );
  assert.equal(reachLabel(plan, jobs[0], "com.example.built"), "launch com.example.built");
  const bare = checkPlan({ screens: [{ id: "c", launch: { url: "https://example.com" } }] }, file).plan;
  assert.equal(reachLabel(bare, planJobs(bare, { screens: bare.screens, locales: ["en"], primary: "en", shots: [], again: false })[0]), "open https://example.com in the simulator's own language");
});
