---
title: Mac apps
description: Make Mac App Store screenshots with appShots. Capture a Mac app's window, show it as a window or inside a MacBook, and export landscape pictures at 2880 × 1800, alone or beside an iPhone and iPad set.
---

appShots makes the screenshots of a macOS app the same way as those of an iPhone app. The Mac is one more device beside the iPhone, the iPhone Duo and the iPad: it has its own screenshots, its own preview in the Studio and its own folder in the export. The pictures are landscape.

An app that runs on the iPhone and the Mac keeps both in one project.

## What the Mac App Store takes

One to ten landscape pictures of 16:10. appShots exports `mac-2880`, which is 2880 × 1800. The store accepts three smaller sizes as well, and one size is all it needs. See [Sizes](/docs/sizes).

## Get the screens in

A Mac app runs on your Mac, not in a simulator. Open it, bring it to the screen you want to show, then capture its window:

```bash
appshots capture --mac Ledger --name overview --project ledger
```

`Ledger` is the app's name, as the menu bar shows it. The command takes the app's frontmost window, without the shadow macOS puts around it. To go through several screens, `shoot` names each one and waits while you open it:

```bash
appshots shoot ledger overview budgets reports --mac Ledger
```

**The first capture needs a permission.** macOS only lets a program take pictures of windows when the terminal it runs in is switched on under **System Settings → Privacy & Security → Screen & System Audio Recording**. The command says so when macOS refuses.

**Or take the window yourself.** Press Shift-Command-4, then Space, then click the window. macOS saves a PNG to the desktop. Upload it in the Studio, or with:

```bash
appshots upload ledger ~/Desktop/overview.png --as mac
```

`appshots run` and `appshots launch` are for the iOS Simulator. Build and start a Mac app the way the project does, such as with Xcode's Run button.

## Which pictures count as Mac

| The image | It counts as |
| --- | --- |
| Is wider than it is tall | Mac |
| Has see-through round corners, as a captured window has | Mac, whatever its shape |
| Has the exact size of an iPhone or iPad screenshot turned on its side | That iPhone or iPad |

When one lands under the wrong device, change it with the small menu on its thumbnail under **Assets** in the Studio, or upload it again with `--as mac`.

## A window or a MacBook

A Mac screenshot is drawn in one of two ways, and the picture decides:

| The screenshot | Is drawn as |
| --- | --- |
| A captured window | That window, with its own round corners and a soft shadow |
| A picture that fills its rectangle and has about the shape of a display, such as an app in full screen | The screen of a MacBook |
| Any other shape, such as a tall panel | A window |

A display's shape here means between 1.45 and 1.85 times as wide as it is tall.

To choose yourself, set the slide's or the theme's `device`:

```json
{ "device": { "frame": "mac" } }
```

`"frame": "mac"` puts any screenshot in a MacBook, and `"frame": "none"` shows it as a bare window. In the Studio this is **Frame** in the slide's device settings. The MacBook is silver unless you pick another colour, takes the same looks as the other devices (`real`, `clay`, `outline`, `sketch`), and has no status bar.

**Which one to use.** A window suits most apps: it is drawn large, so its text stays readable. A full screen inside a MacBook turns into fine print, and works best as the first slide, where it says "this is a Mac app" at a glance.

## Slides on the wide canvas

Every [layout](/docs/slides#layouts) works for the Mac. The canvas is wide and short, so a few things differ from the portrait sets:

- `device-right` and `device-left` give the copy the narrower part and the device the wider one.
- There is little height. With a device below the copy, one line of headline and one of subheadline is the most that fits well.
- A MacBook that would be cut off only slightly at the bottom is made small enough to show whole.
- In `duo`, `side-by-side` and `trio`, laptops and windows stand level instead of fanned out.
- A `features` slide lays its cards across.

## Mac and iPhone together

A slide refers to a screenshot by name, and each device shows its own picture of that name. So for an app on both, capture the same screen under the same name on each device. The shared slide set then serves them all: the Mac sizes show the Mac's `overview`, the iPhone sizes the iPhone's.

That is the quick way, and the Mac's pictures come out as the iPhone's design on a wide canvas. A Mac set reads better when it is composed for that canvas: the copy beside the window, other screens, another order, fewer slides. Give the Mac a set of its own for that, in the same project:

- In the Studio, pick **Mac** above the slides, then **Give the Mac its own slides**.
- An agent calls `set_slides` with `"device": "mac"`.

The iPhone and the iPad keep the shared set, or get their own the same way. The theme and the languages stay shared, so the sets match. See [A set for each device](/docs/slides#a-set-for-each-device).

**One slide with both.** A name that only has an iPhone screenshot is drawn as an iPhone, also on the Mac canvas. Put a Mac screenshot and an iPhone one into a layout that takes several, and the laptop or window stands in the middle with the phone in front of a lower corner:

```json
{ "layout": "duo", "headline": "Also on your *iPhone*", "screenshot": "overview", "screenshot2": "phone" }
```

`trio` adds a third, such as an iPad on the other side.

## Mockups and banners

- [Mockups](/docs/mockups) draws a Mac screenshot as a MacBook or a window on a transparent background, for a website.
- [Banners](/docs/banners) makes the wide picture at the top of a README and the preview a link shows.

## With an agent

[The skill](/docs/skill) reads the project, sees that it is a Mac app and takes this route by itself. It builds and opens the app, captures its window on each screen, and renders the Mac set. For an app that is on the iPhone as well, it designs the Mac's slides as a set of their own. For the capture it needs the Screen Recording permission above. Without it, it asks you to take the windows yourself.
