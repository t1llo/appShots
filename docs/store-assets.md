---
title: Header and search results
description: Make the wide product page header and search results images for App Store Connect with appShots. The three sizes, their safe areas, the three layouts, and every field.
---

Besides screenshots, App Store Connect takes wide images on its **Header and Search Results** tab: one shown at the top of the product page, one shown with the app in search results. appShots makes both from the screenshots, theme and fonts the project has already.

They are optional. A project has none until you add one.

For a wide picture outside the store, such as the top of a README, see [Banners](/docs/banners).

## The three assets

{{PLACEMENTS}}

Make `header` and `search`, or one `universal` file that App Store Connect crops for both places.

## The safe area

Each device crops these images differently. Only the **safe area**, a rectangle in the middle, is shown everywhere. The table gives its size and where its top left corner is.

- Copy and the main subject go inside it. appShots places the copy there for you.
- The rest of the canvas is background and devices that may be cut off.
- **Show safe area** in the Studio, and the previews an agent gets, draw it as a dashed frame. The frame is never in the exported file.

## Layouts

{{CREATIVE_LAYOUTS}}

`fan` shows up to five screenshots, `sides` up to four and `wall` up to six. Further ones are left out. `split` is the layout of [banners](/docs/banners), where nothing is cropped.

## Fields

```json
{
  "header": {
    "layout": "fan",
    "headline": "Build *habits* that stick",
    "screenshots": ["home", "stats", "detail"]
  }
}
```

| Field | What it is |
| --- | --- |
| `layout` | `fan`, `sides` or `wall`. Default `fan` |
| `eyebrow`, `headline`, `subheadline` | The copy, as on a slide. Keep it to one short phrase |
| `screenshots` | Up to six names of uploaded screenshots, most important first. Without any, the asset is copy on the background |
| `badges` | Up to three, as on a slide |
| `badgePosition` | `top` or `bottom` |
| `logo` | Your app's own logo or icon. See [Logos and artwork](/docs/images) |
| `background`, `textColor`, `accentColor`, `font`, `textScale` | As on a slide. Left out, the project's theme decides |
| `device` | `frame`, `color`, `scale` and `shadow` |

The copy is always centred, because it has to stay inside the safe area.

## Make them

**In the Studio:** the **Header and search results** section of the project page adds, previews and edits each one.

**Through an agent:** `set_creative_assets`, then `render`:

```json
{ "project": "streaks", "creatives": ["header", "search"] }
```

Each asset you pass replaces that one, and the others stay. `"remove": ["universal"]` deletes one.

## Export

They are rendered with the slides and land in the ZIP as:

```
en-US/creative-assets/header.png
en-US/creative-assets/search.png
en-US/creative-assets/universal.png
```

One per language. See [Render and export](/docs/export).

## Rules

- No other company's logo, and no icon row. Apple does not allow them here.
- One short phrase of copy. These images are seen small.
- Real figures only in badges.

See [What App Review accepts](/docs/app-review#header-and-search-results-images).
