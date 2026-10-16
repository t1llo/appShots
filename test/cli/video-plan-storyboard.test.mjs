import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cliHome } from "./helpers.mjs";

const home = await cliHome("video-storyboard");
after(() => home.remove());
const { validatePlan } = await import("../../cli/src/video/plan.mjs");
const { buildStoryboard, storyboardText } = await import("../../cli/src/video/storyboard.mjs");

const FIXTURES = path.join(import.meta.dirname, "fixtures", "video");
const example = () => JSON.parse(readFileSync(path.join(FIXTURES, "plan.json"), "utf8"));
const sidecar = JSON.parse(readFileSync(path.join(FIXTURES, "sidecar.json"), "utf8"));

/** A plan as the command gives it, its languages settled, from the example with changes. */
function planOf(change = (plan) => plan) {
  const { plan, problems } = validatePlan(change(example()));
  assert.deepEqual(problems, []);
  return { ...plan, locales: plan.locales ?? ["en", "de"], file: path.join(home.home, "appshots.video.json"), root: home.home };
}

/** A project with four slides, as GET /api/projects/:id has it. Fictional copy only. */
const project = {
  id: "p_example",
  name: "Notes",
  locales: ["en", "de"],
  slides: [
    { headline: { en: "Notes that keep up", de: "Notizen, die mithalten" }, screenshot: "home" },
    { headline: { en: "Everything in *one* place", de: "Alles an einem Ort" }, screenshot: "inbox" },
    { headline: { en: "Find any note in a second" }, screenshot: "search" },
    { headline: "Your notes, everywhere", subheadline: { en: "On every device", de: "Auf jedem Gerät" } },
  ],
};

test("captions come from the slides in the primary language, with the languages that have none", () => {
  const board = buildStoryboard(planOf(), { project });
  const [inbox, search, share] = board.scenes;
  assert.deepEqual(inbox.caption, { text: "Everything in *one* place", from: "slide 2 headline", missing: [] });
  assert.deepEqual(search.caption, { text: "Find any note in a second", from: "slide 3 headline", missing: ["de"] });
  // One text in the plan is the primary language's, and the others show it.
  assert.deepEqual(share.caption, { text: "Share in one tap", from: "plan", missing: ["de"] });
  assert.deepEqual(board.intro.headline, { text: "Notes that keep up", from: "slide 1 headline", missing: [] });
  assert.deepEqual(board.outro.lines, [{ text: "On every device", from: "slide 4 sub", missing: [] }]);
  assert.ok(board.warnings.includes("search: the caption has no text in de, which shows the en one."));
  assert.ok(board.warnings.includes("share: the caption has no text in de, which shows the en one."));
  assert.equal(inbox.drive, "UI test testInbox");
  assert.equal(search.drive, "plays 6 s");
  assert.equal(share.drive, "by hand");
});

test("without the project, captions from slides say where they come from", () => {
  const board = buildStoryboard(planOf());
  assert.deepEqual(board.scenes[0].caption, { text: null, from: "slide 2 headline", missing: [] });
  assert.match(storyboardText(board), /inbox +\(slide 2 headline\) +· UI test testInbox/);
});

test("a slide that is not there, or has no such text, is a warning", () => {
  const board = buildStoryboard(
    planOf((raw) => {
      raw.scenes[0].caption = { slide: 9 };
      raw.scenes[1].caption = { slide: 3, field: "eyebrow" };
      return raw;
    }),
    { project },
  );
  assert.ok(board.warnings.includes("scenes[0].caption (inbox): project p_example has slides 1 to 4, so slide 9 has no text for it."));
  assert.ok(board.warnings.includes("scenes[1].caption (search): slide 3 has no eyebrow."));
});

test("prices, free and years in a caption are pointed out", () => {
  const board = buildStoryboard(
    planOf((raw) => {
      raw.scenes[2].caption = { en: "Free for a week", de: "Eine Woche gratis" };
      raw.scenes[1].caption = "Only $4.99 in 2026";
      return raw;
    }),
    { project },
  );
  const flagged = board.warnings.filter((warning) => warning.includes("Captions carry no prices"));
  assert.equal(flagged.length, 3);
  assert.ok(flagged.some((warning) => warning.includes('"Free for a week" has "Free"')));
  assert.ok(flagged.some((warning) => warning.includes('"Eine Woche gratis" has "gratis"')));
});

test("the timeline and the recording time follow the recordings there are", () => {
  const plan = planOf();
  const fresh = buildStoryboard(plan, { project });
  assert.equal(fresh.displays.length, 2);
  assert.equal(fresh.displays[0].total, 21.9);
  assert.equal(fresh.displays[0].recorded, 0);
  // 3 scenes in 2 languages on 2 displays, each at least 15 s with launching and settling.
  assert.deepEqual(fresh.recording, { needed: 12, seconds: (15 + 15 + 15.5) * 4 });

  const recorded = buildStoryboard(plan, { project, recording: (display, locale, scene) => (scene.id === "inbox" ? sidecar : null) });
  assert.equal(recorded.displays[0].recorded, 1);
  assert.equal(recorded.displays[0].total, 22.5);
  assert.equal(recorded.recording.needed, 8);
  assert.match(storyboardText(recorded), /Length: iphone 22\.5 s \(estimated, 1 of 3 scenes recorded\), ipad 22\.5 s \(estimated, 1 of 3 scenes recorded\)/);

  const primary = buildStoryboard(planOf((raw) => ({ ...raw, footage: "primary" })), { project });
  assert.equal(primary.recording.needed, 6);
  assert.ok(primary.warnings.includes("The app is recorded in en only, and the other languages show it with their own captions."));
});

test("what Apple or the viewer would object to is warned about", () => {
  const board = buildStoryboard(
    planOf((raw) => ({
      ...raw,
      intro: { seconds: 3, headline: { slide: 1 } },
      outro: { seconds: 3 },
      music: { file: "missing.m4a" },
      scenes: [{ id: "only", record: { seconds: 1.5 } }, ...raw.scenes],
    })),
    { project },
  );
  for (const expected of [
    "The intro and outro run 6.0 s together. Previews autoplay and are judged by their first seconds: keep the cards under 4 s.",
    "The app shows only after 2.6 s. Show it within the first 2 s.",
    "only runs 1.5 s, too short to follow.",
    'only has no drive. Say how the app gets through each moment before recording: "manual", {"wait": <seconds>}, {"uitest": …}, {"command": […]} or {"web": […]}.',
    "music.file: missing.m4a is not there.",
  ]) {
    assert.ok(board.warnings.includes(expected), `${expected}\nnot among:\n${board.warnings.join("\n")}`);
  }
  const long = buildStoryboard(planOf((raw) => ({ ...raw, scenes: raw.scenes.map((scene) => ({ ...scene, trim: [0, 10] })) })), { project });
  // An estimate keeps half a second from the limits.
  assert.ok(long.warnings.includes("iphone: the preview runs 31.9 s, and the App Store takes 30 s at most: cut 2.4 s or more."));
  const web = buildStoryboard(planOf((raw) => ({ ...raw, app: { platform: "web" }, displays: ["iphone"], poster: { time: 3 }, scenes: [{ id: "home", drive: { wait: 20 } }] })), { project });
  assert.ok(web.warnings.includes("app.url is not set, so 'appshots video record' needs --web <address>."));
});

test("the storyboard prints a row per segment with its start, length and caption", () => {
  const text = storyboardText(buildStoryboard(planOf(), { project }));
  const lines = text.split("\n");
  assert.equal(lines[0], "Storyboard of appshots.video.json: project p_example, an iPhone or iPad app.");
  assert.equal(lines[1], "Languages: en (primary), de. Displays: iphone, ipad.");
  assert.ok(lines.includes("  Starts  Seconds  Segment  Caption (en)"));
  assert.ok(lines.includes("     0.0      1.5  intro    Notes that keep up  + logo"));
  assert.ok(lines.includes("     1.1      6.0  inbox    Everything in one place  · UI test testInbox"));
  assert.ok(lines.includes("    19.9      2.0  outro    On every device  [subscription]  + logo"));
  assert.ok(lines.includes("Transitions: fade, 0.4 s. Poster frame at 3.0 s."));
  assert.ok(lines.includes("Recording: 12 recordings to make, about 3 minutes."));
  assert.ok(lines.includes("Warnings:"));
});
