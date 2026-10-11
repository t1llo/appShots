---
title: Render and export
description: Render an appShots project to PNGs at exact App Store sizes and download them as a ZIP, from the Studio, the appshots command or an agent. Includes where each file goes in App Store Connect.
---

Rendering turns the slides into PNG files at the exact pixel sizes App Store Connect accepts. The previews in the Studio are drawn by the same code, so the files look like the previews.

## Three ways

**In the Studio.** Press **Export ZIP** on the project page. It renders everything and downloads `<project>-screenshots.zip`.

**From the Mac.**

```bash
appshots pull streaks --render
appshots pull streaks --render --out ~/Desktop/streaks
```

The files land in `./store-screenshots/streaks`, or in the folder after `--out`. Without `--render` you get the files of the last render.

**Through an agent.** The `render` tool renders, shows the agent a contact sheet to check, and returns a link to every file. To iterate, it renders single slides:

```json
{ "project": "streaks", "slides": [3] }
```

## What is in the ZIP

```
en-US/
  iphone-6.9/01.png … 08.png
  ipad-13/01.png … 08.png
  creative-assets/header.png
  creative-assets/search.png
de-DE/
  …
```

One folder per language, then one per size, with the slides numbered in store order. The files are PNGs without transparency, which is what App Store Connect asks for.

## Which sizes

| Your project has | Rendered by default |
| --- | --- |
| iPhone screenshots | `iphone-6.9` |
| iPhone and iPad screenshots | `iphone-6.9` and `ipad-13` |
| iPad screenshots only | `ipad-13` |

Those two are the sizes App Store Connect asks for, and it scales them down for smaller devices itself. For the older sizes, pass `targets` to `render`. See [Sizes](/docs/sizes).

## How long it takes

Every language and every size is a full pass over the set. A set in three languages takes about three times as long as the same set in one.

The server renders one job at a time. Yours waits its turn if somebody else's is running. One account can have one render running and one waiting. A third is refused with "A render is already running for this account", so wait for the first to finish.

## Upload to App Store Connect

1. Open your app in [App Store Connect](https://appstoreconnect.apple.com), then the version you are preparing.
2. Under **Previews and Screenshots**, pick the language at the top right.
3. Drag the files of `iphone-6.9` onto the 6.9-inch iPhone display, and those of `ipad-13` onto the 13-inch iPad display. The file names keep them in order.
4. Do the same for each language.
5. Header and search results images go on the **Header and Search Results** tab. See [Header and search results](/docs/store-assets).

App Store Connect takes up to ten screenshots per language and size. An appShots set has at most ten slides, so a whole set fits.

## Render again

A render replaces the last one. Render again after you change a slide, replace a screenshot, or when [an update](/docs/update) redraws a layout. Projects are never rendered by themselves.
