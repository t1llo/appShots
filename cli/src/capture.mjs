import { captureDevice } from "./capture/device.mjs";
import { captureMac, macWindow } from "./capture/mac.mjs";
import { captureSim, withCleanStatusBar } from "./capture/sim.mjs";
import { shotTarget } from "./shot.mjs";
import { bootedSimulators } from "./sim.mjs";
import { choose } from "./util.mjs";

/**
 * Takes a screenshot from where --mac, --device or --sim says, a booted simulator when none of them does.
 * @param {Record<string, string | true | undefined>} flags
 * @param {{ statusBar?: boolean }} [options] statusBar: false when a session around it has set the status bar already.
 */
export async function capture(flags, { statusBar = true } = {}) {
  // Before the folder is made: a wrong name should leave nothing behind.
  if (flags.mac) {
    const window = await macWindow(flags.mac);
    const { name, file } = shotTarget(flags);
    await captureMac(window, file);
    return { name, file };
  }
  if (flags.device) {
    const { name, file } = shotTarget(flags);
    await captureDevice(flags.device, file);
    return { name, file };
  }
  const simulator = choose(await bootedSimulators(), flags.sim, "simulator", "--sim");
  const { name, file } = shotTarget(flags);
  if (flags.clean && statusBar) await withCleanStatusBar(simulator, () => captureSim(simulator, file));
  else await captureSim(simulator, file);
  return { name, file };
}
