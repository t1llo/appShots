import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoute, request } from "../api.mjs";
import { loadConfig } from "../config.mjs";
import { fail } from "../fail.mjs";
import { run } from "../proc.mjs";
import { pause, readJson } from "../util.mjs";
import { orientationOf, workFolders } from "./plan.mjs";

/** @typedef {import("./plan.mjs").Plan & { locales: string[] }} Plan */

/**
 * @typedef {object} Layer One picture of a set, as the server lists it.
 * @property {string} id Such as plate, caption-inbox or intro-text.
 * @property {string | null} locale Null for the ones every language shares: the plate, the logo cards, the touch ring.
 * @property {string} kind
 * @property {string} file Its address on the server.
 * @property {number} width
 * @property {number} height
 * @property {[number, number, number, number]} [box] Where its text is: x, y, width, height.
 * @property {string} [text]
 * @property {boolean} [fallback] Its text is another language's.
 * @property {number} [fit] How far the text was shrunk to fit, 1 for not at all.
 * @property {string} [path] Where it is on this Mac, once fetched.
 *
 * @typedef {object} Manifest The layers of one display, drawn in the project's style at the video's size.
 * @property {string} set A hash of everything they were drawn from, so the same request is the same set.
 * @property {boolean} charged Whether drawing it used a render.
 * @property {[number, number]} size
 * @property {Array<{ locale: string | null, layer: string, kind: string, detail: string }>} warnings
 * @property {Layer[]} layers
 * @property {string} zip
 * @property {string} [dir] The folder on this Mac it was unpacked into.
 */

/** How often a set being drawn is asked after. */
const POLL_MS = 1000;
/** Which set each display and language has, so that the compose finds its layers without the server. */
const INDEX = "current.json";

/**
 * The body of POST /api/projects/:id/video-layers for one display: the captions of the scenes, the cards, and
 * whether the plate and the touch ring are wanted. It always runs as a background job.
 * @param {Plan} plan
 * @param {string} display
 * @param {string[]} locales
 */
export function layersRequest(plan, display, locales) {
  return {
    display,
    orientation: orientationOf(plan, display),
    locales,
    captionStyle: plan.captionStyle,
    captions: plan.scenes.filter((scene) => scene.caption !== false).map((scene) => ({ id: scene.id, text: scene.caption, position: scene.captionPosition })),
    ...(plan.intro ? { intro: { ...(plan.intro.headline !== undefined ? { headline: plan.intro.headline } : {}), logo: plan.intro.logo } } : {}),
    ...(plan.outro ? { outro: { lines: plan.outro.lines, logo: plan.outro.logo, disclosure: plan.outro.disclosure } } : {}),
    plate: true,
    touch: plan.scenes.some((scene) => scene.touches),
    background: true,
  };
}

/** A short hash of a request, to tell whether the layers on this Mac were drawn for the plan as it is now. */
const requestHash = (body) => createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);

/**
 * Has the server draw the layers of one display in the given languages, and puts them into
 * appshots-video/layers/<set>/. A set the server has drawn before costs nothing and is answered at once; one that
 * is on this Mac already is not downloaded again.
 * @param {Plan} plan
 * @param {{ display: string, locales?: string[] }} choice
 * @returns {Promise<Manifest>}
 */
export async function fetchLayers(plan, { display, locales = plan.locales }) {
  const config = loadConfig();
  const route = projectRoute(plan.project, "/video-layers");
  const body = layersRequest(plan, display, locales);
  const answer = await request(config, "POST", route, { body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  let manifest = /** @type {any} */ (await answer.json());
  if (answer.status === 202 || (manifest.job && !manifest.layers)) {
    const job = await follow(config, manifest.job, display);
    const set = job.result?.set ?? job.set ?? manifest.set;
    // The finished job answers with the set, or the same request does, now that it is drawn and costs nothing.
    // Either way it was this job that drew it.
    if (job.result?.layers) manifest = job.result;
    else if (set) manifest = await (await request(config, "GET", projectRoute(plan.project, `/video-layers/${encodeURIComponent(set)}`))).json();
    else manifest = await (await request(config, "POST", route, { body: JSON.stringify({ ...body, background: false }), headers: { "content-type": "application/json" } })).json();
    manifest = { ...manifest, charged: true };
  }
  if (typeof manifest.set !== "string" || !/^[0-9a-f]{8,64}$/.test(manifest.set) || !Array.isArray(manifest.layers)) fail(`The server answered the layers of ${display} with something that is not a set of layers. Is it an appShots server, and up to date?`);

  const dir = path.join(workFolders(plan).layers, manifest.set);
  if (!complete(dir, manifest)) await unpack(config, manifest, dir);
  const index = path.join(workFolders(plan).layers, INDEX);
  const current = readJson(index) ?? {};
  current[display] ??= {};
  for (const locale of locales) current[display][locale] = { set: manifest.set, request: requestHash({ ...layersRequest(plan, display, [locale]), locales: undefined }) };
  writeFileSync(index, `${JSON.stringify(current, null, 2)}\n`);
  return located(manifest, dir);
}

/**
 * The layers of one display and language that are on this Mac and were drawn for the plan as it is now, or null.
 * @param {Plan} plan
 * @param {string} display
 * @param {string} locale
 * @returns {Manifest | null}
 */
export function localLayers(plan, display, locale) {
  const layers = workFolders(plan).layers;
  const entry = readJson(path.join(layers, INDEX))?.[display]?.[locale];
  if (!entry || entry.request !== requestHash({ ...layersRequest(plan, display, [locale]), locales: undefined })) return null;
  const dir = path.join(layers, entry.set);
  const manifest = readJson(path.join(dir, "manifest.json"));
  return manifest && complete(dir, manifest) ? located(manifest, dir) : null;
}

/**
 * Where a layer is in a set's folder, as the server zips it: the shared ones at the top, the others in a folder
 * per language.
 * @param {Layer} layer
 */
export const layerFile = (layer) => (layer.locale ? path.join(layer.locale, `${layer.id}.png`) : `${layer.id}.png`);

/** @param {string} dir @param {Manifest} manifest */
const complete = (dir, manifest) => existsSync(path.join(dir, "manifest.json")) && manifest.layers.every((layer) => existsSync(path.join(dir, layerFile(layer))));

/**
 * The manifest with where the set and each of its layers are on this Mac.
 * @param {Manifest} manifest
 * @param {string} dir
 * @returns {Manifest}
 */
const located = (manifest, dir) => ({ ...manifest, dir, layers: manifest.layers.map((layer) => ({ ...layer, path: path.join(dir, layerFile(layer)) })) });

/**
 * Asks after a set being drawn until it is done, and says how far it has come. Ctrl+C cancels it on the server, so
 * that it uses no render.
 * @param {import("../config.mjs").Config} config
 * @param {{ id: string }} job
 * @param {string} display
 */
async function follow(config, job, display) {
  if (!job?.id) fail(`The server started drawing the layers of ${display} without saying where to follow it.`);
  const route = `/api/renders/${encodeURIComponent(job.id)}`;
  const cancel = () => {
    process.stdout.write("\n");
    request(config, "DELETE", route).finally(() => process.exit(130));
  };
  process.once("SIGINT", cancel);
  try {
    let said = "";
    for (;;) {
      const state = await (await request(config, "GET", route)).json();
      if (state.state === "done") return state;
      if (state.state === "failed") fail(`The server could not draw the layers of ${display}: ${state.error ?? "it did not say why"}.`);
      if (state.state === "cancelled") fail(`Drawing the layers of ${display} was cancelled.`);
      const now = state.total > 0 ? `${display}: drawing, ${state.done} of ${state.total}` : `${display}: waiting for the server`;
      if (now !== said) console.log((said = now));
      await pause(POLL_MS);
    }
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}

/**
 * Downloads a set as the server zips it and puts it into its folder in one step, so that a download cut short
 * leaves no set that looks whole.
 * @param {import("../config.mjs").Config} config
 * @param {Manifest} manifest
 * @param {string} dir
 */
async function unpack(config, manifest, dir) {
  const parent = path.dirname(dir);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(path.join(parent, `.${manifest.set}-`));
  try {
    const zip = path.join(staging, "layers.zip");
    writeFileSync(zip, Buffer.from(await (await request(config, "GET", manifest.zip)).arrayBuffer()));
    const files = path.join(staging, "files");
    const result = await run("unzip", ["-o", "-q", zip, "-d", files]);
    if (result.status !== 0) fail(`Could not unpack the layers: ${(result.stderr || result.error?.message || "").trim()}`);
    if (!existsSync(path.join(files, "manifest.json"))) writeFileSync(path.join(files, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const missing = manifest.layers.filter((layer) => !existsSync(path.join(files, layerFile(layer))));
    if (missing.length > 0) fail(`The layers of set ${manifest.set} came without ${missing.slice(0, 3).map(layerFile).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`);
    rmSync(dir, { recursive: true, force: true });
    renameSync(files, dir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * `appshots video layers`: the layer set of each display, in the plan's languages or those --lang picks.
 * @param {Plan} plan
 * @param {{ displays: string[], locales: string[] }} choice
 */
export async function layersCommand(plan, { displays, locales }) {
  for (const display of displays) {
    console.log(`${display}: asking the server for the layers in ${locales.join(", ")}`);
    const manifest = await fetchLayers(plan, { display, locales });
    const count = manifest.layers.length;
    console.log(`${display}: set ${manifest.set}, ${count} layer${count === 1 ? "" : "s"} in ${path.relative(process.cwd(), manifest.dir ?? "") || manifest.dir}. ${manifest.charged ? "Drawing it used one render." : "Drawn before, so no render was used."}`);
    for (const warning of manifest.warnings ?? []) console.log(`  ${warning.locale ? `${warning.locale} ` : ""}${warning.layer}: ${warning.detail}${warning.kind === "fit" ? " to fit" : ""}`);
  }
}

/**
 * The manifest of a set on this Mac, by its folder.
 * @param {string} dir
 * @returns {Manifest | null}
 */
export function readManifest(dir) {
  try {
    return located(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")), dir);
  } catch {
    return null;
  }
}
