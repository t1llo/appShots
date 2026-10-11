---
name: appshots
description: Make the App Store screenshots for the app in this repository from start to finish. Asks a few questions, takes the screens from screenshots the user already has, from the iOS Simulator or from a plugged-in iPhone or iPad, writes the headlines, and builds and renders the set on the appShots server. Use when asked for App Store screenshots, store screenshots, a screenshot set, or the header and search results assets of an app.
---

# appShots

Turn the app in this repository into a finished set of App Store screenshots: get its screens, write the copy, and build the set on the appShots server at {{SERVER}}.

Follow the steps in order, the same way every time. Say in a line or two what you decided at each step and carry on.

## Keep it quick

A set takes about ten minutes when the user supplies or opens the screens, and about twenty when you reach them yourself. What makes it take an hour is building the app from scratch, hunting for screens by trial and error, reading the whole codebase, and rendering over and over. So:

- **Use the `appshots` commands for everything on the Mac.** Do not write shell scripts, Swift scripts, UI tests or fastlane lanes to take screenshots, and do not call `xcodebuild` or `xcrun simctl` yourself. `appshots run`, `launch`, `capture` and `simctl` do it the same way each time and know which Xcode and which simulator to use.
- **Build at most once per device,** with `appshots run`. It reuses the build Xcode already made. Skip it when the app is installed already.
- **Two tries per screen.** If a screen does not come up after two attempts, ask the user to open it and capture it then.
- **Read little.** The README, the root view with its tabs or navigation, and the accent colour. Ten files at most.
- **Render the whole set once,** then fix what is off in one go. Two rounds of fixes at most. Where the account's renders are counted, every `render` uses one, so do not render slide by slide.
- **Only what was asked for.** An iPad or iPhone Duo set, more languages, and header and search results assets each cost time; make them when the user said yes to them.
- If you pass the time above, stop, say what is holding things up, and ask how to go on.

## 1. Check the setup

The `appshots` command is the file `appshots.mjs` in this skill's folder, next to this file. The rest of this skill writes `appshots` for short; where that is not a command, run `node <this skill's folder>/appshots.mjs`.

Run this first, from the app's folder:

```bash
appshots check
```

It reports in one go: whether the server answers, whether this skill is the current one, which Xcode there is, the project and scheme in this folder, the simulators it would use, the apps installed on the booted ones, and plugged-in devices. Each line says what to do when something is missing. These commands need the network, Xcode and the simulator; if your shell is sandboxed and one fails for that reason, ask the user to allow it.

If the `Skill:` line says the server has a newer one, run `appshots update`, then read this file again from the top and follow the new one. If `check` is not a command this copy knows, it is an old one: ask the user to run the setup command again, as described below.

**The server's tools** are `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `set_creative_assets` and `render`. There are two ways to reach them, and the rest of this skill names only the tool:

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

Then call `get_design_guide` and read it. It is the current reference for layouts, feature slides, backgrounds, fonts, badges, icon and logo rows, the app's logo and other placed images, copy and the header and search results assets, and it wins over anything remembered.

## 2. Ask first

Ask these together, in one message, before doing anything else. Use this agent's tool for asking the user questions if it has one. Leave out whatever the request or `appshots check` has already answered, and do not add questions of your own.

1. **Devices:** iPhone only, or the iPad or the iPhone Duo as well? One design per device covers every size of it, so never ask about sizes.
2. **The screens:** how do we get them?
   - *I have screenshots.* They give you the folder.
   - *I open each screen, you capture it.* The quickest way to real content, and the one to recommend.
   - *Do it yourself.* You start the app on each screen. Slower, and it may need a few lines in the app that only exist in debug builds; ask whether adding them is fine.
3. **Where the app runs,** only when `check` leaves it open: on a simulator or on the plugged-in iPhone or iPad? Name the ones `check` listed. If the app is installed on a booted simulator, ask whether that is the current build.
4. **The look:** light or dark? Which languages, if more than the app's main one?
5. **Extras:** Is there a real rating, download count, award or review to show? Services the app works with, whose logos belong on a slide? A logo, mascot or other artwork of their own to put on the slides, and where the files are? Header and search results assets as well?

If the user says to decide yourself: iPhone only, do it yourself without changing the app, the appearance the app looks best in, the main language, no badges, no logos, no artwork, no header and search results assets.

## 3. Understand the app

Read the README, the store description if the repository has one (`fastlane/metadata`, a marketing site), and the root view with its tabs or navigation. Take the accent colour from the asset catalogue.

Come out of it with what the app does in one sentence a stranger would understand, the four to seven things worth showing with the strongest first, and the app's own colours.

## 4. Plan the set

Five to eight slides. Slide 1 sells the whole app and the rest take one benefit each, in the order somebody would care about them. People decide on the first three, so those carry the most.

Write the plan as a short list (slide, screen, screenshot name, headline) and show it to the user. Then carry on without waiting.

Screenshot names are short lowercase words such as `home`, `stats` or `detail`. Slides refer to screenshots by these names. Not every slide needs a screen: a `features` slide lists what the app does as cards with icons, and a text slide with badges or a row of logos can open or close the set. One or two of those per set.

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

Then `get_project` lists what is there. Open the files to see what each one shows, and use those names in the slides. iPhone, iPhone Duo and iPad are told apart by the size of the image, and one name can hold one of each. `get_project` says which device each one counts as; if that is wrong, upload it again with `--as iphone`, `--as duo` or `--as ipad`.

### B. The user opens each screen

First the app has to be running where it will be captured:

- **Simulator, app installed** (it is under `Apps:` in `appshots check`): `appshots launch <bundle id>`, with `--dark` or `--light` and `--lang <code>` as asked.
- **Simulator, app not installed:** `appshots run`, with the same options, and `--ipad` for the iPad or `--duo` for the iPhone Duo.
- **Plugged-in iPhone or iPad:** the user opens the app on it and keeps it unlocked.

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

   It finds the project and scheme, boots the simulator, builds in Xcode's own build folder, installs and launches, and prints the bundle id. A first build can take several minutes, so give the command a long timeout and do not start a second one. If it says Xcode is building right now, wait and run it again. React Native, Expo and Flutter apps: use the project's own run command for this one step.

2. **Capture each screen with one command:**

   ```bash
   appshots launch <bundle id> --capture stats --to <project> -- <launch arguments>
   ```

   It starts the app again with those arguments, waits two seconds (`--wait 5` for a slow screen), takes the screenshot with the 9:41 status bar, and uploads it. Add `--dark` or `--light`, `--lang de`, and `--sim "<name>"` when several simulators are booted. Run these one after the other, not at the same time.

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

For the iPad or the Duo set, capture the same names on that simulator. One name holds one screenshot of each device, and every slide picks the one of the device it is drawn for.

For another language, when the user asked for it and the app itself is translated: list the language in the project's `locales` first, then capture the same names again with `--lang`, which starts the app in that language and files the screenshot under it:

```bash
appshots launch <bundle id> --lang de-DE --capture stats --to <project> -- <launch arguments>
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
- Badges only with the real figures and reviews the user gave you in step 2. Without any, leave badges out. Invented ones get the app rejected.
- A row of logos only for services the app really works with, as the user named them in step 2.
- The app's logo belongs on the first slide, not on every one. Other artwork: one to three images on a slide, clear of the headline and of the part of the screen the slide is about.
- Write in the app's main language. Add other languages only when asked, as `{"en-US": "...", "de-DE": "..."}` maps, with the locales listed on the project. The first locale is the one the others fall back to, for texts and screenshots alike.

## 8. Build and render

1. `set_slides` with the whole set and the theme. Take the theme from the app: its accent colour, a muted background in the same family or `auto`, one font for the set. Vary the layouts so it does not read as one template repeated: one device, a close-up, the device beside a column of feature points, two or three devices on one slide, a feature slide. If the screenshots come from a real device and show an odd time or a low battery, set `"device": {"statusBar": "cover"}` in the theme: it paints a clean 9:41 status bar over theirs. The theme's `device.style` draws the frames as `clay`, `outline` or `sketch` instead of the real device, when the user wants a calmer or a hand-drawn look; on a slide with two or three devices, `device.spread` is the angle between them.
2. `render` with `"creatives": []`. It writes every size of every device the project has screenshots of, from the one design: sizes of the same shape are the same picture scaled, so there is nothing to design per size and no `targets` to pass. Look at the contact sheet it returns for each device as a customer would: is each headline readable at thumbnail size, does the device crop hide the point of the screen, does the set hold together?
3. Fix everything that is off with `update_slide`, then render those slides in one call, as in `"slides": [2, 5], "creatives": []`. Two rounds at most. `render` says how many renders the account has left when they are counted: each call uses one, so never spend one on a single small fix, and when none are left, say so and stop. The person who runs the server can give the account more. Stop when it is good, not when it is perfect. When the device hides the point of its screen or crowds the copy, move or resize it on that slide with `device`: `scale`, `offsetX` and `offsetY`, in small steps. A placed image that covers something moves with its `x`, `y` and `size`; with an iPad set, look at both, because the same numbers land elsewhere on the wider canvas.
4. Only if the user asked for them: `set_creative_assets` for the product page header and the search results image, then `render` with `"creatives": ["header", "search"]`. Keep their copy to one short phrase. The preview marks the safe area with a dashed frame so you can check that the copy is inside it; that frame is not in the file. Apple reviews these more strictly than screenshots.

appShots makes still images. If the user asks for an app preview video, say that this skill does not make one.

## 9. Hand over

Tell the user:

- The Studio link, {{SERVER}}/#/<project>, where every slide can still be edited by hand.
- How to get the files: **Export ZIP** in the Studio, or `appshots pull <project>` for `./store-screenshots/<project>`. There is one folder per display of App Store Connect, and `README.txt` says which folder goes onto which display. A display only takes the files of its own folder.
- The slides with their headlines, in order.
- What you assumed or left out: no iPad or Duo set, no badges, a screen you could not reach, a file you changed for the debug launch argument.
- That header and search results assets, if made, should be checked in App Store Connect's preview before submitting.
- If the `appshots` MCP server answered 401 and you used the command instead: running the setup command again, from this folder, repairs the connection.
