---
name: appshots
description: Make the App Store screenshots for the app in this repository from start to finish. Asks a few questions, takes the screens from screenshots the user already has, from the iOS Simulator, from a plugged-in iPhone or iPad, from the window of a Mac app or from the pages of a web app, writes the headlines, and builds and renders the set on the appShots server. Works for iPhone, iPad and Mac apps and for web apps, whatever they are built with: Xcode, Flutter, React Native, Expo, Capacitor, Tauri, Electron or a web framework. Also makes device mockups: the app's screens inside an iPhone, iPad or MacBook on a transparent background, for a website or a README. And banners: the wide picture at the top of a README, a repository's social preview, a link preview. And it can put the finished set into App Store Connect from this Mac with the user's own API key: every language into its language, every device onto its display, in the version being prepared or a new one, along with the store page's texts, without ever submitting anything. Use when asked for App Store or Mac App Store screenshots, store screenshots, a screenshot set, the header and search results assets of an app, device mockups of its screens, a README banner or social preview made from them, or to upload screenshots or texts to App Store Connect.
---

# appShots

Turn the app in this repository into a finished set of App Store screenshots: get its screens, write the copy, and build the set on the appShots server at {{SERVER}}.

Follow the steps in order, the same way every time. Say in a line or two what you decided at each step and carry on.

If what the user wants is not store screenshots but the devices alone, such as "iPhone mockups for the website" or "a transparent PNG of the app for the README", go to [Mockups](#mockups-for-a-website-or-a-readme) at the end. That needs no questions, no copy and no slides. If it is a wide picture with a headline, such as "a banner for the README" or "a social preview for the repository", go to [Banners](#a-banner-for-a-readme-or-a-link). If the set exists already and the user only wants it uploaded, or wants the store page's texts changed, go to [step 10](#10-put-it-into-app-store-connect).

## Keep it quick

A set takes about ten minutes when the user supplies or opens the screens, and about twenty when you reach them yourself. What makes it take an hour is building the app from scratch, hunting for screens by trial and error, reading the whole codebase, and rendering over and over. So:

- **Use the `appshots` commands for everything on the Mac.** Do not write shell scripts, Swift scripts, UI tests, fastlane lanes or Playwright and Puppeteer scripts to take screenshots, and do not call `xcodebuild` or `xcrun simctl` yourself. `appshots run`, `launch`, `boot`, `capture` and `simctl` do it the same way each time and know which Xcode, which simulator and which browser to use. The one exception is starting an app that `appshots run` does not build: a Mac app, or an app made with another toolkit, starts with the project's own command, which `appshots check` names (step 6 D, E and F).
- **Build at most once per device,** with `appshots run` or the project's own run command. `appshots run` reuses the build Xcode already made. Skip it when the app is installed or running already.
- **Two tries per screen.** If a screen does not come up after two attempts, ask the user to open it and capture it then.
- **Read little.** The README, the root view with its tabs or navigation, and the accent colour. Ten files at most.
- **Render the whole set once,** then fix what is off in one go. Two rounds of fixes at most. Where the account's renders are counted, every `render` uses one, so do not render slide by slide.
- **Only what was asked for.** An iPad or iPhone Duo set, more languages, and header and search results assets each cost time; make them when the user said yes to them. The same goes for the upload to App Store Connect and for the store page's texts.
- If you pass the time above, stop, say what is holding things up, and ask how to go on.

## 1. Check the setup

The `appshots` command is the file `appshots.mjs` in this skill's folder, next to this file. The rest of this skill writes `appshots` for short; where that is not a command, run `node <this skill's folder>/appshots.mjs`.

Run this first, from the app's folder:

```bash
appshots check
```

It reports in one go: whether the server answers, whether this skill is the current one, whether an App Store Connect key is saved on this Mac, which Xcode there is, the project in this folder and what it is made with, the commands that start it, the simulators it would use, the apps installed on the booted ones, and plugged-in devices. Each line says what to do when something is missing. These commands need the network and, depending on the app, Xcode and the simulator or a browser; if your shell is sandboxed and one fails for that reason, ask the user to allow it.

If the `Skill:` line says the server has a newer one, run `appshots update`, then read this file again from the top and follow the new one. If `check` is not a command this copy knows, it is an old one: ask the user to run the setup command again, as described below.

**The server's tools** are `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `set_creative_assets`, `render`, `render_mockups`, `list_revisions` and `restore_project`. There are two ways to reach them, and the rest of this skill names only the tool:

- As MCP tools, when this session has an MCP server called `appshots` and its `list_projects` answers.
- Through the command, in every other case, including an MCP server that answers 401:

  ```bash
  appshots tools set_slides                        # one tool's arguments in full
  appshots call list_projects
  appshots call set_slides @slides.json            # arguments from a file, for anything long
  ```

  A tool that returns pictures saves them and prints where. Open those files to look at them.

If `check` says the server is not set up or did not accept the token, the setup has not been run on this Mac. One command does all of it, and only the user can get it, because it carries their token. Tell them exactly this, as numbered steps, and stop:

1. Open {{SERVER}}, sign in, and click **Connect an agent** in the sidebar.
2. Pick the agent you are (or **Something else**), then **Do everything for me**, and click **Create token**.
3. Copy the command that appears and paste it into Terminal.
4. Start a new session in this folder and ask for the screenshots again.

Then call `get_design_guide` and read it. It is the current reference for layouts, feature slides, backgrounds, fonts, badges, icon and logo rows, the app's logo and other placed images, copy, Mac apps, the header and search results assets and banners, and it wins over anything remembered.

**Find out what kind of app this is** before you ask anything. It decides where the app runs, and an app is always captured where it runs. `check` says what the project is made with and gives the commands; this table says what follows from it:

| The app | It runs | It is started by | A screen is captured with | Step |
| --- | --- | --- | --- | --- |
| iPhone or iPad app in an Xcode project | in the iOS Simulator, or on a plugged-in device | `appshots run` | `appshots capture --clean` | 6 B, C |
| iPhone or iPad app made with Flutter, React Native, Expo, Capacitor or Tauri | in the iOS Simulator | `appshots boot`, then the toolkit's own command | `appshots capture --clean` | 6 E |
| Mac app: Xcode, Tauri, Electron, Flutter for macOS | in a window on this Mac | the project's own command | `appshots capture --mac <app>` | 6 D |
| Web app: Next.js, Vite, SvelteKit, Rails, Django and the like | as pages in a browser | its dev server | `appshots capture --web <address>` | 6 F |

An Xcode project is a Mac app when a target has `SDKROOT = macosx` or `macosx` among its `SUPPORTED_PLATFORMS`, or when a Swift package lists `.macOS` in its `platforms`. A Mac app gets a landscape set for the Mac App Store. A web app is drawn at the size of an iPhone, an iPad or a Mac, whichever the set is for, and comes out as that device's screenshots. An app for several of these can have them all in one project.

If `check` recognises nothing, find out how the app is started from the README and the project's scripts (`package.json`, a `Makefile`, a `justfile`), then take the row of the table that fits. If it lists several apps below this folder, work from the folder of the one the user means, and ask when that is not clear.

## 2. Ask first

Ask these together, in one message, before doing anything else. Use this agent's tool for asking the user questions if it has one. Leave out whatever the request or `appshots check` has already answered, and do not add questions of your own.

1. **Devices:** iPhone only, or the iPad or the iPhone Duo as well? One design per device covers every size of it, so never ask about sizes. For an app that runs on the Mac only, leave this question out. For one that runs on iPhone and Mac, ask which of them the set is for. For a web app, ask how it is to be shown: on an iPhone, on an iPad, on a Mac, or on several of them.
2. **The screens:** how do we get them?
   - *I have screenshots.* They give you the folder.
   - *I open each screen, you capture it.* The quickest way to real content, and the one to recommend.
   - *Do it yourself.* You start the app on each screen. Slower, and it may need a few lines in the app that only exist in debug builds; ask whether adding them is fine. For a web app this is the quick way and the one to recommend: every screen is an address, and nothing in the app has to change.
3. **Where the app runs,** not for a Mac app or a web app, and only when `check` leaves it open: on a simulator or on the plugged-in iPhone or iPad? Name the ones `check` listed. If the app is installed on a booted simulator, ask whether that is the current build.
4. **The look:** light or dark? Which languages, if more than the app's main one?
5. **Extras:** Is there a real rating, download count, award or review to show? Services the app works with, whose logos belong on a slide? A logo, mascot or other artwork of their own to put on the slides, and where the files are? Header and search results assets as well?
6. **App Store Connect:** shall the finished set be put into App Store Connect as well, or do they upload it themselves? Not for a web app that is not in the App Store. It needs an App Store Connect API key of their own, which stays on this Mac. If the `App Store Connect:` line of `check` shows no key, ask for it with the same question, in the words of [the key](#the-key) in step 10: the issuer ID, the key ID, and the path of the `.p8` file. Never ask for what is in the file.

If the user says to decide yourself: iPhone only (for a web app that only works on a wide screen, the Mac), do it yourself without changing the app, the appearance the app looks best in, the main language, no badges, no logos, no artwork, no header and search results assets, and no upload to App Store Connect.

## 3. Understand the app

Read the README, the store description if the repository has one (`fastlane/metadata`, a marketing site), and the root view with its tabs or navigation, or the router with its routes. Take the accent colour from the asset catalogue, the theme file or the stylesheet.

Come out of it with what the app does in one sentence a stranger would understand, the four to seven things worth showing with the strongest first, and the app's own colours.

## 4. Plan the set

Five to eight slides. Slide 1 sells the whole app and the rest take one benefit each, in the order somebody would care about them. People decide on the first three, so those carry the most.

Write the plan as a short list (slide, screen, screenshot name, headline) and show it to the user. Then carry on without waiting.

Screenshot names are short lowercase words such as `home`, `stats` or `detail`. Slides refer to screenshots by these names. Not every slide needs a screen. A `features` slide lists what the app does as cards with icons, a `statement` slide is one bold claim, a `stat` slide shows two or three figures, a `steps` slide a short how-to, and a `reviews` slide what people say about the app. A text slide with badges or a row of logos can open or close the set. One or two of those per set, and a `stat` or `reviews` slide only with the real figures and reviews the user gave you.

When one screen stands for several things, give its slide feature points: two to four short lines with an icon each, next to the headline. The `device-right` and `device-left` layouts are made for that, with the copy in a column beside the device. One such slide per set is plenty.

## 5. Create the project

`list_projects` first: continue the app's project if it has one, otherwise `create_project` with the app's name. Everything after this needs the project id.

## 6. Get the screens

Take the way the user chose in step 2. Whichever it is, every screen has to be worth showing: believable content instead of empty states, no onboarding, permission prompt, paywall, keyboard, spinner, alert or debug banner, and no private content.

### A. The user has screenshots

```bash
appshots upload <project> <folder>               # every PNG and JPEG in it, named after the files
appshots upload <project> home.png stats.png
appshots upload <project> IMG_0412.png --name home
```

Then `get_project` lists what is there. Open the files to see what each one shows, and use those names in the slides. iPhone, iPhone Duo and iPad are told apart by the size of the image, and one name can hold one of each. A picture that is wider than tall counts as a Mac's unless it has the exact size of an iPhone or iPad screenshot turned on its side, and so does a captured window. `get_project` says which device each one counts as; if that is wrong, upload it again with `--as iphone`, `--as duo`, `--as ipad` or `--as mac`.

### B. The user opens each screen

First the app has to be running where it will be captured:

- **Simulator, app installed** (it is under `Apps:` in `appshots check`): `appshots launch <bundle id>`, with `--dark` or `--light` and `--lang <code>` as asked.
- **Simulator, app not installed:** `appshots run`, with the same options, and `--ipad` for the iPad or `--duo` for the iPhone Duo.
- **Plugged-in iPhone or iPad:** the user opens the app on it and keeps it unlocked.
- **An app made with another toolkit:** start it as in E, then carry on here.

A web app has nothing for the user to open: its screens are captured by address, as in F.

Then give the user this one command to paste into Terminal, with the names from the plan in order, and tell them which screen each name means:

```bash
appshots shoot <project> home stats detail settings --clean      # add --device for the plugged-in device
```

It names each screen in turn, waits for Return while they open it, captures it and uploads it. `s` skips one, `q` stops. You cannot run it yourself, because it waits for their keys.

If they would rather stay in the chat, go screen by screen instead: name the screen, wait for their word that it is up, then

```bash
appshots capture --name home --project <project> --clean           # the simulator
appshots capture --name home --project <project> --device          # the plugged-in device
```

### C. You do it yourself

1. **Get the app running, once.** If `appshots check` lists it under `Apps:` and the user said that build is current, there is nothing to build. Otherwise:

   ```bash
   appshots run                    # iPhone Pro Max, the size the store asks for
   appshots run --ipad             # the 13-inch iPad Pro, when an iPad set was asked for
   appshots run --duo              # the iPhone Duo, when a Duo set was asked for
   ```

   It finds the project and scheme, boots the simulator, builds in Xcode's own build folder, installs and launches, and prints the bundle id. A first build can take several minutes, so give the command a long timeout and do not start a second one. If it says Xcode is building right now, wait and run it again. If it says the simulator of the store's size is not installed and `--create` adds one, run it again with `--create`. An app made with Flutter, React Native, Expo, Capacitor or Tauri is not built by `appshots run`: start it as in E, then carry on with 2.

2. **Capture each screen with one command:**

   ```bash
   appshots launch <bundle id> --capture stats --to <project> -- <launch arguments>
   ```

   It starts the app again with those arguments, waits until the screen stops changing, four seconds at most (`--wait 5` for a slow screen), takes the screenshot with the 9:41 status bar, and uploads it. Add `--dark` or `--light`, `--lang de`, and `--sim "<name>"` when several simulators are booted. Run these one after the other, not at the same time.

3. **How to land on a screen,** in this order. Take the first that works:

   1. What the app has already: launch arguments, a demo or screenshot mode, deep links. Search the code once for `ProcessInfo.processInfo.arguments`, `CommandLine.arguments`, `onOpenURL` and `CFBundleURLSchemes`. A deep link goes in with `appshots simctl openurl booted "<scheme>://stats"`, followed by `appshots capture --name stats --project <project> --clean`.
   2. A tool in this session that taps and swipes in the simulator, if there is one. Then `appshots capture`.
   3. If the user agreed to it in step 2, a launch argument for screenshots that only exists in debug builds. Keep it to a few lines in one place, reading the screen to open from `-appshots <screen>`:

      ```swift
      #if DEBUG
      // Store screenshots: `-appshots stats` at launch opens that screen with sample content.
      if let screen = UserDefaults.standard.string(forKey: "appshots") {
          switch screen {
          case "stats": selectedTab = .stats
          case "detail": path = [.detail(.sample)]
          default: break
          }
      }
      #endif
      ```

      Put it where the root view sets its first tab or route, fill in sample content there if the app would be empty, run `appshots run` once more, and from then on every screen is `appshots launch <bundle id> --capture <name> --to <project> -- -appshots <name>`. Tell the user which file you changed.
   4. Otherwise ask the user to open that screen, and capture it as in B.

4. **Write a capture plan when the screens can be reached without you.** When the app has launch arguments or deep links for its screens (from 3), or a UI test target that reaches them, write `appshots.capture.json` next to the Xcode project instead of a `launch` per screenshot, all the more for several languages, both appearances or iPhone and iPad:

   ```json
   {
     "project": "<project>",
     "app": { "xcode": ".", "args": ["-demo"] },
     "devices": ["iphone", "ipad"],
     "locales": ["en", "de"],
     "screens": [
       { "id": "home" },
       { "id": "stats", "launch": ["-appshots", "stats"] },
       { "id": "detail", "launch": { "url": "<scheme>://detail/sample" } },
       { "id": "share", "uitest": "AppUITests/ScreenshotTests/testShare" }
     ]
   }
   ```

   `app.bundleId` instead of `app.xcode` for an app that is installed already; `"appearances": ["light", "dark"]` adds a `-dark` screenshot of each. A UI test calls `appshotsReady()` once its screen is up; the appShots docs have those few lines under Command line, Capture plans. Run `appshots shoot --plan --dry-run` and read what it would take and how, then `appshots shoot --plan` with a long timeout: it builds once, boots what it needs, takes every screen in every language and uploads it. Run it again after a fix and it takes only what the project lacks (`--again` takes all again, `--only home,stats` some). Tell the user about the file, as it makes the next set one command. If the repository uses fastlane snapshot already, `appshots shoot <project> --fastlane fastlane/screenshots` uploads what that wrote instead.

### D. A Mac app

A Mac app runs on this Mac, not in a simulator, so `appshots run`, `launch` and `--clean` are not for it. That goes for an Xcode Mac app as for one made with Tauri, Electron or Flutter for macOS.

1. **Get it running.** If the user has it open and says that build is current, there is nothing to build. Otherwise build and open it the project's own way. For an Xcode project:

   ```bash
   xcodebuild -scheme <scheme> -configuration Debug -derivedDataPath build build
   open build/Build/Products/Debug/<App>.app
   ```

   Give the build a long timeout, and do not commit `build/`. For Tauri, Electron and Flutter, `appshots check` names the command, such as `npm run tauri dev`, `npm run start` or `flutter run -d macos`. Run it in the background, because it keeps running for as long as the app is open, and wait until its window is there. A first Tauri build compiles for several minutes. If it stops over missing dependencies, install them the way it says, once.

2. **Capture its window with one command:**

   ```bash
   appshots capture --mac "<app name>" --name overview --project <project>
   ```

   `<app name>` is the name in the menu bar. An app that runs from source goes by the name of its program instead, such as `Electron` or the name of the Cargo package; `check` says which, and `appshots capture --mac` alone lists the apps that have a window open. It takes the app's frontmost window, without the shadow, and uploads it as a Mac screenshot. When the user opens the screens themselves, give them `appshots shoot <project> overview budgets reports --mac "<app name>"` to paste, as in B.

3. **If macOS refuses,** the terminal lacks the Screen Recording permission, and the command says where to switch it on: System Settings, Privacy & Security, Screen & System Audio Recording. Only the user can do that. Tell them, or ask them to take each window themselves (Shift-Command-4, then Space, then a click on the window) and upload the files with `appshots upload <project> <file> --name overview --as mac`.

4. **How to land on a screen,** in the order of C: launch arguments (`open <App>.app --args -appshots stats`), a deep link (`open "<scheme>://stats"`), a debug-only launch argument if the user agreed to one, and otherwise the user opens the screen. `open` only brings a running app to the front, so quit the app before opening it with other arguments: `osascript -e 'quit app "<app name>"'`. Wait two seconds after opening before you capture. An app started from source takes its first screen from what the project already reads at the start, such as an environment variable in front of the command; if it reads none and the user agreed to a change, a few debug-only lines that read one.

5. **Window or full screen.** A captured window is drawn as that window, large and readable, which suits most apps. An app in full screen is drawn inside a MacBook, where its text turns small: at most one such slide, usually the first. Give the window a size that shows the content without empty space before capturing.

6. **Stop what you started.** When the screens are captured, stop the command that runs the app from source. Leave an app the user had open as it is.

### E. An app made with another toolkit

A Flutter, React Native, Expo or Capacitor app, or a Tauri app for iOS, runs in the iOS Simulator like any other. Only the build is the toolkit's own.

1. **Boot the simulator:**

   ```bash
   appshots boot                   # iPhone Pro Max; --ipad or --duo for those sets
   ```

   It boots the simulator the store sizes ask for and prints the toolkit's run command with that simulator filled in, such as `flutter run -d <udid>`, `npx expo run:ios --device <udid>`, `npx react-native run-ios --udid <udid>` or `npx cap run ios --target <udid>`.

2. **Start the app with that command, in the background.** It keeps running for as long as the app does, so do not wait for it to end: wait until its output says the app is running. A first build takes several minutes; do not start a second one. If it stops over missing dependencies (`flutter pub get`, `npm install`, `pod install`), run what it names, once.

3. **Capture** as in B or C: `appshots capture --name home --project <project> --clean`. Once the app is installed, `check` lists it under `Apps:` with its bundle id, and `appshots launch <bundle id> --capture <name> --to <project>` starts it again without a build. A React Native or Expo app needs the run command's bundler to stay up for that.

4. **How to land on a screen,** in the order of C. Deep links are the usual way here, since Expo Router, React Navigation and go_router treat a route as an address: `appshots simctl openurl booted "<scheme>://stats"`, then `appshots capture`. Next comes what the project reads at the start already (`flutter run --dart-define=SCREEN=stats`, an `EXPO_PUBLIC_` variable), then a tool in this session that taps, then the user.

5. **Stop the run command** when the screens are captured.

A Capacitor app is its web pages inside a native shell. Capturing the pages as in F is quicker and looks the same, unless a screen depends on a native plugin such as the camera or purchases.

### F. A web app

A web app is captured page by page. `appshots capture --web <address>` draws the page at that address with Chrome, without opening a window, at the exact size of the device, and uploads it as that device's screenshot. It uses the Chrome, Edge or Brave that is installed, which `check` reports under `Browser:`. Do not install or script a browser yourself.

1. **Get it running.** If the user has the dev server running, use its address. Otherwise start it with the command `check` names, such as `npm run dev`, in the background, and read the address off what it prints: the port is not always the usual one. Install dependencies first only if they are missing. If it needs a database, keys or an account you do not have, ask the user to start it and tell you the address. A site that is already online works the same way, when the user says to use it.

2. **Capture each screen with one command:**

   ```bash
   appshots capture --web http://localhost:5173/stats --name stats --project <project>
   ```

   It waits for the page and what it fetches, then one second more (`--wait 3` for a slow screen). The size is an iPhone's unless you say otherwise: `--as ipad`, `--as mac` or `--as duo`. Add `--dark` or `--light` for the colour scheme the page is asked for, and `--lang de-DE` for the language the browser reports. On an iPhone or iPad the page is laid out as an installed web app is, between the status bar and the home indicator: the home indicator is drawn, and the status bar's place stays free for step 8 to fill.

3. **How to land on a screen,** in this order. Take the first that works:

   1. Its address. Read the routes off the router or the pages folder; a query or a `#` part counts.
   2. State the page reads when it loads, set with `--init`: JavaScript that runs before the page's own on every load, such as `--init "localStorage.setItem('onboarded', '1')"` or `--init @seed.js` for a file. Sample data, a dismissed cookie banner and a fixed date go here.
   3. A step in the loaded page, with `--eval`: the click that opens a tab or a dialog, a scroll. `--eval "document.querySelector('[data-tab=stats]').click()"`. `await` works in it, and when the click leads to another page, that page is captured.
   4. Pages behind a sign-in: use the test account the project's own seed or fixture files set up, never a real one. `--profile .appshots-browser` keeps cookies between captures, so sign in once with `--eval` and capture the rest after it. Without a test account, ask the user for one, or for the screenshots (A).
   5. Otherwise ask the user for a screenshot of that screen (A).

4. **Believable content.** Use what the project has for it: a seed script, fixtures, a demo mode, mocked requests. Never write into a database that is not a local one.

5. **Look at each picture.** The command says so when the address answered with an error such as 404. Take a dev tool's badge or overlay out of the picture with `--eval`, as in `--eval "document.querySelector('nextjs-portal')?.remove()"`.

6. **Stop what you started.** When the screens are captured, stop the dev server if you started it, and delete `.appshots-browser` if you made it. Do not commit either.

`appshots shoot` is not for web pages, which have no window to wait for. For the same screens on several devices, capture each address once per device under the same name, with `--as`.

For an app on iPhone and Mac, capture the same screens under the same names on both. The Mac then gets a slide set of its own in step 8. Read Mac apps in the design guide before writing the slides: the canvas is wide and short, so the copy has to be shorter still.

For the iPad or the Duo set, capture the same names on that simulator. One name holds one screenshot of each device, and every slide picks the one of the device it is drawn for. Each of these devices gets a slide set of its own in step 8 as well.

For another language, when the user asked for it and the app itself is translated: list the language in the project's `locales` first, then capture the same names again with `--lang`, which starts the app in that language and files the screenshot under it:

```bash
appshots launch <bundle id> --lang de-DE --capture stats --to <project> -- <launch arguments>
appshots capture --web <address> --lang de-DE --name stats --project <project>      # a web app
appshots upload <project> <folder> --lang de-DE      # or files the user already has in that language
```

The slides stay as they are: each language's set shows its own screenshot of a name, and the first language's where it has none. So an app that is not translated needs no second round of captures, only translated copy.

The PNGs are also saved in `./raw-shots`. Open each one and look at it before moving on; capture again under the same name to replace it. Do not commit `raw-shots/`.

### A logo and other artwork

Only when the user gave you files in step 2, or asked for the app's icon on the slides. These are not screenshots, so they go up with `--image`:

```bash
appshots upload <project> logo.svg mascot.png --image             # PNG, SVG, JPEG or WebP, named after the files
appshots upload <project> <the 1024 px icon in the asset catalogue> --image --name app-icon
```

`get_project` lists them under `images`. A slide shows one over its headline with `logo`, and places others anywhere with `images`; the design guide has the fields. Use only what the user gave you or what is in the repository. Do not draw, generate or download artwork.

## 7. Write the copy

- A headline is two to five words and one benefit. Say what the user gets, not what the feature is called: "Never miss a day", not "Reminder notifications". Verb first where it fits.
- Wrap the one word that matters in `*asterisks*` to tint it.
- A subheadline is one short sentence, and most slides are better without it.
- Use the words the app itself uses. No "best", "ultimate" or "#1", and nothing the app does not do.
- Badges, the figures of a `stat` slide and the reviews of a `reviews` slide only with the real figures and reviews the user gave you in step 2. Without any, leave them out. Invented ones get the app rejected.
- A row of logos only for services the app really works with, as the user named them in step 2.
- The app's logo belongs on the first slide, not on every one. Other artwork: one to three images on a slide, clear of the headline and of the part of the screen the slide is about.
- Write in the app's main language. Add other languages only when asked, as `{"en-US": "...", "de-DE": "..."}` maps, with the locales listed on the project. The first locale is the one the others fall back to, for texts and screenshots alike.

## 8. Build and render

1. `set_slides` with the whole set and the theme. Take the theme from the app: its accent colour, a muted background in the same family or `auto`, one font for the set. Vary the layouts so it does not read as one template repeated: one device, a close-up, the device beside a column of feature points, two or three devices on one slide, a feature slide. If the screenshots come from a real device and show an odd time or a low battery, set `"device": {"statusBar": "cover"}` in the theme: it paints a clean 9:41 status bar over theirs. If they are a web app's, taken with `appshots capture --web` for an iPhone or iPad, set `"device": {"statusBar": "overlay"}` instead: it draws the 9:41 status bar into the place those pictures leave free at the top. The theme's `device.style` draws the frames as `clay`, `outline` or `sketch` instead of the real device, when the user wants a calmer or a hand-drawn look; on a slide with two or three devices, `device.spread` is the angle between them.
2. **A set for every other device,** before the first render. When the project has screenshots of more than one device, the set from 1 is the iPhone's, and each of the others gets its own: `set_slides` again with `"device": "ipad"`, `"device": "mac"` or `"device": "duo"`. Do not send the iPhone's slides unchanged. Start from them and compose each slide for that canvas: an iPad's is close to square and a Mac's is wide, so the layout, the size and place of the device and how much copy fits all change. The sets tell the same story in the same words and share the theme, and they may differ in layouts, in the screens they show, in order and in number. A slide that already sits well on the other canvas stays as it is. A set for each device in the design guide says what usually changes. With one device only, skip this.
3. `render` with `"creatives": []`. It writes every size of every device the project has screenshots of, each from its own set: sizes of the same shape are the same picture scaled, so there is nothing to design per size and no `targets` to pass. Look at the contact sheet it returns for each device as a customer would: is each headline readable at thumbnail size, does the device crop hide the point of the screen, does the set hold together?
4. Fix everything that is off with `update_slide`, and in a device's own set with `"of": "ipad"` added, then render those slides in one call, as in `"slides": [2, 5], "creatives": []`. Two rounds at most. `render` says how many renders the account has left when they are counted: each call uses one, so never spend one on a single small fix, and when none are left, say so and stop. The person who runs the server can give the account more. Stop when it is good, not when it is perfect. When the device hides the point of its screen or crowds the copy, move or resize it on that slide with `device`: `scale`, `offsetX` and `offsetY`, in small steps. A placed image that covers something moves with its `x`, `y` and `size`; look at every device's sheet, because the same numbers land elsewhere on a wider canvas, and change them in that device's own set. A bad edit can be undone: every change is kept as a revision, `list_revisions` lists them and `restore_project` brings one back, also when a change wrote over what the user tuned in the Studio.
5. Only if the user asked for them: `set_creative_assets` for the product page header and the search results image, then `render` with `"creatives": ["header", "search"]`. Keep their copy to one short phrase. The preview marks the safe area with a dashed frame so you can check that the copy is inside it; that frame is not in the file. Apple reviews these more strictly than screenshots.

appShots makes still images. If the user asks for an app preview video, say that this skill does not make one.

## 9. Hand over

Tell the user:

- The Studio link, {{SERVER}}/#/<project>, where every slide can still be edited by hand.
- How to get the files: **Export ZIP** in the Studio, or `appshots pull <project>` for `./store-screenshots/<project>`. There is one folder per display of App Store Connect, and `README.txt` says which folder goes onto which display. A display only takes the files of its own folder.
- If they did not ask for the upload: that `appshots store push <project>` can put the set into App Store Connect for them, with an API key of their own that stays on this Mac. One line, no more.
- The slides with their headlines, in order.
- For a Mac set: the files are in the `mac-2880` folder, 2880×1800, and go onto the macOS version of the app in App Store Connect.
- Which devices have a set of their own, and how those differ from the iPhone's.
- What you assumed or left out: no iPad or Duo set, no badges, a screen you could not reach, a file you changed for the debug launch argument, sample data you put into a local database.
- That header and search results assets, if made, should be checked in App Store Connect's preview before submitting.
- If the `appshots` MCP server answered 401 and you used the command instead: running the setup command again, from this folder, repairs the connection.

When the user said yes to the upload in step 2, go on with step 10 once they are happy with the set.

## 10. Put it into App Store Connect

Only when the user asked for it: with a yes in step 2, or in their own words at any time. The upload runs on this Mac with `appshots store`, which talks to Apple directly. It changes the store page of a version that is being prepared and nothing else: it cannot submit a version for review or release one, and neither do you, by any other means.

### The key

The command needs an App Store Connect API key of the user's own. If the `App Store Connect:` line of `appshots check` names a key, it is there already: go on. If not, ask the user for three things and tell them where they are:

- In App Store Connect, under **Users and Access → Integrations → App Store Connect API → Team Keys**: the **issuer ID** above the list of keys, the **key ID** beside the key, and the key file, `AuthKey_<key id>.p8`, which is downloaded once when the key is made.
- A new key should get the role **Marketing**. That is enough to make a version and to change screenshots and texts, and it cannot submit or release anything. Only the Account Holder or an Admin of the team can make a key.
- You need the **path** of the `.p8` file on this Mac, and never what is in it.

Then save them. This checks them with Apple and lists the apps the key reaches:

```bash
appshots store login --issuer <issuer id> --key-id <key id> --key <path to the .p8 file>
```

**The key file is not yours to read.** Do not open it, print it, copy it, move it or put it into the repository, and do not go looking for key files on the Mac: the path the user gives is all the command needs. If the user pastes the key's contents into the chat, do not use them: tell them a pasted key should be revoked in App Store Connect, and ask for the path of a new one. The key, its path and the IDs never go to the appShots server either, not as a tool's argument and not into a project.

### The upload

1. **Find the app.** Take the bundle id from the project (`PRODUCT_BUNDLE_IDENTIFIER`, or the toolkit's own setting) and look for it among the apps `appshots store login` or `appshots store apps` lists. Ask the user when it is not among them or several fit.
2. **Look first.** Run the dry run and show the user what it prints:

   ```bash
   appshots store push <project> --app <bundle id> --dry-run
   ```

   It names the version, and for each language and display how many screenshots would go up and what they would replace. It takes the files of the last render; add `--render` only when the slides changed since.
3. **If it says no version is being prepared,** a new one has to be created. Take the number from the app (`MARKETING_VERSION`, or the toolkit's own version setting) when that is higher than the latest version the message names. Otherwise ask the user which number the next version gets. Then add `--version <number>` to the dry run and the upload. A version number is not a build number, and no build is made or touched.
4. **If it says a language is not on the store page,** ask the user whether to add it. `--add-languages` does. If it says a language could go onto either of two, such as `en` onto `en-US` or `en-GB`, ask the user which, and name it with `--lang en=en-GB`. `--lang` uploads only the languages it names, so list the others after it, as in `--lang en=en-GB,de-DE`.
5. **Wait for the user's yes to that plan,** unless they already told you to upload without asking. Then run the same command without `--dry-run`.
6. **If Apple refuses a file,** the command says which and why, and ends with an error. Render again and run it once more. Do not work around it.

The command leaves three things out and says so: screenshots for the iPhone Duo, which App Store Connect's API has no display for yet, the header and search results assets, and banners. The first two the user drags in by hand.

`--lang de-DE,fr-FR` uploads only those languages, and `--only iphone,ipad` or `--only iphone-6.9` only those devices or folders. Mac screenshots need a macOS version of the app in App Store Connect: without one, leave them out with `--only iphone,ipad` and tell the user.

### The texts

Only when the user asks for them. `appshots store text --app <bundle id>` prints the store page's texts per language as JSON: `name`, `subtitle`, `description`, `keywords`, `promotionalText`, `whatsNew`, `supportUrl` and `marketingUrl`. To change some, hand back the same shape with only the ones to change:

```bash
appshots store text --app <bundle id> --set @texts.json --dry-run
```

Show the user the new texts in full and wait for their yes before you run it without `--dry-run`. Write for the store as for the slides: plain, specific, no invented figures. Apple's limits are 30 characters for the name and the subtitle, 100 for the keywords, 170 for the promotional text and 4000 for the description and what is new; the command refuses longer ones before anything is sent. An app on iOS and the Mac has texts for each: `--platform ios` or `--platform mac`.

### Then tell the user

- What went up: the version, the languages and the displays. And what did not: iPhone Duo screenshots, header and search results assets, a language that is not on the store page.
- If a version was created: its number, and that it has no build yet.
- That nothing was submitted. The link the command printed opens the app in App Store Connect, where they look the version over and submit it themselves.

## Mockups for a website or a README

A mockup is one raw screenshot inside its device with nothing behind it: a transparent PNG, cut to the device. Make them when the user asks for the devices alone, or offers a place for them: a landing page, a README, a press kit, a deck. They are not for App Store Connect, which takes no transparency.

1. Do step 1, then get the screens as in steps 5 and 6: a project, and the raw screenshots in it. An existing project already has them. Skip the questions, the plan and the copy.
2. Draw them. With the MCP tool, `render_mockups` with the project, and look at the picture it returns. Then `appshots mockups <project> --out <folder>` puts the PNGs where they are needed, such as `docs/` for a README or the site's image folder. Without `--out` they go to `./mockups/<project>/`. Each file is named `<screenshot>-<device>.png`.
3. Set the device only when asked or when the page calls for it, with `device` on the tool or the command's options: `--style clay` (or `outline`, `sketch`), `--color silver`, `--shadow soft`, `--rotate -8`, `--perspective left`, `--status-bar cover` for a clean 9:41, and `--width 1200` for a certain size. Left alone, a mockup is the plain device, upright, without a shadow, with the screenshot pixel for pixel, which suits a page that scales the picture itself. On a dark page a line drawing needs `--color silver`. What you set is saved with the project.
4. Put them on the page if that was the request, scaled by the page: `<img src="docs/home-iphone.png" alt="…" width="320">`. Write a real `alt` text.
5. Tell the user where the files are, and that {{SERVER}}/#/<project>/mockups shows them and lets them change the device and download again.

Mockups use none of the account's renders.

## A banner for a README or a link

A banner is a wide picture with the app's screens in their devices, a headline and the project's background, for outside the store. Make one when the user asks for a README banner or header, a social preview for the repository, a link preview (`og:image`) or a 16:9 picture for a post.

1. Do step 1, then get a project with its raw screenshots as in steps 5 and 6. An existing project already has them, and its theme. Skip the questions and the plan.
2. `set_creative_assets` with the banner asked for: `readme` (2400×800), `social` (1280×640, GitHub's social preview), `link` (1200×630) or `post` (1920×1080). Give it a headline of a few words, perhaps a subheadline, and one to three `screenshots`. Banners in the design guide has every field. In a new project, set the theme first with `update_project`: the app's accent colour and a background in the same family.
3. `render` with `"creatives": ["readme"]`. That draws the banner alone and leaves the slides as they are. It uses one render, so make every banner that was asked for in one call. Look at the preview it returns, and fix and render once more at most.
4. `appshots pull <project>` saves it as `./store-screenshots/<project>/<language>/banners/readme.png`. For a README, copy it into the repository, such as `docs/banner.png`, and make `![<App name>](docs/banner.png)` the first line of the README. Do not commit `store-screenshots/`.
5. Tell the user what only they can do: a `social` banner is uploaded under the repository's Settings, General, Social preview, where GitHub takes a file of up to 1 MB; a `link` banner goes onto their website as the page's `og:image`.
