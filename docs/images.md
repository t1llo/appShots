---
title: Logos and artwork
description: Put your own logo, app icon, mascot or stickers on App Store screenshots with appShots. How to upload images, show a logo over the headline, and place artwork anywhere on a slide.
---

Besides screenshots, a project holds images: your logo or app icon, a mascot, stickers, shapes. A slide can show one as its **logo** and place up to ten more **anywhere** on the canvas.

## Upload

In the Studio, drop the files on **Logos and images**. From the Mac:

```bash
appshots upload streaks logo.svg mascot.png --image
appshots upload streaks AppIcon.png --image --name app-icon
```

`--image` is what says these are not screenshots. Like a screenshot, an image has a name, and uploading under the same name replaces it on every slide.

| | |
| --- | --- |
| Formats | PNG, SVG, JPEG, WebP. Transparency is kept |
| Size | Up to 20 MB a file |
| Stored as | A PNG of at most 2048 pixels a side. An SVG is drawn once, when it is uploaded |
| How many | {{MAX_SHOTS}} per project |

A PNG or SVG with a transparent background works best.

## A logo over the headline

Pick it under **Your logo** in the slide's editor, or set `logo` on the slide:

```json
{ "logo": { "image": "app-icon", "size": "medium", "shape": "app-icon" } }
```

- `size`: `small`, `medium` or `large`.
- `shape`:

{{LOGO_SHAPES}}

The logo belongs on the first slide, not on every one.

## Artwork anywhere on a slide

In the Studio, select a slide, click an image to place it, and drag it in the large preview. Size, turn, opacity, shadow, mirroring and the layer are in the slide's editor, with ready arrangements for several images at once.

As data, each entry of `images` is:

| Field | Meaning | Default |
| --- | --- | --- |
| `image` | The name of an uploaded image | Required |
| `x` | Where its centre is, in % of the canvas width from the left. -30 to 130 | 50 |
| `y` | Where its centre is, in % of the canvas height from the top. -30 to 130 | 50 |
| `size` | Its width in % of the canvas width. 2 to 200 | 30 |
| `rotate` | Degrees, -180 to 180 | 0 |
| `layer` | `front` lies over the device and the copy. `behind` lies on the background, under both | `front` |
| `opacity` | 0.05 to 1 | 1 |
| `shadow` | `none`, `soft` or `strong`. It follows the outline of the image | `none` |
| `flip` | Mirrored left to right | `false` |

Later entries lie over earlier ones.

```json
{
  "images": [
    { "image": "mascot", "x": 82, "y": 30, "size": 28, "rotate": 8, "shadow": "soft" },
    { "image": "sparkle", "x": 14, "y": 62, "size": 12, "layer": "behind", "opacity": 0.6 }
  ]
}
```

## Good to know

- One to three images per slide is plenty. Keep them clear of the headline and of the part of the screen the slide is about.
- Positions are percentages, so the same numbers land elsewhere on the wider iPad canvas. With an iPad set, look at both.
- **Use only your own artwork.** A logo is a trademark. For other companies' logos, see [What App Review accepts](/docs/app-review).
- Header and search results images take a logo too, but only your app's own. Apple does not allow other logos there.
