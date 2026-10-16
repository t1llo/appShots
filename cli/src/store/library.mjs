// App previews go into App Store Connect through the app's asset library: a video is uploaded into the library
// once, and a placement puts it onto the store page of one language of a version, in one group of displays. This
// is a small client for the part of that API appShots uses, on the requests of asc.mjs and with the same key. It
// never submits anything for review, never releases anything and never deletes an asset: every write it makes
// passes guardWrite, and the only thing it removes is a placement of a video appShots uploaded itself.
//
// The routes, bodies and states below follow Apple's documentation of the App Asset Library (API 4.5.1, read in
// October 2026): the upload commits with `uploaded` alone, without a checksum; a video is processed through
// UPLOAD_COMPLETE to PREPARE_FOR_SUBMISSION or FAILED; a placement cannot be changed, only removed and made
// again; an App Store version takes 3 previews per placement group. What the documentation does not say, the
// code assumes as follows, until a first run against App Store Connect shows otherwise:
//
// | Assumption                                                                     | Where                    |
// | ------------------------------------------------------------------------------ | ------------------------ |
// | One placement in the group of the largest display of a size is enough: Apple   | PREVIEW_CLASSES,         |
// | shows it on the smaller iPhones and iPads of that size, as it scaled previews  | previewGroup             |
// | before. The other groups that take the same size are left alone.               |                          |
// | A video can be placed in every state but AWAITING_UPLOAD, UPLOAD_COMPLETE,     | PROCESSING, BROKEN       |
// | FAILED, REJECTED and ARCHIVED; the documentation names PREPARE_FOR_SUBMISSION. |                          |
// | A version's page takes placements in every state of STORE_OPEN.                | push.mjs, openVersion    |
// | The poster frame of a video can be moved until it goes into review; after that | POSTER_MOVABLE           |
// | it is left as it is, as it may be on the App Store.                            |                          |
// | The placements of a page come with their videos under `included` for           | previewPlacements        |
// | include=video, in the order of sort=placementGroupPosition.                    |                          |
// | An ordering request names every placement of the group, ours and the user's.   | orderPlacements          |
// | The library's list of videos takes filter[referenceName] and limit=200, and    | videosNamed              |
// | is matched exactly here in any case.                                           |                          |
// | The reference data comes as one item; several are merged.                      | referenceData            |
// | A key with the role Marketing may use the library. Apple names Admin and App   | (a 403 says what to do)  |
// | Manager for the API, and Marketing for the website.                            |                          |

import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { fail } from "../fail.mjs";
import { apple, appleList, sendParts } from "./asc.mjs";

/** How many parts of a video go to Apple at once. */
const SENDS = 3;

const PREVIEW = "APP_PREVIEW";

/** What the reference name of every video appShots uploads starts with. Nothing else is ever removed. */
export const REFERENCE_PREFIX = "appshots ";

/** States of a video that is still on its way: uploaded, and being processed. */
export const PROCESSING = new Set(["AWAITING_UPLOAD", "UPLOAD_COMPLETE"]);

/** States of a video that will not become placeable. */
export const BROKEN = new Set(["FAILED", "REJECTED", "ARCHIVED"]);

/** States of a video whose poster frame appShots moves. Later ones are in review or on the App Store. */
export const POSTER_MOVABLE = new Set([...PROCESSING, "COMPLETE", "PREPARE_FOR_SUBMISSION"]);

/** @param {string | undefined} state */
export const isReady = (state) => Boolean(state) && !PROCESSING.has(/** @type {string} */ (state)) && !BROKEN.has(/** @type {string} */ (state));

/**
 * The display class whose group a preview of each display goes into. Several groups take the same size (every
 * iPhone with Face ID takes 886x1920); the preview goes into the largest display's.
 */
export const PREVIEW_CLASSES = {
  iphone: "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY",
  "iphone-5.5": "IPHONE_HOME_BUTTON_LARGE_DISPLAY",
  "iphone-4.7": "IPHONE_HOME_BUTTON_MEDIUM_DISPLAY",
  ipad: "IPAD_13_DISPLAY",
  "ipad-9.7": "IPAD_97_DISPLAY",
};

/**
 * The platform of the library whose groups a display's previews go into.
 * @param {string} display
 */
export const placementPlatform = (display) => (display === "mac" ? "MAC_APP_STORE" : display.startsWith("ipad") ? "IPAD_APP_STORE" : "IPHONE_APP_STORE");

/**
 * The writes this client makes, and for a change of a video the attributes it may change. Anything else is
 * refused before it is sent: a submission, a release, an archived or deleted asset, a change to a version.
 * @type {Array<{ method: string, route: RegExp, attributes?: string[] }>}
 */
const WRITES = [
  { method: "POST", route: /^\/v1\/appAssetLibraryVideos$/ },
  { method: "PATCH", route: /^\/v1\/appAssetLibraryVideos\/[\w.-]+$/, attributes: ["uploaded", "previewFrameTimeCode"] },
  { method: "POST", route: /^\/v1\/appAssetLibraryPlacements$/ },
  { method: "DELETE", route: /^\/v1\/appAssetLibraryPlacements\/[\w.-]+$/ },
  { method: "POST", route: /^\/v1\/appAssetLibraryPlacementOrderingRequests$/ },
];

/**
 * Stops any write this client does not make. Asking is always allowed.
 * @param {string} method
 * @param {string} route
 * @param {any} [body]
 */
export function guardWrite(method, route, body) {
  if (method === "GET") return;
  const write = WRITES.find((entry) => entry.method === method && entry.route.test(route.split("?")[0]));
  const changed = Object.keys(body?.data?.attributes ?? {});
  if (write && (!write.attributes || changed.every((name) => write.attributes?.includes(name)))) return;
  fail(`appShots does not send ${method} ${route.split("?")[0]}${changed.length > 0 ? ` with ${changed.join(", ")}` : ""} to App Store Connect. It never submits, releases, archives or deletes anything there; it only adds previews and takes out its own.`);
}

/**
 * @param {import("./asc.mjs").Account} account
 * @param {string} method
 * @param {string} route
 * @param {string} what
 * @param {unknown} [body]
 */
function write(account, method, route, what, body) {
  guardWrite(method, route, body);
  return apple(account, method, route, what, body);
}

/**
 * The id of the app's asset library, which stays the same for the life of the app.
 * @param {import("./asc.mjs").Account} account
 * @param {import("./asc.mjs").App} app
 * @returns {Promise<string>}
 */
export async function assetLibrary(account, app) {
  const reply = await apple(account, "GET", `/v1/apps/${app.id}/assetLibrary`, `open the asset library of ${app.name}`);
  if (!reply?.data?.id) fail(`App Store Connect has no asset library for ${app.name}. App previews go in through it.`);
  return reply.data.id;
}

/**
 * @typedef {object} RefData What App Store Connect takes, as its reference data says.
 * @property {any[]} features
 * @property {any[]} placementProfileGroups
 * @property {any[]} videoSpecs
 * @property {any[]} placementTypes
 * @property {any[]} displayClasses
 */

/**
 * The reference data of the asset library: which groups of displays there are, which video sizes each takes, and
 * how many previews a version holds per group. Apple adds groups without a new API version, so this is read on
 * every push rather than written down here.
 * @param {import("./asc.mjs").Account} account
 * @returns {Promise<RefData>}
 */
export async function referenceData(account) {
  const keys = /** @type {const} */ (["features", "placementProfileGroups", "videoSpecs", "placementTypes", "displayClasses"]);
  const items = await appleList(account, `/v1/appAssetLibraryRefData?fields[appAssetLibraryRefData]=${keys.join(",")}`, "read which videos the asset library takes");
  /** @type {RefData} */
  const ref = { features: [], placementProfileGroups: [], videoSpecs: [], placementTypes: [], displayClasses: [] };
  for (const item of items) for (const key of keys) ref[key].push(...(item.attributes?.[key] ?? []));
  return ref;
}

/**
 * @typedef {object} Group Where a preview goes on a version's page.
 * @property {string} group The placement group, such as IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE.
 * @property {string | null} displayClass
 * @property {any} spec The video specification of the group that the size fits.
 * @property {number} limit How many previews a version's page holds in the group.
 */

/**
 * The group an app preview of a display and size goes into, from the reference data, or null when no group an
 * App Store version has takes that size. Of several, the one of the display class the display is recorded for
 * wins; then a group that takes this size alone, upright or turned, over one that takes others as well; then the
 * largest screen.
 * @param {RefData} ref
 * @param {{ display: string, width: number, height: number }} preview
 * @returns {Group | null}
 */
export function previewGroup(ref, { display, width, height }) {
  const platform = placementPlatform(display);
  /** @param {number} value @param {number | undefined} least @param {number | undefined} most */
  const within = (value, least, most) => (least === undefined || value >= least) && (most === undefined || value <= most);
  /** @param {any} spec @param {number} across @param {number} down */
  const takes = (spec, across, down) => (spec.compatiblePlacementTypes ?? [PREVIEW]).includes(PREVIEW) && within(across, spec.dimensions?.minWidth, spec.dimensions?.maxWidth) && within(down, spec.dimensions?.minHeight, spec.dimensions?.maxHeight);
  /** @param {any} spec */
  const fits = (spec) => takes(spec, width, height);
  // A group whose every spec is this size, upright or turned, is for this size; one that takes others is shared.
  /** @param {any} spec */
  const ownSize = (spec) => fits(spec) || takes(spec, height, width);
  const specs = new Map(ref.videoSpecs.map((spec) => [spec.specId, spec]));
  const groups = new Map(ref.placementProfileGroups.map((group) => [group.placementProfileGroupId, group]));
  const classes = new Map(ref.displayClasses.map((entry) => [entry.displayClassId, entry]));
  const policy = ref.features.find((feature) => feature.featureId === "APP_STORE_VERSIONS")?.placementPolicies?.find((/** @type {any} */ entry) => entry.placementType === PREVIEW);
  /** @param {string} id @returns {number | undefined} */
  const limitOf = (id) => policy?.groupLimits?.find((/** @type {any} */ limit) => limit.groupIds?.includes(id))?.maxCount;
  const preferred = PREVIEW_CLASSES[/** @type {keyof typeof PREVIEW_CLASSES} */ (display)];
  const candidates = [];
  for (const mapping of ref.placementTypes.find((type) => type.placementTypeId === PREVIEW)?.specMappings ?? []) {
    const group = groups.get(mapping.placementGroupId);
    if (group?.platform !== platform) continue;
    // A group the page of a version takes no previews in is for another feature.
    if (policy && limitOf(mapping.placementGroupId) === undefined) continue;
    const taken = (mapping.specs ?? []).map((/** @type {string} */ id) => specs.get(id)).filter(Boolean);
    const spec = taken.find(fits);
    if (!spec) continue;
    const screen = Math.max(0, ...(classes.get(group.displayClassId)?.screenDimensions ?? []).map(Number).filter(Number.isFinite));
    candidates.push({ group: mapping.placementGroupId, displayClass: group.displayClassId ?? null, spec, limit: limitOf(mapping.placementGroupId) ?? 3, own: taken.every(ownSize), screen });
  }
  candidates.sort((a, b) => Number(b.displayClass === preferred) - Number(a.displayClass === preferred) || Number(b.own) - Number(a.own) || b.screen - a.screen);
  if (candidates.length === 0) return null;
  const { group, displayClass, spec, limit } = candidates[0];
  return { group, displayClass, spec, limit };
}

/**
 * A duration as the reference data writes it, such as PT15S or PT1M30S, in seconds. Null for anything else.
 * @param {string | undefined} text
 */
export function isoSeconds(text) {
  const parts = /^PT(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(text ?? "");
  if (!parts || (!parts[1] && !parts[2])) return null;
  return Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0);
}

/** @param {number} bytes */
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * What App Store Connect's specification of the group says against a file: its size, its length, its kind.
 * @param {any} spec
 * @param {{ file: string, bytes: number, seconds: number | null }} preview
 * @returns {string[]}
 */
export function specProblems(spec, { file, bytes, seconds }) {
  const problems = [];
  if (spec.maxFileSize && bytes > spec.maxFileSize) problems.push(`it is ${megabytes(bytes)}, and the group takes at most ${megabytes(spec.maxFileSize)}`);
  const shortest = isoSeconds(spec.duration?.min);
  const longest = isoSeconds(spec.duration?.max);
  if (seconds !== null && ((shortest !== null && seconds < shortest) || (longest !== null && seconds > longest))) problems.push(`it is ${seconds.toFixed(1)} s long, and the group takes ${shortest ?? 0} to ${longest ?? "any"} s`);
  const extension = path.extname(file).toLowerCase();
  if (Array.isArray(spec.fileExtensions) && spec.fileExtensions.length > 0 && !spec.fileExtensions.includes(extension)) problems.push(`the group takes ${spec.fileExtensions.join(", ")} files`);
  return problems;
}

/**
 * @typedef {{ id: string, referenceName: string, state: string, timecode: string | null }} Video
 */

/** @param {any} entry @returns {Video} */
const videoOf = (entry) => ({ id: entry.id, referenceName: entry.attributes?.referenceName ?? "", state: entry.attributes?.state ?? "UNKNOWN", timecode: entry.attributes?.previewFrameTimeCode ?? null });

/**
 * The videos of the library that go by a reference name, the newest first.
 * @param {import("./asc.mjs").Account} account
 * @param {string} library
 * @param {string} referenceName
 * @returns {Promise<Video[]>}
 */
export async function videosNamed(account, library, referenceName) {
  const route = `/v1/appAssetLibraries/${library}/videos?filter[referenceName]=${encodeURIComponent(referenceName)}&fields[appAssetLibraryVideos]=referenceName,state,previewFrameTimeCode,createdDate&limit=200`;
  const found = await appleList(account, route, "look for previews uploaded before");
  return found
    .filter((entry) => entry.attributes?.referenceName === referenceName)
    .sort((a, b) => String(b.attributes?.createdDate ?? "").localeCompare(String(a.attributes?.createdDate ?? "")))
    .map(videoOf);
}

/**
 * How far Apple is with a video, and why it refused it if it did.
 * @param {import("./asc.mjs").Account} account
 * @param {string} id
 * @returns {Promise<Video & { details: string[] }>}
 */
export async function videoState(account, id) {
  const reply = await apple(account, "GET", `/v1/appAssetLibraryVideos/${id}?fields[appAssetLibraryVideos]=referenceName,state,stateDetails,previewFrameTimeCode`, "check the uploaded previews");
  const details = (reply?.data?.attributes?.stateDetails ?? []).map((/** @type {any} */ detail) => detail.description || detail.code).filter(Boolean);
  return { ...videoOf(reply.data), details };
}

/**
 * The bytes of a part of an open file.
 * @param {number} fd
 * @param {number} offset
 * @param {number} length
 */
function readPart(fd, offset, length) {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const got = readSync(fd, bytes, read, length - read, offset + read);
    if (got === 0) break;
    read += got;
  }
  return bytes.subarray(0, read);
}

/**
 * Uploads a video into the library: reserves it, sends its parts, three at a time, and commits it. Apple then
 * processes it, which videoState follows. Returns its id.
 * @param {import("./asc.mjs").Account} account
 * @param {string} library
 * @param {{ file: string, bytes: number, referenceName: string, timecode: string | null }} video
 */
export async function uploadVideo(account, library, { file, bytes, referenceName, timecode }) {
  const name = path.basename(file);
  const attributes = { fileName: name, fileSize: bytes, category: "APP_SCREENSHOTS_AND_PREVIEWS", referenceName, ...(timecode ? { previewFrameTimeCode: timecode } : {}) };
  const body = { data: { type: "appAssetLibraryVideos", attributes, relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: library } } } } };
  const reserved = (await write(account, "POST", "/v1/appAssetLibraryVideos", `take ${name}`, body)).data;
  // Each part is read from the file when it goes, so a long preview is never in memory whole.
  const fd = openSync(file, "r");
  try {
    await sendParts(reserved.attributes?.uploadOperations ?? [], (offset, length) => readPart(fd, offset, length), name, "Run the command again: it uploads that preview anew.", SENDS);
  } finally {
    closeSync(fd);
  }
  await write(account, "PATCH", `/v1/appAssetLibraryVideos/${reserved.id}`, `finish ${name}`, { data: { type: "appAssetLibraryVideos", id: reserved.id, attributes: { uploaded: true } } });
  return /** @type {string} */ (reserved.id);
}

/**
 * Moves the poster frame of a video. Every placement of the video shows the new one.
 * @param {import("./asc.mjs").Account} account
 * @param {string} video
 * @param {string} timecode
 */
export const setPosterTime = (account, video, timecode) =>
  write(account, "PATCH", `/v1/appAssetLibraryVideos/${video}`, "move the poster frame", { data: { type: "appAssetLibraryVideos", id: video, attributes: { previewFrameTimeCode: timecode } } });

/**
 * @typedef {{ id: string, video: Video | null }} Placement
 */

/**
 * The previews on the page of a language in one group, in the order the store shows them, each with its video.
 * @param {import("./asc.mjs").Account} account
 * @param {string} localization
 * @param {string} group
 * @returns {Promise<Placement[]>}
 */
export async function previewPlacements(account, localization, group) {
  /** @type {any[]} */
  const included = [];
  const route = `/v1/appStoreVersionLocalizations/${localization}/placements?filter[placementType]=${PREVIEW}&filter[placementGroup]=${group}&sort=placementGroupPosition&include=video&fields[appAssetLibraryVideos]=referenceName,state,previewFrameTimeCode&limit=200`;
  const placements = await appleList(account, route, "list the previews on the page", included);
  const videos = new Map(included.filter((entry) => entry.type === "appAssetLibraryVideos").map((entry) => [entry.id, videoOf(entry)]));
  return placements.map((placement) => ({ id: placement.id, video: videos.get(placement.relationships?.video?.data?.id) ?? null }));
}

/**
 * Puts a video onto the page of a language, in a group. It goes last; orderPlacements moves it.
 * @param {import("./asc.mjs").Account} account
 * @param {{ localization: string, group: string, video: string }} placement
 * @returns {Promise<string>}
 */
export async function placePreview(account, { localization, group, video }) {
  const body = {
    data: {
      type: "appAssetLibraryPlacements",
      attributes: { placementType: PREVIEW, placementGroup: group },
      relationships: { video: { data: { type: "appAssetLibraryVideos", id: video } }, appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localization } } },
    },
  };
  return (await write(account, "POST", "/v1/appAssetLibraryPlacements", "place the preview on the page", body)).data.id;
}

/**
 * Takes a preview appShots placed off the page. The video stays in the library, and any other placement of it
 * stays where it is. A placement of a video appShots did not upload is never taken off.
 * @param {import("./asc.mjs").Account} account
 * @param {Placement} placement
 */
export async function removePlacement(account, placement) {
  if (!placement.video?.referenceName.startsWith(REFERENCE_PREFIX)) fail("appShots only takes its own previews off a page, and this one is not.");
  await write(account, "DELETE", `/v1/appAssetLibraryPlacements/${placement.id}`, "take the earlier preview off the page");
}

/**
 * Sets the order of the previews of a group on the page of a language.
 * @param {import("./asc.mjs").Account} account
 * @param {{ localization: string, group: string, ids: string[] }} order
 */
export async function orderPlacements(account, { localization, group, ids }) {
  const body = {
    data: {
      type: "appAssetLibraryPlacementOrderingRequests",
      attributes: { placementGroup: group },
      relationships: {
        orderedPlacements: { data: ids.map((id) => ({ type: "appAssetLibraryPlacements", id })) },
        appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localization } },
      },
    },
  };
  await write(account, "POST", "/v1/appAssetLibraryPlacementOrderingRequests", "put the previews in order", body);
}
