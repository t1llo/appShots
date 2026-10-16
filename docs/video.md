---
title: App preview videos
nav: App previews
description: Make the app preview videos of the App Store with appShots. Your Mac records the app, the server draws the captions in the style of your screenshot set, and the appshots command cuts each preview, checks it against Apple's rules and can put it into App Store Connect.
---

An app preview is a video of 15 to 30 seconds at the top of the product page. It plays muted, before the screenshots. appShots makes one for each display and each language from real recordings of your app, with a caption over each moment, in the words and the look of your screenshot set.

The work is split as it is for screenshots:

- **Your Mac records and cuts.** The `appshots` command records each moment of the app, cuts the recordings into a preview with ffmpeg, and checks the file against Apple's specification. The recordings never leave your Mac.
- **The server draws.** It draws the captions, the intro and outro cards and the background as pictures, in the project's fonts and colours and in every language. A new set of them uses one render, and asking for the same again is free.

Make the screenshot set first. A preview takes its captions, its font and its background from the project.

## What your Mac needs

| For | What it needs |
| --- | --- |
| Every preview | The `appshots` command, set up as in [Connect an agent](/docs/connect), and ffmpeg 4.3 or newer. When ffmpeg is missing, `appshots` asks before it installs it with Homebrew (`brew install ffmpeg`, about 100 MB) |
| An iPhone or iPad app | Xcode and its simulators, as for screenshots |
| A plugged-in iPhone or iPad | Xcode 27 or newer. This is experimental, and the simulator is the surer source |
| A Mac app | The Screen Recording permission for your terminal app |
| A web app | Google Chrome, Chromium, Microsoft Edge or Brave |
| Animated captions | Remotion, which is optional and has a licence of its own. See [Animated text with Remotion](#animated-text-with-remotion) |

`appshots check` says which ffmpeg it finds, whether your terminal may record the screen, and, with a device plugged in, whether this Xcode can record it.

## With an agent

Ask your agent for "an App Store preview video". The [skill](/docs/skill) runs `appshots video guide`, which prints the steps it follows, and asks you everything at once: which displays and languages, the three to five moments to show, how the app reaches each one, and whether there is music. It shows you the storyboard before it records anything, asks before it changes your app or installs anything, and uploads only when you ask.

## Quick start

In your app's folder:

```bash
appshots video init streaks
appshots video plan
appshots video record
appshots video layers
appshots video compose
```

1. `init` writes `appshots.video.json`, the plan, from the slides of the project `streaks`: the first slide's headline on the intro card, then a scene for each of up to four more slides that show a screen, named after the screenshot, with that slide's headline as its caption. It also writes `appshots-video/`, the folder the work goes into, with a `.gitignore` that keeps the large files out of Git.
2. Say in the plan how the app gets through each scene. See [Drivers](#drivers).
3. `plan` checks the plan and prints the storyboard.
4. `record` records each scene in each language.
5. `layers` has the server draw the captions and cards.
6. `compose` cuts the previews into `appshots-video/out/`, each with its poster frame and its check.

Then look at them, and put them into App Store Connect with `appshots video push`, or by hand. See [Upload to App Store Connect](#upload-to-app-store-connect).

## The plan

`appshots.video.json` holds the whole preview. Commit it with your app. `--plan <file>` makes a video command read another one, and the work then goes into `appshots-video/` beside that file.

```json
{
  "version": 1,
  "project": "streaks",
  "app": { "platform": "ios", "bundleId": "com.example.streaks" },
  "displays": ["iphone", "ipad"],
  "locales": ["en-US", "de-DE"],
  "intro": { "headline": { "slide": 1 } },
  "outro": { "lines": [{ "slide": 4, "field": "sub" }], "disclosure": ["subscription"] },
  "scenes": [
    { "id": "today", "caption": { "slide": 2 }, "launch": { "args": ["-AppshotsDemo", "today"] },
      "drive": { "uitest": "StreaksUITests/PreviewTests/testToday" }, "trim": "auto" },
    { "id": "progress", "caption": { "slide": 3 }, "drive": { "wait": 6 } },
    { "id": "share", "caption": { "en-US": "Share in one tap", "de-DE": "Mit einem Tipp teilen" }, "drive": "manual", "record": { "seconds": 8 } }
  ],
  "poster": { "scene": "today" }
}
```

`appshots video plan` reads it and prints the storyboard:

```
Storyboard of appshots.video.json: project streaks, an iPhone or iPad app.
Languages: en-US (primary), de-DE. Displays: iphone, ipad.

  Starts  Seconds  Segment   Caption (en-US)
     0.0      1.5  intro     Never miss a day  + logo
     1.1      6.0  today     Build the habit  · UI test testToday
     6.7      6.0  progress  See your progress  · plays 6 s
    12.3      8.0  share     Share in one tap  · by hand
    19.9      2.0  outro     Keep going every day  [subscription]  + logo

Length: iphone 21.9 s (estimated, nothing recorded yet), ipad 21.9 s (estimated, nothing recorded yet). The aim is 26 s; the App Store takes 15 to 30 s.
Transitions: fade, 0.4 s. Poster frame at 3.0 s.
Recording: 12 recordings to make, about 3 minutes.

Warnings:
  - iphone: the preview runs 21.9 s, and the plan aims at 26 s.
  - ipad: the preview runs 21.9 s, and the plan aims at 26 s.
```

Before anything is recorded, the lengths are estimates. The warnings name what to fix first: a scene without a drive, a preview too long or too short, cards that keep the app off the screen too long, a caption without a text in some language. `--json` prints the same as JSON.

### The whole preview

| Field | What it is |
| --- | --- |
| `version` | `1` |
| `project` | The appShots project whose captions, font and background the preview takes |
| `name` | The file name of the previews. Default `preview` |
| `app` | `platform`: `ios`, `mac` or `web`. `bundleId`: the app's bundle id. `url`: a web app's address |
| `displays` | `iphone`, `ipad`, `mac`, and for older displays `iphone-5.5`, `iphone-4.7` and `ipad-9.7`. See [Sizes](#sizes) |
| `orientation` | `portrait` (default) or `landscape`. A Mac preview is always landscape |
| `locales` | The languages, of the project's. The first is the primary one. Default: all of the project's |
| `footage` | `per-locale` (default) records the app in every language. `primary` records it in the primary language only, and the others show those recordings with their own captions |
| `captionStyle` | `panel` (default), a card in the theme's background. `shadow`, text with a soft shadow. `band`, a band the full width, which the plan warns about: Apple has turned down previews for framing around the recording |
| `fit` | How a Mac window lands in the video. `plate` (default) puts it whole on the project's background, `fill` scales it to cover the video |
| `intro` | A card before the first scene: `headline`, `logo` (default `true`) and `seconds`, 0.5 to 3, default 1.5. `false` leaves it out |
| `outro` | A card after the last scene: up to three `lines`, `logo` (default `true`), `disclosure` and `seconds`, 0.5 to 4, default 2. `false` leaves it out |
| `transition` | `type`: `fade` (default), `dissolve` or `none`. `seconds`: 0.1 to 1, default 0.4. Neighbouring parts overlap by it |
| `music` | `file`, the path of an audio file from the plan's folder, `volume` 0 to 1 (default 0.8), `start` in seconds into the file, and `fadeOut`, up to 5 s (default 1.5). Left out, the preview has a silent track |
| `scenes` | One to eight moments of the app, in order. See below |
| `poster` | The frame App Store Connect shows before the preview plays: `{ "scene": "today" }` takes it a second after that scene's caption is in, `"at"` sets seconds into the scene, and `{ "time": 3 }` seconds into the preview |
| `target` | The length the storyboard aims at, 15 to 30 s. Default 26 |

The logo on the cards is the one your slides use, or an image of the project named `logo` or `app-icon`. `disclosure` takes `iap`, `subscription` and `login`, and adds "Offers in-app purchases.", "Subscription required." or "Requires an account." to the outro. Those notices are in English only; for other languages, write the notice as one of the outro's `lines` instead, with a text for each language.

### A scene

| Field | What it is |
| --- | --- |
| `id` | Lowercase letters, digits and `-`, up to 32. The recordings are named after it |
| `caption` | `{ "slide": 2 }` for that slide's headline, with `"field": "eyebrow"` or `"sub"` for another of its lines. Or one text, or one per language. `false` for none |
| `captionPosition` | `top` (default) or `bottom` |
| `launch` | How the app starts for the scene: `args`, its launch arguments, `url`, a link it opens, and `appearance`, `light` or `dark` |
| `drive` | How the app gets through the moment. See [Drivers](#drivers) |
| `record` | `seconds`, the longest the recording runs, 1 to 60, default 12. `settle`, the seconds the app gets after it starts and before recording begins, default 1.5 |
| `trim` | The part of the recording used, as `[start, end]` in seconds. `"auto"` cuts a still start and end |
| `speed` | 1 to 2. Plays the scene faster |
| `hold` | 0 to 2 seconds the last frame stays |
| `touches` | `false` leaves out the touch rings of this scene |

A scene runs `(end - start) / speed + hold` seconds. Aim for 20 to 28 seconds in all, and for three to five scenes: a moment needs a few seconds to be followed.

## Record

```bash
appshots video record
```

It records each scene in each language on each display that has no recording yet, and starts the app in that language for each. Run it again after a change, and it records only what is missing. Then look at what it recorded:

```bash
appshots video sheet --raw
```

A wrong screen, the keyboard up, a spinner, or real people's data: record that scene again.

```bash
appshots video record --scene share --again
```

| Option | What it does |
| --- | --- |
| `--scene <ids>` | Only these scenes |
| `--lang <codes>`, `--display <keys>` | Only these languages and displays of the plan |
| `--again` | Records again what has a recording |
| `--seconds <n>` | Records each scene this long at most, 1 to 120 |
| `--manual` | You drive each scene by hand. Recording stops when you press Return |
| `--reuse-footage` | Records the primary language only, as `"footage": "primary"` does |
| `--sim [name]` | On this simulator |
| `--device [name]` | On a plugged-in iPhone or iPad |
| `--mac [app]` | A Mac app's window. `--window 1440x900` sizes it first |
| `--web <url>` | A web app's page. `--realtime` records it as it plays |

Ctrl+C stops at any moment. The scene being recorded is thrown away, the ones recorded before it are kept, and the simulator gets its status bar back.

### Where it records

**The simulator.** The usual source. An iPhone preview is recorded on the 6.9-inch iPhone simulator and an iPad preview on the 13-inch iPad, with a clean status bar, 9:41 and a full battery. In a folder with an Xcode project, the app is built once first; otherwise the plan's `bundleId` has to be installed in the simulator already.

**A plugged-in iPhone or iPad.** `--device` records the screen of a device with Xcode 27 or newer. This is experimental, and its status bar shows what the device shows. If it does not work, record the device with QuickTime Player: **File → New Movie Recording**, then pick the iPhone or iPad as the camera beside the record button. Bring the movie in with [`import`](#a-recording-made-elsewhere).

**A Mac app.** `--mac` records the app's window, without its shadow. The terminal app needs the Screen Recording permission, under **System Settings → Privacy & Security → Screen & System Audio Recording**; switch it on, then quit and reopen the terminal. `--window 1440x900` sets the window to that size in points first, which needs the Accessibility permission as well. A Mac app has a plan of its own, for the `mac` display.

**A web app.** `--web <url>`, or `url` in the plan's `app`, records the page in a browser of its own, frame by frame, so the preview plays smoothly however busy the Mac is. The browser is Chrome, Chromium, Edge or Brave, or the one `APPSHOTS_BROWSER` names. A page that plays a video or draws with WebGL needs `--realtime`, which records it as it plays.

### A recording made elsewhere

```bash
appshots video import ~/Movies/share.mov --scene share --lang de-DE --display iphone
```

takes a movie made with QuickTime Player, Xcode or anything else as the footage of a scene. `--lang` defaults to the primary language, and `--display` is needed when the plan has more than one. It is cut and scaled like a recording of its own.

## Drivers

A scene's `drive` says how the app gets through the moment while it is recorded:

| `drive` | What happens |
| --- | --- |
| `"manual"` | You use the app while it records. Recording stops when you press Return, or after `record.seconds`. Needs you at the Terminal |
| `{ "wait": 6 }` | The app plays something by itself, such as a demo started by a launch argument, for that many seconds |
| `{ "uitest": "StreaksUITests/PreviewTests/testToday" }` | A UI test method, built once and run against the simulator. `"scheme"` names the scheme when the project has several |
| `{ "command": ["maestro", "test", "flows/today.yaml"] }` | Any command, run from the plan's folder |
| `{ "web": [ … ] }` | Steps on a web app's page: `{ "goto": "/today" }`, `{ "click": "#new" }`, `{ "type": ["#title", "Read"] }`, `{ "scroll": 400 }`, `{ "hover": ".chart" }`, `{ "wait": 1 }` |

A command finds what it drives in its environment: `APPSHOTS_LOCALE`, `APPSHOTS_DISPLAY`, `APPSHOTS_SCENE`, `APPSHOTS_UDID` on a simulator, `APPSHOTS_TOUCH_LOG`, and `APPSHOTS_START`, the moment it started in milliseconds since 1970.

The quickest app to record is one that fills itself with sample data in a debug build: a launch argument such as `-AppshotsDemo today`, read only under `#if DEBUG`. Use made-up names, messages and figures, never real people's.

### Touches

The simulator records no touches. A driver can say where it tapped, and the preview shows a ring there: it prints a line `APPSHOTS_TOUCH <ms> <x> <y>`, or adds it to the file `$APPSHOTS_TOUCH_LOG`. `ms` counts from the driver's start, and `x` and `y` are points on an iPhone or iPad, the window's points on a Mac and CSS pixels on the web. In a UI test, tap with this instead of `tap()`:

```swift
extension XCUIElement {
  func appshotsTap(since start: Date) {
    print("APPSHOTS_TOUCH \(Int(Date().timeIntervalSince(start) * 1000)) \(Int(frame.midX)) \(Int(frame.midY))")
    tap()
  }
}
```

Set `let start = Date()` as the test's first line, then tap with `app.buttons["Share"].appshotsTap(since: start)`.

## Captions and languages

A caption taken from a slide, as `{ "slide": 2 }`, has that slide's text in every language of the project, so translating the slides translates the preview. A text written into the plan has to name each language, as `{ "en-US": "…", "de-DE": "…" }`. A language without a text shows the primary language's, and `plan` and `layers` say so.

`footage` decides what changes from one language to the next:

- **`per-locale`**, the default: every language is recorded on its own, with the app in that language. The preview matches the store page, and recording takes as long again for each language.
- **`primary`**: the app is recorded once, in the primary language, and every other language shows those recordings under its own captions. Much quicker, but the app's own text stays in the primary language.

`appshots video plan` says how long recording takes. A preview set in a dozen languages can take an hour of recording in `per-locale`.

## Music

appShots ships no music and suggests none. A preview without `music` has a silent stereo track, which App Store Connect asks for. To add music, use a file you have the right to use on the App Store, put its path into the plan, and the compose cuts it to the preview's length, fades it in and out and sets its volume. The app's own sound is not recorded.

## Layers

```bash
appshots video layers
```

asks the server to draw, for each display, everything that goes over and around the recordings: the background, each caption in each language, the intro and outro cards, and the touch ring. They are drawn in the project's theme, and fetched into `appshots-video/layers/`. A new set uses one of the account's renders. A set drawn before, with the same words, size and style, is free. Each project keeps its three newest sets on the server.

It warns about a caption it had to shrink to fit, a text missing in a language, and a missing logo. Fix the slide or the plan, and run it again. The compose fetches the layers by itself when they are missing.

## Compose

```bash
appshots video compose
```

cuts the previews, one per language and display:

```
appshots-video/out/en-US/iphone/preview.mp4
appshots-video/out/en-US/iphone/preview.poster.png
appshots-video/out/en-US/iphone/preview.check.json
```

Each scene is trimmed, sped up and laid under its caption, the cards and transitions go between them, the music under it all, and the file is encoded to Apple's specification: H.264 at 30 frames a second, with an AAC stereo track. The poster frame is taken and the file is checked.

| Option | What it does |
| --- | --- |
| `--lang <codes>`, `--display <keys>` | Only these languages and displays |
| `--draft` | Quicker, at a lower quality, for a first look. `push` does not take a draft |
| `--jobs <n>` | How many scenes are cut at once. Default: half the Mac's cores, four at most |
| `--engine remotion` | Draws the captions and cards with Remotion. See [Animated text with Remotion](#animated-text-with-remotion) |

A preview outside 15 to 30 seconds is not written: the compose says how much to cut or add.

## Check

```bash
appshots video check
appshots video check ~/Movies/preview.mp4 --display iphone
```

checks the plan's previews, or any video, against Apple's specification for app previews. Each rule is one line: `OK`, `warning` or `error`.

```
appshots-video/out/en-US/iphone/preview.mp4: iphone, 886x1920, 21.90 s
  OK       video stream    1
  OK       codec           h264
  OK       profile         High
  OK       level           4.0
  …
  OK       frame rate      30/1
  OK       frames          657
  OK       length          21.90 s
  OK       file size       29.9 MB
  OK       audio track     1 track
  …
  OK       colour tags     bt709, bt709, bt709
  OK       index first     before the media
  OK       audio length    0.000 s apart
Every rule passes.
```

| An error | Apple's rule |
| --- | --- |
| codec, profile, level | H.264 High, Main or Baseline profile, level 4.0 or lower; or ProRes 422 HQ in a `.mov` |
| pixel format, scan, pixel shape | 4:2:0, progressive, square pixels |
| size | Exactly the size of a display. See [Sizes](#sizes) |
| frame rate, frames | 30 frames a second, constant |
| length | 15 to 30 seconds |
| file size | 500 MB at most |
| audio track | One stereo AAC track at 44.1 or 48 kHz, silent if need be |

Warnings point at what passes but is worth a look: a length close to 30 seconds, a video bitrate outside 8 to 14 Mbps, missing BT.709 colour tags, an index at the end of the file, cards longer than four seconds, the app first seen after two seconds, a caption shrunk a lot or shown in another language, and more than three previews for one display. The command ends with 1 when a file has an error, and `--json` prints the result as JSON.

## Poster and contact sheet

The poster frame is the still App Store Connect shows before the preview plays. It should be a screen of the app, not a card. To take another:

```bash
appshots video poster --at 4.5
```

It takes the frame at 4.5 seconds of each preview, writes `preview.poster.png`, and keeps the time for `push`, which hands it to App Store Connect. Give a file to take it from that video only.

```bash
appshots video sheet
appshots video sheet --raw --scene share
```

makes a contact sheet, a picture every second, of each preview: the quickest way to look one over. `--raw` makes one of each language's recordings instead, `--every 2` takes a picture every two seconds, and a file makes one of that video.

## Sizes

| Display | Size | Goes onto, in App Store Connect |
| --- | --- | --- |
| `iphone` | 886 × 1920, or 1920 × 886 in landscape | iPhone with Dynamic Island (large display) |
| `ipad` | 1200 × 1600, or 1600 × 1200 | iPad 13" display |
| `mac` | 1920 × 1080 | Mac, on the macOS version of the app |
| `iphone-5.5` | 1080 × 1920, or 1920 × 1080 | iPhone with Home Button (large display) |
| `iphone-4.7` | 750 × 1334, or 1334 × 750 | iPhone with Home Button (medium display) |
| `ipad-9.7` | 900 × 1200, or 1200 × 900 | iPad 9.7" display |

App Store Connect shows the preview of the largest display on the smaller ones of the same kind, so an `iphone` and an `ipad` preview cover today's devices. The older sizes are for an app that wants a preview of its own on those displays.

## Upload to App Store Connect

```bash
appshots video push --dry-run
appshots video push
```

puts each preview onto the store page of its language, in the version you are preparing, with the same key as [`appshots store`](/docs/app-store-connect#app-previews). It uploads each file once, waits while Apple processes it, places it, and sets the poster frame. Nothing is submitted for review or released.

| Option | What it does |
| --- | --- |
| `--app <bundle id>` | The app. Left out when the key reaches one app only |
| `--version <number>` | Stops unless this is the version being prepared. It never creates one |
| `--lang <codes>`, `--display <keys>` | Only these. `--lang en=en-GB` puts the `en` preview onto the `en-GB` page |
| `--replace` | Takes off appShots' own earlier upload of the same preview and puts the new one in its place |
| `--dry-run` | Changes nothing and says what would be done |
| `--no-wait` | Stops once the files are uploaded. `--resume` places them later, without uploading again |

See [App previews](/docs/app-store-connect#app-previews) for what it changes and what it leaves alone.

To upload by hand instead, drag each `preview.mp4` onto its display under **Previews and Screenshots** of the version, in its language.

## Animated text with Remotion

The captions and cards above fade in and out. To have them slide, spring and type themselves in, appShots can write a [Remotion](https://www.remotion.dev) project into your repository and compose with it.

**Remotion's licence.** Remotion is not open source, and appShots does not include it. It is free for individuals, for companies of up to three people and for non-profits. A larger company needs a Remotion Company License, paid per seat or per render: see [remotion.pro/license](https://remotion.pro/license). When you set it up, Remotion is installed from npm into your repository, under its own licence, and the first render downloads Chrome Headless Shell, about 170 MB.

```bash
appshots video remotion
```

shows that licence first and goes on only after your yes. An agent shows it to you and asks, and runs `appshots video remotion --yes` only after you agreed in the chat. It writes the project into `appshots-video/remotion/`, installs it there, and offers Remotion's own skills for coding agents. `--no-install` writes the files only.

```bash
appshots video compose --engine remotion
```

then draws each preview with that project, and encodes and checks it as the compose does without it. The project's `README.md` says which file draws what. The files are yours to change, and appShots leaves your changes alone; `appshots video remotion --again` brings them back to the template, after showing what changes and asking. That is a question apart from the licence: an agent shows you the list in the chat, and runs `appshots video remotion --yes --again --replace` only after you agreed to lose those changes.

## What App Review accepts

Apple reviews previews by guideline 2.3.4. In short:

- **Only the app.** Real recordings of the app as it is, captions over them, and cards at the start and end. No hands, no devices around the recording, no frames, no footage of other things.
- **No prices, dates or rankings in the captions**, and no "free". When the app has in-app purchases, a subscription or needs an account, say so: `"disclosure"` in the outro.
- **Made-up data only**, and music you have the right to use.
- **The first seconds count.** Previews play muted and loop, so the app should show within two seconds, the poster should be a screen of the app, and the captions carry the message.
- **Up to three previews** per display and language.

See [What App Review accepts](/docs/app-review#app-previews).

## Files

```
appshots.video.json                       the plan: commit it
appshots-video/
  .gitignore                              keeps the large folders below out of Git
  raw/<display>/<language>/<scene>.mov    the recordings, each with a <scene>.json beside it
  work/                                   cut scenes and other files on the way
  layers/<set>/                           the layers the server drew
  out/<language>/<display>/preview.mp4    the previews, with their posters and checks
  remotion/                               only after 'appshots video remotion'
```

Every command of the video steps is in [The appshots command](/docs/cli#app-preview-videos).
