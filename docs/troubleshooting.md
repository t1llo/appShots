---
title: Troubleshooting
description: Fixes for the common appShots problems. Sign-in errors, an agent that cannot see the skill or the MCP server, 401 answers, capture failures in the simulator or on a device, and render problems.
---

Start with this. It reports the server, the token, the skill, Xcode, simulators and devices, and every line says what to do next:

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

**`appshots: command not found`.** The command is in `~/.local/bin`, which is not on your `PATH`. Open a new Terminal window, or add this line to `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

**The agent does not know `/appshots`.** Skills are read when a session starts. Start a new session. If it is still missing, run `appshots check` and look at the `Skill:` line.

**The agent has the skill but no appshots tools.** The MCP connection is missing or was added while the session was running. Start a new session. The skill works without MCP too, through `appshots call`.

**401 Unauthorized.** The token was revoked, or it belongs to another server. Create a new one under **Connect an agent** and run the setup command again. See [Connect an agent](/docs/connect).

**The setup command stops at "Node.js 18 or newer is needed".** Install Node.js 18 or newer from [nodejs.org](https://nodejs.org), then run it again.

**You connected through a connector dialog and it asks for a sign-in page.** appShots has no OAuth. Add it with a header instead. See [Connect an agent](/docs/connect#only-the-mcp-connection).

## Capturing

**"simctl failed" or no simulators.** Xcode is not installed, or it was never opened. Install it from the App Store, open it once, and let it install the iOS platform.

**No booted simulator.** Start your app from Xcode, or run `appshots run`.

**The build fails in `appshots run`.** Build the app in Xcode first and fix what it reports. If the folder has several projects or schemes, name them with `--project` and `--scheme`.

**The device is not found.** Plug it in, unlock it, and tap **Trust** on it. Capturing from a device needs Xcode 27 or newer. A simulator works with any recent Xcode.

**The status bar shows the wrong time.** Add `--clean`. It works in the simulator only.

**The screenshot shows the launch screen.** The app needed longer to settle. Add `--wait 5`.

## Slides

**A device is empty.** The slide names a screenshot that is not uploaded. The render lists the missing names. Upload it under exactly that name.

**An iPad slide shows a phone screen.** The project has no iPad screenshot under that name. Upload one with the same name. See [Sizes](/docs/sizes#iphone-or-ipad).

**The headline is tiny.** Text shrinks to fit. Shorten the headline, force a line break, or lower the device with the position control.

**A screenshot was taken for the wrong device kind.** Upload it again, or delete it under **Screenshots** and upload the right one.

**The preview does not show a change the agent made.** The Studio checks for changes every few seconds. Reload the page if it stays behind.

## Rendering and exporting

**"A render is already running for this account".** One render runs and one waits per account. Wait for the first to finish.

**"Nothing has been rendered yet".** `appshots pull` downloads the last render. Add `--render`.

**The export takes long.** Every language and every size is a full pass. The server also renders one job at a time for everybody, so yours may be waiting.

**App Store Connect refuses a file.** Check that it went onto the display it was made for: the folder name says which. See [Sizes](/docs/sizes).

**The files look different from before.** A project is drawn by the current version of appShots each time. See [Update](/docs/update).

## Limits

**"This account is limited to {{MAX_PROJECTS}} projects", or the same about screenshots or images.** Delete what you no longer need. The limits are in [Accounts, tokens and limits](/docs/accounts#limits).

## Still stuck

<!-- if contact -->
Write to [{{CONTACT}}](mailto:{{CONTACT}}) and include what `appshots check` prints. Leave your token out.
<!-- else -->
Ask the person who runs this server, and include what `appshots check` prints. Leave your token out.
<!-- endif -->
