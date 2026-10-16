import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../config.mjs";
import { fail } from "../fail.mjs";
import { fetchExport } from "../pull.mjs";
import { pause, pool } from "../util.mjs";
import { addLanguage, apple, appleList, createVersion, sendParts, storeAccount, storeApp, storeVersion, versionLanguages } from "./asc.mjs";
import { STORE_BY_HAND, STORE_DISPLAYS, STORE_PLATFORMS, platformOf } from "./displays.mjs";
import { ascLocale, sameLanguage, storeLocale } from "./locales.mjs";

/** How many screenshots go to Apple at once. More only meets "too many requests" sooner. */
const SENDS = 3;

/**
 * @param {Record<string, string | true>} flags
 * @param {string} name
 * @param {string} example
 */
export function listFlag(flags, name, example) {
  if (flags[name] === undefined) return null;
  if (typeof flags[name] !== "string") fail(`--${name} needs a value, such as --${name} ${example}.`);
  return flags[name]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The size a PNG says it has, from its first bytes. Null for a file that is no PNG.
 * @param {string} file
 */
function pngSize(file) {
  const head = Buffer.alloc(24);
  const fd = openSync(file, "r");
  let read = 0;
  try {
    read = readSync(fd, head, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  if (read < 24 || head.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/**
 * The languages --lang picks out of the files, and the store languages it puts them onto. `en=en-GB` puts the
 * folder en onto en-GB; `en-US,en-GB` puts it onto both; a plain `de` only picks.
 * @param {Record<string, string | true>} flags
 */
export function languageFlag(flags) {
  const entries = listFlag(flags, "lang", "de-DE,fr-FR");
  if (!entries) return null;
  return entries.map((entry) => {
    const [from, to, more] = entry.split("=").map((part) => part.trim());
    if (more !== undefined || !from || to === "") fail(`--lang takes codes, or a code of the files with the store language it goes onto, as in: --lang en=en-GB`);
    if (to === undefined) return { from, to: null };
    const code = ascLocale(to);
    if (!code) fail(`App Store Connect has no language "${to}". It has the codes the Studio offers under Languages, such as en-GB or de-DE.`);
    return { from, to: code };
  });
}

/**
 * What a folder of 'appshots pull' holds for the store: per language, the files of each folder that has a display
 * in App Store Connect, in the order of their names. Banners and the header and search results images are not
 * screenshots, so they are not among them.
 * @param {string} root
 * @param {Record<string, string | true>} flags
 */
export function exportSets(root, flags) {
  const folders = (dir) => readdirSync(dir).filter((name) => !name.startsWith(".") && statSync(path.join(dir, name)).isDirectory());
  const order = Object.keys(STORE_DISPLAYS);
  const languages = languageFlag(flags);
  const only = listFlag(flags, "only", "iphone,ipad");
  for (const part of only ?? []) {
    if (part in STORE_BY_HAND || part === "duo") fail(`App Store Connect's API has no display for the ${STORE_BY_HAND["iphone-duo"]} yet, so its screenshots go in by hand.`);
    if (!["iphone", "ipad", "mac"].includes(part) && !(part in STORE_DISPLAYS)) fail(`--only takes iphone, ipad, mac, or folders of the export: ${order.join(", ")}.`);
  }
  const sets = [];
  const byHand = new Set();
  /** @type {Map<string, string[]>} The store languages a folder goes onto, where --lang names them. */
  const targets = new Map();
  let creatives = false;
  const found = folders(root).sort();
  for (const locale of found) {
    const picked = languages?.filter((entry) => sameLanguage(entry.from, locale));
    if (languages && picked?.length === 0) continue;
    // A code that names a region the folder does not, such as en-GB for en, says where it goes.
    const onto = (picked ?? []).map((entry) => entry.to ?? (entry.from.includes("-") && !locale.includes("-") ? entry.from : null)).filter(Boolean);
    if (onto.length > 0) targets.set(locale, [...new Set(onto)]);
    const taken = new Set();
    for (const target of folders(path.join(root, locale)).sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      if (target === "creative-assets") creatives = true;
      if (target in STORE_BY_HAND && !only) byHand.add(target);
      const [display, width, height] = STORE_DISPLAYS[target] ?? [];
      if (!display || taken.has(display) || (only && !only.some((part) => target === part || target.startsWith(`${part}-`)))) continue;
      const dir = path.join(root, locale, target);
      const files = readdirSync(dir)
        .filter((name) => /\.(png|jpe?g)$/i.test(name) && !name.startsWith("."))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((name) => path.join(dir, name));
      if (files.length === 0) continue;
      if (files.length > 10) fail(`${dir} holds ${files.length} screenshots, and App Store Connect takes ten per display.`);
      // A picture of another size would be refused by Apple after the ones it replaces are gone, so it is caught here.
      for (const file of files) {
        const size = pngSize(file);
        if (size && (size.width !== width || size.height !== height)) fail(`${file} is ${size.width} x ${size.height}, and the pictures of ${target} are ${width} x ${height}. Nothing was changed.`);
      }
      taken.add(display);
      sets.push({ locale, target, display, files });
    }
  }
  const missing = (languages ?? []).map((entry) => entry.from).filter((code) => !found.some((locale) => sameLanguage(code, locale)));
  if (missing.length > 0) fail(`There is no language ${missing.join(", ")} among the files. They hold: ${found.join(", ") || "none"}.`);
  if (sets.length > 0) return { sets, byHand: [...byHand], creatives, targets };
  if (found.some((name) => name in STORE_DISPLAYS)) fail(`${root} holds the folders of one language. --from takes the folder above it, the one with a folder per language.`);
  fail(only ? `Nothing among the files is for ${only.join(", ")}.` : byHand.size > 0 ? `The files hold screenshots for the ${STORE_BY_HAND["iphone-duo"]} only, and App Store Connect's API has no display for it yet. They go in by hand.` : `There are no store screenshots in ${root}. Render the project first: --render does it.`);
}

/**
 * Sends one file where Apple says and tells it the file is there. Returns the screenshot's id.
 * @param {import("./asc.mjs").Account} account
 * @param {string} set
 * @param {string} file
 * @param {Buffer} data What is in the file, read once for its checksum and for this.
 * @param {string} checksum
 */
async function uploadScreenshot(account, set, file, data, checksum) {
  const name = path.basename(file);
  const body = { data: { type: "appScreenshots", attributes: { fileName: name, fileSize: data.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set } } } } };
  const reserved = (await apple(account, "POST", "/v1/appScreenshots", `take ${name}`, body)).data;
  await sendParts(reserved.attributes?.uploadOperations ?? [], (offset, length) => data.subarray(offset, offset + length), name, "Run the command again: it starts that display over.");
  await apple(account, "PATCH", `/v1/appScreenshots/${reserved.id}`, `finish ${name}`, { data: { type: "appScreenshots", id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: checksum } } });
  return reserved.id;
}

/**
 * Apple checks each file once it has arrived. Waits for that, three minutes at most, and returns what it refused.
 * @param {import("./asc.mjs").Account} account
 * @param {Array<{ label: string, set: string, names: Map<string, string> }>} uploads
 */
async function settle(account, uploads) {
  const state = (shot) => shot.attributes?.assetDeliveryState?.state;
  const refused = [];
  const until = Date.now() + 180000;
  let waiting = uploads;
  while (waiting.length > 0) {
    // Each display is asked at the same time; the answers are gone through in the order of the displays.
    const answers = await Promise.all(waiting.map((upload) => appleList(account, `/v1/appScreenshotSets/${upload.set}/appScreenshots?limit=200`, "check the uploads")));
    const still = [];
    for (const [at, upload] of waiting.entries()) {
      const shots = answers[at].filter((shot) => upload.names.has(shot.id));
      if (shots.some((shot) => state(shot) !== "COMPLETE" && state(shot) !== "FAILED")) {
        still.push(upload);
        continue;
      }
      for (const shot of shots.filter((entry) => state(entry) === "FAILED")) {
        const why = (shot.attributes.assetDeliveryState.errors ?? []).map((error) => error.description || error.code).filter(Boolean).join(" ");
        refused.push(`${upload.label}  ${upload.names.get(shot.id)}: ${why || "refused without a reason"}`);
      }
    }
    waiting = still;
    if (waiting.length === 0 || Date.now() > until) break;
    await pause(3000);
  }
  return { refused, late: waiting.reduce((sum, upload) => sum + upload.names.size, 0) };
}

/** @param {number} count */
const screenshots = (count) => `${count} ${count === 1 ? "screenshot" : "screenshots"}`;

/**
 * @param {string | undefined} project
 * @param {Record<string, string | true>} flags
 */
export async function storePush(project, flags) {
  if (flags.from === true || (!project && flags.from === undefined)) {
    fail("Usage: appshots store push <project> --app <bundle id> [--version <number>] [--render] [--from <folder>] [--lang <codes>] [--only <devices or folders>] [--add-languages] [--dry-run]");
  }
  const dry = Boolean(flags["dry-run"]);
  const account = storeAccount(flags);
  // The key and the app are settled before anything is rendered or downloaded.
  const app = await storeApp(account, flags.app);

  let root;
  if (typeof flags.from === "string") {
    root = path.resolve(flags.from);
    if (!existsSync(root) || !statSync(root).isDirectory()) fail(`No such folder: ${root}`);
  } else {
    // A folder of its own each time, so that no file of an earlier render goes along with this one's.
    const dir = mkdtempSync(path.join(tmpdir(), "appshots-store-"));
    root = dir;
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    await fetchExport(loadConfig(), /** @type {string} */ (project), root, flags.render);
  }
  const { sets, byHand, creatives, targets } = exportSets(root, flags);

  // Every version is found before one is created, so a set for two platforms does not stop half way.
  const versions = [];
  for (const platform of new Set(sets.map((set) => platformOf(set.display)))) versions.push(await storeVersion(account, app, platform, flags));

  // Which language of the store page each folder goes onto is settled for every version before anything changes,
  // so a language App Store Connect does not have stops the push before it starts and not half way through.
  const notes = [];
  const choices = [];
  let skipped = 0;
  const plans = [];
  for (const version of versions) {
    const listed = await versionLanguages(account, version);
    const codes = listed.map((entry) => entry.attributes.locale);
    const mine = sets.filter((set) => platformOf(set.display) === version.platform);
    const onto = [];
    const seen = new Map();
    const system = STORE_PLATFORMS[version.platform];
    for (const locale of new Set(mine.map((set) => set.locale))) {
      for (const to of targets.get(locale) ?? [undefined]) {
        const found = storeLocale(locale, codes, { primary: app.primaryLocale, to });
        if (!found.listed && found.others) {
          notes.push(`${locale}: version ${version.number} for ${system} has ${found.others.join(" and ")}, and either could be meant. Say which with --lang ${locale}=${found.others[0]}.`);
          skipped++;
          continue;
        }
        if (!found.listed && !flags["add-languages"]) {
          const as = found.code && found.code !== locale ? ` as ${found.code}` : "";
          notes.push(`${locale}: version ${version.number} for ${system} has no such language on its store page. It has ${codes.join(", ")}. --add-languages adds it${as}.`);
          skipped++;
          continue;
        }
        if (!found.code) fail(`${locale} is not a language App Store Connect has, so it cannot be added there. Put its screenshots onto one it has with --lang ${locale}=<code>, such as --lang ${locale}=en-US. Nothing was changed.`);
        const code = found.code;
        if (seen.has(code)) fail(`${seen.get(code)} and ${locale} would both go onto ${code}. Leave one out with --lang. Nothing was changed.`);
        seen.set(code, locale);
        if (code !== locale) choices.push(`${locale} goes onto ${code}${found.others ? `; the store page has ${found.others.join(" and ")} as well, which --lang ${locale}=${found.others[0]} picks` : ""}`);
        onto.push({ locale, code });
      }
    }
    plans.push({ version, listed, mine, onto });
  }

  if (dry) console.log("Dry run: nothing is changed.");
  for (const version of versions) {
    if (!version.id && !dry) await createVersion(account, app, version);
    else console.log(`${app.name} ${version.number} for ${STORE_PLATFORMS[version.platform]}${version.id ? "" : ": this version would be created, with the languages and screenshots of the one before it"}`);
  }
  for (const line of new Set(choices)) console.log(line);

  const uploads = [];
  let unchanged = 0;
  for (const plan of plans) {
    const { version, mine } = plan;
    // A version made just now has languages of its own, copied from the one before it.
    const listed = version.before && !dry ? await versionLanguages(account, version) : plan.listed;
    for (const { locale, code } of plan.onto) {
      let language = listed.find((entry) => entry.attributes.locale === code);
      if (!language) {
        if (!dry) language = await addLanguage(account, version, code);
        console.log(`${code}  ${dry ? "would be added" : "added"} to the store page`);
      }
      const there = language ? await appleList(account, `/v1/appStoreVersionLocalizations/${language.id}/appScreenshotSets?limit=200`, `list the displays of ${code}`) : [];
      for (const set of mine.filter((entry) => entry.locale === locale)) {
        const label = `${code.padEnd(8)} ${set.target.padEnd(11)}`;
        let display = there.find((entry) => entry.attributes.screenshotDisplayType === set.display);
        const old = display ? await appleList(account, `/v1/appScreenshotSets/${display.id}/appScreenshots?limit=200`, `list the screenshots of ${code}`) : [];
        // Each file is read once, for its checksum and for the upload.
        const data = set.files.map((file) => readFileSync(file));
        const sums = data.map((bytes) => createHash("md5").update(bytes).digest("hex"));
        // The same files in the same order are left alone, so running this twice changes nothing the second time.
        if (old.length === sums.length && old.every((shot, at) => shot.attributes.sourceFileChecksum === sums[at] && !["FAILED", "AWAITING_UPLOAD"].includes(shot.attributes.assetDeliveryState?.state))) {
          console.log(`${label}  unchanged, the same ${screenshots(old.length)} are there`);
          unchanged += old.length;
          continue;
        }
        const instead = old.length > 0 ? `, in place of the ${old.length} there` : "";
        if (dry) {
          console.log(`${label}  would upload ${screenshots(sums.length)}${instead}`);
          continue;
        }
        await pool(old, SENDS, (shot) => apple(account, "DELETE", `/v1/appScreenshots/${shot.id}`, "remove a screenshot"));
        display ??= (await apple(account, "POST", "/v1/appScreenshotSets", `open the display ${set.target}`, { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: set.display }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: language.id } } } } })).data;
        const ids = await pool(set.files, SENDS, (file, at) => uploadScreenshot(account, display.id, file, data[at], sums[at]));
        // Kept in a Map, which holds the order of the files whatever the ids look like.
        const names = new Map(ids.map((id, at) => [id, path.basename(set.files[at])]));
        // They were sent side by side. This makes the order on the store page the order of the slides.
        if (sums.length > 1) await apple(account, "PATCH", `/v1/appScreenshotSets/${display.id}/relationships/appScreenshots`, "put the screenshots in order", { data: ids.map((id) => ({ type: "appScreenshots", id })) });
        uploads.push({ label, set: display.id, names });
        console.log(`${label}  uploaded ${screenshots(sums.length)}${instead}`);
      }
    }
  }

  for (const target of byHand) notes.push(`${target}: App Store Connect's API has no display for the ${STORE_BY_HAND[target]} yet. Drag those files onto it by hand.`);
  if (creatives) notes.push("The header and search results images are not uploaded. They go onto the Header and Search Results tab by hand.");
  const sent = uploads.reduce((sum, upload) => sum + upload.names.size, 0);
  if (sent > 0) {
    console.log("Waiting for Apple to check them...");
    const { refused, late } = await settle(account, uploads);
    for (const line of refused) console.log(`  ! ${line}`);
    if (late > 0) console.log(`  ! Apple is still checking ${screenshots(late)}. They show in App Store Connect when it is done.`);
    if (refused.length > 0) process.exitCode = 1;
    console.log(`${screenshots(sent)} uploaded${refused.length > 0 ? `, ${refused.length} of them refused by Apple` : ""}${unchanged > 0 ? `, ${unchanged} were there already` : ""}.`);
  } else if (!dry) {
    console.log(unchanged > 0 ? "Nothing to upload: App Store Connect has these screenshots already." : "Nothing was uploaded.");
  }
  for (const note of notes) console.log(`  ! ${note}`);
  // A language left out is a store page that is not what the files say, so the command does not end as if it were.
  if (skipped > 0) process.exitCode = 1;
  if (dry) return console.log("Run it again without --dry-run to do it.");
  console.log(`Nothing was submitted for review. Look the version over and submit it yourself: https://appstoreconnect.apple.com/apps/${app.id}`);
}
