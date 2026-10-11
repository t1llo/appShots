---
name: appshots
description: Make the App Store screenshots for the app in this repository from start to finish. Runs the app in the iOS Simulator or uses a plugged-in iPhone or iPad, captures the screens worth showing, writes the headlines, and builds and renders the set on the appShots server. Use when asked for App Store screenshots, store screenshots, a screenshot set, or the header and search results assets of an app.
---

# appShots

Turn the app in this repository into a finished set of App Store screenshots. You do all of it: find out what the app is, get it on screen, capture the right screens, write the copy, and build the set on the appShots server at {{SERVER}}.

Work through the steps in order. Say in a line or two what you decided at each step and carry on. Stop to ask only for things the user alone knows, such as real ratings and download numbers, or which screen to open on their phone.

## 1. Check the setup

Check these before anything else.

- **The `appshots` command.** It captures the screen, uploads it and reaches the server. It is the file `appshots.mjs` in this skill's folder, next to this file. The rest of this skill writes `appshots` for short; where that is not a command, run `node <this skill's folder>/appshots.mjs`. Run `appshots projects` to see that it is there and signed in.
- **Xcode**, for the simulator. If `xcrun simctl` fails because `xcode-select` points at the Command Line Tools, prefix commands with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

These commands need the network, Xcode and the simulator. If your shell is sandboxed and one fails for that reason, ask the user to allow it.

**The server's tools** are `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `set_creative_assets` and `render`. There are two ways to reach them, and the rest of this skill names only the tool:

- As MCP tools, when this session has an MCP server called `appshots` and its `list_projects` answers.
- Through the command, in every other case, including an MCP server that answers 401:

  ```bash
  appshots tools                                   # every tool and its arguments
  appshots tools set_slides                        # one tool's arguments in full
  appshots call list_projects
  appshots call create_project '{"name": "Streaks"}'
  appshots call set_slides @slides.json            # arguments from a file, for anything long
  ```

  A tool that returns pictures saves them and prints where. Open those files to look at them.

If `appshots projects` fails because the command is missing or not signed in, the setup has not been run on this Mac. One command does all of it, and only the user can get it, because it carries their token. Do not hand them separate commands to piece together. Tell them exactly this, as numbered steps, and stop:

1. Open {{SERVER}}, sign in, and click **Connect an agent** in the sidebar.
2. Pick the agent you are (or **Something else**), then **Do everything for me**, and click **Create token**.
3. Copy the command that appears and paste it into Terminal.
4. Start a new session in this folder and ask for the screenshots again.

Then call `get_design_guide` and read it. It is the current reference for layouts, backgrounds, fonts, badges, copy and the header and search results assets, and it wins over anything remembered.

## 2. Understand the app

Read before you capture: the README, the store description if the repository has one (`fastlane/metadata`, a marketing site, `*.xcstrings`), the root view and the navigation, the main screens, and the accent colour in the asset catalogue.

Come out of it with:

- What the app does, in one sentence a stranger would understand.
- The four to seven things worth showing, strongest first. Each one is a screen and a benefit.
- The look: the app's own colours, and whether it reads better in light or dark.
- Which devices it runs on. An app that supports iPad gets an iPad set as well.

## 3. Plan the set

Five to eight slides. Slide 1 sells the whole app and the rest take one benefit each, in the order somebody would care about them. People decide on the first three, so those carry the most.

Write the plan down as a short list (slide, screen to capture, screenshot name, headline) and show it to the user. Then carry on without waiting.

Screenshot names are short lowercase words such as `home`, `stats` or `detail`. Slides refer to screenshots by these names.

## 4. Create the project

`list_projects` first: continue the app's project if it has one, otherwise `create_project` with the app's name. Capturing needs the project id.

## 5. Get the app on screen

Run `appshots devices` to see what is there.

**A plugged-in, unlocked iPhone or iPad comes first.** It has the user's real content, which looks better than anything seeded. You cannot touch it, so name the screen you need, ask the user to open it, capture with `--device`, and go on to the next. Ask them to keep private content off the screen.

**Otherwise use the simulator.**

- Pick the newest Pro Max iPhone simulator, which matches the 6.9-inch store size, and an iPad Pro 13-inch for the iPad set. `xcrun simctl list devices available` lists them.
- Build and launch the app the way this project does it. For a plain Xcode project: `xcodebuild -list -json` for the scheme, `xcrun simctl boot <udid>`, `open -a Simulator`, `xcodebuild -scheme <scheme> -destination "platform=iOS Simulator,id=<udid>" -derivedDataPath build/appshots build`, then `xcrun simctl install <udid> <path to .app>` and `xcrun simctl launch <udid> <bundle id>`. React Native, Expo and Flutter projects have their own run command; use it.
- If this session has a tool that drives the simulator (tap, swipe, type), use it to move through the app.
- Without one, reach screens with what the app already supports: deep links (`xcrun simctl openurl <udid> "<scheme>://..."`), launch arguments, a demo or debug mode. Read the code to find them. Failing that, ask the user to open the screen and tell you when it is up.
- Do not change the app's code to make this easier unless the user agrees.

**Make every screen worth showing.**

- Empty states sell nothing. Fill the app with believable content first: a demo or sample-data mode, preview fixtures, launch arguments, or enter it through the UI. Use realistic names and numbers, never "Test 1" or lorem ipsum.
- Get past onboarding, permission prompts, paywalls and sign-in before capturing. No keyboard, no spinner, no alert, no debug banner on screen.
- Set the appearance on purpose: `xcrun simctl ui <udid> appearance dark` or `light`.

**Capture and upload** in one go:

```bash
appshots capture --name home --project <project> --clean
appshots capture --name home --project <project> --device   # from the plugged-in phone
```

`--clean` gives the simulator the 9:41 status bar with full battery and signal. The PNG is also saved in `./raw-shots`. Open each one and look at it before moving on. Capture again under the same name to replace it. For the iPad set, capture the same names on the iPad simulator; one name holds both.

Do not commit `raw-shots/`.

## 6. Write the copy

- A headline is two to five words and one benefit. Say what the user gets, not what the feature is called: "Never miss a day", not "Reminder notifications". Verb first where it fits.
- Wrap the one word that matters in `*asterisks*` to tint it.
- A subheadline is one short sentence, and most slides are better without it.
- Use the words the app itself uses. No "best", "ultimate" or "#1", and nothing the app does not do.
- Badges only with real figures the user gave you or the repository proves. Ask once if the user has a rating, a download count or an award to show; without one, leave badges out. Invented ones get the app rejected.
- Write in the app's main language. Add other languages only when asked, as `{"en-US": "...", "de-DE": "..."}` maps, with the locales listed on the project.

## 7. Build and render

1. `set_slides` with the whole set and the theme. Take the theme from the app: its accent colour, a muted background in the same family or `auto`, one font for the set. Vary the layouts so it does not read as one template repeated.
2. `render`. Look at the contact sheet it returns as a customer would: is each headline readable at thumbnail size, does the device crop hide the point of the screen, does the set hold together?
3. Fix what is off with `update_slide` and render again. Two or three rounds is normal. Stop when it is good, not when it is perfect.
4. `set_creative_assets` for the product page header and the search results image, then `render` once more. Keep their copy to one short phrase inside the dashed safe area; Apple reviews these more strictly than screenshots.

## 8. Hand over

Tell the user:

- The Studio link, {{SERVER}}/#/<project>, where every slide can still be edited by hand.
- How to get the files: **Export ZIP** in the Studio, or `appshots pull <project>` for `./store-screenshots/<project>`.
- The slides with their headlines, in order.
- What you assumed or left out: no iPad set, no badges, a screen you could not reach.
- That the header and search results assets should be checked in App Store Connect's preview before submitting.
- If the `appshots` MCP server answered 401 and you used the command instead: running the setup command again, from this folder, repairs the connection.
