---
title: The appshots skill
nav: The skill
description: What the appshots skill makes a coding agent do, step by step. It checks the setup, asks a few questions, captures the screens, writes the headlines, then builds and renders the set.
---

The skill is a page of instructions your agent follows to turn the app in the current folder into a finished set. It works the same way every time, which is what keeps a set to ten or twenty minutes. You can read it at [`/skill.md`](/skill.md).

That page is the short version, small enough for an agent on a local model with little context. Each step's full text is in a reference file it names, such as [`/skill/screens.md`](/skill/screens.md) for getting the screens of an iPhone app or [`/skill/copy-and-render.md`](/skill/copy-and-render.md) for the copy and the render. The setup command installs them in a `references` folder beside `SKILL.md`, and the agent reads each one when it reaches its step. One that is missing on your Mac, it fetches from the server.

## Start it

Open the agent in your app's repository, in a new session, then:

| Agent | How to start |
| --- | --- |
| Claude Code | `/appshots` |
| Codex | `$appshots` |
| OpenCode | Ask: "Make my App Store screenshots" |
| Pi | `/skill:appshots` |
| Another agent | "Read `~/.agents/skills/appshots/SKILL.md` and follow it" |

Or just ask for App Store screenshots. An agent that has the skill installed picks it up. Not installed yet? See [Connect an agent](/docs/connect).

The same skill makes [mockups](/docs/mockups): ask for "iPhone mockups of the app for the website" or "a transparent picture of the home screen for the README", and the agent gets the screens, draws each one in its device on a transparent background and puts the files where you want them. It asks no questions for that and writes no headlines.

It also makes [banners](/docs/banners): ask for "a banner for the README" and the agent builds it from the project's screenshots, renders it and puts the file into the repository.

**A Mac app** takes a route of its own, which the agent picks when it reads the project: it builds and opens the app on your Mac and captures its window, instead of using the simulator. See [Mac apps](/docs/mac).

**An app that is not an Xcode project** works too. The agent reads what the project is made with, starts it with the toolkit's own command and captures it where it runs: a Flutter, React Native, Expo or Capacitor app in the simulator, a Tauri or Electron app in its window, and a web app page by page in a browser. See [Web apps and other toolkits](/docs/web-apps).

## What the agent does

1. **Checks the setup** with `appshots check`: the server, the token, Xcode, the project and what it is made with, simulators and devices. If the server has a newer skill, it updates itself first.
2. **Asks you a few questions**, all at once. They are listed below.
3. **Reads a little of your code**: the README, the root view, the accent colour. It wants one sentence on what the app does and the four to seven things worth showing.
4. **Plans five to eight slides** and shows you the list: slide, screen, headline. The first slide sells the whole app, and the rest take one benefit each.
5. **Creates the project**, or continues the one your app has already.
6. **Gets the screens**, the way you chose. See [Get your screens in](/docs/screens).
7. **Writes the copy**: headlines of two to five words, one benefit each.
8. **Builds and renders** the set, looks at the result, and fixes single slides. Two rounds at most. When you asked for more than one device, each gets a set of its own: the same story, composed again for the iPad's or the Mac's canvas. See [A set for each device](/docs/slides#a-set-for-each-device).
9. **Hands over**: the link to the project in the Studio, how to get the files, and what it assumed or left out.
10. **Puts the set into App Store Connect**, if you said yes to that. It shows you what would go where, uploads after your yes, and submits nothing. See [Upload to App Store Connect](/docs/app-store-connect).

## The questions it asks

| Question | Your choices |
| --- | --- |
| Devices | iPhone only, or the iPad or the iPhone Duo as well. For an app that also runs on the Mac, the Mac as well. For a web app, whether to show it on an iPhone, an iPad, a Mac or several. Never about sizes: one design covers every size of a device |
| The screens | You have screenshots. You open each screen and it captures. Or it does everything itself |
| Where the app runs | A simulator, or the plugged-in iPhone or iPad. Not asked for a Mac app or a web app |
| The look | Light or dark, and which languages |
| Extras | A real rating, download count, award or review. Logos of services the app works with. Your own logo or artwork. Header and search results images |
| App Store Connect | Whether it uploads the finished set for you. If yes, and no key is saved on your Mac yet: the issuer ID, the key ID and the path of the key file |

Say "decide yourself" and it takes: iPhone only, does everything itself without changing your app, the appearance the app looks best in, the main language, no badges, logos, artwork or header images, and no upload.

**"You open each screen" is the quickest way to real content.** The agent starts the app and gives you one command to paste. You open each screen and press Return.

## What it will not do

- **Invent figures.** Badges, a slide of figures and a slide of reviews show only the ratings, download counts, awards and reviews you gave it. Invented ones get an app rejected.
- **Draw, generate or download artwork.** It uses the files you give it or the ones in your repository.
- **Write scripts or UI tests** to take screenshots. It uses the `appshots` command for everything on the Mac.
- **Change your app without asking.** Reaching a screen sometimes needs a few lines that only exist in debug builds. It asks first and tells you which file it changed.
- **Make videos.** appShots makes still images.
- **Submit your app.** It can put screenshots and texts into the version you are preparing, when you ask it to. It never submits a version for review or releases one.
- **Read your App Store Connect key.** It asks for the path of the key file and hands that to the `appshots` command. The key stays on your Mac and never reaches the appShots server.

## Get a better set

- Give it the real numbers up front: "4.8 stars from 2,100 ratings, 50K downloads".
- Name the screens that matter: "the stats screen is the point of the app".
- Put believable content in the app first. Empty lists make empty screenshots.
- Ask for changes in plain words afterwards: "slide 3: move the phone down a little and shorten the headline". The agent changes that slide and renders only it.
- Or finish in [the Studio](/docs/studio). Every slide the agent made can be edited by hand.

## Keep it current

The skill checks for a newer version of itself at the start of every job. To do it by hand, run `appshots update`. See [Update](/docs/update).
