# Step 6 D: a Mac app

Part of the appshots skill: step 6 of SKILL.md for a Mac app. Screenshots the user already has go up as in A of `screens.md`, with `--as mac`.

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

   `<app name>` is the name in the menu bar. An app that runs from source goes by the name of its program instead, such as `Electron` or the name of the Cargo package; `check` says which, and `appshots capture --mac` alone lists the apps that have a window open. It takes the app's frontmost window, without the shadow, and uploads it as a Mac screenshot. When the user opens the screens themselves, give them `appshots shoot <project> overview budgets reports --mac "<app name>"` to paste, as in B of `screens.md`.

3. **If macOS refuses,** the terminal lacks the Screen Recording permission, and the command says where to switch it on: System Settings, Privacy & Security, Screen & System Audio Recording. Only the user can do that. Tell them, or ask them to take each window themselves (Shift-Command-4, then Space, then a click on the window) and upload the files with `appshots upload <project> <file> --name overview --as mac`.

4. **How to land on a screen,** in the order of C in `screens.md`: launch arguments (`open <App>.app --args -appshots stats`), a deep link (`open "<scheme>://stats"`), a debug-only launch argument if the user agreed to one, and otherwise the user opens the screen. `open` only brings a running app to the front, so quit the app before opening it with other arguments: `osascript -e 'quit app "<app name>"'`. Wait two seconds after opening before you capture. An app started from source takes its first screen from what the project already reads at the start, such as an environment variable in front of the command; if it reads none and the user agreed to a change, a few debug-only lines that read one.

5. **Window or full screen.** A captured window is drawn as that window, large and readable, which suits most apps. An app in full screen is drawn inside a MacBook, where its text turns small: at most one such slide, usually the first. Give the window a size that shows the content without empty space before capturing.

6. **Stop what you started.** When the screens are captured, stop the command that runs the app from source. Leave an app the user had open as it is.

For an app on iPhone and Mac, see `devices-languages.md`: the same screens under the same names on both, and a slide set of its own for the Mac.
