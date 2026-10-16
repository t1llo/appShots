import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Failure } from "../../cli/src/fail.mjs";
import { commandLine, runFfmpeg, stallLimit } from "../../cli/src/video/encode.mjs";
import { pause } from "../../cli/src/util.mjs";

/** @type {string} */
let dir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "appshots-video-encode-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A stand-in for ffmpeg: a Node script that gets ffmpeg's arguments, writes its pid and its arguments next to
 * itself, and then does what `body` says. The output file is its last argument.
 * @param {string} name
 * @param {string} body
 */
async function fakeFfmpeg(name, body) {
  const file = path.join(dir, name);
  const script = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const out = args.at(-1);
fs.writeFileSync(${JSON.stringify(`${file}.pid`)}, String(process.pid));
fs.writeFileSync(${JSON.stringify(`${file}.args`)}, JSON.stringify(args));
const progress = (us) => process.stdout.write("frame=1\\nout_time_us=" + us + "\\nprogress=continue\\n");
${body}
`;
  await writeFile(file, script);
  await chmod(file, 0o755);
  return file;
}

/** Whether a process is still there. */
function alive(/** @type {number} */ pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("ffmpeg runs quietly, its progress is read, and the seconds it wrote come back", async () => {
  const ffmpeg = await fakeFfmpeg("good", `fs.writeFileSync(out, "video"); progress(500000); progress(1000000); process.stdout.write("out_time_us=2000000\\nprogress=end\\n");`);
  /** @type {number[]} */
  const seen = [];
  const out = path.join(dir, "good.mp4");
  const result = await runFfmpeg({ ffmpeg }, ["-i", "in.mov", "-f", "mp4", out], { label: "stage 1, scene \"a\"", out, onProgress: (seconds) => seen.push(seconds) });
  assert.deepEqual(result, { seconds: 2 });
  assert.deepEqual(seen, [0.5, 1, 2]);
  const args = JSON.parse(await readFile(`${ffmpeg}.args`, "utf8"));
  assert.deepEqual(args.slice(0, 6), ["-nostdin", "-hide_banner", "-nostats", "-y", "-progress", "pipe:1"]);
  assert.ok(existsSync(out));
});

test("an ffmpeg whose output stops moving is stopped, its file removed, and the error says what to try", async () => {
  // It writes a little, then hangs and does not hear SIGTERM, as a stalled graph does.
  const ffmpeg = await fakeFfmpeg(
    "stalls",
    `process.on("SIGTERM", () => {}); fs.writeFileSync(out, "half"); console.error("Input #0, mov"); console.error("Stream mapping: [0:v] -> [v]"); progress(100000); progress(200000); setInterval(() => progress(200000), 20);`,
  );
  const out = path.join(dir, "stalls.mp4");
  const started = Date.now();
  await assert.rejects(
    runFfmpeg({ ffmpeg }, ["-i", "in.mov", "-filter_complex", "[0:v]fps=30[v]", "-f", "mp4", out], { label: 'stage 1, scene "inbox" (iphone, de)', out, stall: 2500 }),
    (/** @type {Error} */ error) => {
      assert.ok(error instanceof Failure);
      assert.match(error.message, /stopped making progress on stage 1, scene "inbox" \(iphone, de\) for 2\.5 s/);
      assert.match(error.message, /--jobs 1/);
      assert.match(error.message, /'\[0:v\]fps=30\[v\]'/);
      assert.match(error.message, /Stream mapping/);
      return true;
    },
  );
  // SIGTERM is not enough for it; SIGKILL follows two seconds later.
  assert.ok(Date.now() - started < 9000);
  assert.ok(!existsSync(out), "the half-written file is gone");
  const pid = Number(await readFile(`${ffmpeg}.pid`, "utf8"));
  for (let wait = 0; wait < 40 && alive(pid); wait++) await pause(100);
  assert.ok(!alive(pid), "the stalled ffmpeg is gone");
});

test("a slow ffmpeg that keeps making progress is left to finish", async () => {
  // The watchdog reads a clock that moves 10 ms with each step ffmpeg makes and stands still in between, so a busy
  // machine that is slow to start the stand-in, or to run it, cannot make it look stalled. By the wall clock, the
  // 20 ms limit would stop a stand-in that steps every 40 ms.
  let clock = 0;
  const ffmpeg = await fakeFfmpeg("slow", `let us = 0; progress(us); const tick = setInterval(() => { us += 40000; progress(us); if (us >= 1000000) { clearInterval(tick); fs.writeFileSync(out, "video"); process.stdout.write("progress=end\\n"); } }, 40);`);
  const out = path.join(dir, "slow.mp4");
  const result = await runFfmpeg({ ffmpeg }, ["-f", "mp4", out], { label: "stage 2", out, stall: 20, now: () => clock, onProgress: () => (clock += 10) });
  // By that clock it ran thirteen times the limit, and was never still for long.
  assert.equal(clock, 260);
  assert.equal(result.seconds, 1);
  assert.ok(existsSync(out));
});

test("a failing ffmpeg's error carries its last 20 lines and the command, and leaves no file", async () => {
  const ffmpeg = await fakeFfmpeg("fails", `fs.writeFileSync(out, "half"); for (let line = 1; line <= 30; line++) console.error("line " + line); process.exitCode = 1;`);
  const out = path.join(dir, "fails.mp4");
  await assert.rejects(runFfmpeg({ ffmpeg }, ["-i", "my file.mov", "-f", "mp4", out], { label: "stage 2, the preview (iphone, en)", out }), (/** @type {Error} */ error) => {
    assert.ok(error instanceof Failure);
    assert.match(error.message, /ffmpeg failed on stage 2, the preview \(iphone, en\) \(exit status 1\)/);
    assert.match(error.message, /line 11\nline 12/);
    assert.match(error.message, /line 30/);
    assert.doesNotMatch(error.message, /line 10\n/);
    assert.match(error.message, /'my file\.mov'/);
    return true;
  });
  assert.ok(!existsSync(out));
});

test("an ffmpeg that is not there is said plainly", async () => {
  await assert.rejects(runFfmpeg({ ffmpeg: path.join(dir, "no-such-ffmpeg") }, ["-f", "mp4", path.join(dir, "x.mp4")], { label: "stage 1" }), /ffmpeg is not at .*no-such-ffmpeg\. Run 'appshots check'/);
});

test("the stall limit is 30 seconds, or what APPSHOTS_FFMPEG_STALL says", () => {
  assert.equal(stallLimit({}), 30000);
  assert.equal(stallLimit({ APPSHOTS_FFMPEG_STALL: "5" }), 5000);
  assert.equal(stallLimit({ APPSHOTS_FFMPEG_STALL: "0.25" }), 250);
  assert.equal(stallLimit({ APPSHOTS_FFMPEG_STALL: "soon" }), 30000);
});

test("a command line reads as it would be typed", () => {
  assert.equal(commandLine("ffmpeg", ["-i", "a b.mov", "-vf", "[0:v]fps=30", "it's.mp4"]), "ffmpeg -i 'a b.mov' -vf '[0:v]fps=30' 'it'\\''s.mp4'");
});
