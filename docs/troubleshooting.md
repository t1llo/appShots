---
title: Troubleshooting
description: Fixes for the common appShots problems. Sign-in errors, an agent that cannot see the skill or the MCP server, 401 answers, capture failures in the simulator or on a device, and render problems.
---

Start with this. It reports the server, the token, the skill, Xcode, the project and what it is made with, simulators and devices, and every line says what to do next:

```bash
appshots check
```

## Signing in

| The home page says | What to do |
| --- | --- |
| That Google account is not on the list | The server only admits listed people. Ask whoever runs it to add your address |
| Google sign-in was cancelled | You closed Google's page. Try again |
| That sign-in expired | It took longer than ten minutes, or cookies are blocked. Allow cookies for this site and try again |
| Google has not verified that email address | Use a Google account whose address is verified |
| Too many sign-in attempts | Wait fifteen minutes |

## Connecting an agent

**`appshots: command not found`.** The setup command makes `appshots` a command only when `~/.local/bin`, `~/bin` or the folder Claude Code sits in is already on your `PATH`. Otherwise it said `Command installed: node ~/.claude/skills/appshots/appshots.mjs`, and that is how you run it, as the skill does. To have the short command, add this line to `~/.zshrc`, open a new Terminal window and run the setup command again:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

**The agent does not know `/appshots`.** Skills are read when a session starts. Start a new session. If it is still missing, run `appshots check` and look at the `Skill:` line.

**The agent has the skill but no appshots tools.** The MCP connection is missing or was added while the session was running. Start a new session. The skill works without MCP too, through `appshots call`.

**401 Unauthorized.** The token was revoked, or it belongs to another server. Create a new one under **Connect an agent** and run the setup command again. See [Connect an agent](/docs/connect).

**The setup command stops at "Node.js 18 or newer is needed".** Node.js is missing, or the one first on your `PATH` is older; the message names its version. Install Node.js 18 or newer from [nodejs.org](https://nodejs.org) or with `brew install node`, then run it again. `node --version` says which one a new Terminal window finds.

**A connector in claude.ai, Claude Desktop or ChatGPT cannot connect.** The app connects from its maker's servers, so the server has to be reachable from the internet over HTTPS: one on `localhost` or in your home network is out of its reach. Behind a reverse proxy, `PUBLIC_URL` has to be the public address. When appShots' own page says the app cannot connect, it says why. Remove appShots from the app and add it again. See [Add it as a connector](/docs/connect#add-it-as-a-connector).

**A connector worked and now asks to connect again.** It was disconnected under **Settings → Connected apps**, it went unused for 30 days, or the account it signed in with was deleted. Connect it again in the app.

## Capturing

**"simctl failed" or no simulators.** Xcode is not installed, or it was never opened. Install it from the App Store, open it once, and let it install the iOS platform.

**"xcrun simctl … did not answer within … seconds".** The simulator service has stopped answering, which happens most with many simulators booted at once. Shut down the ones you do not need, or all of them with `xcrun simctl shutdown all`. If that hangs too, `killall -9 com.apple.CoreSimulator.CoreSimulatorService` restarts the service. Then try again.

**`appshots check` says no iPhone Pro Max simulator is installed.** The screenshots of the closest one are scaled to the store's sizes, which works but is less sharp. `appshots run --create` adds the model when this Xcode has it; at the Terminal, `run` asks first. Otherwise add a newer iOS in Xcode under **Settings → Components**.

**No booted simulator.** Start your app from Xcode, or run `appshots run`. For an app made with Flutter, React Native, Expo, Capacitor or Tauri, run `appshots boot` and then the toolkit's own run command.

**The build fails in `appshots run`.** Build the app in Xcode first and fix what it reports. If the folder has several projects or schemes, name them with `--project` and `--scheme`.

**The device is not found.** Plug it in, unlock it, and tap **Trust** on it. Capturing from a device needs Xcode 27 or newer. A simulator works with any recent Xcode.

**The status bar shows the wrong time.** Add `--clean`. It works in the simulator only.

**The screenshot shows the launch screen.** The app needed longer to settle. Without `--wait`, the capture waits until the screen stops changing, four seconds at most, and an app that shows a spinner or an animation for longer needs `--wait 5`.

**`~/Library/Caches/appshots` takes a lot of space.** It holds the build logs of `appshots run`, and with `--fresh` the builds themselves. `appshots clean --builds --older-than 30` removes those of projects not built for a month, and `--dry-run` shows what that would be first.

**"Could not capture the window" with `--mac`.** macOS only lets a program take pictures of windows with the Screen Recording permission. Switch on your terminal app under **System Settings → Privacy & Security → Screen & System Audio Recording**, then quit and reopen the terminal. Or take the window yourself with Shift-Command-4, Space and a click, and upload the file with `--as mac`. See [Mac apps](/docs/mac#get-the-screens-in).

**`--mac` does not find the app.** The app has to be open with a window on screen. Use its name as the menu bar shows it. The command lists the apps it can see.

**`appshots run` says the project is a Mac app.** `run` is for the iOS Simulator. Start a Mac app your own way and capture its window with `appshots capture --mac`.

**`appshots run` says there is no Xcode workspace or project.** `run` builds Xcode projects only. An app made with another toolkit and a web app are started by their own command, which `appshots check` names. See [Web apps and other toolkits](/docs/web-apps).

**`--web` says nothing answers at the address.** The dev server is not running, or it took another port than usual. Read the address off what it printed when it started.

**`--web` finds no browser.** It draws pages with Google Chrome, Chromium, Microsoft Edge or Brave, or with the Chromium Playwright keeps in its cache. Install one, run `npx playwright install chromium` in a project that uses Playwright, or set `APPSHOTS_BROWSER` to the program of a Chromium browser.

**A web page shows a sign-in or an empty state.** The browser the command starts has a profile of its own and knows none of your sign-ins. Put sample data in with `--init`, or keep a session between captures with `--profile`. See [Reach a screen](/docs/web-apps#reach-a-screen).

**A web app's slides have no status bar.** The capture leaves its place free. Set **Status bar** to overlay in the device settings, or `"device": {"statusBar": "overlay"}` in the theme.

## Slides

**A device is empty.** The slide names a screenshot that is not uploaded. The render lists the missing names. Upload it under exactly that name.

**An iPad slide shows a phone screen.** The project has no iPad screenshot under that name. Upload one with the same name. See [Sizes](/docs/sizes#which-device-a-screenshot-counts-as).

**A Mac screenshot sits in a MacBook, or does not, and it should be the other way.** A captured window is shown as a window, and a display-shaped picture in a MacBook. Set **Frame** in the slide's device settings to **MacBook** or **No frame**. See [Mac apps](/docs/mac#a-window-or-a-macbook).

**App Store Connect says the dimensions are wrong.** Each display only takes its own sizes. Drag the files of the folder named after that display, as listed in the `README.txt` of the ZIP. See [Render and export](/docs/export#upload-to-app-store-connect).

**A screenshot is filed under the wrong device.** Change it with the small menu on its thumbnail under **Assets** in the Studio, or upload it again with `--as iphone`, `--as duo`, `--as ipad` or `--as mac`.

**The headline is tiny.** Text shrinks to fit. Shorten the headline, force a line break, or lower the device with the position control.

**A screenshot was taken for the wrong device kind.** Upload it again, or delete it under **Screenshots** and upload the right one.

**The preview does not show a change the agent made.** The Studio checks for changes every few seconds. Reload the page if it stays behind.

## Rendering and exporting

**"Two renders are already under way for this account".** One render runs and one waits per account. Wait for one to finish, or cancel one with the × beside it under **Renders** in the sidebar.

**"This account has used all of its renders".** Every export uses one render, and the account has none left. Ask the person who runs the server for more. See [Accounts, tokens and limits](/docs/accounts#renders).

**"The render stopped because the server restarted".** The server was updated or restarted while it was drawing. Press **Export ZIP** again. The stopped render was not counted.

**The ZIP did not download when the render was done.** It downloads by itself in the tab that started the render. Press **Download ZIP** under **Renders** in the sidebar. Some browsers block a download that starts in a background tab.

**"Nothing has been rendered yet".** `appshots pull` downloads the last render. Add `--render`.

**The export takes long.** Every language and every size is a full pass. The server also renders one job at a time for everybody, so yours may be waiting.

**App Store Connect refuses a file.** Check that it went onto the display it was made for: the folder name says which. See [Sizes](/docs/sizes).

**The files look different from before.** A project is drawn by the current version of appShots each time. See [Update](/docs/update).

## Limits

**"This account is limited to {{MAX_PROJECTS}} projects", or the same about screenshots or images.** Delete what you no longer need. The limits are in [Accounts, tokens and limits](/docs/accounts#limits).

**"This account keeps … of screenshots and images and has room for {{MAX_UPLOADS}}".** Uploads of all your projects count together. Delete screenshots you no longer use, those of languages a project no longer has first: the Studio lists them under **Languages taken out** on a project's **Assets** page. Deleting a project frees all of its own.

**"The picture is … pixels, more than any screen has".** The file is larger than a screenshot can be, often a picture scaled up or stitched together. Upload the screenshot as the device took it.

## Still stuck

<!-- if contact -->
Write to [{{CONTACT}}](mailto:{{CONTACT}}) and include what `appshots check` prints. Leave your token out.
<!-- else -->
Ask the person who runs this server, and include what `appshots check` prints. Leave your token out.
<!-- endif -->
