---
title: Slides
description: Reference for an appShots slide. Every layout, the copy fields, device options, backgrounds, fonts, badges, feature cards, icon rows and icons, with the exact values an agent or the API accepts.
---

A set is a list of up to ten slides. A slide is one screenshot image for the store: a layout, some copy, and a screenshot inside a device. This page lists every field. The Studio's editor sets the same fields, so it reads as a map of the editor too.

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

## Copy

| Field | What it is |
| --- | --- |
| `eyebrow` | A small uppercase line above the headline |
| `headline` | The main line. Two to five words read best |
| `subheadline` | One supporting line under it |

- `*Asterisks*` around a word tint it with the accent colour.
- `\n` forces a line break.
- Text shrinks to fit its space, so nothing is cut off.
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
| `align` | `center` or `left` | `center` |
| `textScale` | 0.5 to 1.5. A multiplier for the headline size | 1 |
| `device` | The device options. See below | |

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
| `frame` | `auto`, `iphone`, `ipad`, `none`. `auto` matches the screenshot, and `none` shows the bare rounded screen | `auto` |
| `color` | {{DEVICE_COLORS}} | `black` |
| `scale` | 0.4 to 1.6 | 1 |
| `rotate` | -45 to 45 degrees | 0 |
| `perspective` | `none`, `left`, `right`. A 3D turn towards one side | `none` |
| `offsetX` | -60 to 60, in % of the canvas width | 0 |
| `offsetY` | -60 to 60, in % of the canvas height | 0 |
| `shadow` | `none`, `soft`, `strong` | `soft` |

## Badges

Up to four per slide, in `badges`. `badgePosition` puts them at the `top`, above the headline, or at the `bottom`, below the subheadline.

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

`features` holds up to eight entries, most important first. On the `features` layout they are the cards that fill the slide. On every other layout they are short points beside the headline.

| Field | What it is |
| --- | --- |
| `title` | The feature, in two to four words. Required |
| `text` | One short supporting line |
| `icon` | An icon id |
| `value` | A big figure or word in place of the icon, such as "0", "24h" or "100%" |

`featureStyle` on the `features` layout:

{{FEATURE_STYLES}}

`featureStyle` for points on the other layouts:

{{POINT_STYLES}}

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

## Fonts

{{FONT_COUNT}} fonts, all served by the server itself. The value of `font` is the id in brackets.

{{FONTS}}

## Icons

{{ICON_COUNT}} icons, for badges, features and icon rows.

{{ICON_GROUPS}}

**Brand logos** ({{BRAND_COUNT}}): {{BRANDS}}

A brand logo is somebody's trademark. See [What App Review accepts](/docs/app-review#other-companies-names-and-logos).
