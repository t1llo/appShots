---
title: Quick start
description: Make your first set of App Store screenshots with appShots. Sign in, connect your agent with one command or add screenshots by hand, then export the ZIP.
---

There are two ways to a finished set. Both end in the same place: a project in the Studio that you can still edit by hand, and a ZIP of PNG files for App Store Connect.

## What you need

- A Google account, to sign in.
- **With an agent:** a Mac with [Node.js](https://nodejs.org) 18 or newer and a coding agent (Claude Code, Codex, OpenCode, Pi or another). An iPhone or iPad app needs Xcode as well. A [web app](/docs/web-apps) needs Chrome, Edge or Brave instead.
- **By hand:** a browser and screenshots of your app.

## With an agent

1. Open [the Studio](/studio) and sign in with Google.
2. Click **Connect an agent** in the sidebar. Pick your agent, then **Do everything for me**, then **Create token**.
3. Copy the command that appears and paste it into Terminal. It looks like this:

   ```bash
   curl -fsS {{SERVER}}/install.sh | APPSHOTS_TOKEN=<your token> sh -s claude
   ```

4. Open your agent in your app's folder, in a new session, and start the skill:

   | Agent | How to start |
   | --- | --- |
   | Claude Code | `/appshots` |
   | Codex | `$appshots` |
   | OpenCode | Ask: "Make my App Store screenshots" |
   | Pi | `/skill:appshots` |
   | Another agent | "Read `~/.agents/skills/appshots/SKILL.md` and follow it" |

5. Answer its questions: iPhone or iPad, where the screens come from, light or dark, and any real rating or award to show.

The agent gets the screens, writes the headlines, builds the set and renders it. The set shows up in the Studio as it goes. Expect about ten minutes when you open the screens yourself, and about twenty when the agent reaches them on its own.

[Connect an agent](/docs/connect) explains what the command sets up, and [The skill](/docs/skill) what the agent does step by step.

## By hand

1. Open [the Studio](/studio) and sign in with Google.
2. Click **New project** and name it after your app.
3. Drag your screenshots from Finder onto the page. In the iOS Simulator, ⌘S saves the current screen to the desktop.
4. Click a slide, pick a layout, type the headline, and click a screenshot to put it in the slide. **+ Add slide** adds the next one.
5. Set the look once for the whole set under the **Project** tab: background, font and colours.
6. Click **Export ZIP**.

[The Studio](/docs/studio) covers every control.

## Then

- Upload the files to App Store Connect, by hand or with `appshots store push`. See [Upload to App Store Connect](/docs/app-store-connect).
- Read [What App Review accepts](/docs/app-review) before you put ratings, awards or logos on a slide.
