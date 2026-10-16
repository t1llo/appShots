# Steps 1 to 5 in full

Part of the appshots skill: what keeps a set quick, and steps 1 to 5 of SKILL.md with everything they say.

## Keep it quick

A set takes about ten minutes when the user supplies or opens the screens, and about twenty when you reach them yourself. What makes it take an hour is building the app from scratch, hunting for screens by trial and error, reading the whole codebase, and rendering over and over. So:

- **Use the `appshots` commands for everything on the Mac.** Do not write shell scripts, Swift scripts, UI tests, fastlane lanes or Playwright and Puppeteer scripts to take screenshots, and do not call `xcodebuild` or `xcrun simctl` yourself. `appshots run`, `launch`, `boot`, `capture` and `simctl` do it the same way each time and know which Xcode, which simulator and which browser to use. The one exception is starting an app that `appshots run` does not build: a Mac app, or an app made with another toolkit, starts with the project's own command, which `appshots check` names (`mac.md`, E in `screens.md`, and `web.md`).
- **Build at most once per device,** with `appshots run` or the project's own run command. `appshots run` reuses the build Xcode already made. Skip it when the app is installed or running already.
- **Two tries per screen.** If a screen does not come up after two attempts, ask the user to open it and capture it then.
- **Read little.** The README, the root view with its tabs or navigation, and the accent colour. Ten of the app's files at most; this skill's reference files do not count.
- **Render the whole set once,** then fix what is off in one go. Two rounds of fixes at most. Where the account's renders are counted, every `render` uses one, so do not render slide by slide.
- **Only what was asked for.** An iPad or iPhone Duo set, more languages, and header and search results assets each cost time; make them when the user said yes to them. The same goes for the upload to App Store Connect and for the store page's texts.
- If you pass the time above, stop, say what is holding things up, and ask how to go on.

## 1. Check the setup

The `appshots` command is the file `appshots.mjs` in this skill's folder, next to SKILL.md. The skill writes `appshots` for short; where that is not a command, run `node <this skill's folder>/appshots.mjs`.

Run this first, from the app's folder:

```bash
appshots check
```

It reports in one go: whether the server answers, whether this skill is the current one, whether an App Store Connect key is saved on this Mac, which Xcode there is, the project in this folder and what it is made with, the commands that start it, the simulators it would use, the apps installed on the booted ones, and plugged-in devices. Each line says what to do when something is missing. These commands need the network and, depending on the app, Xcode and the simulator or a browser; if your shell is sandboxed and one fails for that reason, ask the user to allow it.

If the `Skill:` line says the server has a newer one, run `appshots update`. When the line says to read SKILL.md again, read it from the top and follow the new one; otherwise go on. If `check` is not a command this copy knows, it is an old one: ask the user to run the setup command again, as described below.

**The server's tools** are `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `set_creative_assets`, `check_project`, `render`, `render_mockups`, `list_revisions` and `restore_project`. There are two ways to reach them, and the rest of this skill names only the tool:

- As MCP tools, when this session has an MCP server called `appshots` and its `list_projects` answers.
- Through the command, in every other case, including an MCP server that answers 401:

  ```bash
  appshots tools set_slides                        # one tool's arguments
  appshots call list_projects
  appshots call set_slides @slides.json            # arguments from a file, for anything long
  ```

  A tool that returns pictures saves them and prints where. Open those files to look at them.

The tools show the parts of a slide, such as `badges`, `features` or `device`, as objects, to keep their list short. `get_design_guide` with the topic `fields` lists what each of them takes; without MCP, that is `appshots call get_design_guide '{"topic":"fields"}'`.

If `check` says the server is not set up or did not accept the token, the setup has not been run on this Mac. One command does all of it, and only the user can get it, because it carries their token. Tell them exactly this, as numbered steps, and stop:

1. Open {{SERVER}}, sign in, and click **Connect an agent** in the sidebar.
2. Pick the agent you are (or **Something else**), then **Do everything for me**, and click **Create token**.
3. Copy the command that appears and paste it into Terminal.
4. Start a new session in this folder and ask for the screenshots again.

Then call `get_design_guide` and read it. It is the current reference for layouts, feature slides, backgrounds, fonts, badges, icon and logo rows, the app's logo and other placed images, copy, Mac apps, the header and search results assets and banners, and it wins over anything remembered. With a small context, call it with the topic `core` instead: a short version that names the topic to read for everything else.

**Find out what kind of app this is** before you ask anything. It decides where the app runs, and an app is always captured where it runs. `check` says what the project is made with and gives the commands; this table says what follows from it:

| The app | It runs | It is started by | A screen is captured with | Step 6 |
| --- | --- | --- | --- | --- |
| iPhone or iPad app in an Xcode project | in the iOS Simulator, or on a plugged-in device | `appshots run` | `appshots capture --clean` | `screens.md` B, C |
| iPhone or iPad app made with Flutter, React Native, Expo, Capacitor or Tauri | in the iOS Simulator | `appshots boot`, then the toolkit's own command | `appshots capture --clean` | `screens.md` E |
| Mac app: Xcode, Tauri, Electron, Flutter for macOS | in a window on this Mac | the project's own command | `appshots capture --mac <app>` | `mac.md` |
| Web app: Next.js, Vite, SvelteKit, Rails, Django and the like | as pages in a browser | its dev server | `appshots capture --web <address>` | `web.md` |

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
6. **App Store Connect:** shall the finished set be put into App Store Connect as well, or do they upload it themselves? Not for a web app that is not in the App Store. It needs an App Store Connect API key of their own, which stays on this Mac. If the `App Store Connect:` line of `check` shows no key, ask for it with the same question, in the words of The key in `app-store-connect.md`: the issuer ID, the key ID, and the path of the `.p8` file. Never ask for what is in the file.

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
