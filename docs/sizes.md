---
title: Sizes
description: The exact pixel sizes appShots exports for the App Store. One design each for iPhone, iPhone Duo, iPad and Mac, exported once for every display App Store Connect lists, plus the wide header and search results images and the banners.
---

You design a set once per device: once for the iPhone, once for the iPhone Duo, once for the iPad and once for the Mac. The export then holds that design at the exact pixel size of every display App Store Connect lists, each in a folder of its own.

Every file is a PNG without transparency. iPhone and iPad sets are portrait, and a Mac set is landscape.

## Screenshots

{{TARGETS}}

The folder name is also the id of the size, which agents and the API use.

## What an export holds

The sizes marked **Always**, for every device the project has screenshots of:

| Your project has | The export holds |
| --- | --- |
| iPhone screenshots | `iphone-6.9`, `iphone-6.3`, `iphone-6.5`, `iphone-6.1` |
| iPhone Duo screenshots as well | `iphone-duo` too |
| iPad screenshots as well | `ipad-13` and `ipad-11` too |
| Mac screenshots as well | `mac-2880` too |

A project without any screenshots yet counts as an iPhone project.

The other sizes are for displays Apple no longer sells, and the three smaller sizes the Mac App Store takes besides its largest. App Store Connect fills a display you leave empty from a larger one, and a Mac app needs one size only, so most apps never need them. To add or drop sizes, tick them under **Project → Export sizes** in the Studio, or set the project's `targets`:

```json
{ "project": "streaks", "targets": ["iphone-6.9", "iphone-6.3", "iphone-5.5"] }
```

An empty list goes back to the standard sizes.

## One design, many sizes

Displays of the same shape, to within a pixel or two, get the same picture. The slide is drawn once at the largest size and scaled to the others, so a headline breaks on the same word and the device sits in the same place on every one of them.

| Drawn | Scaled from it |
| --- | --- |
| `iphone-6.9` | `iphone-6.3` |
| `iphone-6.5` | `iphone-6.1` |
| `iphone-5.5` | `iphone-4.7`, `iphone-4` |
| `ipad-13` | `ipad-12.9`, `ipad-10.5`, `ipad-9.7` |
| `mac-2880` | `mac-2560`, `mac-1440`, `mac-1280` |

The iPhones with Face ID, `iphone-6.5` and `iphone-6.1`, are some ten pixels off the shape of `iphone-6.9`, so they are drawn at a size of their own rather than squeezed, which would make circles oval. `iphone-3.5`, `iphone-duo`, `iphone-duo-cover` and `ipad-11` have a shape of their own too. The layout is the same and follows the shape, so a long headline can break on another word.

## Which device a screenshot counts as

Each raw screenshot belongs to one device:

| The image is | It counts as |
| --- | --- |
| A captured Mac window, which has see-through round corners | Mac, whatever its shape |
| Exactly a size App Store Connect takes for a display, such as 2007 × 2853 or 2868 × 1320 | That display's device: the iPhone Duo and the iPhone here |
| Any other picture wider than it is tall | Mac |
| Any other picture, tall and narrow | iPhone |
| Any other picture, tall and wider than that | iPad |

An iPhone, Duo or iPad size counts upright and turned on its side. A Mac size counts in landscape only.

The iPhone Duo is told by its exact size because its shape is close to an iPad's. When a screenshot lands under the wrong device, change it with the small menu on its thumbnail under **Assets** in the Studio, or say it at upload: `appshots upload streaks home.png --as duo`. `--as` takes `iphone`, `duo`, `ipad` and `mac`.

Upload each device's screenshot under the same name. A slide that uses `home` then shows the iPhone `home` on iPhone sizes, the Duo `home` on Duo sizes, the iPad `home` on iPad sizes and the Mac `home` on the Mac size. If a device has none of its own, the closest other one stands in, and the render says so.

## Raw screenshots

Any resolution from 300 pixels on the short side works. The screenshot is scaled to the device's screen.

The frame follows the screenshot's size. A screenshot from a 6.5" or 6.1" iPhone sits in a phone with a notch, and one from a 5.5", 4.7" or 4" iPhone, or from an iPad with a home button, sits under a deep forehead with a home button below. A phone screenshot of a size Apple does not list, but as wide as those older ones, gets the home button frame too.

A screenshot taken in landscape is drawn whole, in a device turned on its side, inside the upright slide. Nothing of it is cut off. For the sharpest result, capture on the simulators the largest sizes are made for: an iPhone Pro Max, the iPhone Duo and the 13-inch iPad Pro. `appshots run` picks them for you. A Mac app is captured from its own window. See [Mac apps](/docs/mac).

## Header and search results

{{PLACEMENTS}}

These are the largest sizes App Store Connect accepts for them. See [Header and search results](/docs/store-assets).

## Banners

{{BANNERS}}

Wide pictures for outside the store. See [Banners](/docs/banners).

## What appShots does not make

Landscape sets for an iPhone or iPad app (a landscape screenshot goes into an upright slide, in a turned device), and Apple Watch, Apple TV or Vision Pro sizes. App preview videos have sizes of their own, listed in [App preview videos](/docs/video#sizes).
