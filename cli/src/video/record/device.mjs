import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fail } from "../../fail.mjs";
import { launchPlan } from "../../plan.mjs";
import { choose } from "../../util.mjs";
import { xcodeEnv, xcrun } from "../../xcode.mjs";
import { footageDisplay } from "./session.mjs";
import { startRecorder } from "./spawn.mjs";

/**
 * Recording from an iPhone or iPad plugged into this Mac, with devicectl's screen recorder. It is experimental:
 * it was tried against a simulator only, and says so until a real device has confirmed it.
 */

/** What to do instead when devicectl cannot record a device. */
export const QUICKTIME =
  "Record the scene with QuickTime Player instead: File, New Movie Recording, pick the iPhone or iPad as the camera, record, save, then give the movie to 'appshots video import <file> --scene <id>'.";

/**
 * The devices devicectl can reach, with what a sidecar says about them: the model and the system, never the
 * device's own identifier.
 * @returns {Promise<Array<{ name: string, udid: string, model: string, os: string, family: string }>>}
 */
async function devices() {
  const dir = mkdtempSync(path.join(tmpdir(), "appshots-"));
  const file = path.join(dir, "devices.json");
  try {
    const result = await xcrun(["devicectl", "list", "devices", "--json-output", file], { timeout: 30000 });
    if (result.status !== 0) fail(`devicectl failed. Recording a device needs Xcode 27 or newer.\n${result.stderr.trim()}`);
    return JSON.parse(readFileSync(file, "utf8"))
      .result.devices.filter((device) => device.hardwareProperties?.reality !== "simulated")
      .filter((device) => device.connectionProperties?.tunnelState !== "unavailable")
      .map((device) => ({
        name: device.deviceProperties?.name ?? "Unnamed device",
        udid: device.hardwareProperties?.udid ?? device.identifier,
        model: device.hardwareProperties?.marketingName ?? device.hardwareProperties?.productType ?? "",
        os: device.deviceProperties?.osVersionNumber ?? "",
        family: /ipad/i.test(device.hardwareProperties?.deviceType ?? "") ? "iPad" : /iphone/i.test(device.hardwareProperties?.deviceType ?? "") ? "iPhone" : "",
      }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Points to pixels on a device, from the width of its recording: an iPad has 2, an iPhone 3 unless its screen is
 * one of the narrow ones that have 2.
 * @param {string} family
 * @param {[number, number]} size
 */
const deviceScale = (family, size) => (family === "iPad" ? 2 : Math.min(...size) <= 828 ? 2 : 3);

/**
 * Records a display's footage on a connected device. The app has to be on the device already: it is launched in
 * each scene's language, and its status bar stays what the device shows, which only a simulator can set.
 * @param {string} display
 * @param {any} plan
 * @param {Record<string, string | true | undefined>} flags
 * @returns {Promise<import("./index.mjs").Source>}
 */
export async function deviceSource(display, plan, flags) {
  const family = footageDisplay(display) === "ipad" ? "iPad" : "iPhone";
  const device = choose(await devices(), flags.device, "device", "--device");
  if (device.family && device.family !== family) fail(`${device.name} is an ${device.family}, and the ${display} footage is recorded on an ${family}. Name an ${family} with --device, or record one display at a time with --display.`);
  const bundleId = plan.app?.bundleId;
  if (!bundleId) fail(`A device records the app as it is installed there, which the plan names by its bundle id: put "bundleId" into the plan's "app".`);
  console.log(`Recording ${display} on ${device.name}. Recording from a device is experimental.`);
  console.log(`  ! ${device.name} shows its own time and battery. Only a simulator's status bar is set to 9:41 and full; leave out --device to record on one.`);
  const env = await xcodeEnv();
  return {
    kind: "device",
    label: device.name,
    model: device.model,
    os: device.os,
    extension: ".mp4",
    padded: false,
    scale: (size) => deviceScale(device.family || family, size),
    around: (work) => work(),
    open: async (scene, locale) => {
      if (scene.launch?.appearance) console.log(`  ! ${device.name} keeps the appearance it has; ${scene.id} asks for ${scene.launch.appearance}, which is set on a simulator only.`);
      const { launchArguments } = launchPlan({ lang: locale }, scene.launch?.args ?? []);
      const url = scene.launch?.url ? ["--payload-url", scene.launch.url] : [];
      const result = await xcrun(["devicectl", "device", "process", "launch", "--device", device.udid, "--terminate-existing", ...url, bundleId, ...launchArguments], { timeout: 60000 });
      if (result.status !== 0) fail(`Could not launch ${bundleId} on ${device.name}. It has to be installed there already, and the device unlocked.\n${`${result.stderr}${result.stdout}`.trim()}`);
    },
    // devicectl says nothing that marks the start, so it is taken to record once it has run a moment.
    record: (file) => startRecorder("devicectl", "xcrun", ["devicectl", "device", "capture", "screen-record", "--device", device.udid, "--destination", file, "--codec", "h264"], { env, quiet: 2000, timeout: 20000 }),
    help: QUICKTIME,
  };
}
