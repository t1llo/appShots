---
title: The appshots command
nav: Command line
description: Reference for the appshots command line tool on the Mac. Setup, update, check, run an app in the iOS Simulator, capture and upload screens, capture a Mac app's window, pull the finished set, download mockups, and call the server's tools.
---

`appshots` is one small Node.js file with no dependencies. It runs your app in a simulator, captures screens, moves files between your Mac and the server, and can call every tool the server has. The [setup command](/docs/connect) installs it as `~/.local/bin/appshots`.

It needs Node.js 18 or newer. Running and capturing need Xcode.

## Set up and keep current

| Command | What it does |
| --- | --- |
| `appshots setup <url> [--agent <agent>]` | Saves the server and your token, installs the skill and this command, and connects the agent. Agents: `claude` (the default), `codex`, `opencode`, `pi`, `other`. `--token <token>` skips the question |
| `appshots login <url>` | Saves the server address and the token only |
| `appshots update` | Brings the installed skill and this command up to date with the server's. Needs no token |
| `appshots check` | Reports the server, whether the skill is current, Xcode, the project in this folder, simulators, installed apps and devices. Every line says what to do next |

When the server has a newer skill or command than this Mac, every other command says so in one line when it is done. See [Connect an agent](/docs/connect) and [Update](/docs/update).

## Run the app

```bash
appshots run
appshots run --ipad --dark --lang de
appshots run --duo
appshots run --capture home --to streaks
```

`run` builds the app in the current folder and starts it in a simulator. It is for iPhone and iPad apps. A Mac app runs on the Mac itself: start it your own way and use `capture --mac`. See [Mac apps](/docs/mac).

| Option | What it does |
| --- | --- |
| `--scheme <name>` | The scheme to build, when the choice is not obvious |
| `--project <path>` | The workspace or project to build, when there are several |
| `--fresh` | Builds in a folder of its own instead of reusing Xcode's build |
| `--ipad` | On the 13-inch iPad Pro instead of the iPhone Pro Max |
| `--duo` | On the iPhone Duo instead. Needs an Xcode that has its simulator |
| `--sim <name or udid>` | On this simulator instead. It is booted if need be |
| `--dark`, `--light` | Sets the simulator's appearance first |
| `--lang <code>` | Starts the app in this language, such as `de` or `pt-BR`. A screenshot taken with `--capture` is filed under that language in the project |
| `--capture <name>` | Takes the screenshot as well, with a clean status bar |
| `--to <project>` | Uploads that screenshot to this project |
| `--wait <seconds>` | How long the app gets to settle before the capture. Default 2 |
| `-- <arguments>` | Handed to the app as they are, such as `-- -appshots stats` |

```bash
appshots launch com.example.streaks --capture stats --to streaks -- -appshots stats
```

`launch <bundle id>` starts an installed app again without building, to switch screen or language. It takes `--sim`, `--dark`, `--light`, `--lang`, `--capture`, `--to`, `--as` and `--wait`.

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
| `--clean` | Simulator only: shows 9:41, full battery and full signal |
| `--project <id>` | Uploads it to this project straight away. `--to` works too |
| `--as <iphone, duo, ipad or mac>` | Files it under this device. Only needed when the server cannot tell from the size. `upload`, `run` and `launch` take it too |
| `--lang <code>` | The language the screenshot shows the app in, one the project has. Left out, it is for the project's first language. See [Languages](/docs/languages#screenshots-per-language) |
| `--out <dir>` | Where the PNG is saved. Default `./raw-shots` |

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

## Where the settings live

| | |
| --- | --- |
| Server and token | `~/.config/appshots/config.json`, readable by you only |
| Or, for one command | The environment variables `APPSHOTS_URL` and `APPSHOTS_TOKEN` |
| The skill | `~/.claude/skills/appshots` for Claude Code, `~/.agents/skills/appshots` for the others |

`appshots help` prints all of this.
