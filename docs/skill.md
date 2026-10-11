---
title: The appshots skill
nav: The skill
description: What the appshots skill makes a coding agent do, step by step. It checks the setup, asks five questions, captures the screens, writes the headlines, then builds and renders the set.
---

The skill is a page of instructions your agent follows to turn the app in the current folder into a finished set. It works the same way every time, which is what keeps a set to ten or twenty minutes. You can read it at [`/skill.md`](/skill.md).

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

## What the agent does

1. **Checks the setup** with `appshots check`: the server, the token, Xcode, the project, simulators and devices. If the server has a newer skill, it updates itself first.
2. **Asks you a few questions**, all at once. They are listed below.
3. **Reads a little of your code**: the README, the root view, the accent colour. It wants one sentence on what the app does and the four to seven things worth showing.
4. **Plans five to eight slides** and shows you the list: slide, screen, headline. The first slide sells the whole app, and the rest take one benefit each.
5. **Creates the project**, or continues the one your app has already.
6. **Gets the screens**, the way you chose. See [Get your screens in](/docs/screens).
7. **Writes the copy**: headlines of two to five words, one benefit each.
8. **Builds and renders** the set, looks at the result, and fixes single slides. Two rounds at most.
9. **Hands over**: the link to the project in the Studio, how to get the files, and what it assumed or left out.

## The questions it asks

| Question | Your choices |
| --- | --- |
| Devices | iPhone only, iPhone and iPad, or iPad only |
| The screens | You have screenshots. You open each screen and it captures. Or it does everything itself |
| Where the app runs | A simulator, or the plugged-in iPhone or iPad |
| The look | Light or dark, and which languages |
| Extras | A real rating, download count, award or review. Logos of services the app works with. Your own logo or artwork. Header and search results images |

Say "decide yourself" and it takes: iPhone only, does everything itself without changing your app, the appearance the app looks best in, the main language, and no badges, logos, artwork or header images.

**"You open each screen" is the quickest way to real content.** The agent starts the app and gives you one command to paste. You open each screen and press Return.

## What it will not do

- **Invent figures.** Badges show only the ratings, download counts, awards and reviews you gave it. Invented ones get an app rejected.
- **Draw, generate or download artwork.** It uses the files you give it or the ones in your repository.
- **Write scripts or UI tests** to take screenshots. It uses the `appshots` command for everything on the Mac.
- **Change your app without asking.** Reaching a screen sometimes needs a few lines that only exist in debug builds. It asks first and tells you which file it changed.
- **Make videos.** appShots makes still images.

## Get a better set

- Give it the real numbers up front: "4.8 stars from 2,100 ratings, 50K downloads".
- Name the screens that matter: "the stats screen is the point of the app".
- Put believable content in the app first. Empty lists make empty screenshots.
- Ask for changes in plain words afterwards: "slide 3: move the phone down a little and shorten the headline". The agent changes that slide and renders only it.
- Or finish in [the Studio](/docs/studio). Every slide the agent made can be edited by hand.

## Keep it current

The skill checks for a newer version of itself at the start of every job. To do it by hand, run `appshots update`. See [Update](/docs/update).
