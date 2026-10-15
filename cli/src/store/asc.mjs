// A finished set goes into App Store Connect from this Mac, with an API key of the user's own. The key file is
// read here to sign a token that lasts ten minutes, and that token goes to Apple alone: the appShots server
// never sees the key, the token, or where the key is. Nothing here submits a version for review or releases
// one, and a key with the role Marketing, which is all this needs, could not.

import { createPrivateKey, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CONFIG_FILE, tilde } from "../config.mjs";
import { attempt, fail } from "../fail.mjs";
import { run } from "../proc.mjs";
import { promptLine } from "../prompt.mjs";
import { pause } from "../util.mjs";
import { STORE_PLATFORMS } from "./displays.mjs";

/** The issuer ID, the key ID and the path of the key file, as `store login` saves them. Never the key. */
const STORE_FILE = path.join(path.dirname(CONFIG_FILE), "app-store-connect.json");
// A stand-in for Apple's server on this machine can take its place, so the flow can be exercised without an
// account. Nothing else can, so the token is never sent to another host.
const STORE_API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.APPSHOTS_STORE_API ?? "") ? process.env.APPSHOTS_STORE_API : "https://api.appstoreconnect.apple.com";

/** The states in which the page of a version can still be changed. */
export const STORE_OPEN = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY", "READY_FOR_REVIEW"]);

const STORE_HOWTO = `All three come from App Store Connect, under Users and Access > Integrations > App Store Connect API > Team Keys:
the issuer ID is above the list of keys, the key ID is beside the key, and the .p8 file is the download offered
once when the key is made. Give the key the role Marketing: it can then make a version and change screenshots
and texts, and it cannot submit or release anything.`;

/**
 * @typedef {{ issuerId: string, keyId: string, file: string, key: import("node:crypto").KeyObject }} Account
 * @typedef {{ id: string, name: string, bundleId: string, primaryLocale: string }} App
 * @typedef {{ id: string | null, number: string, platform: string, before?: string }} Version
 */

/**
 * The three settings, from the flags, the environment, or what `store login` saved.
 * @param {Record<string, string | true>} flags
 */
function storeSettings(flags) {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(STORE_FILE, "utf8"));
  } catch {}
  const pick = (flag, variable, key) => {
    if (flags[flag] === true) fail(`--${flag} needs ${flag === "key" ? "the path of the .p8 file" : "a value"} after it.`);
    return String(flags[flag] ?? process.env[variable] ?? saved[key] ?? "").trim();
  };
  return { issuerId: pick("issuer", "ASC_ISSUER_ID", "issuerId"), keyId: pick("key-id", "ASC_KEY_ID", "keyId"), keyFile: pick("key", "ASC_KEY_PATH", "keyFile") };
}

/**
 * Reads the key so that it can sign, and says what is wrong in words a person can act on. Never prints any of it.
 * @param {{ issuerId: string, keyId: string, keyFile: string }} settings
 * @returns {Account}
 */
function storeKey({ issuerId, keyId, keyFile }) {
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(keyFile)) fail("--key takes the path of the .p8 file, not what is in it. The key is never pasted anywhere.");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(issuerId)) fail(`"${issuerId}" is not an issuer ID. It is the long code with dashes above the list of keys in App Store Connect.`);
  if (!/^[A-Z0-9]{6,20}$/i.test(keyId)) fail(`"${keyId}" is not a key ID. It is the short code beside the key in App Store Connect, such as 2X9R4HXF34.`);
  // Without a path, the key is looked for where Apple's own tools look for it.
  const folders = [path.resolve("private_keys"), path.join(homedir(), "private_keys"), path.join(homedir(), ".private_keys"), path.join(homedir(), ".appstoreconnect", "private_keys")];
  const file = keyFile ? path.resolve(keyFile.replace(/^~(?=\/|$)/, homedir())) : folders.map((dir) => path.join(dir, `AuthKey_${keyId}.p8`)).find(existsSync);
  if (!file) fail(`Where is the key? Give the path of the .p8 file with --key, or put it into ~/.appstoreconnect/private_keys as AuthKey_${keyId}.p8.`);
  if (!existsSync(file) || !statSync(file).isFile()) fail(`There is no key file at ${file}. Run 'appshots store login' with --key <path to the .p8 file>.`);
  let key;
  try {
    key = createPrivateKey(readFileSync(file));
  } catch {
    fail(`${file} is not a private key. It has to be the .p8 file from App Store Connect, as it was downloaded.`);
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") fail(`${file} is not an App Store Connect key.`);
  return { issuerId, keyId, file, key };
}

/** @param {Record<string, string | true>} flags */
export function storeAccount(flags) {
  const settings = storeSettings(flags);
  if (!settings.issuerId || !settings.keyId) fail(`No App Store Connect key is set up on this Mac. Run: appshots store login --issuer <issuer id> --key-id <key id> --key <path to the .p8 file>\n${STORE_HOWTO}`);
  return storeKey(settings);
}

/** The App Store Connect line of 'appshots check'. It looks at what is saved and asks Apple nothing. */
export async function storeStatus() {
  const settings = storeSettings({});
  if (!settings.issuerId && !settings.keyId) return "no key set up. It is only needed to put a finished set there: 'appshots store login'";
  const { value, problem } = await attempt(() => storeKey(settings));
  return problem ?? `key ${value.keyId} (${tilde(value.file)}). 'appshots store push <project> --app <bundle id>' puts a finished set there`;
}

const storeToken = { value: "", until: 0 };

/**
 * A token Apple takes for ten minutes, signed with the key. A long upload gets a new one in time.
 * @param {Account} account
 */
function appleToken(account) {
  const now = Math.floor(Date.now() / 1000);
  if (storeToken.until - now > 120) return storeToken.value;
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = `${part({ alg: "ES256", kid: account.keyId, typ: "JWT" })}.${part({ iss: account.issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
  storeToken.value = `${head}.${sign("sha256", Buffer.from(head), { key: account.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  storeToken.until = now + 600;
  return storeToken.value;
}

/**
 * How long to wait before the next try: longer each time, and a little more or less at random, so that the
 * uploads that run side by side do not all come back at the same moment.
 * @param {number} tries
 * @param {Response} [response]
 */
export function backoff(tries, response) {
  const asked = Number(response?.headers.get("retry-after"));
  const base = asked > 0 && asked <= 60 ? asked * 1000 : tries * 3000;
  return Math.round(base * (0.75 + Math.random() / 2));
}

/**
 * One call to the App Store Connect API. `what` finishes the sentence "App Store Connect could not ...".
 * @param {Account} account
 * @param {string} method
 * @param {string} route
 * @param {string} what
 * @param {unknown} [body]
 */
export async function apple(account, method, route, what, body) {
  // Asking again, or removing again, is safe. A change that may have arrived is not sent a second time.
  const repeatable = method === "GET" || method === "DELETE";
  for (let tries = 1; ; tries++) {
    let response;
    try {
      response = await fetch(STORE_API + route, {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: { authorization: `Bearer ${appleToken(account)}`, ...(body ? { "content-type": "application/json" } : {}) },
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      if (repeatable && tries < 4) {
        // A dropped connection usually comes back within seconds; asking again at once would only fail again.
        await pause(backoff(tries));
        continue;
      }
      fail(`Cannot reach App Store Connect: ${error.cause?.message ?? error.message}`);
    }
    // Too many requests means this one was not looked at, so it can go again after a pause.
    if ((response.status === 429 || (response.status >= 500 && repeatable)) && tries < 4) {
      await pause(backoff(tries, response));
      continue;
    }
    // A removal sent again finds the thing gone: the first one arrived after all.
    if (method === "DELETE" && response.status === 404 && tries > 1) return null;
    const text = await response.text();
    let reply = null;
    try {
      reply = text ? JSON.parse(text) : null;
    } catch {}
    if (response.ok) return reply;
    const detail = [...new Set((reply?.errors ?? []).map((error) => error.detail || error.title).filter(Boolean))].join(" ") || `It answered ${response.status}.`;
    if (response.status === 401) fail(`App Store Connect did not accept the key. ${detail} Check the issuer ID and the key ID, and that the key has not been revoked, then run 'appshots store login' again.`);
    if (response.status === 403) fail(`App Store Connect does not let this key ${what}. ${detail} A key keeps the role it was made with, and this needs Marketing or App Manager.`);
    fail(`App Store Connect could not ${what}. ${detail}`);
  }
}

/**
 * Every item of a list, however many pages Apple splits it into.
 * @param {Account} account
 * @param {string} route
 * @param {string} what
 * @returns {Promise<any[]>}
 */
export async function appleList(account, route, what) {
  const items = [];
  for (let next = route; next; ) {
    const page = await apple(account, "GET", next, what);
    items.push(...(page?.data ?? []));
    // The link to the next page is followed only while it stays with the same server, because the token goes along.
    next = page?.links?.next?.startsWith(`${STORE_API}/`) ? page.links.next.slice(STORE_API.length) : null;
  }
  return items;
}

/**
 * @param {Account} account
 * @returns {Promise<App[]>}
 */
export async function storeApps(account) {
  const apps = await appleList(account, "/v1/apps?limit=200", "list the apps");
  return apps
    .map((app) => ({ id: app.id, name: app.attributes?.name ?? "", bundleId: app.attributes?.bundleId ?? "", primaryLocale: app.attributes?.primaryLocale ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {App[]} apps */
export const appLines = (apps) => apps.map((app) => `  ${app.bundleId.padEnd(Math.max(...apps.map((each) => each.bundleId.length)))}  ${app.name}`).join("\n");

/**
 * The app --app names by its bundle id, its name or its Apple ID. Left out, it is the only one the key reaches.
 * @param {Account} account
 * @param {string | true | undefined} query
 */
export async function storeApp(account, query) {
  const apps = await storeApps(account);
  if (apps.length === 0) fail("This key reaches no app. A key sees the apps of its own team: is it that team's?");
  if (typeof query !== "string") {
    if (apps.length === 1) return apps[0];
    fail(`Which app? Name it with --app <bundle id>:\n${appLines(apps)}`);
  }
  const wanted = query.toLowerCase();
  const found = apps.filter((app) => app.bundleId.toLowerCase() === wanted || app.id === query || app.name.toLowerCase() === wanted);
  if (found.length === 1) return found[0];
  fail(`${found.length > 1 ? "Several apps are" : "No app is"} "${query}" for this key. It reaches:\n${appLines(apps)}`);
}

/**
 * Whether a file sits in a Git repository that would take it along in a commit.
 * @param {string} file
 */
async function couldBeCommitted(file) {
  const git = (args) => run("git", ["-C", path.dirname(file), ...args]);
  return (await git(["rev-parse", "--is-inside-work-tree"])).stdout.trim() === "true" && (await git(["check-ignore", "-q", file])).status === 1;
}

/** @param {Record<string, string | true>} flags */
export async function storeLogin(flags) {
  const settings = storeSettings(flags);
  if (!settings.issuerId || !settings.keyId) {
    // A person at the Terminal is asked for what is missing. None of the three is a secret, and the key itself is never asked for.
    const usage = `Usage: appshots store login --issuer <issuer id> --key-id <key id> --key <path to the .p8 file>\n${STORE_HOWTO}`;
    if (!process.stdin.isTTY) fail(usage);
    console.log(`${STORE_HOWTO}\n`);
    settings.issuerId ||= await promptLine("Issuer ID: ", usage);
    settings.keyId ||= await promptLine("Key ID: ", usage);
    settings.keyFile ||= await promptLine("Path to the .p8 file (empty to look in ~/.appstoreconnect/private_keys): ", usage);
  }
  const account = storeKey(settings);
  const apps = await storeApps(account);
  mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  writeFileSync(STORE_FILE, `${JSON.stringify({ issuerId: account.issuerId, keyId: account.keyId, keyFile: account.file }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STORE_FILE, 0o600);
  console.log(`App Store Connect accepted key ${account.keyId}. Its ID, the issuer ID and where it is are saved in ${tilde(STORE_FILE)}.`);
  console.log(`The key itself stays in ${tilde(account.file)}. It signs in to Apple from this Mac and goes nowhere else.`);
  if (await couldBeCommitted(account.file)) console.log("  ! That is inside a Git repository, where it could end up in a commit. Move it out, to ~/.appstoreconnect/private_keys for one, and run this again.");
  console.log(apps.length > 0 ? `It reaches ${apps.length === 1 ? "one app" : `${apps.length} apps`}:\n${appLines(apps)}` : "It reaches no app yet.");
  console.log("Next: appshots store push <project> --app <bundle id> --dry-run");
}

/** @param {any} version */
export const versionState = (version) => version.attributes?.appVersionState ?? version.attributes?.appStoreState ?? "UNKNOWN";
/** @param {string} state */
export const plainState = (state) => ({ PREPARE_FOR_SUBMISSION: "being prepared", READY_FOR_DISTRIBUTION: "on the App Store", READY_FOR_SALE: "on the App Store" })[state] ?? state.toLowerCase().replaceAll("_", " ");

/**
 * The versions of an app on one platform, the newest first.
 * @param {Account} account
 * @param {App} app
 * @param {string} platform
 */
export async function storeVersions(account, app, platform) {
  const versions = await appleList(account, `/v1/apps/${app.id}/appStoreVersions?filter[platform]=${platform}&limit=200`, `list the versions of ${app.name}`);
  return versions.sort((a, b) => String(b.attributes?.createdDate ?? "").localeCompare(String(a.attributes?.createdDate ?? "")));
}

/**
 * The version whose page gets changed: the one being prepared, or with --version a new one. App Store Connect
 * holds one such version per platform. Nothing is created here: a version that has to be comes back without an id,
 * and with the one before it, whose languages, texts and screenshots Apple carries over into the new one.
 * @param {Account} account
 * @param {App} app
 * @param {string} platform
 * @param {Record<string, string | true>} flags
 * @returns {Promise<Version>}
 */
export async function storeVersion(account, app, platform, flags) {
  if (flags.version === true) fail("--version needs a number, such as --version 1.3.");
  const wanted = typeof flags.version === "string" ? flags.version.trim() : "";
  const system = STORE_PLATFORMS[platform];
  const versions = await storeVersions(account, app, platform);
  // Naming a version for a platform the app does not have would add that platform to the app.
  if (versions.length === 0) fail(`${app.name} has no ${system} version in App Store Connect. ${platform === "MAC_OS" ? "Mac screenshots go onto the macOS version of an app: add that platform there first, or leave them out with --only iphone,ipad." : "Add that platform there first, or leave its screenshots out with --only mac."}`);
  const open = versions.find((version) => STORE_OPEN.has(versionState(version)));
  const named = wanted ? versions.find((version) => version.attributes.versionString === wanted) : null;
  const say = (version) => `${version.attributes.versionString} (${plainState(versionState(version))})`;
  if (named && named !== open) fail(`Version ${say(named)} of ${app.name} for ${system} can no longer be changed. ${open ? `The one being prepared is ${open.attributes.versionString}: leave out --version to use it.` : "Name a new one with --version."}`);
  if (open && (named || !wanted)) return { id: open.id, number: open.attributes.versionString, platform };
  if (open) fail(`Version ${open.attributes.versionString} of ${app.name} for ${system} is being prepared already, and App Store Connect holds one at a time. Leave out --version to use it, or rename it there first.`);
  if (!wanted) fail(`No version of ${app.name} for ${system} is being prepared: the latest is ${say(versions[0])}. Name the next one and it is created: --version <number>`);
  if (!/^\d+(\.\d+){0,2}$/.test(wanted)) fail(`"${wanted}" is not a version number. App Store Connect takes up to three numbers with dots between them, such as 1.3 or 2.0.1.`);
  return { id: null, number: wanted, platform, before: versions[0].id };
}

/**
 * @param {Account} account
 * @param {App} app
 * @param {Version} version
 */
export async function createVersion(account, app, version) {
  const body = { data: { type: "appStoreVersions", attributes: { platform: version.platform, versionString: version.number }, relationships: { app: { data: { type: "apps", id: app.id } } } } };
  version.id = (await apple(account, "POST", "/v1/appStoreVersions", `create version ${version.number}`, body)).data.id;
  console.log(`Created version ${version.number} of ${app.name} for ${STORE_PLATFORMS[version.platform]}.`);
}

/**
 * The languages a version's store page has. For a version a dry run would create, the ones it would start with.
 * @param {Account} account
 * @param {Version} version
 */
export const versionLanguages = (account, version) => appleList(account, `/v1/appStoreVersions/${version.id ?? version.before}/appStoreVersionLocalizations?limit=200`, `list the languages of version ${version.number}`);

/**
 * @param {Account} account
 * @param {Version} version
 * @param {string} locale A code App Store Connect has.
 * @param {Record<string, string>} [texts]
 */
export const addLanguage = async (account, version, locale, texts = {}) =>
  (await apple(account, "POST", "/v1/appStoreVersionLocalizations", `add the language ${locale}`, { data: { type: "appStoreVersionLocalizations", attributes: { locale, ...texts }, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } })).data;
