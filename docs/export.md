---
title: Render and export
description: Render an appShots project to PNGs at exact App Store sizes and download them as a ZIP, from the Studio, the appshots command or an agent. Includes where each file goes in App Store Connect.
---

Rendering turns the slides into PNG files at the exact pixel sizes App Store Connect accepts. The previews in the Studio are drawn by the same code, so the files look like the previews.

## Three ways

**In the Studio.** Press **Export ZIP** on the project page. It renders everything in the background and downloads `<project>-screenshots.zip` when it is done. You can keep working meanwhile. See [In the background](#in-the-background).

**From the Mac.**

```bash
appshots pull streaks --render
appshots pull streaks --render --out ~/Desktop/streaks
```

The files land in `./store-screenshots/streaks`, or in the folder after `--out`. Without `--render` you get the files of the last render.

**Through an agent.** The `render` tool renders, shows the agent a contact sheet to check, and returns a link to every file. It can render single slides too:

```json
{ "project": "streaks", "slides": [3] }
```

Every call uses one of the account's renders, whatever it draws. See [How many renders](#how-many-renders).

## What is in the ZIP

```
README.txt
en-US/
  iphone-6.9/01.png … 08.png
  iphone-6.3/01.png … 08.png
  iphone-6.5/01.png … 08.png
  iphone-6.1/01.png … 08.png
  ipad-13/01.png … 08.png
  ipad-11/01.png … 08.png
  mac-2880/01.png … 08.png
  creative-assets/header.png
  creative-assets/search.png
  banners/readme.png
de-DE/
  …
```

One folder per language, then one per display of App Store Connect, with the slides numbered in store order. `README.txt` lists which folder goes onto which display. `banners` holds the pictures for outside the store, when the project has any. See [Banners](/docs/banners). The files are PNGs without transparency at the exact pixel size of their display, which is what App Store Connect asks for.

## Which sizes

You design the set once per device. The export holds it at every size:

| Your project has | The export holds |
| --- | --- |
| iPhone screenshots | `iphone-6.9`, `iphone-6.3`, `iphone-6.5`, `iphone-6.1` |
| iPhone Duo screenshots as well | `iphone-duo` too |
| iPad screenshots as well | `ipad-13` and `ipad-11` too |
| Mac screenshots as well | `mac-2880` too |

Sizes of the same shape are the same picture scaled, so they look alike on every display. The sizes for older devices are left out until you tick them under **Project → Export sizes**. See [Sizes](/docs/sizes).

## How long it takes

Every language and every device is a full pass over the set. A set in three languages takes about three times as long as the same set in one. The extra sizes of a device cost next to nothing, because they are the same picture scaled.

The server renders one job at a time. Yours waits its turn if somebody else's is running. One account can have one render running and one waiting. A third is refused with "Two renders are already under way for this account", so wait for one to finish.

## In the background

A render started in the Studio runs on the server and does not need the page. Keep editing, open another project, switch to another tab or close the laptop lid: the render goes on.

- **It draws the project as it was when you pressed the button.** What you change while it runs is in the next render, not in this one.
- **Renders** in the sidebar shows the progress, and the × beside a running render cancels it.
- When it is done, the ZIP downloads by itself. If the tab was in the background, its title says the render is done and the download starts when you look at it again.
- **Notify me when it is done** lets your browser show a notification. It asks for permission once.
- A finished render stays in the list for ten minutes, and **Download ZIP** fetches the files again. They are kept until the next render replaces them.

A render stops if the server restarts, for instance for an update. The Studio says so, and you start it again. It has not used a render.

## How many renders

An account gets {{RENDERS}} renders. One render is one press of **Export ZIP**, one `appshots pull --render`, or one call of the `render` tool, whatever it draws: a single slide counts the same as the whole set in every language.

- Previews in the Studio are free. You only use a render when you export.
- A render that fails or that you cancel uses none.
- The Studio shows how many are left beside **Renders** in the sidebar, and the `render` tool tells the agent after each call.
- Downloading the ZIP of the last render again uses none.

When none are left, ask the person who runs the server for more. Their own renders are not counted.

## Upload to App Store Connect

1. Open your app in [App Store Connect](https://appstoreconnect.apple.com), then the version you are preparing.
2. Under **Previews and Screenshots**, pick the language at the top right.
3. Open a display and drag all files of its folder onto it. The file names keep them in order.
4. Do the same for each language.
5. Header and search results images go on the **Header and Search Results** tab. See [Header and search results](/docs/store-assets).
6. Banners are not for App Store Connect. See [where each one goes](/docs/banners#where-each-one-goes).

| Display in App Store Connect | Folder |
| --- | --- |
| iPhone with Dynamic Island (large display) | `iphone-6.9` |
| iPhone with Dynamic Island (medium display) | `iphone-6.3` |
| iPhone with Face ID (large display) | `iphone-6.5` |
| iPhone with Face ID (medium display) | `iphone-6.1` |
| iPhone Duo | `iphone-duo` |
| iPad 13" display | `ipad-13` |
| iPad 11" display | `ipad-11` |
| Mac, on the macOS version of the app | `mac-2880` |

**A display only takes its own sizes.** A file from another folder is refused as having the wrong dimensions. A display you leave empty is filled by App Store Connect from a larger one, so you can also upload the largest iPhone and iPad folders alone.

App Store Connect takes up to ten screenshots per language and display. An appShots set has at most ten slides, so a whole set fits.

## Render again

A render replaces the last one. Render again after you change a slide, replace a screenshot, or when [an update](/docs/update) redraws a layout. Projects are never rendered by themselves.
