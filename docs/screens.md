---
title: Get your screens in
description: Three ways to get raw app screenshots into an appShots project. Upload files you have, capture each screen as you open it, or let the agent run the app in the iOS Simulator.
---

A slide shows a raw screenshot of your app inside a device frame. Raw means the plain screen, as the simulator or the phone saves it, with nothing around it.

## Names

Every screenshot has a short name, such as `home`, `stats` or `detail`. Slides refer to screenshots by name.

- Uploading under a name that exists **replaces** that screenshot, and every slide that uses it updates.
- iPhone, iPhone Duo and iPad are told apart by the size of the image. **One name can hold one of each**, and each output size picks the matching one. See [Sizes](/docs/sizes#iphone-iphone-duo-or-ipad).
- Names are lowercase letters, digits, `-` and `_`.

## In the browser

Drag the files from Finder onto the project page in the Studio, or use the upload button under **Screenshots**. The name is the file name. In the iOS Simulator, ⌘S saves the current screen to the desktop.

## From files you have

```bash
appshots upload streaks ./screens
appshots upload streaks home.png stats.png
appshots upload streaks IMG_0412.png --name home
```

`streaks` is the project. A folder stands for every PNG and JPEG in it.

## You open each screen

The quickest way to screens with real content. Start the app in the simulator, or open it on a plugged-in, unlocked iPhone or iPad, then:

```bash
appshots shoot streaks home stats detail settings --clean
```

It names each screen in turn and waits for Return while you open it, then captures and uploads. `s` skips one, `q` stops. Add `--device` for the plugged-in device.

One at a time works too:

```bash
appshots capture --name home --project streaks --clean
appshots capture --name home --project streaks --device
```

## The agent runs the app

With [the skill](/docs/skill), the agent builds your app once and starts it on each screen:

```bash
appshots run
appshots launch com.example.streaks --capture stats --to streaks -- -appshots stats
```

`run` finds the Xcode project and scheme, boots the simulator the store sizes ask for (an iPhone Pro Max, the 13-inch iPad Pro with `--ipad`, or the iPhone Duo with `--duo`), and reuses the build Xcode already made. `launch` starts the installed app again with launch arguments, waits two seconds, captures with a clean status bar and uploads.

To land on a screen, the agent uses what your app has already: launch arguments, a demo mode or deep links. If there are none and you agree, it adds a launch argument that only exists in debug builds. Otherwise it asks you to open the screen.

React Native, Expo and Flutter apps use the project's own run command for the build. Capturing works the same.

## A clean status bar

`--clean` sets the simulator's status bar to 9:41 with full battery and signal before capturing. It works on simulators only. On a real device the status bar is whatever the device shows.

## Light, dark and languages

```bash
appshots run --dark --lang de
appshots launch com.example.streaks --light --lang pt-BR
```

`--dark` and `--light` set the simulator's appearance. `--lang` starts the app in that language.

A project in several languages holds each screen once per language, under the same name. Add `--lang` to the capture and the screenshot goes to that language:

```bash
appshots launch com.example.streaks --lang de-DE --capture home --to streaks -- -appshots home
```

A language shows the first language's screenshots until it has its own. See [Languages](/docs/languages#screenshots-per-language).

## What you need on the Mac

| For | You need |
| --- | --- |
| The command itself | Node.js 18 or newer |
| Simulator capture | Xcode with an iOS simulator |
| Device capture | Xcode 27 or newer, and the device plugged in, unlocked and trusting the Mac |

If `xcode-select` points at the Command Line Tools, the command switches to `/Applications/Xcode.app` by itself.

## What makes a good screen

- Believable content. No empty states.
- No onboarding, permission prompt, paywall, keyboard, spinner, alert or debug banner.
- Nothing private: no real names, addresses or messages.
- One appearance, light or dark, across the set, unless a slide is about the other one.

## Limits

- PNG, JPEG or WebP, up to 40 MB a file and at least 300 pixels on the short side.
- {{MAX_SHOTS}} screenshots per project, and as many again for each further language.
- Captures are also saved in `./raw-shots`, in the folder you ran the command in. Do not commit that folder.
