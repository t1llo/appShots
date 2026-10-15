import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fail } from "../fail.mjs";
import { choose } from "../util.mjs";
import { xcrun } from "../xcode.mjs";

/**
 * The iPhones and iPads plugged into this Mac or paired with it, as devicectl lists them.
 * @param {{ timeout?: number }} [options]
 */
export async function connectedDevices({ timeout = 30000 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "appshots-"));
  const file = path.join(dir, "devices.json");
  try {
    const result = await xcrun(["devicectl", "list", "devices", "--json-output", file], { timeout });
    if (result.status !== 0) fail(`devicectl failed. Physical devices need Xcode 15 or newer.\n${result.stderr.trim()}`);
    return JSON.parse(readFileSync(file, "utf8"))
      .result.devices.filter((device) => device.hardwareProperties?.reality !== "simulated")
      .filter((device) => device.connectionProperties?.tunnelState !== "unavailable")
      .map((device) => ({
        name: device.deviceProperties?.name ?? "Unnamed device",
        udid: device.hardwareProperties?.udid ?? device.identifier,
        model: device.hardwareProperties?.marketingName ?? device.hardwareProperties?.productType ?? "",
        transport: device.connectionProperties?.transportType ?? "",
      }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Saves what a connected iPhone or iPad shows as a PNG. A device named exactly, by its name or udid, is asked
 * straight away, as listing every device first takes seconds; anything else is looked up among them.
 * @param {string | true} query
 * @param {string} file
 */
export async function captureDevice(query, file) {
  const shoot = (id) => xcrun(["devicectl", "device", "capture", "screenshot", "--device", id, "--destination", file]);
  const failed = (name, result) => {
    const output = `${result.stderr}${result.stdout}`.trim();
    const hint = /capture|Unknown|unexpected/i.test(output) && !/locked/i.test(output) ? "\nCapturing from a physical device needs Xcode 27 or newer, and the device unlocked." : "";
    fail(`Could not capture ${name}:\n${output}${hint}`);
  };
  if (typeof query === "string") {
    const result = await shoot(query);
    if (result.status === 0) return console.log(`Captured ${query} -> ${file}`);
    if (!/device was not found|no device|not find/i.test(`${result.stderr}${result.stdout}`)) failed(query, result);
  }
  const device = choose(await connectedDevices(), query, "device", "--device");
  const result = await shoot(device.udid);
  if (result.status !== 0) failed(device.name, result);
  console.log(`Captured ${device.name} -> ${file}`);
}
