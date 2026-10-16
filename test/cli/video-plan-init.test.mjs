import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

// A server with one project of four slides, stood in for. Fictional copy only.
const home = await cliHome("video-init");
after(() => home.remove());
const project = {
  id: "p_example",
  name: "Notes",
  locales: ["en-US", "de-DE", "fr-FR"],
  slides: [
    { headline: { "en-US": "Notes that keep up" }, screenshot: "home" },
    { headline: { "en-US": "Everything in one place" }, screenshot: "Inbox View" },
    { headline: "", screenshot: "empty" },
    { headline: { "en-US": "Find any note" }, screenshot: "inbox view" },
    { headline: "Share with anyone" },
  ],
};
const shots = [
  { name: "home", device: "iphone" },
  { name: "inbox", device: "duo" },
  { name: "wide", device: "ipad" },
];
let projects = [{ id: "p_example", name: "Notes" }];
const server = await stubServer(({ method, url }) => {
  if (method === "GET" && url === "/api/projects") return [200, projects];
  if (method === "GET" && url === "/api/projects/p_example") return [200, { project, shots }];
  return [404, { error: "not found" }];
});
after(() => server.close());
process.env.APPSHOTS_URL = server.url;
process.env.APPSHOTS_TOKEN = "test-token";

const { GITIGNORE, initPlan, planFromProject } = await import("../../cli/src/video/init.mjs");
const { validatePlan } = await import("../../cli/src/video/plan.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");

let folders = 0;
/** A folder of its own for each plan. */
function folder() {
  const dir = path.join(home.home, `app-${++folders}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("a plan from the slides: the first one on the intro card, the next ones that show a screen as scenes", () => {
  const plan = planFromProject(project, shots);
  assert.deepEqual(plan, {
    version: 1,
    project: "p_example",
    app: { platform: "ios" },
    // A duo shot is an iPhone one.
    displays: ["iphone", "ipad"],
    locales: ["en-US", "de-DE", "fr-FR"],
    intro: { headline: { slide: 1 } },
    outro: { logo: true },
    scenes: [
      { id: "inbox-view", caption: { slide: 2 } },
      { id: "inbox-view-2", caption: { slide: 4 } },
    ],
  });
  assert.deepEqual(validatePlan(plan).problems, []);
});

test("a Mac app's plan is its own, and slides without screens still give scenes", () => {
  const mac = planFromProject({ ...project, slides: [{ headline: "One" }, { headline: "Two" }, { headline: "Three" }] }, [{ name: "main", device: "mac" }]);
  assert.deepEqual(mac.app, { platform: "mac" });
  assert.deepEqual(mac.displays, ["mac"]);
  assert.deepEqual(mac.scenes, [
    { id: "scene-2", caption: { slide: 2 } },
    { id: "scene-3", caption: { slide: 3 } },
  ]);
  // Displays of another kind of app are left out, and an iPhone is taken when none fits.
  assert.deepEqual(planFromProject(project, shots, { displays: ["mac", "ipad"] }).displays, ["ipad"]);
  assert.deepEqual(planFromProject(project, shots, { displays: ["mac"], platform: "ios" }).displays, ["iphone"]);
});

test("a project with one slide, or none with text, still makes a plan that holds up", () => {
  const one = planFromProject({ ...project, slides: [{ headline: "Only", screenshot: "home" }] }, []);
  assert.equal(one.intro, undefined);
  assert.deepEqual(one.scenes, [{ id: "home", caption: { slide: 1 } }]);
  const none = planFromProject({ ...project, slides: [{ headline: "" }, { headline: {} }] }, []);
  assert.deepEqual(none.scenes, [{ id: "app" }]);
  assert.deepEqual(validatePlan(none).problems, []);
  const web = planFromProject(project, [], { platform: "web", url: "http://localhost:8000" });
  assert.deepEqual(web.app, { platform: "web", url: "http://localhost:8000" });
  assert.deepEqual(web.displays, ["iphone"]);
});

test("init writes the plan and the work folder's .gitignore, and writes over a plan only with --again", async () => {
  const file = path.join(folder(), "appshots.video.json");
  const printed = await quietly(() => initPlan("p_example", { plan: file, lang: "EN-us,de-de" }));
  assert.match(printed, /: 2 scenes from the slides of Notes, for iphone, ipad in en-US, de-DE\./);
  const plan = JSON.parse(readFileSync(file, "utf8"));
  // Languages are written as the project writes them.
  assert.deepEqual(plan.locales, ["en-US", "de-DE"]);
  assert.equal(readFileSync(path.join(path.dirname(file), "appshots-video", ".gitignore"), "utf8"), GITIGNORE);

  await assert.rejects(initPlan("p_example", { plan: file }), (error) => error instanceof Failure && /is there already/.test(error.message));
  writeFileSync(path.join(path.dirname(file), "appshots-video", ".gitignore"), "kept\n");
  await quietly(() => initPlan("p_example", { plan: file, again: true, display: "iphone" }));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).displays, ["iphone"]);
  // A .gitignore that is there is left as it is.
  assert.equal(readFileSync(path.join(path.dirname(file), "appshots-video", ".gitignore"), "utf8"), "kept\n");
});

test("init takes the project's languages, and refuses a display or language the project does not have", async () => {
  const file = path.join(folder(), "appshots.video.json");
  await quietly(() => initPlan("p_example", { plan: file }));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).locales, ["en-US", "de-DE", "fr-FR"]);
  const other = path.join(folder(), "appshots.video.json");
  await assert.rejects(initPlan("p_example", { plan: other, display: "watch" }), (error) => error instanceof Failure && /--display watch: previews are made for iphone, .*ipad, .*mac\./.test(error.message));
  await assert.rejects(initPlan("p_example", { plan: other, lang: "ja" }), Failure);
  await assert.rejects(initPlan("p_example", { plan: true }), (error) => error instanceof Failure && /--plan needs a file name/.test(error.message));
  assert.equal(existsSync(other), false);
});

test("a web app is told by the folder the plan is written to", async () => {
  const dir = folder();
  writeFileSync(path.join(dir, "manage.py"), "");
  const file = path.join(dir, "appshots.video.json");
  await quietly(() => initPlan("p_example", { plan: file }));
  const plan = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(plan.app, { platform: "web", url: "http://localhost:8000" });
});

test("without a project named, init takes the only one there is, or lists them", async () => {
  const file = path.join(folder(), "appshots.video.json");
  await quietly(() => initPlan(undefined, { plan: file }));
  assert.equal(JSON.parse(readFileSync(file, "utf8")).project, "p_example");

  const other = path.join(folder(), "appshots.video.json");
  projects = [
    { id: "p_example", name: "Notes" },
    { id: "p_second", name: "Tasks" },
  ];
  await assert.rejects(initPlan(undefined, { plan: other }), (error) => error instanceof Failure && error.message.includes("Name the project: appshots video init <project>. The projects are:\n  p_example  Notes\n  p_second  Tasks"));
  projects = [];
  await assert.rejects(initPlan(undefined, { plan: other }), (error) => error instanceof Failure && /There is no project yet/.test(error.message));
  projects = [{ id: "p_example", name: "Notes" }];
});
