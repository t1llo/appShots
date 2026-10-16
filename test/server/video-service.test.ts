import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { PageError } from "../../src/render/capture.ts";
import { Cancelled } from "../../src/render/output.ts";
import type { Slide } from "../../src/schema.ts";
import { createProject, deleteProject, InputError, NotFoundError, projectDir, saveImage, updateProject } from "../../src/store.ts";
import { projectsDir } from "../../src/storage/paths.ts";
import { createVideoService, type LayersAnswer } from "../../src/video/service.ts";
import { KEPT_SETS, readSet, videoDir } from "../../src/video/store.ts";
import { svgLogo } from "../helpers/images.ts";
import { tmpData } from "../helpers/tmp-data.ts";
import { type FakeCapturer, fakeCapturer, gate } from "./video-fakes.ts";

// The service behind the video layers, with a capturer that needs no browser: what a set costs, what it keeps on
// the disk, and what is left when a run fails, is cancelled or loses its project.

const data = await tmpData("video");
after(() => data.remove());
const { space } = data;

let fake: FakeCapturer;
/** How each run settled its render: true when it used one. */
let settled: boolean[];
let service: ReturnType<typeof createVideoService>;
let count = 0;

beforeEach(() => {
  fake = fakeCapturer();
  settled = [];
  service = createVideoService({ capturer: fake, hold: () => async (used) => void settled.push(used) });
});

const SLIDES: Slide[] = [
  { layout: "statement", headline: { en: "Plan your *week*", de: "Plane deine *Woche*" }, logo: { image: "logo", shape: "app-icon" } },
  { layout: "statement", headline: { en: "Share in one tap" }, subheadline: { en: "With anyone", de: "Mit allen" } },
];

async function project(withLogo = true): Promise<string> {
  const made = await createProject(space, { name: `Video ${++count}`, locales: ["en", "de"], slides: SLIDES, theme: { accentColor: "#F59E0B" } });
  if (withLogo) await saveImage(space, made.id, "logo", svgLogo);
  return made.id;
}

/** Starts a request and waits for its answer, drawn or found. */
async function layers(id: string, body: Parameters<typeof service.start>[2]): Promise<LayersAnswer> {
  const started = await service.start(space, id, body);
  return "done" in started ? started.done : started.finished;
}

const exists = (file: string) => stat(file).then(() => true, () => false);
const staging = path.join(projectsDir(space), ".video-staging");

const BODY = { display: "iphone" as const, captions: [{ id: "plan", text: { slide: 1 } }], intro: { headline: { slide: 1 } }, outro: { lines: [{ slide: 2 }], disclosure: ["subscription" as const] } };

test("a new set uses one render; asking for it again answers from the disk and uses none", async () => {
  const id = await project();
  const first = await layers(id, BODY);
  assert.equal(first.charged, true);
  assert.deepEqual(settled, [true]);
  assert.match(first.set, /^[0-9a-f]{16}$/);
  assert.deepEqual(first.size, [886, 1920]);
  assert.equal(first.display, "iphone");
  assert.deepEqual(first.locales, ["en", "de"]);
  assert.equal(first.zip, `/api/projects/${id}/video-layers/${first.set}/layers.zip`);
  // One page per language; the plate is drawn once, on the first.
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(
    first.layers.filter((layer) => layer.locale === "de").map((layer) => layer.id),
    ["caption-plan", "intro-logo", "intro-text", "outro-logo", "outro-text"],
  );
  const plate = first.layers.find((layer) => layer.kind === "plate")!;
  assert.equal(plate.locale, null);
  assert.equal(plate.file, `/files/${id}/video/${first.set}/plate.png`);
  const caption = first.layers.find((layer) => layer.id === "caption-plan" && layer.locale === "de")!;
  assert.deepEqual([caption.width, caption.height, caption.text, caption.fallback, caption.fit], [886, 1920, "Plane deine Woche", false, 1]);
  assert.deepEqual(caption.box, [10, 20, 866, 100]);
  for (const layer of first.layers) assert.ok(await exists(path.join(videoDir(space, id), first.set, layer.locale ?? "", `${layer.id}.png`)), layer.file);
  assert.equal((await readSet(space, id, first.set))?.set, first.set);
  assert.equal(await exists(staging), false, "nothing is left in staging");

  const again = await layers(id, BODY);
  assert.equal(again.charged, false);
  assert.equal(again.set, first.set);
  assert.deepEqual(again.layers, first.layers);
  assert.deepEqual(settled, [true]);
  assert.equal(fake.calls.length, 2, "nothing was drawn again");
});

test("the set is named by what it draws: a change to the copy or the theme makes a new one", async () => {
  const id = await project();
  const before = await layers(id, BODY);
  await updateProject(space, id, { slides: [{ ...SLIDES[0]!, headline: { en: "Plan your *month*", de: "Plane deinen *Monat*" } }, SLIDES[1]!] });
  const copy = await layers(id, BODY);
  await updateProject(space, id, { theme: { accentColor: "#22C55E" } });
  const theme = await layers(id, BODY);
  assert.equal(new Set([before.set, copy.set, theme.set]).size, 3);
  assert.deepEqual(settled, [true, true, true]);
});

test("copy missing in a language is drawn in the first one and named in the warnings, as is English small print", async () => {
  const id = await project();
  fake.fits = { "caption-share": 0.6 };
  const answer = await layers(id, { display: "iphone", captions: [{ id: "share", text: { slide: 2 } }], outro: { lines: [{ slide: 2, field: "sub" }], disclosure: ["iap"] } });
  const share = answer.layers.find((layer) => layer.id === "caption-share" && layer.locale === "de")!;
  assert.equal(share.text, "Share in one tap");
  assert.equal(share.fallback, true);
  const warnings = answer.warnings.map((warning) => `${warning.locale} ${warning.layer} ${warning.kind}`);
  assert.ok(warnings.includes("de caption-share fallback"), warnings.join("; "));
  assert.ok(warnings.includes("de outro-text fallback"), warnings.join("; "));
  assert.ok(warnings.includes("en caption-share fit"), warnings.join("; "));
  assert.ok(!warnings.some((warning) => warning.startsWith("en") && warning.endsWith("fallback")), warnings.join("; "));
  assert.equal(answer.warnings.find((warning) => warning.kind === "fit")!.detail, "shrunk to 60 %");
});

test("a project without a logo gets its cards without one, and a warning", async () => {
  const id = await project(false);
  await updateProject(space, id, { slides: SLIDES.map(({ logo: _, ...slide }) => slide) });
  const answer = await layers(id, { display: "ipad", locales: ["en"], intro: { headline: "Welcome" } });
  assert.deepEqual(answer.size, [1200, 1600]);
  assert.deepEqual(
    answer.layers.map((layer) => layer.id),
    ["plate", "intro-text"],
  );
  assert.deepEqual(
    answer.warnings.map((warning) => [warning.layer, warning.kind]),
    [["intro-logo", "logo"]],
  );
});

test("a request the project cannot answer is refused before a render is held", async () => {
  const id = await project();
  await assert.rejects(service.start(space, id, { display: "iphone", locales: ["fr"], captions: [{ id: "a", text: "A" }] }), /no language "fr"/);
  await assert.rejects(service.start(space, id, { display: "iphone", captions: [{ id: "a", text: { slide: 9 } }] }), /Caption "a": the project has no slide 9/);
  await assert.rejects(service.start(space, id, { display: "iphone", captions: [{ id: "a", text: { slide: 1, field: "eyebrow" } }] }), /slide 1 has no eyebrow/);
  await assert.rejects(service.start(space, id, { display: "mac", orientation: "portrait", captions: [{ id: "a", text: "A" }] }), /landscape only/);
  await assert.rejects(service.start(space, id, { display: "iphone", plate: false }), /Nothing to draw/);
  await assert.rejects(service.start(space, "nope", { display: "iphone" }), NotFoundError);
  assert.deepEqual(settled, []);
  assert.equal(fake.calls.length, 0);
});

test("a page that cannot be drawn fails the run, costs nothing, keeps nothing and says which language and layer", async () => {
  const id = await project();
  fake.before = (capture) => {
    if (capture.path.includes("locale=de")) throw new PageError(`${capture.where}: the page could not be drawn (fit:caption-plan).`);
  };
  const started = await service.start(space, id, BODY);
  assert.ok("job" in started);
  await assert.rejects(started.finished, /in de: the page could not be drawn \(fit:caption-plan\)/);
  assert.deepEqual(settled, [false]);
  assert.equal(started.job.state, "failed");
  assert.match(started.job.error!, /fit:caption-plan/);
  assert.equal(await readSet(space, id, started.job.set), null);
  assert.deepEqual(await readdir(videoDir(space, id)).catch(() => []), []);
  assert.equal(await exists(staging), false);
});

test("an error of the server's own is not shown to the caller", async () => {
  const id = await project();
  fake.before = () => {
    throw new Error("the browser went away at /internal/path");
  };
  const started = await service.start(space, id, BODY);
  assert.ok("job" in started);
  await assert.rejects(started.finished, /browser went away/);
  assert.equal(started.job.error, "The video layers stopped with an error on the server.");
  assert.deepEqual(settled, [false]);
});

test("a cancelled run stops before its next page, costs nothing and keeps nothing", async () => {
  const id = await project();
  const hold = gate();
  fake.before = () => hold.opened;
  const started = await service.start(space, id, BODY);
  assert.ok("job" in started);
  while (fake.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(service.getJob(space, started.job.id)?.state, "running");
  assert.equal(service.cancel(space, started.job.id)?.id, started.job.id);
  hold.open();
  await assert.rejects(started.finished, Cancelled);
  assert.equal(started.job.state, "cancelled");
  assert.equal(started.job.error, undefined);
  assert.equal(fake.calls.length, 1, "the second language was never drawn");
  assert.deepEqual(settled, [false]);
  assert.equal(await readSet(space, id, started.job.set), null);
  assert.equal(await exists(staging), false);
  // Another account cannot see or cancel it.
  assert.equal(service.getJob({ id: "someone-else", root: data.dir }, started.job.id), undefined);
  assert.equal(service.cancel({ id: "someone-else", root: data.dir }, started.job.id), undefined);
});

test("a project deleted while its layers are drawn keeps nothing of them", async () => {
  const id = await project();
  fake.before = async (capture) => {
    if (capture.path.includes("locale=de")) await deleteProject(space, id);
  };
  const started = await service.start(space, id, BODY);
  assert.ok("job" in started);
  await assert.rejects(started.finished, /deleted while its video layers were drawn/);
  assert.deepEqual(settled, [false]);
  assert.equal(await exists(projectDir(space, id)), false);
  assert.equal(await exists(staging), false);
});

test("the same layers asked for twice at once are drawn once and charged once", async () => {
  const id = await project();
  const hold = gate();
  fake.before = () => hold.opened;
  const first = await service.start(space, id, BODY);
  const second = await service.start(space, id, BODY);
  assert.ok("job" in first && "job" in second);
  assert.equal(second.job.id, first.job.id);
  assert.equal(second.started, false);
  hold.open();
  const [one, two] = await Promise.all([first.finished, second.finished]);
  assert.equal(one.charged, true);
  assert.equal(two.charged, false);
  assert.deepEqual(settled, [true]);
});

test("an account has one run going and one waiting at most", async () => {
  const id = await project();
  const hold = gate();
  fake.before = () => hold.opened;
  const runs = [await service.start(space, id, { ...BODY, captions: [{ id: "a", text: "A" }] }), await service.start(space, id, { ...BODY, captions: [{ id: "b", text: "B" }] })];
  await assert.rejects(service.start(space, id, { ...BODY, captions: [{ id: "c", text: "C" }] }), InputError);
  hold.open();
  for (const run of runs) if ("finished" in run) await run.finished;
  assert.deepEqual(settled, [true, true]);
});

test(`the newest ${KEPT_SETS} sets are kept, counting a set asked for again as new`, async () => {
  const id = await project();
  const sets: string[] = [];
  for (const word of ["one", "two", "three", "four"]) sets.push((await layers(id, { display: "iphone", locales: ["en"], plate: false, captions: [{ id: "a", text: word }] })).set);
  assert.equal(await readSet(space, id, sets[0]!), null);
  assert.deepEqual((await readdir(videoDir(space, id))).sort(), sets.slice(1).sort());

  // "two" is asked for again, so "three" is now the oldest.
  assert.equal((await layers(id, { display: "iphone", locales: ["en"], plate: false, captions: [{ id: "a", text: "two" }] })).charged, false);
  sets.push((await layers(id, { display: "iphone", locales: ["en"], plate: false, captions: [{ id: "a", text: "five" }] })).set);
  assert.deepEqual((await readdir(videoDir(space, id))).sort(), [sets[1]!, sets[3]!, sets[4]!].sort());
});
