---
title: The appshots command
nav: Command line
description: Reference for the appshots command line tool on the Mac. Setup, update, check, run an app in the iOS Simulator, capture and upload screens, capture a Mac app's window or a web app's pages, pull the finished set, download mockups, and call the server's tools.
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
| `--wait <seconds>` | How long the app gets to settle before the capture. Left out, the capture waits until the screen stops changing, four seconds at most |
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
| `appshots pull <project> [--out <dir>]` | Downloads the rendered set into `./store-screenshots/<project>`, one folder per display of App Store Connect, with the header and search results images and the [banners](/docs/banners). `--render` renders first |
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

## Mockups

```bash
appshots mockups streaks
appshots mockups streaks --style clay --color silver --shadow soft --rotate -8
appshots mockups streaks --width 1200 --out ./website/img
```

`mockups` saves one transparent PNG per screenshot into `./mockups/<project>`, named `<screenshot>-<device>.png`. It needs no slides and uses no render. What the options set is saved with the project, so the Studio's Mockups page shows the same, and the next call without options draws them the same way.

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

Arguments are JSON: inline, `@file.json`, or `-` for standard input. Pictures a tool returns are saved in a temporary folder, or in the folder after `--out`, and the command prints where. See [MCP tools](/docs/mcp).

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
