---
title: appShots documentation
nav: Overview
description: What appShots is, what it makes and where to start. App Store screenshots for iPhone and iPad, built by hand in the Studio or by a coding agent over MCP.
---

appShots makes App Store screenshots. You give it the raw screens of your app. It puts them in device frames with a headline, a background and badges, and exports PNG files at the exact sizes App Store Connect accepts.

You can build a set by hand in the Studio, the editor in your browser, or let a coding agent such as Claude Code or Codex make the whole set while you watch.

## Start here

- **[Quick start](/docs/quick-start)**: your first set in about ten minutes.
- **[Connect an agent](/docs/connect)**: one command sets up Claude Code, Codex, OpenCode, Pi or another agent.
- **[Update](/docs/update)**: what updates by itself, and the one command for the rest.

## The four parts

| Part | Where it runs | What it does |
| --- | --- | --- |
| Studio | Your browser, at {{SERVER}} | Shows every slide as a live preview at export size. You edit copy, layout and look, and download the set as a ZIP. |
| MCP server | {{SERVER}}/mcp | Nine tools that let an agent create projects, write slides and render them. |
| `appshots` command | Your Mac | Runs your app in the simulator, captures screens from the simulator or a plugged-in iPhone or iPad, and uploads them. |
| `appshots` skill | Your agent | The instructions for the whole job: ask a few questions, get the screens, write the headlines, build the set, check the render. |

The server draws the pictures. It cannot see your Mac, your simulator or your phone, which is why capturing happens on your machine and the result is uploaded.

## What it makes

- Portrait screenshots for every iPhone, iPhone Duo and iPad display App Store Connect lists, up to ten per set. You design once per device and get every size. See [Output sizes](/docs/sizes).
- The wide images for the Header and Search Results tab of App Store Connect. See [Header and search results](/docs/store-assets).
- Any number of languages from one set. See [Languages](/docs/languages).

## What it does not make

- Landscape screenshots, or screenshots for Apple Watch, Apple TV, Mac or Vision Pro.
- App preview videos.
- Anything for Google Play. The sizes and the device frames are Apple's.

## All pages

**Make a set:** [The skill](/docs/skill) · [Get your screens in](/docs/screens) · [The Studio](/docs/studio) · [Logos and artwork](/docs/images) · [Languages](/docs/languages) · [Render and export](/docs/export) · [What App Review accepts](/docs/app-review)

**Reference:** [Slides](/docs/slides) · [Header and search results](/docs/store-assets) · [Output sizes](/docs/sizes) · [The appshots command](/docs/cli) · [MCP tools](/docs/mcp) · [REST API](/docs/api)

**Help:** [Accounts, tokens and limits](/docs/accounts) · [Troubleshooting](/docs/troubleshooting) · [Questions and answers](/docs/faq)

**Legal:** [Privacy policy](/privacy) · [Terms of use](/terms)

## For agents reading this

Every page is also plain Markdown: add `.md` to its address, as in `{{SERVER}}/docs/quick-start.md`. [`/llms.txt`](/llms.txt) lists all pages, [`/llms-full.txt`](/llms-full.txt) is all of them in one file, and [`/skill.md`](/skill.md) is the skill an agent follows to make a set.
