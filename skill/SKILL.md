---
name: appshots
description: Make the App Store screenshots for the app in this repository from start to finish. Takes the screens from existing screenshots, the iOS Simulator, a plugged-in iPhone or iPad, a Mac app's window or a web app's pages, writes the headlines and renders the set on the appShots server. For iPhone, iPad, Mac and web apps, whatever they are built with (Xcode, Flutter, React Native, Expo, Capacitor, Tauri, Electron or a web framework). Also makes device mockups of the screens on a transparent background, banners for a README or a link preview, and app preview videos recorded on the Mac in the set's style. Can put the set and the store page's texts into App Store Connect from this Mac with the user's own API key, never submitting anything. Use when asked for App Store or Mac App Store screenshots, store screenshots, a screenshot set, the header and search results assets of an app, device mockups, a README banner or social preview, an app preview video, or to upload screenshots or texts to App Store Connect.
---

# appShots

Turn the app in this repository into a finished set of App Store screenshots: get its screens, write the copy, and build the set on the appShots server at {{SERVER}}.

Follow the steps in order, the same way every time. Say in a line or two what you decided at each step and carry on.

If the user wants the devices alone, such as "iPhone mockups for the website" or "a transparent PNG of the app for the README", read `mockups.md`: no questions, no copy, no slides. For a wide picture with a headline, such as "a banner for the README" or "a social preview for the repository", read `banners.md`. If the set exists and the user only wants it uploaded, or the store page's texts changed, go to step 10.

## Reference files

This file is the short version. The `references` folder next to it holds each step in full, and a step names the file to read. Read it when you reach that step; where it says more than this file, follow it.

| File | What is in it |
| --- | --- |
| `start.md` | Keep it quick, and steps 1 to 5 in full |
| `screens.md` | Step 6 for an iPhone or iPad app, and for screenshots the user has |
| `mac.md` | Step 6 for a Mac app |
| `web.md` | Step 6 for a web app |
| `devices-languages.md` | Several devices, other languages, a logo and other artwork |
| `copy-and-render.md` | Steps 7, 8 and 9 in full |
| `app-store-connect.md` | Step 10: the key, the upload, the store page's texts |
| `mockups.md` | The devices alone, for a website or a README |
| `banners.md` | A banner for a README or a link |

**If a file is missing,** run `appshots update`, which fetches them all. If it is still missing, read it from the server: `curl -fsS {{SERVER}}/skill/<file>`, as in `curl -fsS {{SERVER}}/skill/screens.md`.

## Keep it quick

A set takes about ten minutes when the user supplies or opens the screens, and about twenty when you reach them yourself.

- Use the `appshots` commands for everything on the Mac. No scripts, UI tests, fastlane, Playwright or Puppeteer of your own, and no `xcodebuild` or `xcrun simctl`, except to start an app that `appshots run` does not build.
- Build at most once per device. Two tries per screen, then ask the user to open it.
- Read ten files at most. Render the whole set once, then two rounds of fixes at most.
- Make only what was asked for. Past the time above, stop, say what holds things up, and ask how to go on.

## 1. Check the setup

`appshots` is the file `appshots.mjs` next to this file; where that is not a command, run `node <this skill's folder>/appshots.mjs`. From the app's folder, run:

```bash
appshots check
```

Each line says what to do when something is missing. If a command fails because your shell is sandboxed, ask the user to allow it. If the `Skill:` line says the server has a newer one, run `appshots update`, then read this file again from the top.

**The server's tools** are `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `set_creative_assets`, `check_project`, `render`, `render_mockups`, `list_revisions` and `restore_project`. Use them as MCP tools when this session has an MCP server called `appshots` and its `list_projects` answers. Otherwise, also when it answers 401, use the command:

```bash
appshots tools set_slides                        # one tool's arguments in full
appshots call list_projects
appshots call set_slides @slides.json            # arguments from a file, for anything long
```

A tool that returns pictures saves them and prints where. Open those files to look at them.

If `check` says the server is not set up or did not accept the token, tell the user exactly this, as numbered steps, and stop:

1. Open {{SERVER}}, sign in, and click **Connect an agent** in the sidebar.
2. Pick the agent you are (or **Something else**), then **Do everything for me**, and click **Create token**.
3. Copy the command that appears and paste it into Terminal.
4. Start a new session in this folder and ask for the screenshots again.

Then call `get_design_guide`. With a small context, call it with the topic `core`: it is short and names the topic to read for everything else. The guide wins over anything remembered.

**What kind of app is it?** `check` says what the project is made with, and that decides which file step 6 reads:

- iPhone or iPad app in an Xcode project: `screens.md` B and C.
- iPhone or iPad app made with Flutter, React Native, Expo, Capacitor or Tauri: `screens.md` E.
- Mac app (Xcode, Tauri, Electron, Flutter for macOS): `mac.md`.
- Web app (Next.js, Vite, SvelteKit, Rails, Django and the like): `web.md`.

If `check` recognises nothing, `start.md` says how to tell.

## 2. Ask first

Ask these together, in one message, with this agent's tool for questions if it has one. Leave out what the request or `check` answered; add none of your own. `start.md` has each in full.

1. **Devices:** iPhone only, or the iPad or the iPhone Duo as well? Never ask about sizes. For iPhone and Mac, which of them; for a web app, which devices it is shown on. None for a Mac-only app.
2. **The screens:** *I have screenshots*, *I open each screen, you capture it* (recommend this), or *do it yourself* (recommend this for a web app; for other apps it may need a few debug-only lines, so ask whether that is fine).
3. **Where the app runs,** only when `check` leaves it open: a simulator or the plugged-in device? Is the installed build current?
4. **The look:** light or dark? More languages than the main one?
5. **Extras:** a real rating, download count, award or review? Services whose logos belong on a slide? Their own logo or artwork, and where? Header and search results assets?
6. **App Store Connect:** put the set into it, or do they upload it themselves? With no key in `check`, ask for the issuer ID, the key ID and the path of the `.p8` file. Never ask for what is in the file.

If the user says to decide yourself: iPhone only (the Mac for a web app that only works on a wide screen), do it yourself without changing the app, the appearance the app looks best in, the main language, and no badges, logos, artwork, header and search results assets or upload.

## 3. Understand the app

Read the README, a store description if there is one, and the root view or the router. Take the accent colour from the asset catalogue, theme file or stylesheet. Come out with one sentence a stranger would understand, the four to seven things worth showing, strongest first, and the app's colours.

## 4. Plan the set

Five to eight slides. Slide 1 sells the whole app, each other slide one benefit, and the first three carry the most. Show the plan as a short list (slide, screen, screenshot name, headline), then carry on without waiting. Screenshot names are short lowercase words such as `home` or `stats`. One or two slides may have no screen (`features`, `statement`, `stat`, `steps`, `reviews`); `stat` and `reviews` only with real figures and reviews from the user.

## 5. Create the project

`list_projects` first: continue the app's project if it has one, otherwise `create_project` with the app's name.

## 6. Get the screens

Read the file for this kind of app, and take the way the user chose. Every screen has to be worth showing: believable content, no onboarding, permission prompt, paywall, keyboard, spinner, alert or debug banner, and nothing private.

- The user's screenshots: `appshots upload <project> <folder>`, then `get_project` (`screens.md` A).
- The user opens each screen: give them `appshots shoot <project> home stats --clean` to paste into Terminal (`screens.md` B).
- You do it: `appshots run` once, then `appshots launch <bundle id> --capture <name> --to <project> -- <launch arguments>` for each screen, or one capture plan for them all (`screens.md` C).
- A Mac app: `appshots capture --mac "<app name>" --name <name> --project <project>` (`mac.md`).
- A web app: `appshots capture --web <address> --name <name> --project <project>` (`web.md`).

For several devices, other languages, or a logo and artwork, read `devices-languages.md` too. Look at each picture in `./raw-shots` before moving on.

## 7. Write the copy

Read `copy-and-render.md`. A headline is two to five words and one benefit, with the word that matters in `*asterisks*`. Most slides need no subheadline. No "best", "ultimate" or "#1", nothing the app does not do, and no badges, figures, reviews or logos the user did not give you: invented ones get the app rejected.

## 8. Build and render

Follow `copy-and-render.md`. In short:

1. `set_slides` with the whole set and a theme from the app: its accent colour, a background in the same family, one font. Vary the layouts.
2. With screenshots of more than one device, `set_slides` again for each other device (`"device": "ipad"`, `"mac"` or `"duo"`), composed for its canvas.
3. `check_project` with what you will give `render`. It names what the render would refuse or warn about, and uses no render. Fix that first.
4. `render` with `"creatives": []`, and look at every contact sheet as a customer would.
5. Fix with `update_slide`, then render only those slides, in one call. Two rounds at most. Each render uses one of the account's renders; when none are left, say so and stop.

**App preview videos.** When the user asks for an app preview video, run `appshots video guide` and follow it. The CLI records the app on the Mac, the server draws the captions in the project's style, and the CLI cuts the video, checks it against Apple's rules and can place it in App Store Connect.

## 9. Hand over

Tell the user the Studio link, {{SERVER}}/#/<project>, how to get the files (**Export ZIP**, or `appshots pull <project>`), the slides with their headlines, and what you assumed or left out. `copy-and-render.md` has the whole list. If they said yes to the upload, go on with step 10.

## 10. Put it into App Store Connect

Only when the user asked for it. Follow `app-store-connect.md` step by step: the key, a dry run shown to the user, their yes, then the upload. Whatever happens:

- **The key file is not yours to read.** Use its path, never its contents: do not open, print, copy or move it. A key pasted into the chat is not used; tell the user to revoke it. The key, its path and the IDs never go to the appShots server.
- **Nothing is submitted or released.** `appshots store` only changes a version being prepared; the user submits it.
