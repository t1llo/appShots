---
title: Upload to App Store Connect
description: Put a finished appShots set into App Store Connect from your Mac with an API key of your own. Each language goes into its language and each folder onto its display, in the version you are preparing or a new one. The key stays on your Mac and nothing is submitted for review.
---

The `appshots` command can put a finished set into App Store Connect for you: every language into its language, every folder onto its display, in the version you are preparing. It can make that version, and it can read and change the texts of the store page. You give it an App Store Connect API key of your own.

Two things it does not do, by design:

- **Your key never leaves your Mac.** The command reads the key file where it is, signs in to Apple with it, and talks to Apple directly. The appShots server never gets the key, its path or the sign-in. Only the issuer ID, the key ID and the path are saved, in a file on your Mac.
- **Nothing is submitted for review or released.** The command has no such step. With a key of the role Marketing, Apple would refuse it anyway. You look the version over in App Store Connect and submit it yourself.

## Make a key

You need a team key with the role **Marketing**. Only the Account Holder or an Admin of the team can make one.

1. Open [App Store Connect](https://appstoreconnect.apple.com), then **Users and Access → Integrations → App Store Connect API → Team Keys**.
2. Add a key, name it, and give it the role **Marketing**.
3. Download the key. It is a file called `AuthKey_<key id>.p8`, and Apple offers it once. Keep it outside your repositories, in `~/.appstoreconnect/private_keys` for one.
4. Note the **issuer ID** above the list of keys and the **key ID** beside the key.

**Why Marketing.** It is the smallest role that fits. A Marketing key can create a version and edit the store page: screenshots, description, keywords and the rest. It cannot submit an app for review, upload a build or release anything. App Manager and Admin keys work too, and can do more than this needs.

An individual key does not work here. It has no issuer ID.

## Save it

```bash
appshots store login --issuer 57246542-96fe-1a63-e053-0824d011072a --key-id 2X9R4HXF34 --key ~/.appstoreconnect/private_keys/AuthKey_2X9R4HXF34.p8
```

It checks the three with Apple, saves them, and lists the apps the key reaches with their bundle ids. Run it without the options and it asks for each. `--key` is the path of the file, never what is in it. Left out, the command looks for `AuthKey_<key id>.p8` in `~/.appstoreconnect/private_keys`, `~/.private_keys`, `~/private_keys` and `./private_keys`, where Apple's own tools look.

`appshots store apps` lists the apps again, and `appshots check` says whether a key is saved.

## Upload the screenshots

Look first, then do it:

```bash
appshots store push streaks --app com.example.streaks --dry-run
appshots store push streaks --app com.example.streaks
```

`streaks` is the project, and `--app` is the app's bundle id. With `--dry-run` nothing is changed, and every line says what would be: which version, which language, which display, how many files, and what they replace.

```
Streaks 2.4 for iOS
de-DE    iphone-6.9   uploaded 6 screenshots, in place of the 6 there
de-DE    iphone-6.3   uploaded 6 screenshots, in place of the 6 there
de-DE    ipad-13      uploaded 6 screenshots
en-US    iphone-6.9   unchanged, the same 6 screenshots are there
…
Nothing was submitted for review. Look the version over and submit it yourself: https://appstoreconnect.apple.com/apps/…
```

It takes the files of the last render. `--render` renders first, as `appshots pull --render` does, and `--from <folder>` takes the files of an earlier `appshots pull` instead of downloading them.

| Option | What it does |
| --- | --- |
| `--app <bundle id>` | The app. Its name or its Apple ID work too. Left out when the key reaches one app only |
| `--version <number>` | Creates this version when none is being prepared. See [Which version](#which-version) |
| `--render` | Renders the project first. This uses one of the account's renders |
| `--from <folder>` | Uploads the files of an earlier `appshots pull` |
| `--lang <codes>` | Only these languages, such as `de-DE,fr-FR` |
| `--only <devices or folders>` | Only these, such as `iphone,ipad` or `iphone-6.9,ipad-13` |
| `--add-languages` | Adds a language the store page does not have yet |
| `--dry-run` | Changes nothing and says what would be done |

### What goes where

Each folder of the [export](/docs/export#what-is-in-the-zip) goes onto its own display:

| Folder | Display in App Store Connect |
| --- | --- |
| `iphone-6.9` | iPhone with Dynamic Island (large display) |
| `iphone-6.3` | iPhone with Dynamic Island (medium display) |
| `iphone-6.5` | iPhone with Face ID (large display) |
| `iphone-6.1` | iPhone with Face ID (medium display) |
| `ipad-13` | iPad 13" display |
| `ipad-11` | iPad 11" display |
| `mac-2880` | Mac, on the macOS version of the app |

The sizes for older devices go onto their displays too, when the project exports them. For the Mac, the largest folder there is goes up.

- **A display is replaced as a whole.** The files of a folder take the place of the screenshots on that display, in the order of the slides. A display the project has no folder for is left as it is.
- **Running it again changes nothing.** A display that holds the same files in the same order is skipped.
- **A language has to exist on the store page.** A language the store page does not have is left out, and the command says so. `--add-languages` adds it. A project language of `de` goes into `de-DE` when that is the only German the store page has.
- **Mac screenshots need a macOS version.** The command never adds a platform to an app. Without a macOS version, leave them out with `--only iphone,ipad`.

### What does not go up

- **iPhone Duo screenshots.** App Store Connect's API has no display for the iPhone Duo yet. Drag the files of `iphone-duo` onto it by hand.
- **Header and search results images.** They go onto the **Header and Search Results** tab by hand. See [Header and search results](/docs/store-assets).
- **Banners.** They are not for App Store Connect.

## Which version

Screenshots and texts belong to a version of the app, and they can only be changed while that version is being prepared.

- **A version is being prepared.** The command uses it. This is the usual case.
- **None is.** The command stops and names the latest version. Add `--version 2.5` and it creates version 2.5, which starts with the languages, texts and screenshots of the one before it. That is the same as **+ Version** in App Store Connect.
- **Another one is being prepared already.** App Store Connect holds one at a time per platform. Leave out `--version` to use that one, or rename it there.

A version number is not a build number. Builds come from Xcode, and this command does not touch them.

## The texts

```bash
appshots store text --app com.example.streaks
```

prints the texts of the store page as JSON, one object per language:

```json
{
  "en-US": {
    "name": "Streaks",
    "subtitle": "Habits that stick",
    "description": "…",
    "keywords": "habit,streak,routine",
    "promotionalText": "",
    "whatsNew": "",
    "supportUrl": "https://example.com/support",
    "marketingUrl": ""
  }
}
```

Change them by handing back the same shape with the texts to change. Whatever you leave out stays as it is:

```bash
appshots store text --app com.example.streaks --set '{"en-US": {"whatsNew": "Widgets for the lock screen."}}' --dry-run
appshots store text --app com.example.streaks --set @texts.json
```

`--set` takes JSON inline, `@file.json`, or `-` for standard input. It takes `--version`, `--add-languages` and `--dry-run` as `push` does, and `--platform ios` or `--platform mac` for an app that has both. Apple's limits are checked before anything is sent: 30 characters for the name and the subtitle, 100 for the keywords, 170 for the promotional text, 4000 for the description and for what is new.

The name and the subtitle belong to the app and the rest to the version. Apple does not take a `whatsNew` for the first version of an app.

## With an agent

The [skill](/docs/skill) asks whether the finished set should go into App Store Connect. Say yes and it asks for the issuer ID, the key ID and the path of the key file, runs the dry run, shows you the plan, and uploads after your yes. It never opens the key file. Give it the path, not the contents.

The MCP tools cannot do this. They run on the server, and the key stays on your Mac.

## Where the key is kept

| | |
| --- | --- |
| The key | Where you put the `.p8` file. It is read there and never copied |
| Issuer ID, key ID and the path | `~/.config/appshots/app-store-connect.json`, readable by you only |
| Or, for one command | The environment variables `ASC_ISSUER_ID`, `ASC_KEY_ID` and `ASC_KEY_PATH`, or the options `--issuer`, `--key-id` and `--key` |

Each command signs a token that Apple takes for ten minutes and sends it to `api.appstoreconnect.apple.com` only. The pictures go to the storage address Apple names for each, without the token. To stop using a key, delete that file. To take a key's access away, revoke it under **Users and Access** in App Store Connect.

## When it does not work

| It says | What to do |
| --- | --- |
| App Store Connect did not accept the key | The issuer ID or the key ID is wrong, or the key was revoked. Run `appshots store login` again |
| App Store Connect does not let this key … | The key's role is too small, such as Developer or Sales. A key keeps the role it was made with, so make one with the role Marketing |
| No version … is being prepared | Add `--version <number>` to create the next one |
| Version … is being prepared already | Leave out `--version`, or rename the version in App Store Connect |
| … has no macOS version in App Store Connect | Add `--only iphone,ipad`, or add the macOS platform to the app there first |
| … has no such language on its store page | Add `--add-languages`, or add the language in App Store Connect |
| A file is refused by Apple | Render the project again and upload once more. The files of a render always have the size of their display |
