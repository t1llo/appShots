// App Store Connect's asset library stood in for by a server on this machine: one app with a version being
// prepared for iOS and one for macOS, the store page of each in a few languages, the library's reference data,
// its videos, and the previews placed on each page. It follows the routes, bodies and states of Apple's
// documentation, and the assumptions written down in cli/src/store/library.mjs.
//
// It keeps a list of what App Store Connect must never be sent by appShots: a submission, a review or a release,
// a change to a version, a deleted or archived video, a removed placement of the user's, an upload that carries
// the token, a request that is not signed by the key. Every test checks that list is empty.

import { verify } from "node:crypto";
import { stubServer } from "../helpers.mjs";

const PREVIEW = "APP_PREVIEW";
const LIMIT = 3;

/** States of a video that cannot be placed yet, or ever. */
const UNPLACEABLE = new Set(["AWAITING_UPLOAD", "UPLOAD_COMPLETE", "FAILED", "REJECTED", "ARCHIVED"]);

/** @param {string} id @param {number} width @param {number} height */
const videoSpec = (id, width, height) => ({
  specId: id,
  shortName: id.toLowerCase(),
  dimensions: { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height },
  aspectRatio: `${width}:${height}`,
  compatiblePlacementTypes: [PREVIEW],
  frameRates: [{ minFps: 30, maxFps: 30 }],
  duration: { min: "PT15S", max: "PT30S" },
  audioRequired: true,
  fileExtensions: [".mp4", ".m4v", ".mov"],
  mimeTypes: ["video/mp4", "video/quicktime"],
  maxFileSize: 524288000,
  universalAsset: false,
});

/** The groups of displays, with their platform, display class and the specs of the previews each takes. */
const GROUPS = [
  ["IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", "IPHONE_APP_STORE", "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY", ["IPHONE_FACE_ID_PORTRAIT", "IPHONE_FACE_ID_LANDSCAPE"]],
  ["IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE", "IPHONE_APP_STORE", "IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY", ["IPHONE_FACE_ID_PORTRAIT", "IPHONE_FACE_ID_LANDSCAPE"]],
  ["IPHONE_DUO_PROFILE", "IPHONE_APP_STORE", "IPHONE_DUO", ["IPHONE_FACE_ID_PORTRAIT", "IPHONE_DUO_OPEN"]],
  ["IPHONE_HOME_BUTTON_LARGE_PROFILE", "IPHONE_APP_STORE", "IPHONE_HOME_BUTTON_LARGE_DISPLAY", ["IPHONE_55_PORTRAIT", "IPHONE_55_LANDSCAPE"]],
  ["IPHONE_HOME_BUTTON_MEDIUM_PROFILE", "IPHONE_APP_STORE", "IPHONE_HOME_BUTTON_MEDIUM_DISPLAY", ["IPHONE_47_PORTRAIT", "IPHONE_47_LANDSCAPE"]],
  ["IPAD_13_PROFILE", "IPAD_APP_STORE", "IPAD_13_DISPLAY", ["IPAD_PRO_PORTRAIT", "IPAD_PRO_LANDSCAPE"]],
  ["IPAD_129_PROFILE", "IPAD_APP_STORE", "IPAD_129_DISPLAY", ["IPAD_PRO_PORTRAIT", "IPAD_PRO_LANDSCAPE"]],
  ["IPAD_97_PROFILE", "IPAD_APP_STORE", "IPAD_97_DISPLAY", ["IPAD_97_PORTRAIT", "IPAD_97_LANDSCAPE"]],
  ["MAC_PROFILE", "MAC_APP_STORE", "DEFAULT", ["MAC"]],
];

/**
 * Reference data in the shape Apple's appAssetLibraryRefData has. The numbers are Apple's; the names of the
 * specs are made up. A group for custom product pages only takes iPhone previews as well, and an App Store
 * version must never get one placed there.
 */
export const REF_DATA = {
  features: [
    { featureId: "APP_STORE_VERSIONS", placementPolicies: [{ placementType: PREVIEW, groupLimits: [{ groupIds: GROUPS.map(([id]) => id), maxCount: LIMIT }] }] },
    { featureId: "CUSTOM_PRODUCT_PAGES", placementPolicies: [{ placementType: PREVIEW, groupLimits: [{ groupIds: ["IPHONE_PRODUCT_PAGE_PROFILE"], maxCount: LIMIT }] }] },
  ],
  placementProfileGroups: [
    ...GROUPS.map(([id, platform, displayClassId]) => ({ placementProfileGroupId: id, platform, displayClassId })),
    { placementProfileGroupId: "IPHONE_PRODUCT_PAGE_PROFILE", platform: "IPHONE_APP_STORE", displayClassId: "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY" },
  ],
  videoSpecs: [
    videoSpec("IPHONE_FACE_ID_PORTRAIT", 886, 1920),
    videoSpec("IPHONE_FACE_ID_LANDSCAPE", 1920, 886),
    videoSpec("IPHONE_DUO_OPEN", 1600, 1800),
    videoSpec("IPHONE_55_PORTRAIT", 1080, 1920),
    videoSpec("IPHONE_55_LANDSCAPE", 1920, 1080),
    videoSpec("IPHONE_47_PORTRAIT", 750, 1334),
    videoSpec("IPHONE_47_LANDSCAPE", 1334, 750),
    videoSpec("IPAD_PRO_PORTRAIT", 1200, 1600),
    videoSpec("IPAD_PRO_LANDSCAPE", 1600, 1200),
    videoSpec("IPAD_97_PORTRAIT", 900, 1200),
    videoSpec("IPAD_97_LANDSCAPE", 1200, 900),
    videoSpec("MAC", 1920, 1080),
  ],
  placementTypes: [
    {
      placementTypeId: PREVIEW,
      acceptsAssetCategories: ["APP_SCREENSHOTS_AND_PREVIEWS"],
      specMappings: [...GROUPS.map(([id, , , specs]) => ({ placementGroupId: id, specs })), { placementGroupId: "IPHONE_PRODUCT_PAGE_PROFILE", specs: ["IPHONE_FACE_ID_PORTRAIT"] }],
    },
    { placementTypeId: "SCREENSHOT", acceptsAssetCategories: ["APP_SCREENSHOTS_AND_PREVIEWS"], specMappings: [{ placementGroupId: "IPHONE_DUO_PROFILE", specs: ["IPHONE_FACE_ID_PORTRAIT"] }] },
  ],
  displayClasses: [
    { displayClassId: "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY", deviceFamily: "IPHONE", screenDimensions: ["6.9"] },
    { displayClassId: "IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY", deviceFamily: "IPHONE", screenDimensions: ["6.3"] },
    { displayClassId: "IPHONE_DUO", deviceFamily: "IPHONE", screenDimensions: ["7.8"] },
    { displayClassId: "IPHONE_HOME_BUTTON_LARGE_DISPLAY", deviceFamily: "IPHONE", screenDimensions: ["5.5"] },
    { displayClassId: "IPHONE_HOME_BUTTON_MEDIUM_DISPLAY", deviceFamily: "IPHONE", screenDimensions: ["4.7"] },
    { displayClassId: "IPAD_13_DISPLAY", deviceFamily: "IPAD", screenDimensions: ["13"] },
    { displayClassId: "IPAD_129_DISPLAY", deviceFamily: "IPAD", screenDimensions: ["12.9"] },
    { displayClassId: "IPAD_97_DISPLAY", deviceFamily: "IPAD", screenDimensions: ["9.7"] },
    { displayClassId: "DEFAULT", deviceFamily: "MAC", screenDimensions: [] },
  ],
};

/** Routes that submit, review or release a version. appShots never sends anything to them. */
const FORBIDDEN = /^\/v1\/(appStoreVersionSubmissions|reviewSubmissions|reviewSubmissionItems|appStoreVersionReleaseRequests|appStoreVersionPhasedReleases|appStoreVersionExperiments|appStoreReviewDetails)\b/;

/**
 * @typedef {{ referenceName: string, fileName: string, fileSize: number, state: string, timecode: string | null, created: number, bytes: Buffer, parts: Set<number>, polls: number, details: Array<{ code: string, description: string }> }} StoredVideo
 * @typedef {{ localization: string, group: string, video: string }} StoredPlacement
 * @typedef {{ id: string, platform: string, versionString: string, appVersionState: string, createdDate: string }} StoredVersion
 */

/**
 * Starts the stand-in. Point APPSHOTS_STORE_API at its url before store/asc.mjs is imported.
 * @param {import("node:crypto").KeyObject} publicKey The public half of the key the CLI signs with.
 */
export async function libraryStandIn(publicKey) {
  /** @type {string[]} */
  const violations = [];
  const state = {
    app: { id: "1001", type: "apps", attributes: { name: "Demo", bundleId: "com.example.demo", primaryLocale: "en-US" } },
    library: "library-1",
    /** @type {StoredVersion[]} */
    versions: [],
    /** @type {Map<string, Array<{ id: string, locale: string }>>} */
    languages: new Map(),
    /** @type {Map<string, StoredVideo>} */
    videos: new Map(),
    /** @type {Map<string, StoredPlacement>} placements in the order of their position */
    placements: new Map(),
    /** How often a video is asked for before Apple has processed it. */
    processAfter: 1,
    /** Reference names (or the start of them) of the videos Apple refuses when it processes them. */
    /** @type {string[]} */
    refuse: [],
    /** The size of the parts an upload is split into. */
    partSize: 4096,
  };
  let next = 0;
  let clock = 0;

  /** @param {string} id @param {StoredVideo} video */
  const videoBody = (id, video) => ({
    id,
    type: "appAssetLibraryVideos",
    attributes: { fileName: video.fileName, fileSize: video.fileSize, referenceName: video.referenceName, state: video.state, previewFrameTimeCode: video.timecode, stateDetails: video.details, createdDate: new Date(Date.UTC(2026, 9, 1) + video.created * 1000).toISOString() },
  });
  /** @param {string} localization @param {string} group */
  const groupOf = (localization, group) => [...state.placements.entries()].filter(([, placement]) => placement.localization === localization && placement.group === group);
  /** @param {string} localization */
  const versionOf = (localization) => state.versions.find((version) => state.languages.get(version.id)?.some((entry) => entry.id === localization));
  /** @param {string} code @param {string} title @param {number} [status] */
  const refuse = (code, title, status = 409) => /** @type {[number, unknown]} */ ([status, { errors: [{ status: String(status), code, title, detail: title }] }]);

  const server = await stubServer(async ({ method, url, headers, body }) => {
    const [route, query = ""] = url.split("?");
    const params = new URLSearchParams(query);
    let match;
    if (route.startsWith("/upload/")) {
      // The bytes go to storage, which is not the API: the token must not go along.
      if (headers.authorization !== undefined) violations.push(`${method} ${route} carried the token`);
      const [, , id, part] = route.split("/");
      const video = state.videos.get(id);
      if (!video || method !== "PUT") return [404, ""];
      const offset = Number(part) * state.partSize;
      body.copy(video.bytes, offset);
      video.parts.add(Number(part));
      return [200, ""];
    }
    const [scheme, token = ""] = String(headers.authorization).split(" ");
    const [head, claims, signature = ""] = token.split(".");
    if (scheme !== "Bearer" || !verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))) {
      violations.push(`${method} ${route} was not signed by the key`);
      return refuse("NOT_AUTHORIZED", "The token is not valid.", 401);
    }
    const json = body.length > 0 ? JSON.parse(body.toString()) : null;
    if (FORBIDDEN.test(route)) {
      violations.push(`${method} ${route} would submit, review or release`);
      return refuse("FORBIDDEN_ERROR", "Not part of this test.", 403);
    }
    if (method !== "GET" && /^\/v1\/(apps|appStoreVersions|appStoreVersionLocalizations|appAssetLibraries)\b/.test(route)) {
      violations.push(`${method} ${route} would change the app or a version`);
      return refuse("FORBIDDEN_ERROR", "Not part of this test.", 403);
    }
    if (method === "DELETE" && route.startsWith("/v1/appAssetLibraryVideos")) {
      violations.push(`${method} ${route} would delete a video of the library`);
      return refuse("FORBIDDEN_ERROR", "Not part of this test.", 403);
    }

    if (method === "GET" && route === "/v1/apps") return [200, { data: [state.app], links: {} }];
    if (method === "GET" && route === `/v1/apps/${state.app.id}/appStoreVersions`) {
      const platform = params.get("filter[platform]");
      const versions = state.versions.filter((version) => !platform || version.platform === platform);
      return [200, { data: versions.map(({ id, ...attributes }) => ({ id, type: "appStoreVersions", attributes })) }];
    }
    if (method === "GET" && (match = /^\/v1\/appStoreVersions\/([^/]+)\/appStoreVersionLocalizations$/.exec(route))) {
      return [200, { data: (state.languages.get(match[1]) ?? []).map(({ id, locale }) => ({ id, type: "appStoreVersionLocalizations", attributes: { locale } })) }];
    }
    if (method === "GET" && route === `/v1/apps/${state.app.id}/assetLibrary`) return [200, { data: { id: state.library, type: "appAssetLibraries" } }];
    if (method === "GET" && route === "/v1/appAssetLibraryRefData") return [200, { data: [{ id: "refdata-1", type: "appAssetLibraryRefData", attributes: REF_DATA }] }];

    if (method === "POST" && route === "/v1/appAssetLibraryVideos") {
      const { attributes, relationships } = json.data;
      if (relationships?.assetLibrary?.data?.id !== state.library) return refuse("ENTITY_ERROR.RELATIONSHIP.INVALID", "No such library.");
      if (attributes.category !== "APP_SCREENSHOTS_AND_PREVIEWS") return refuse("ENTITY_ERROR.ATTRIBUTE.INVALID", "The category is not one a video takes.");
      if (attributes.previewFrameTimeCode !== undefined && !/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(attributes.previewFrameTimeCode)) return refuse("ENTITY_ERROR.ATTRIBUTE.INVALID", "The time code is not HH:MM:SS:FF.");
      const id = `video-${++next}`;
      const size = Number(attributes.fileSize);
      /** @type {StoredVideo} */
      const video = { referenceName: attributes.referenceName, fileName: attributes.fileName, fileSize: size, state: "AWAITING_UPLOAD", timecode: attributes.previewFrameTimeCode ?? null, created: ++clock, bytes: Buffer.alloc(size), parts: new Set(), polls: 0, details: [] };
      state.videos.set(id, video);
      const operations = [];
      for (let offset = 0, part = 0; offset < size; offset += state.partSize, part++) {
        operations.push({ method: "PUT", url: `${server.url}/upload/${id}/${part}`, offset, length: Math.min(state.partSize, size - offset), requestHeaders: [{ name: "Content-Type", value: "application/octet-stream" }] });
      }
      return [201, { data: { ...videoBody(id, video), attributes: { ...videoBody(id, video).attributes, uploadOperations: operations } } }];
    }
    if (method === "PATCH" && (match = /^\/v1\/appAssetLibraryVideos\/([^/]+)$/.exec(route))) {
      const video = state.videos.get(match[1]);
      if (!video) return refuse("NOT_FOUND", "No such video.", 404);
      const attributes = json.data.attributes ?? {};
      for (const name of Object.keys(attributes)) if (name !== "uploaded" && name !== "previewFrameTimeCode") violations.push(`PATCH ${route} would change ${name}`);
      if (attributes.uploaded === true) {
        const parts = Math.ceil(video.fileSize / state.partSize);
        if (video.parts.size !== parts) return refuse("STATE_ERROR", `Only ${video.parts.size} of ${parts} parts arrived.`);
        video.state = "UPLOAD_COMPLETE";
      }
      if (attributes.previewFrameTimeCode !== undefined) video.timecode = attributes.previewFrameTimeCode;
      return [200, { data: videoBody(match[1], video) }];
    }
    if (method === "GET" && (match = /^\/v1\/appAssetLibraryVideos\/([^/]+)$/.exec(route))) {
      const video = state.videos.get(match[1]);
      if (!video) return refuse("NOT_FOUND", "No such video.", 404);
      if (video.state === "UPLOAD_COMPLETE" && ++video.polls >= state.processAfter) {
        if (state.refuse.some((name) => video.referenceName.startsWith(name))) {
          video.state = "FAILED";
          video.details = [{ code: "VIDEO_TOO_SHORT", description: "The video is shorter than the placement allows." }];
        } else {
          video.state = "PREPARE_FOR_SUBMISSION";
        }
      }
      return [200, { data: videoBody(match[1], video) }];
    }
    if (method === "GET" && route === `/v1/appAssetLibraries/${state.library}/videos`) {
      const name = params.get("filter[referenceName]");
      const found = [...state.videos.entries()].filter(([, video]) => !name || video.referenceName === name);
      return [200, { data: found.map(([id, video]) => videoBody(id, video)), links: {} }];
    }

    if (method === "POST" && route === "/v1/appAssetLibraryPlacements") {
      const { attributes, relationships } = json.data;
      const video = state.videos.get(relationships?.video?.data?.id);
      const localization = relationships?.appStoreVersionLocalization?.data?.id;
      const version = versionOf(localization);
      if (attributes.placementType !== PREVIEW) return refuse("ENTITY_ERROR.ATTRIBUTE.INVALID", "Not a placement type of this test.");
      if (!video || !version) return refuse("ENTITY_ERROR.RELATIONSHIP.INVALID", "No such video or page.");
      if (UNPLACEABLE.has(video.state)) return refuse("STATE_ERROR.INVALID_STATE", `A video that is ${video.state} cannot be placed.`);
      if (!["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY", "READY_FOR_REVIEW"].includes(version.appVersionState)) return refuse("STATE_ERROR.INVALID_STATE", "The version cannot be changed.");
      if (!GROUPS.some(([id]) => id === attributes.placementGroup)) return refuse("ENTITY_ERROR.ATTRIBUTE.INVALID", "An App Store version has no such group.");
      if (groupOf(localization, attributes.placementGroup).length >= LIMIT) return refuse("STATE_ERROR.INVALID_STATE", "The group holds as many previews as it can.");
      const id = `placement-${++next}`;
      state.placements.set(id, { localization, group: attributes.placementGroup, video: relationships.video.data.id });
      return [201, { data: { id, type: "appAssetLibraryPlacements", attributes: { placementType: PREVIEW, placementGroup: attributes.placementGroup, state: "PARENT_PREPARE_FOR_SUBMISSION" } } }];
    }
    if (method === "GET" && (match = /^\/v1\/appStoreVersionLocalizations\/([^/]+)\/placements$/.exec(route))) {
      const group = params.get("filter[placementGroup]");
      const placed = [...state.placements.entries()].filter(([, placement]) => placement.localization === match[1] && (!group || placement.group === group));
      const data = placed.map(([id, placement]) => ({ id, type: "appAssetLibraryPlacements", attributes: { placementType: PREVIEW, placementGroup: placement.group }, relationships: { video: { data: { type: "appAssetLibraryVideos", id: placement.video } } } }));
      const included = params.get("include") === "video" ? [...new Set(placed.map(([, placement]) => placement.video))].map((id) => videoBody(id, /** @type {StoredVideo} */ (state.videos.get(id)))) : undefined;
      return [200, { data, included, links: {} }];
    }
    if (method === "DELETE" && (match = /^\/v1\/appAssetLibraryPlacements\/([^/]+)$/.exec(route))) {
      const placement = state.placements.get(match[1]);
      if (!placement) return refuse("NOT_FOUND", "No such placement.", 404);
      if (!state.videos.get(placement.video)?.referenceName.startsWith("appshots ")) violations.push(`DELETE ${route} took a preview of the user's off the page`);
      state.placements.delete(match[1]);
      return [204, ""];
    }
    if (method === "POST" && route === "/v1/appAssetLibraryPlacementOrderingRequests") {
      const group = json.data.attributes.placementGroup;
      const localization = json.data.relationships.appStoreVersionLocalization.data.id;
      const ids = json.data.relationships.orderedPlacements.data.map((/** @type {any} */ entry) => entry.id);
      const there = groupOf(localization, group).map(([id]) => id);
      if (ids.length !== there.length || !there.every((id) => ids.includes(id))) return refuse("ENTITY_ERROR.RELATIONSHIP.INVALID", "The order names other placements than the group holds.");
      const others = [...state.placements.entries()].filter(([id]) => !there.includes(id));
      state.placements = new Map([...others, ...ids.map((/** @type {string} */ id) => /** @type {[string, StoredPlacement]} */ ([id, state.placements.get(id)]))]);
      return [201, { data: { id: `order-${++next}`, type: "appAssetLibraryPlacementOrderingRequests", attributes: { placementGroup: group } } }];
    }
    violations.push(`${method} ${route} is not part of this test`);
    return refuse("NOT_FOUND", `${method} ${route} is not part of this test.`, 404);
  });

  /** @param {string} platform @param {string} locale */
  const localizationId = (platform, locale) => `loc-${platform}-${locale}`;

  return {
    url: server.url,
    requests: server.requests,
    close: server.close,
    violations,
    state,
    /**
     * A fresh store: a version of each platform in the state given, with its languages.
     * @param {{ ios?: string | null, mac?: string | null, locales?: string[], macLocales?: string[], processAfter?: number }} [options]
     */
    reset({ ios = "PREPARE_FOR_SUBMISSION", mac = "PREPARE_FOR_SUBMISSION", locales = ["en-US", "de-DE"], macLocales = locales, processAfter = 1 } = {}) {
      violations.length = 0;
      server.requests.length = 0;
      state.versions = [];
      state.languages = new Map();
      state.videos = new Map();
      state.placements = new Map();
      state.processAfter = processAfter;
      state.refuse = [];
      for (const [platform, versionState, codes] of /** @type {const} */ ([["IOS", ios, locales], ["MAC_OS", mac, macLocales]])) {
        // An older version that is on the App Store, under the one given.
        state.versions.push({ id: `${platform}-1.0`, platform, versionString: "1.0", appVersionState: "READY_FOR_DISTRIBUTION", createdDate: "2026-06-01T00:00:00Z" });
        if (versionState) state.versions.push({ id: `${platform}-1.1`, platform, versionString: "1.1", appVersionState: versionState, createdDate: "2026-09-01T00:00:00Z" });
        for (const id of [`${platform}-1.0`, `${platform}-1.1`]) state.languages.set(id, codes.map((locale) => ({ id: id.endsWith("1.1") ? localizationId(platform, locale) : `${id}-${locale}`, locale })));
      }
    },
    /**
     * Puts a preview onto a page, as the user or an earlier push did, and returns its placement's id.
     * @param {{ locale: string, group: string, referenceName: string, platform?: string, timecode?: string, state?: string }} preview
     */
    seed({ locale, group, referenceName, platform = "IOS", timecode = "00:00:01:00", state: videoState = "PREPARE_FOR_SUBMISSION" }) {
      const video = `video-${++next}`;
      state.videos.set(video, { referenceName, fileName: "seeded.mp4", fileSize: 10, state: videoState, timecode, created: ++clock, bytes: Buffer.alloc(10), parts: new Set([0]), polls: 0, details: [] });
      const id = `placement-${++next}`;
      state.placements.set(id, { localization: localizationId(platform, locale), group, video });
      return id;
    },
    /**
     * The reference names of the previews on a page in one group, in their order.
     * @param {string} locale
     * @param {string} group
     * @param {string} [platform]
     */
    page(locale, group, platform = "IOS") {
      return groupOf(localizationId(platform, locale), group).map(([, placement]) => state.videos.get(placement.video)?.referenceName);
    },
    /** What was sent that is not a question: method and route. */
    writes() {
      return server.requests.filter((request) => request.method !== "GET").map((request) => `${request.method} ${request.url.split("?")[0].replace(/\/(video|placement)-\d+(\/\d+)?$/, "/$1-n")}`);
    },
  };
}
