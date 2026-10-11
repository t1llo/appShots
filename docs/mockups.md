---
title: Mockups
nav: Mockups
description: Turn raw app screenshots into device mockups with a transparent background. One PNG per screenshot of the iPhone, iPhone Duo, iPad or Mac alone, for a website, a README or a deck, from the Studio, the appshots command or an agent.
---

A mockup is one of your screenshots inside its device, with nothing behind it. The file is a PNG with a transparent background, so it sits on a page of any colour: a landing page, a GitHub README, a press kit, a slide deck.

Mockups come from the same raw screenshots as the App Store set. A project needs no slides, no headlines and no theme to have them. They are not for App Store Connect, which accepts no transparency. For that, see [Render and export](/docs/export).

## Three ways

**In the Studio.** Open the project and switch from **App Store** to **Mockups** at the top. Every screenshot is shown in its device. Set the device on the right, then press **PNG** under a mockup, **Copy** to paste it into a design or a document, or **Download all** for a ZIP.

**From the Mac.**

```bash
appshots mockups streaks
appshots mockups streaks --style clay --shadow soft --width 1200
```

The files land in `./mockups/streaks`, or in the folder after `--out`. See [the command's options](/docs/cli#mockups).

**Through an agent.** The `render_mockups` tool draws them and returns a link to every PNG and a picture to check. Ask for it in plain words, such as "give me transparent iPhone mockups of these screens for the website". See [MCP tools](/docs/mcp#render-mockups).

## What you get

One PNG per screenshot and device, named after both:

```
home-iphone.png
stats-iphone.png
home-ipad.png
home-mac.png
```

Each file is cut to the device and its shadow, with no margin around it. **Download all** and `appshots mockups` deliver them as `<project>-mockups.zip`.

Left alone, a mockup shows the screenshot pixel for pixel, which is the sharpest it gets. A 1320 pixel wide iPhone screenshot makes a PNG about 1430 pixels wide, because the frame adds to it. Set a width when you need a certain size. A tilted device makes a wider picture than an upright one.

## The device

The same settings apply to every mockup of a project. They are saved with the project and are separate from the theme of the App Store set, so changing one never changes the other.

| Setting | What it does |
| --- | --- |
| Device look | `real`, the default, or `clay`, `outline` or `sketch` |
| Device colour | `black`, `silver`, `natural`, `gold`, `blue` or `orange` |
| Frame | Matches the screenshot unless you pick one. `none` gives the bare screenshot with rounded corners. A Mac screenshot comes out as a window or inside a MacBook, as on a slide. See [Mac apps](/docs/mac#a-window-or-a-macbook) |
| Shadow | `none`, the default, or `soft` or `strong`. The shadow is part of the PNG and falls straight down |
| Tilt | Turns the device, from -45 to 45 degrees |
| Turn in 3D | Turns it towards the left or the right |
| Status bar | `cover` or `overlay` draws a clean one, with the time you set. See [Slides](/docs/slides#status-bar) |
| Width | The width of each PNG in pixels, from 200 to 4000. Left empty: pixel for pixel |

A line drawing (`outline`, `sketch`) is near black unless you pick a device colour. On a dark page, pick `silver`.

The **Transparent**, **Light** and **Dark** switch above the mockups only changes what the previews stand on, to see how they look on your page. The PNG stays transparent.

## Languages

A project in several languages has a mockup per language wherever that language has its own screenshot. The language switch above the mockups picks which ones you see. **Download all** holds the first language's mockups, and a folder per other language with the ones that differ. `appshots mockups streaks --lang de-DE` fetches one language only. See [Languages](/docs/languages#screenshots-per-language).

## On a web page

A mockup at its own size is larger than most pages need, which keeps it sharp on high-resolution screens. Let the page scale it:

```html
<img src="home-iphone.png" alt="The home screen of Streaks" width="320">
```

In a README:

```markdown
<img src="docs/home-iphone.png" alt="The home screen of Streaks" width="320">
```

## What it costs

Nothing. Drawing mockups does not use any of the account's [renders](/docs/export#how-many-renders). A mockup is drawn when it is asked for, which takes a second or two each, so a ZIP of many takes a moment.

For a wide picture with a headline and a background, such as the top of a README, see [Banners](/docs/banners).
