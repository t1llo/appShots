---
title: The appshots command
nav: Command line
description: Reference for the appshots command line tool on the Mac. Setup, update, check, run an app in the iOS Simulator, capture and upload screens, capture a Mac app's window or a web app's pages, pull the finished set, make app preview videos, download mockups, and call the server's tools.
---

`appshots` is one small Node.js file with no dependencies. It runs your app in a simulator, captures screens from the simulator, a device, a Mac window or a web page, moves files between your Mac and the server, and can call every tool the server has. The [setup command](/docs/connect) puts it next to the skill, as `~/.claude/skills/appshots/appshots.mjs` for Claude Code or `~/.agents/skills/appshots/appshots.mjs` for the other agents. When `~/.local/bin`, `~/bin` or the folder Claude Code sits in is on your `PATH`, it also links it there as the command `appshots`. Otherwise you run it as `node ~/.claude/skills/appshots/appshots.mjs`, which is how the skill runs it anyway.

It needs Node.js 18 or newer, and the setup script says so before it starts when an older one is installed. The simulator and plugged-in devices need Xcode. A web app's pages need Chrome, Edge or Brave instead.

## Set up and keep current

| Command | What it does |
| --- | --- |
| `appshots setup <url> [--agent <agent>]` | Saves the server and your token, installs the skill and this command, and connects the agent. Agents: `claude` (the default), `codex`, `opencode`, `pi`, `other`. `--token <token>` skips the question |
| `appshots login <url>` | Saves the server address and the token only. `--token <token>` or `APPSHOTS_TOKEN` skips the question |
| `appshots update` | Brings the installed skill and this command up to date with the server's. Needs no token |
| `appshots check` | Reports the server, whether the skill is current, Xcode, the project in this folder, what it is made with and the commands that start it, simulators, installed apps and devices. Every line says what to do next. Each simulator comes with the size of its screenshots and the App Store display that size is for |

When the server has a newer skill or command than this Mac, every other command says so in one line when it is done. See [Connect an agent](/docs/connect) and [Update](/docs/update).

## Run the app

```bash
appshots run
appshots run --ipad --dark --lang de
appshots run --duo
appshots run --capture home --to streaks
```

`run` builds the Xcode project in the current folder and starts the app in a simulator. It is for iPhone and iPad apps. A Mac app runs on the Mac itself: start it your own way and use `capture --mac`. See [Mac apps](/docs/mac). An app made with Flutter, React Native, Expo, Capacitor or Tauri is started by its own command, after `appshots boot`. See [Web apps and other toolkits](/docs/web-apps).

| Option | What it does |
| --- | --- |
| `--scheme <name>` | The scheme to build, when the choice is not obvious |
| `--project <path>` | The workspace or project to build, when there are several |
| `--fresh` | Builds in a folder of its own instead of reusing Xcode's build |
| `--ipad` | On the 13-inch iPad Pro instead of the iPhone Pro Max |
| `--duo` | On the iPhone Duo instead. Needs an Xcode that has its simulator |
| `--sim <name or udid>` | On this simulator instead. It is booted if need be |
| `--create` | Creates the simulator of the store's size when none is installed and this Xcode has the model. At the Terminal, `run` and `boot` ask first; an agent passes `--create` |
| `--dark`, `--light` | Sets the simulator's appearance first |
| `--lang <code>` | Starts the app in this language, such as `de` or `pt-BR`. A screenshot taken with `--capture` is filed under that language in the project |
| `--capture <name>` | Takes the screenshot as well, with a clean status bar |
| `--to <project>` | Uploads that screenshot to this project |
| `--wait <seconds>` | How long the app gets to settle before the capture. Left out, the capture waits until the screen stops changing: up to fifteen seconds while the app has drawn nothing yet, then four at most. A screen still blank after that is taken with a warning |
| `-- <arguments>` | Handed to the app as they are, such as `-- -appshots stats` |

```bash
appshots launch com.example.streaks --capture stats --to streaks -- -appshots stats
```

`launch <bundle id>` starts an installed app again without building, to switch screen or language. It takes `--sim`, `--dark`, `--light`, `--lang`, `--capture`, `--to`, `--as` and `--wait`.

`appshots boot` boots the simulator the store sizes ask for, without building anything, and prints its udid together with the run command of the toolkit in the current folder, such as `flutter run -d <udid>`. It takes `--ipad`, `--duo`, `--sim` and `--create`.

Without `--sim`, `run` and `boot` pick the simulator whose screenshots have the size the store asks for, by the size its model takes rather than by its name: the iPhone Pro Max at 1320×2868, the iPhone Duo, or the 13-inch iPad Pro at 2064×2752. A newer iOS goes first, then a newer model. When none is installed, they say so and use the closest one.

`appshots simctl <arguments>` runs `xcrun simctl` with the right Xcode, for `openurl`, `ui`, `privacy` and `push`.

## Capture

| Command | What it does |
| --- | --- |
| `appshots devices` | Lists booted simulators and connected devices |
| `appshots capture` | Takes one screenshot |
| `appshots shoot <project> <names…>` | Names each screen in turn, waits for Return while you open it, then captures and uploads |
| `appshots shoot --plan [file]` | Takes every screen of a [capture plan](#capture-plans) unattended, and uploads them |

Options of `capture`, which `shoot` takes too:

| Option | What it does |
| --- | --- |
| `--name <name>` | The name slides refer to. Default: a timestamp |
| `--sim [name or udid]` | From a booted simulator. This is the default |
| `--device [name or udid]` | From a connected, unlocked iPhone or iPad. Needs Xcode 27 or newer |
| `--mac <app>` | From a Mac app running on this Mac: its frontmost window, without the shadow. `<app>` is the app's name. The terminal needs the Screen Recording permission. See [Mac apps](/docs/mac) |
| `--web <address>` | From a web app: the page at this address, drawn by Chrome without a window at the size of an iPhone. `--as ipad`, `--as mac` and `--as duo` draw it at those sizes. Not for `shoot`. See [Web apps and other toolkits](/docs/web-apps) |
| `--clean` | Simulator only: shows 9:41, full battery and full signal |
| `--project <id>` | Uploads it to this project straight away. `--to` works too |
| `--as <iphone, duo, ipad or mac>` | Files it under this device. Only needed when the server cannot tell from the size. `upload`, `run` and `launch` take it too |
| `--lang <code>` | The language the screenshot shows the app in, one the project has. Left out, it is for the project's first language. See [Languages](/docs/languages#screenshots-per-language) |
| `--out <dir>` | Where the PNG is saved. Default `./raw-shots` |

With `--web`:

| Option | What it does |
| --- | --- |
| `--dark`, `--light` | The colour scheme the page is asked for |
| `--wait <seconds>` | Time the page gets to settle once it has loaded. Default 1 |
| `--init <script or @file>` | JavaScript that runs before the page's own on every load: sample data in `localStorage`, a fixed date |
| `--eval <script or @file>` | JavaScript that runs in the loaded page before the picture: the click or scroll that brings up the screen |
| `--viewport <width>x<height>` | The page's size in points instead of the device's |
| `--profile <dir>` | Keeps cookies and storage in this folder between captures |
| `--user-agent <text>` | The browser the page is told it is in. Left out, Safari on the device it is drawn as, or Chrome for `--as mac` |

## Capture plans

A capture plan lists an app's screens and how each one is reached. `appshots shoot --plan` takes all of them with nobody at the Terminal: on each simulator the plan asks for, in each language and appearance, and uploads them to the project. The plan is a file in the app's repository, `appshots.capture.json` next to the Xcode project unless you name another, so the next set is one command again.

```bash
appshots shoot --plan --dry-run                    # what it would take, on which simulator, and how
appshots shoot --plan                              # take it
appshots shoot --plan --only home,stats --lang de  # some screens, some languages
appshots shoot --plan --again                      # take again what the project has already
```

```json
{
  "project": "notes",
  "app": { "xcode": ".", "scheme": "Notes", "args": ["-demo"] },
  "devices": ["iphone", "ipad"],
  "locales": ["en", "de"],
  "appearances": ["light", "dark"],
  "screens": [
    { "id": "home" },
    { "id": "board", "launch": { "args": ["-tab", "board"], "url": "notes://board/sample" } },
    { "id": "share", "uitest": "NotesUITests/ScreenshotTests/testShare", "devices": ["iphone"] },
    { "id": "website", "app": "com.apple.mobilesafari", "launch": { "url": "https://appshots.example.com" } }
  ]
}
```

| Field | What it is |
| --- | --- |
| `project` | The project the screenshots go to. One named on the command line, `appshots shoot <project> --plan`, goes first |
| `app.bundleId` | The app's bundle id, for an app that is installed on the simulators already |
| `app.xcode`, `app.scheme` | The Xcode workspace or project, or the folder it is in, from the plan's folder. The plan then builds the app once, installs it on each simulator and starts it by the bundle id the build says. The scheme only where the choice is not obvious |
| `app.args` | Launch arguments the app gets on every screen, such as a demo mode |
| `devices` | The displays, one per family. `iphone`, `duo` and `ipad` are the sizes the store asks for first, and a display's own name, such as `iphone-6.5` or `ipad-11`, is that size. Each is taken on a simulator whose screenshots have its size; `{ "display": "ipad-13", "sim": "<name or udid>" }` picks the simulator. Default `["iphone"]` |
| `locales` | The languages, of those the project has. Default: all of them |
| `appearances` | `light`, `dark` or both. The second one is added to the screen's name, as in `home-dark`. Left out, the simulator stays as it is |
| `statusBar` | `clean`, the default, for 9:41 with full battery and signal, or `as-is` |
| `wait` | Seconds each screen gets before it is taken. Left out, it is taken once it stops changing: up to fifteen seconds while the app has drawn nothing yet, then four at most. A screen still blank after that is not uploaded, and counts as not taken |
| `out` | Where the PNGs are kept, as `<out>/<language>/<display>/<id>.png`. Default `raw-shots` next to the plan |
| `screens[].id` | The screenshot's name, which the slides refer to |
| `screens[].launch` | `args`, launch arguments after the app's, and `url`, a link opened once the app runs. A list on its own is `args`. A link with no app to start is opened by whatever the simulator opens it with |
| `screens[].app` | The bundle id of another app the screen is in, such as `com.apple.Preferences` |
| `screens[].uitest` | A UI test that brings the screen up, as `Target/Class/method`. See below |
| `screens[].wait`, `screens[].devices` | The screen's own wait, and the plan's displays it is taken on when not all of them |

Each launch is in the screen's language, with `-AppleLanguages` and `-AppleLocale` as `appshots launch --lang` does it. An app the screen before brought to the front is closed first when this one starts another, so the status bar shows no link back to it. A web link with no app to start comes up in Safari and is closed the same way; for another link with no app, name the app that takes it in `screens[].app` so that it is closed too. What the project has already under a screen's name, family and language is skipped, so a run that stopped half way goes on where it stopped, and a screenshot deleted in the Studio is taken again. A screen that fails does not stop the others. After three failures in a row on one simulator its remaining screens are left, and the command lists what it did not take and exits with 1. A simulator the run booted keeps running.

### Screens a UI test brings up

A screen that takes taps to reach, and no launch argument or link, can be brought up by a UI test. The plan builds the tests once and runs each one on its own with `xcodebuild test-without-building`, with `-testLanguage` set to the screen's language. The test says when the screen is up and waits while it is taken:

```swift
import XCTest

/// Lets appshots take the screenshot, and waits until it has. Does nothing outside `appshots shoot --plan`.
func appshotsReady(timeout: TimeInterval = 120) {
    guard let folder = ProcessInfo.processInfo.environment["APPSHOTS_SIGNAL"] else { return }
    FileManager.default.createFile(atPath: folder + "/ready", contents: nil)
    let end = Date().addingTimeInterval(timeout)
    while !FileManager.default.fileExists(atPath: folder + "/done") && Date() < end {
        Thread.sleep(forTimeInterval: 0.1)
    }
}

final class ScreenshotTests: XCTestCase {
    func testShare() {
        let app = XCUIApplication()
        app.launchArguments += ["-demo"]
        app.launch()
        app.buttons["Share"].tap()
        appshotsReady()
    }
}
```

`APPSHOTS_LOCALE` holds the language code too, for a test that passes it to the app itself.

### What fastlane snapshot took

```bash
appshots shoot <project> --fastlane fastlane/screenshots --dry-run
appshots shoot <project> --fastlane fastlane/screenshots
```

With `--fastlane`, nothing is captured: what fastlane snapshot wrote is uploaded instead, each language folder such as `en-US` into the project's language, and each picture into its family by its size. frameit's `_framed` pictures are left out, and where simulators of one family took the same screen, the larger display's picture is kept. With `--plan` as well, the project comes from the plan, and a picture named like `01Home` goes to the plan's screen `home`.

## Upload and download

```bash
appshots upload streaks ./screens
appshots upload streaks ./screens-de --lang de-DE
appshots upload streaks logo.svg --image
appshots pull streaks --render
```

| Command | What it does |
| --- | --- |
| `appshots projects` | Lists your projects |
| `appshots upload <project> <files or folders…>` | Uploads screenshots. The name is the file name, or `--name` for a single file. `--as duo` or `--as mac` files them under that device. `--lang de-DE` files them under that language. `--image` uploads logos and artwork instead |
| `appshots pull <project> [--out <dir>]` | Downloads the rendered set into `./store-screenshots/<project>`, one folder per display of App Store Connect, with the header and search results images and the [banners](/docs/banners). `--render` renders first. Pulling again takes out the files an earlier pull put there that the set no longer has, and leaves anything else in the folder |
| `appshots mockups <project>` | Downloads every screenshot in its device on a transparent background. See [Mockups](#mockups) |
| `appshots open [project]` | Opens the Studio in the browser |

## App Store Connect

```bash
appshots store login --issuer 57246542-96fe-1a63-e053-0824d011072a --key-id 2X9R4HXF34 --key ~/.appstoreconnect/private_keys/AuthKey_2X9R4HXF34.p8
appshots store push streaks --app com.example.streaks --dry-run
appshots store push streaks --app com.example.streaks
appshots store text --app com.example.streaks
```

These put a finished set into App Store Connect from your Mac, with an API key of your own. The key file stays where it is, nothing of it goes to the appShots server, and nothing is submitted for review. See [Upload to App Store Connect](/docs/app-store-connect).

| Command | What it does |
| --- | --- |
| `appshots store login` | Saves the issuer ID, the key ID and the path of the `.p8` file, checks them with Apple and lists the apps the key reaches. A key with the role Marketing is enough. Without the options it asks for each |
| `appshots store apps` | Lists the apps the key reaches, with their bundle ids |
| `appshots store push <project> --app <bundle id>` | Uploads the project's screenshots into the version being prepared: each language into its language, each folder onto its display, in place of what is there |
| `appshots store text --app <bundle id>` | Prints the store page's texts per language as JSON. `--set '<JSON>'`, `--set @file.json` or `--set -` writes the ones given, in that same shape. `--platform ios` or `--platform mac` for an app that has both |

| Option of `push` | What it does |
| --- | --- |
| `--version <number>` | Creates that version when none is being prepared. `text --set` takes it too |
| `--render` | Renders first, as `pull --render` does |
| `--from <folder>` | Takes the files of an earlier `appshots pull` |
| `--lang <codes>` | Only these languages, such as `de-DE,fr-FR`. `en=en-GB` puts the files of `en` onto the store page's `en-GB`; `en=en-GB,de-DE` does that and takes `de-DE` as well |
| `--only <devices or folders>` | Only these, such as `iphone,ipad` or `iphone-6.9,ipad-13` |
| `--add-languages` | Adds a language the store page does not have yet. `text --set` takes it too |
| `--dry-run` | Changes nothing and says what would be done. `text --set` takes it too |

When a project language matches several of the store page's, such as `en` with `en-US` and `en-GB`, `push` takes the app's primary language among them, or else the code App Store Connect has for it (`en-US` for `en`), and says which it took. When it cannot tell, it leaves that language out and says how to name one with `--lang en=<code>`, listing the other languages after it. A language left out makes the command end with status 1.

## App preview videos

```bash
appshots video init streaks
appshots video plan
appshots video record
appshots video layers
appshots video compose
appshots video push --dry-run
```

`appshots video` makes the app preview videos of the App Store. It records the app on your Mac, has the server draw the captions in the project's style, cuts the previews with ffmpeg and checks them against Apple's rules. The plan is `appshots.video.json` in the folder the command runs in, and the work goes into `appshots-video/` beside it. See [App preview videos](/docs/video).

| Command | What it does |
| --- | --- |
| `appshots video init [project]` | Writes the plan from the project's slides. `--display iphone,ipad` picks the displays and `--lang <codes>` the languages. `--again` writes it anew over the one there |
| `appshots video plan` | Checks the plan and prints the storyboard: each scene, its caption and its seconds, each display's length, the time recording takes, and what to fix. `--json` prints it as JSON |
| `appshots video record` | Records each scene in each language on each display that has no recording yet. See the options below |
| `appshots video import <file> --scene <id>` | Takes a recording made elsewhere, with QuickTime Player or Xcode, as a scene's footage. `--lang <code>` and `--display <key>` say whose |
| `appshots video layers` | Has the server draw the captions, cards, background and touch ring of each display. A new set uses one render; the same again is free |
| `appshots video compose` | Cuts the previews into `appshots-video/out/<language>/<display>/`, each with its poster and its check. `--draft` is quicker and cannot be uploaded, `--jobs <n>` sets how many scenes are cut at once, and `--engine remotion` draws with Remotion |
| `appshots video check [files…]` | Checks videos against Apple's specification, or the plan's previews without files. `--display <key>` names the display a file is for, and `--json` prints the result as JSON. Ends with status 1 when a file has an error |
| `appshots video sheet [file]` | A contact sheet, a picture a second, of a video or of each preview. `--raw` makes one of each language's recordings, `--scene <ids>` only of these, and `--every <seconds>` sets the step |
| `appshots video poster --at <seconds> [file]` | Takes the poster frame at that time, and keeps the time for `push` |
| `appshots video remotion` | Explains Remotion's licence, then writes a Remotion project into `appshots-video/remotion/` and installs it. `--yes` once you have agreed to the licence, `--no-install` to write the files only, `--again` to bring them back to the template, and `--replace` with it once you have agreed to lose your changes to them |
| `appshots video push` | Puts the previews into the App Store Connect version being prepared. See the options below |
| `appshots video guide` | Prints the steps an agent follows, in order |

Every one but `guide` takes `--plan <file>` for another plan, and most take `--lang <codes>` and `--display <keys>` to work on some of the plan's languages and displays only.

| Option of `record` | What it does |
| --- | --- |
| `--scene <ids>` | Only these scenes |
| `--again` | Records again what has a recording |
| `--seconds <n>` | Records each scene this long at most, 1 to 120 |
| `--manual` | You drive each scene by hand, and recording stops on Return |
| `--reuse-footage` | Records the primary language only, and shows those recordings in the others with their own captions |
| `--sim [name]` | On this simulator. Default: the 6.9-inch iPhone or the 13-inch iPad |
| `--device [name]` | On a plugged-in iPhone or iPad, with Xcode 27 or newer. Experimental |
| `--mac [app]` | A Mac app's window. `--window <width>x<height>` sizes it first |
| `--web <url>` | A web app's page, frame by frame. `--realtime` records it as it plays, for a page with video or WebGL |

| Option of `push` | What it does |
| --- | --- |
| `--app <bundle id>` | The app. Left out when the key reaches one app only |
| `--version <number>` | Stops unless this is the version being prepared. `push` never creates a version |
| `--lang <codes>` | Only these languages. `en=en-GB` puts the preview of `en` onto the store page's `en-GB` |
| `--display <keys>` | Only these displays |
| `--replace` | Takes off appShots' own earlier upload of the same preview and puts the new one in its place |
| `--dry-run` | Changes nothing and says what would be done |
| `--no-wait` | Stops once the files are uploaded, before Apple has processed them. `--resume` places them later without uploading again |

`push` uses the key `appshots store login` saved, and submits nothing for review. See [App previews](/docs/app-store-connect#app-previews).

| Environment variable | What it does |
| --- | --- |
| `APPSHOTS_FFMPEG`, `APPSHOTS_FFPROBE` | The ffmpeg and ffprobe to use, in place of the ones found on the `PATH` or in Homebrew's folders |
| `APPSHOTS_FFMPEG_STALL` | Seconds without progress after which ffmpeg is stopped. Default 30 |
| `APPSHOTS_BROWSER` | The Chromium browser that records a web app |

## Mockups

```bash
appshots mockups streaks
appshots mockups streaks --style clay --color silver --shadow soft --rotate -8
appshots mockups streaks --width 1200 --out ./website/img
```

`mockups` saves one transparent PNG per screenshot into `./mockups/<project>`, named `<screenshot>-<device>.png`. It needs no slides and uses no render. What the options set is saved with the project, so the Studio's Mockups page shows the same, and the next call without options draws them the same way. Like `pull`, a later download takes out only the mockups an earlier one saved that are gone now, so `--out` can point into a website's folder of images.

| Option | What it does |
| --- | --- |
| `--out <dir>` | Where the files go. Default `./mockups/<project>` |
| `--lang <code>` | Only this language's. Left out: the first language's, and a folder per other language for the screenshots it has of its own |
| `--style <look>` | `real`, `clay`, `outline` or `sketch` |
| `--color <colour>` | `black`, `silver`, `natural`, `gold`, `blue` or `orange` |
| `--shadow <kind>` | `none`, `soft` or `strong` |
| `--rotate <degrees>` | The tilt, such as `-8` |
| `--perspective <side>` | A 3D turn: `none`, `left` or `right` |
| `--status-bar <kind>`, `--time <9:41>` | A clean status bar (`none`, `cover` or `overlay`) and the time it shows |
| `--frame <frame>` | `none` for the bare screenshot with rounded corners |
| `--width <pixels>` | The width of each PNG. `auto`, the default, shows the screenshot pixel for pixel |

See [Mockups](/docs/mockups).

## Call the server's tools

Everything an agent can do through MCP works from the command line as well, which is how agents without MCP use appShots.

```bash
appshots tools
appshots tools set_slides
appshots call get_design_guide
appshots call render '{"project":"streaks","slides":[3]}'
appshots call set_slides @slides.json
```

Arguments are JSON: inline, `@file.json`, or `-` for standard input. Pictures a tool returns are saved in a temporary folder, or in the folder after `--out`, and the command prints where. `appshots tools <tool>` shows the parts of a slide, such as its badges or its device, as objects without their fields, and says where they are: `appshots call get_design_guide '{"topic":"fields"}'` lists every one. See [MCP tools](/docs/mcp).

## Clean up

```bash
appshots clean --builds --older-than 30 --dry-run
appshots clean --builds
```

`appshots run` keeps a build log for each project in `~/Library/Caches/appshots/build`, and with `--fresh` the build itself, which can take a few hundred megabytes. `clean --builds` removes them. `--older-than <days>` removes only those of projects not built for that many days, and `--dry-run` lists them with their size and removes nothing. Xcode's own build folder is left as it is.

## Where the settings live

| | |
| --- | --- |
| Server and token | `~/.config/appshots/config.json`, readable by you only |
| Or, for one command | The environment variables `APPSHOTS_URL` and `APPSHOTS_TOKEN` |
| App Store Connect: issuer ID, key ID and the path of the key file | `~/.config/appshots/app-store-connect.json`, readable by you only. The key itself is never copied |
| Or, for one command | The environment variables `ASC_ISSUER_ID`, `ASC_KEY_ID` and `ASC_KEY_PATH` |
| The skill | `~/.claude/skills/appshots` for Claude Code, `~/.agents/skills/appshots` for the others |

`appshots help` prints all of this.
