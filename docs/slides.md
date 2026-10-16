---
title: Slides
description: Reference for an appShots slide. Every layout, the copy fields, device options, backgrounds, fonts, badges, feature cards, figures, steps, reviews, icon rows and icons, with the exact values an agent or the API accepts.
---

A set is a list of up to ten slides. A slide is one screenshot image for the store: a layout, some copy, and a screenshot inside a device. This page lists every field. The Studio's editor sets the same fields, so it reads as a map of the editor too.

A project has one set that every device shares, and any device can have a set of its own. See [A set for each device](#a-set-for-each-device).

```json
{
  "layout": "device-bottom",
  "eyebrow": "Streaks",
  "headline": "Build *habits* that stick",
  "subheadline": "One tap a day",
  "screenshot": "home",
  "badges": [{ "type": "rating", "title": "4.8", "subtitle": "App Store rating", "stars": 4.8 }]
}
```

Every field is optional.

## Layouts

`layout` decides where the copy and the devices go. The default is `device-bottom`.

{{LAYOUTS}}

Layouts with two or three devices read `screenshot2` and `screenshot3` as well.

The last five have no device. See [Slides without a device](#slides-without-a-device).

In a language read from right to left, such as Arabic or Hebrew, every layout is mirrored: `device-left` puts the device on the right, a group of devices fans out the other way, and steps and points start on the right. The screenshots inside the devices are not flipped. See [Languages](/docs/languages#right-to-left).

## Copy

| Field | What it is |
| --- | --- |
| `eyebrow` | A small uppercase line above the headline |
| `headline` | The main line. Two to five words read best |
| `subheadline` | One supporting line under it |

- `*Asterisks*` around a word mark it. By default it takes the accent colour, and `emphasis` picks another way. See [Marked words](#marked-words).
- `\n` forces a line break.
- Text shrinks to fit its space, so nothing is cut off. A render warns when it had to shrink a lot. See [What a render checks](#what-a-render-checks).
- Each text is a string, or one string per language. See [Languages](/docs/languages).

## Screenshots

`screenshot`, `screenshot2` and `screenshot3` hold the names of uploaded screenshots. A name that does not exist leaves the device empty, and the render warns about it. See [Get your screens in](/docs/screens).

## The look

These fields can be set once in the project's **theme** and again on any slide. The slide wins.

| Field | Values | Default |
| --- | --- | --- |
| `background` | A preset, `auto`, a hex colour, or a custom object. See below | |
| `textColor` | A hex colour | Black or white, whichever reads on the background |
| `accentColor` | A hex colour, for tinted words, the eyebrow and badge stars | |
| `font` | A font id. See below | |
| `align` | `center` or `left`. `left` is the start of the line, so the right in a language read from right to left | `center` |
| `textScale` | 0.5 to 1.5. A multiplier for the headline size | 1 |
| `emphasis` | `tint`, `marker`, `underline`. How a headline shows its `*marked*` words | `tint` |
| `device` | The device options. See below | |

### Marked words

{{EMPHASIS}}

## Backgrounds

- **A preset:** {{BACKGROUNDS}}
- **`auto`:** colours taken from the slide's own screenshot.
- **A hex colour:** `"#0F172A"`.
- **A custom one:**

```json
{ "type": "mesh", "colors": ["#1E3A8A", "#7C3AED", "#EC4899"], "angle": 165, "noise": 0.2 }
```

`type` is `solid`, `gradient` or `mesh`. `colors` takes one to five hex colours. `angle` is the direction of a gradient in degrees, and `noise` is film grain from 0 to 1.

## Device

| Field | Values | Default |
| --- | --- | --- |
| `frame` | `auto`, `iphone`, `duo`, `ipad`, `mac`, `none`. `auto` matches the screenshot, down to a notch or a home button for an older iPhone or iPad. See [Sizes](/docs/sizes#raw-screenshots). `duo` is the unfolded iPhone Duo, `mac` is a MacBook, and `none` shows the bare rounded screen, which for a Mac screenshot is the window alone. See [Mac apps](/docs/mac#a-window-or-a-macbook) | `auto` |
| `style` | `real`, `clay`, `outline`, `sketch`. How the frame is drawn. See [Device look](#device-look) | `real` |
| `color` | {{DEVICE_COLORS}} | `black` |
| `scale` | 0.4 to 1.6 | 1 |
| `rotate` | -45 to 45 degrees. On a layout with several devices it turns them all | 0 |
| `spread` | 0 to 60 degrees. The angle between the devices of `duo`, `side-by-side` and `trio` | 11 for `duo`, 14 for `trio`, 0 for `side-by-side` |
| `gap` | -30 to 30, in % of the canvas width. Pushes those devices apart, or together when negative | 0 |
| `perspective` | `none`, `left`, `right`. A 3D turn towards one side | `none` |
| `offsetX` | -60 to 60, in % of the canvas width | 0 |
| `offsetY` | -60 to 60, in % of the canvas height | 0 |
| `shadow` | `none`, `soft`, `strong` | `soft`, and `none` for an outline or a sketch |
| `statusBar` | `none`, `cover`, `overlay`. See [Status bar](#status-bar) | `none` |
| `statusBarTime` | The time the status bar shows, such as `9:41` | `9:41` |
| `statusBarColor` | `auto`, `light` (white), `dark` (black) | `auto` |

### Device look

`style` is how the frame is drawn. Set it once in the theme, so the whole set matches.

{{DEVICE_STYLES}}

### Two or three devices

On `duo`, `side-by-side` and `trio`, `spread` is the angle between the devices. At 0 they stand parallel, and a larger angle fans them out. `gap` moves them apart or together, and `rotate` turns the whole group.

A group that mixes a Mac screenshot with iPhone or iPad ones is arranged differently: the laptop or window stands in the middle, and the phones and tablets stand in front of its lower corners. `spread` does not apply there. See [Mac apps](/docs/mac#mac-and-iphone-together).

```json
{ "layout": "duo", "screenshot": "home", "screenshot2": "stats", "device": { "spread": 24, "gap": 4 } }
```

### Status bar

A screenshot from a real device shows whatever the device showed: an odd time, a low battery, one bar of signal. `statusBar` draws a clean one instead, with the time, full signal, Wi-Fi and a full battery.

{{STATUS_BARS}}

`statusBarColor` is read off the screenshot unless you set it. Screenshots taken with `appshots capture --clean` in the simulator are clean already and need none of this. A web app's pages taken with `appshots capture --web` have no status bar and leave its place free: `overlay` draws one there.

## Badges

A slide draws up to {{BADGES_SHOWN}} with its copy, from `badges`. `badgePosition` puts them at the `top`, above the headline, or at the `bottom`, below the subheadline. The list itself holds up to ten, because the `reviews` layout also reads its review badges. See [Reviews](#reviews).

{{BADGE_TYPES}}

| Field | What it is |
| --- | --- |
| `title` | The big line, such as "10K+" or "4.9". On a review it is the quote |
| `subtitle` | The small line, such as "Downloads". On a review it is who said it |
| `stars` | 0 to 5. Shows a row of stars filled to this value |
| `icon` | An icon id |
| `tone` | See the table below |

{{BADGE_TONES}}

Badges are claims. Use real figures only. See [What App Review accepts](/docs/app-review#only-real-numbers).

## Features

`features` holds up to eight entries, most important first. On the `features` layout they are the cards that fill the slide, on `stat` the figures, and on `steps` the steps. On every other layout they are short points beside the headline.

| Field | What it is |
| --- | --- |
| `title` | The feature, in two to four words. Required |
| `text` | One short supporting line |
| `icon` | An icon id |
| `value` | A big figure or word in place of the icon, such as "0", "24h" or "100%". On `stat` it is the figure, and on `steps` it replaces the step's number |
| `color` | A hex colour for this entry alone: its icon, its figure and its card. Left out, the accent colour |
| `image` | The name of an uploaded image shown in place of the icon, such as a small illustration. See [Logos and artwork](/docs/images) |
| `screenshot` | The name of an uploaded screenshot shown small. On a card it stands under the title and runs off the card's lower edge, and on a step it stands beside the text |

`featureStyle` on the `features` layout:

{{FEATURE_STYLES}}

`featureStyle` for points on the other layouts:

{{POINT_STYLES}}

### The cards

`featureCards` sets what the cards of the `features` layout are made of.

```json
{ "layout": "features", "featureStyle": "grid", "featureCards": { "look": "solid", "icons": "badge", "columns": 2 } }
```

| Field | Values | Default |
| --- | --- | --- |
| `look` | See below | `glass` |
| `icons` | See below | `gradient` |
| `columns` | 1 to 4 cards across, for `grid`, `cards` and `list`. A bento arranges itself | The canvas decides |

{{CARD_LOOKS}}

{{CARD_ICONS}}

## Slides without a device

Five layouts show no device. They carry what a screenshot cannot: a claim, a number, a way of working, what people say. One or two in a set of ten is plenty, and the first slides should still show the app.

| Layout | What it reads | Good for |
| --- | --- | --- |
| `features` | `features`, as cards | What the app does, at a glance |
| `statement` | The headline alone, set very large | A claim, a promise or a question |
| `stat` | `features`: the first is the giant figure, the next ones a row of smaller figures | One number that carries the pitch |
| `steps` | `features`, as numbered steps | How it works, in three or four steps |
| `reviews` | The `review` badges, as a wall of quote cards | What users and the press say |

```json
{
  "layout": "stat",
  "headline": "Loved by *runners*",
  "features": [
    { "value": "2M+", "title": "Runs logged" },
    { "value": "4.8", "title": "App Store rating" },
    { "value": "120", "title": "Countries" }
  ]
}
```

```json
{
  "layout": "steps",
  "headline": "Up and running in *a minute*",
  "features": [
    { "title": "Pick a goal", "text": "Distance, time or pace.", "screenshot": "goal" },
    { "title": "Run", "text": "The watch does the counting." },
    { "title": "See the week", "text": "Every run on one page." }
  ]
}
```

### Reviews

The `reviews` layout draws up to {{REVIEWS_SHOWN}} badges of the type `review` as its wall. `title` is the quote, `subtitle` is who said it, and `stars` adds the row of stars. A publication works the same way, with its name as the `subtitle`. Badges of other types stay with the copy as on any slide. Review badges past the {{REVIEWS_SHOWN}}th are left out: they never move into the copy.

```json
{
  "layout": "reviews",
  "headline": "People *stay*",
  "badges": [
    { "type": "review", "title": "The only tracker I kept past January.", "subtitle": "Maya, App Store review", "stars": 5 },
    { "type": "review", "title": "Quietly excellent.", "subtitle": "The Sweet Setup" }
  ]
}
```

Figures and quotes are claims. Use real ones only, and a quote only with the right to use it. See [What App Review accepts](/docs/app-review#only-real-numbers).

## Icon row

A row of up to eight icons or brand logos with the copy, for the services your app works with.

```json
{ "iconRow": { "label": "Works with", "icons": ["spotify", "slack", "notion"], "style": "tiles" } }
```

| Field | Values | Default |
| --- | --- | --- |
| `icons` | One to eight icon ids, in the order shown | Required |
| `label` | A short line over the row | |
| `style` | See below | `tiles` |
| `tone` | See below | `brand` |
| `size` | `small`, `medium`, `large` | `medium` |
| `position` | `top` or `bottom` | `bottom` |

{{ICON_ROW_STYLES}}

{{ICON_ROW_TONES}}

## Logo and images

`logo` shows an uploaded image over the headline, and `images` places up to ten anywhere on the slide. See [Logos and artwork](/docs/images).

## A set for each device

`slides` is the set every device shares. It is drawn again for each canvas, so one design gives an iPhone, an iPad and a Mac set. That is the quickest way to a full export, and the results look alike.

A device can have its own set instead, in `deviceSlides`. The iPad's or the Mac's canvas has another shape and another reader, so a set composed for it usually reads better: another layout, more text beside the device, other screenshots, a different number of slides.

```json
{
  "slides": [{ "headline": "Build *habits* that stick", "screenshot": "home" }],
  "deviceSlides": {
    "ipad": [{ "layout": "device-right", "headline": "Room for the *whole week*", "screenshot": "week" }],
    "mac": [{ "layout": "device-left", "headline": "Plan at *your desk*", "screenshot": "overview" }]
  }
}
```

- The devices are `iphone`, `duo`, `ipad` and `mac`. Each takes one to ten slides.
- A device with its own set draws that set and nothing from `slides`. The other devices keep the shared one.
- The theme, the languages and the screenshots belong to the project, so the sets match in colour and font without repeating them.
- In the Studio, **Give the iPad its own slides** under the device switch starts a set as a copy of the shared one. **Use the shared slides again** removes it.
- An agent passes `device` to `set_slides`, and `of` to `update_slide`. See [MCP tools](/docs/mcp).

## Fonts

{{FONT_COUNT}} fonts, all served by the server itself. The value of `font` is the id in brackets.

{{FONTS}}

## Icons

{{ICON_COUNT}} icons, for badges, features and icon rows.

{{ICON_GROUPS}}

**Brand logos** ({{BRAND_COUNT}}): {{BRANDS}}

A brand logo is somebody's trademark. See [What App Review accepts](/docs/app-review#other-companies-names-and-logos).

## What a render checks

Every render reads the copy of each slide and header or search results image in every language it draws, and measures each page once its copy is fitted. What it finds comes back among the render's warnings, one sentence per finding that names the languages it is in. Nothing it finds stops the render.

How the copy came out:

- **Shrunk.** The copy was set below three quarters of its size to fit, so it reads smaller than the rest of the set. Usually a translation that runs long.
- **Does not fit.** It does not fit even at half its size and runs into what is around it.
- **Too many lines.** The headline takes more than three lines, or four beside a device and on a `statement` slide. On a header or search results image, more than two.
- **Outside the safe area.** Text of a header or search results image stands where some devices crop it away, or text runs off the edge of a slide.

What App Review turns away. These follow the words, in English and the common store languages, so a check can miss a phrasing or warn about one that is fine:

- One of Apple's own recognitions, such as Editors' Choice, App of the Day or an Apple Design Award, unless Apple gave it to the app. Never on a header or search results image.
- A price or a discount, such as "$4.99" or "50% off", and a claim that the app is free.
- A ranking, such as "#1", "No. 1" or "top-rated".
- A date or a year, which makes the set look old once it has passed.
- The Apple logo or the App Store's anywhere, and another platform's, such as Android or Google Play.
- A brand logo where it reads as an endorsement: in an icon row without a label, as a badge's icon, and on a header or search results image.

A font that does not load stops the render with an error, instead of setting the copy in another. See [What App Review accepts](/docs/app-review).
