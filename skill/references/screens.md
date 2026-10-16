# Step 6: get the screens

Part of the appshots skill: step 6 of SKILL.md for an iPhone or iPad app, and for the screenshots a user already has, whatever the app. A Mac app is in `mac.md` (D), a web app in `web.md` (F), and the same screens on several devices or in several languages in `devices-languages.md`.

Take the way the user chose in step 2. Whichever it is, every screen has to be worth showing: believable content instead of empty states, no onboarding, permission prompt, paywall, keyboard, spinner, alert or debug banner, and no private content.

## A. The user has screenshots

```bash
appshots upload <project> <folder>               # every PNG and JPEG in it, named after the files
appshots upload <project> home.png stats.png
appshots upload <project> IMG_0412.png --name home
```

Then `get_project` lists what is there. Open the files to see what each one shows, and use those names in the slides. iPhone, iPhone Duo and iPad are told apart by the size of the image, and one name can hold one of each. A picture that is wider than tall counts as a Mac's unless it has the exact size of an iPhone or iPad screenshot turned on its side, and so does a captured window. `get_project` says which device each one counts as; if that is wrong, upload it again with `--as iphone`, `--as duo`, `--as ipad` or `--as mac`.

## B. The user opens each screen

First the app has to be running where it will be captured:

- **Simulator, app installed** (it is under `Apps:` in `appshots check`): `appshots launch <bundle id>`, with `--dark` or `--light` and `--lang <code>` as asked.
- **Simulator, app not installed:** `appshots run`, with the same options, and `--ipad` for the iPad or `--duo` for the iPhone Duo.
- **Plugged-in iPhone or iPad:** the user opens the app on it and keeps it unlocked.
- **An app made with another toolkit:** start it as in E, then carry on here.

A web app has nothing for the user to open: its screens are captured by address, as in `web.md`.

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

## C. You do it yourself

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

   It starts the app again with those arguments, waits until the screen stops changing, four seconds at most once the app has drawn and up to fifteen before that (`--wait 5` for a slow screen), takes the screenshot with the 9:41 status bar, and uploads it. If it warns that the screen still showed nothing, run it again. Add `--dark` or `--light`, `--lang de`, and `--sim "<name>"` when several simulators are booted. Run these one after the other, not at the same time.

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

## E. An app made with another toolkit

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

A Capacitor app is its web pages inside a native shell. Capturing the pages as in `web.md` is quicker and looks the same, unless a screen depends on a native plugin such as the camera or purchases.
