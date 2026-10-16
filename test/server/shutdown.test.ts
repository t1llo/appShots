import assert from "node:assert/strict";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Cancelled } from "../../src/render/output.ts";
import { drain } from "../../src/services/lifecycle.ts";
import { createProject, UnavailableError } from "../../src/store.ts";
import { videoService } from "../../src/video/service.ts";
import { tmpData } from "../helpers/tmp-data.ts";
import { fakeCapturer } from "./video-fakes.ts";

// What the server does with the layers of app previews when it is told to stop. They wait in the queue the renders
// wait in, so the shutdown that lets renders finish has to let them finish too, or cancel them. It closes the queue
// for this whole process, hence a file of its own.

const data = await tmpData("shutdown");
after(() => data.remove());

test("a stop lets a video layer run finish for a while, then cancels it, and starts no more", async () => {
  const fake = fakeCapturer();
  // A page stops being drawn when its run is cancelled, as the browser's does, and not before.
  fake.before = (capture) => new Promise((resolve) => capture.signal.addEventListener("abort", () => resolve(), { once: true }));
  videoService.useCapturer(fake);
  const { id } = await createProject(data.space, { name: "Stopped", locales: ["en"], slides: [{ layout: "statement", headline: { en: "Hello" } }] });
  const started = await videoService.start(data.space, id, { display: "iphone", captions: [{ id: "a", text: "A" }] });
  assert.ok("job" in started);
  while (fake.calls.length === 0) await sleep(5);

  const stopping = Date.now();
  assert.equal(await drain(200), false, "it did not finish in time");
  assert.ok(Date.now() - stopping >= 200, "it was given the time");
  assert.equal(started.job.state, "cancelled");
  await assert.rejects(started.finished, Cancelled);
  await assert.rejects(videoService.start(data.space, id, { display: "iphone", captions: [{ id: "b", text: "B" }] }), UnavailableError);
});
