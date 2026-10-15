import { fail } from "../fail.mjs";
import { jsonInput } from "../tools.mjs";
import { addLanguage, apple, appleList, createVersion, plainState, STORE_OPEN, storeAccount, storeApp, storeVersion, storeVersions, versionLanguages, versionState } from "./asc.mjs";
import { STORE_PLATFORMS } from "./displays.mjs";
import { storeLocale } from "./locales.mjs";

/** The texts of a store page and how many characters each may have. The first two belong to the app, the rest to a version. */
const STORE_TEXTS = { name: 30, subtitle: 30, description: 4000, keywords: 100, promotionalText: 170, whatsNew: 4000, supportUrl: 0, marketingUrl: 0 };
const APP_TEXTS = ["name", "subtitle"];

/**
 * The texts handed to `store text --set`, refused as a whole when one of them cannot go in.
 * @param {any} texts
 * @returns {Record<string, Record<string, string>>}
 */
function checkedTexts(texts) {
  if (!texts || typeof texts !== "object" || Array.isArray(texts) || Object.keys(texts).length === 0) fail(`The texts are one object per language, as 'appshots store text' prints them: {"en-US": {"description": "...", "keywords": "..."}}`);
  const wrong = [];
  for (const [locale, fields] of Object.entries(texts)) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      wrong.push(`${locale}: not an object of texts`);
      continue;
    }
    for (const [field, value] of Object.entries(fields)) {
      const length = typeof value === "string" ? [...value].length : 0;
      if (!(field in STORE_TEXTS)) wrong.push(`${locale}: there is no text called "${field}". There are ${Object.keys(STORE_TEXTS).join(", ")}`);
      else if (typeof value !== "string") wrong.push(`${locale}: ${field} is not a text`);
      else if (STORE_TEXTS[field] > 0 && length > STORE_TEXTS[field]) wrong.push(`${locale}: ${field} has ${length} characters, and App Store Connect takes ${STORE_TEXTS[field]}`);
    }
  }
  if (wrong.length > 0) fail(`The texts cannot go in as they are:\n${wrong.map((line) => `  ${line}`).join("\n")}`);
  return texts;
}

/**
 * The platform whose version holds the texts. An app on both has two sets of them.
 * @param {import("./asc.mjs").Account} account
 * @param {import("./asc.mjs").App} app
 * @param {Record<string, string | true>} flags
 */
async function textPlatform(account, app, flags) {
  if (flags.platform !== undefined) {
    const platform = { ios: "IOS", mac: "MAC_OS", macos: "MAC_OS" }[String(flags.platform).toLowerCase()];
    if (!platform) fail("--platform needs ios or mac.");
    return platform;
  }
  const versions = await appleList(account, `/v1/apps/${app.id}/appStoreVersions?limit=200`, `list the versions of ${app.name}`);
  const has = (platform) => versions.some((version) => version.attributes?.platform === platform);
  if (has("IOS") && has("MAC_OS")) fail(`${app.name} has an iOS and a macOS version, each with texts of its own. Say which: --platform ios or --platform mac`);
  return has("MAC_OS") ? "MAC_OS" : "IOS";
}

/**
 * The app's own page, which holds the name and the subtitle. While a version is being prepared there are two, and it is the new one.
 * @param {import("./asc.mjs").Account} account
 * @param {import("./asc.mjs").App} app
 */
async function appInfo(account, app) {
  const infos = await appleList(account, `/v1/apps/${app.id}/appInfos?limit=200`, `read the page of ${app.name}`);
  const state = (info) => info.attributes?.state ?? info.attributes?.appStoreState ?? "";
  return infos.find((info) => STORE_OPEN.has(state(info))) ?? infos.find((info) => !/^READY_FOR_(DISTRIBUTION|SALE)$/.test(state(info))) ?? infos[0] ?? null;
}

/**
 * @param {import("./asc.mjs").Account} account
 * @param {any} info
 */
const appNames = async (account, info) => (info ? appleList(account, `/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`, "read the names and subtitles") : []);

/** @param {Record<string, string | true>} flags */
export async function storeText(flags) {
  if (flags.set === true) fail("--set needs the texts as JSON: inline, @file.json, or - for stdin.");
  // What is wrong with the texts is said before Apple is asked anything.
  const texts = flags.set === undefined ? null : checkedTexts(jsonInput(flags.set, "The texts are"));
  const dry = Boolean(flags["dry-run"]);
  const account = storeAccount(flags);
  const app = await storeApp(account, flags.app);
  const platform = await textPlatform(account, app, flags);
  const system = STORE_PLATFORMS[platform];

  if (!texts) {
    if (flags.version === true) fail("--version needs a number, such as --version 1.3.");
    const versions = await storeVersions(account, app, platform);
    // The version being prepared, as that is the one the texts can be changed in. Without one, the latest.
    const version = typeof flags.version === "string" ? versions.find((entry) => entry.attributes.versionString === flags.version.trim()) : (versions.find((entry) => STORE_OPEN.has(versionState(entry))) ?? versions[0]);
    if (!version) fail(typeof flags.version === "string" ? `${app.name} has no version ${flags.version} for ${system}.` : `${app.name} has no ${system} version in App Store Connect.`);
    const [languages, names] = await Promise.all([versionLanguages(account, { id: version.id, number: version.attributes.versionString, platform }), appInfo(account, app).then((info) => appNames(account, info))]);
    const page = {};
    for (const language of languages) {
      const name = names.find((entry) => entry.attributes.locale === language.attributes.locale);
      page[language.attributes.locale] = Object.fromEntries(Object.keys(STORE_TEXTS).map((field) => [field, (APP_TEXTS.includes(field) ? name?.attributes[field] : language.attributes[field]) ?? ""]));
    }
    // The note goes to the error stream, so that the output is the JSON alone and can be saved to a file.
    console.error(`${app.name} ${version.attributes.versionString} for ${system}, ${plainState(versionState(version))}`);
    return console.log(JSON.stringify(page, null, 2));
  }

  const version = await storeVersion(account, app, platform, flags);
  const languages = await versionLanguages(account, version);
  const codes = languages.map((entry) => entry.attributes.locale);
  const found = Object.fromEntries(Object.keys(texts).map((locale) => [locale, storeLocale(locale, codes, { primary: app.primaryLocale })]));
  // Either every language goes in or none does: a text left out without a word would be worse than a refusal.
  const unclear = Object.keys(texts).filter((locale) => !found[locale].listed && found[locale].others);
  if (unclear.length > 0) fail(`The store page of version ${version.number} has ${unclear.map((locale) => found[locale].others.join(" and ")).join(", ")}, and ${unclear.join(", ")} could be either. Give the texts under the code of the one they are for; nothing was changed.`);
  const absent = Object.keys(texts).filter((locale) => !found[locale].listed);
  if (absent.length > 0 && !flags["add-languages"]) fail(`The store page of version ${version.number} has no ${absent.join(", ")}. It has ${codes.join(", ")}. --add-languages adds a language; nothing was changed.`);
  const unknown = absent.filter((locale) => !found[locale].code);
  if (unknown.length > 0) fail(`App Store Connect has no language ${unknown.join(", ")}, so it cannot be added. Give the texts under a code it has, such as en-US or de-DE; nothing was changed.`);
  /** @param {string} locale */
  const code = (locale) => /** @type {string} */ (found[locale].code);

  if (dry) console.log("Dry run: nothing is changed.");
  if (!version.id && !dry) await createVersion(account, app, version);
  else console.log(`${app.name} ${version.number} for ${system}${version.id ? "" : ": this version would be created, with the texts of the one before it"}`);
  // A version made just now has languages of its own, copied from the one before it.
  const current = version.before && !dry ? await versionLanguages(account, version) : languages;

  const changed = {};
  const own = (fields, ofApp) => Object.fromEntries(Object.entries(fields).filter(([field]) => APP_TEXTS.includes(field) === ofApp));
  const differing = (fields, now) => Object.keys(fields).filter((field) => (now?.attributes[field] ?? "") !== fields[field]);
  for (const [locale, fields] of Object.entries(texts)) {
    const language = current.find((entry) => entry.attributes.locale === code(locale));
    const mine = own(fields, false);
    const fresh = differing(mine, language);
    changed[code(locale)] = fresh;
    if (dry) continue;
    if (!language) await addLanguage(account, version, code(locale), mine);
    else if (fresh.length > 0) await apple(account, "PATCH", `/v1/appStoreVersionLocalizations/${language.id}`, `set the texts of ${code(locale)}`, { data: { type: "appStoreVersionLocalizations", id: language.id, attributes: Object.fromEntries(fresh.map((field) => [field, mine[field]])) } });
  }
  // Names and subtitles come after the languages, because a language added to a version gets its entry here from Apple.
  if (Object.values(texts).some((fields) => Object.keys(own(fields, true)).length > 0)) {
    const info = await appInfo(account, app);
    if (!info) fail(`App Store Connect shows no page for ${app.name} to put a name or subtitle on.`);
    const names = await appNames(account, info);
    for (const [locale, fields] of Object.entries(texts)) {
      const mine = own(fields, true);
      const onName = storeLocale(locale, names.map((each) => each.attributes.locale), { primary: app.primaryLocale });
      const name = names.find((entry) => entry.attributes.locale === (onName.listed ? onName.code : code(locale)));
      const fresh = differing(mine, name);
      changed[code(locale)].push(...fresh);
      if (dry || fresh.length === 0) continue;
      if (name) await apple(account, "PATCH", `/v1/appInfoLocalizations/${name.id}`, `set the name and subtitle of ${code(locale)}`, { data: { type: "appInfoLocalizations", id: name.id, attributes: Object.fromEntries(fresh.map((field) => [field, mine[field]])) } });
      else await apple(account, "POST", "/v1/appInfoLocalizations", `set the name and subtitle of ${code(locale)}`, { data: { type: "appInfoLocalizations", attributes: { locale: code(locale), ...mine }, relationships: { appInfo: { data: { type: "appInfos", id: info.id } } } } });
    }
  }
  for (const [locale, fields] of Object.entries(changed)) console.log(`${locale.padEnd(8)} ${fields.length > 0 ? `${dry ? "would set" : "set"} ${fields.join(", ")}` : "unchanged"}`);
  if (dry) return console.log("Run it again without --dry-run to do it.");
  console.log(`Nothing was submitted for review. Look the version over and submit it yourself: https://appstoreconnect.apple.com/apps/${app.id}`);
}
