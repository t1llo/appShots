---
title: Sizes
description: The exact pixel sizes appShots exports for the App Store. iPhone 6.9 and 6.5 inch, iPad 13 and 12.9 inch, and the wide header and search results images.
---

Every file is a PNG at the exact pixel size App Store Connect accepts, in portrait and without transparency.

## Screenshots

{{TARGETS}}

**`iphone-6.9` and `ipad-13` are the ones to upload.** App Store Connect asks for those two and scales them down for every smaller device by itself. They are also what a render makes when you do not say otherwise:

| Your project has | Rendered by default |
| --- | --- |
| iPhone screenshots | `iphone-6.9` |
| iPhone and iPad screenshots | `iphone-6.9` and `ipad-13` |
| iPad screenshots only | `ipad-13` |

For the others, name them:

```json
{ "project": "streaks", "targets": ["iphone-6.9", "iphone-6.5", "ipad-13"] }
```

## iPhone or iPad

A raw screenshot is an iPhone or an iPad one by its shape. Narrow is iPhone, wide is iPad. An iPhone size is drawn with the iPhone screenshots and an iPad size with the iPad ones.

Upload both kinds under the same name, and a slide that uses `home` shows the iPhone `home` on iPhone sizes and the iPad `home` on iPad sizes. If only one kind exists, it is used for both.

## Raw screenshots

Any resolution from 300 pixels on the short side works. The screenshot is scaled to the device's screen. For the sharpest result, capture on the simulators the store sizes are made for: an iPhone Pro Max and the 13-inch iPad Pro. `appshots run` picks them for you.

## Header and search results

{{PLACEMENTS}}

These are the largest sizes App Store Connect accepts for them. See [Header and search results](/docs/store-assets).

## What appShots does not make

Landscape screenshots, app previews (videos), and Mac, Apple Watch, Apple TV or Vision Pro sizes.
