import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUILD_CACHE } from "../config.mjs";
import { fail } from "../fail.mjs";
import { pause, slugify } from "../util.mjs";
import { xcodeEnv, xcodebuild } from "../xcode.mjs";

/** How long one UI test may take to bring its screen up and end, building nothing. */
const TEST_TIMEOUT = 600000;

/**
 * Where the UI tests of a project are built, apart from Xcode's own build folder, so that running them finds what
 * the build made.
 * @param {string} project
 */
function buildFolder(project) {
  const name = `${slugify(path.parse(project).name)}-${createHash("sha256").update(project).digest("hex").slice(0, 8)}-tests`;
  return { derivedData: path.join(BUILD_CACHE, name), log: path.join(BUILD_CACHE, `${name}.log`) };
}

/** @param {string} project */
const container = (project) => [project.endsWith(".xcworkspace") ? "-workspace" : "-project", project];

/**
 * The last lines of a log that say what went wrong, without the ones xcodebuild stamps with the time.
 * @param {string} log
 */
function tail(log) {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {}
  const lines = text.split("\n").filter((line) => line.trim() && !/^\d{4}-\d\d-\d\d /.test(line));
  const errors = lines.filter((line) => /error|failed|Failing/i.test(line));
  return (errors.length > 0 ? errors : lines).slice(-12).join("\n");
}

/**
 * Builds the app and its UI tests once, for any simulator of the same kind as this one.
 * @param {string} project The workspace or project.
 * @param {string} scheme
 * @param {{ udid: string }} simulator
 */
export async function buildForTesting(project, scheme, simulator) {
  const { derivedData, log } = buildFolder(project);
  mkdirSync(BUILD_CACHE, { recursive: true });
  const output = openSync(log, "w");
  let result;
  try {
    result = await xcodebuild([...container(project), "-scheme", scheme, "-destination", `platform=iOS Simulator,id=${simulator.udid}`, "-derivedDataPath", derivedData, "build-for-testing"], { stdio: ["ignore", output, output], timeout: 0 });
  } finally {
    closeSync(output);
  }
  if (result.status !== 0) fail(`The UI tests of ${scheme} did not build:\n${tail(log)}\nFull log: ${log}`);
  console.log(`Built the UI tests of ${scheme}`);
}

/**
 * The language and region xcodebuild runs a test in, from a language code: de, or pt and BR for pt-BR.
 * @param {string} locale
 */
export function testLanguage(locale) {
  const [language, ...rest] = locale.split("-");
  const region = rest.find((part) => /^[A-Za-z]{2}$|^\d{3}$/.test(part));
  const script = rest.find((part) => /^[A-Za-z]{4}$/.test(part));
  return ["-testLanguage", script ? `${language}-${script}` : language, ...(region ? ["-testRegion", region.toUpperCase()] : [])];
}

/**
 * Runs one UI test on a simulator and takes the screenshot while it waits. The test says that its screen is up by
 * writing a file named ready into the folder APPSHOTS_SIGNAL names, then waits until a file named done is there:
 * the few lines of appshotsReady() in docs/cli.md. A simulator's processes see this Mac's files, so the folder is
 * an ordinary one here.
 * @param {{ project: string, scheme: string, test: string, simulator: { name: string, udid: string }, locale: string }} options
 * @param {() => Promise<void>} take Takes the screenshot.
 */
export async function runUITest({ project, scheme, test, simulator, locale }, take) {
  const { derivedData, log } = buildFolder(project);
  const signal = mkdtempSync(path.join(tmpdir(), "appshots-signal-"));
  const ready = path.join(signal, "ready");
  const output = openSync(log, "w");
  // xcodebuild hands what starts with TEST_RUNNER_ to the tests, without that.
  const env = { ...(await xcodeEnv()), TEST_RUNNER_APPSHOTS_SIGNAL: signal, TEST_RUNNER_APPSHOTS_LOCALE: locale };
  let ended = false;
  const running = xcodebuild(
    [...container(project), "-scheme", scheme, "-destination", `platform=iOS Simulator,id=${simulator.udid}`, "-derivedDataPath", derivedData, "test-without-building", `-only-testing:${test}`, ...testLanguage(locale)],
    { env, stdio: ["ignore", output, output], timeout: TEST_TIMEOUT },
  ).finally(() => {
    ended = true;
  });
  // A failure to start or a test that hangs is said once the loop below has seen it end.
  running.catch(() => {});
  let taken = false;
  try {
    while (!ended && !existsSync(ready)) await pause(100);
    if (existsSync(ready)) {
      await take();
      taken = true;
    }
  } finally {
    // Also when the screenshot failed, so that the test does not wait for it any longer.
    writeFileSync(path.join(signal, "done"), "");
    await running.catch(() => {});
    closeSync(output);
    rmSync(signal, { recursive: true, force: true });
  }
  const result = await running;
  if (!taken) fail(`The UI test ${test} ended without saying that its screen was up. Call appshotsReady() in it once the screen shows, as docs/cli.md describes.\n${tail(log)}\nFull log: ${log}`);
  if (result.status !== 0) console.error(`appshots: the UI test ${test} failed after the screenshot was taken. Full log: ${log}`);
}
