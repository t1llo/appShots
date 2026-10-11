---
title: Sizes
description: The exact pixel sizes appShots exports for the App Store. One design each for iPhone, iPhone Duo and iPad, exported once for every display App Store Connect lists, plus the wide header and search results images.
---

You design a set once per device: once for the iPhone, once for the iPhone Duo and once for the iPad. The export then holds that design at the exact pixel size of every display App Store Connect lists, each in a folder of its own.

Every file is a PNG in portrait, without transparency.

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

A project without any screenshots yet counts as an iPhone project.

The other sizes are for displays Apple no longer sells. App Store Connect fills a display you leave empty from a larger one, so most apps never need them. To add or drop sizes, tick them under **Project → Export sizes** in the Studio, or set the project's `targets`:

```json
{ "project": "streaks", "targets": ["iphone-6.9", "iphone-6.3", "iphone-5.5"] }
```

An empty list goes back to the standard sizes.

## One design, many sizes

Displays of the same shape get the same picture. The slide is drawn once at the largest size and scaled to the others, so a headline breaks on the same word and the device sits in the same place on every one of them.

| Drawn | Scaled from it |
| --- | --- |
| `iphone-6.9` | `iphone-6.3`, `iphone-6.5`, `iphone-6.1` |
| `iphone-5.5` | `iphone-4.7`, `iphone-4` |
| `ipad-13` | `ipad-12.9`, `ipad-10.5`, `ipad-9.7` |

`iphone-3.5`, `iphone-duo`, `iphone-duo-cover` and `ipad-11` have a shape of their own and are drawn on their own. The layout is the same and follows the shape.

## iPhone, iPhone Duo or iPad

Each raw screenshot belongs to one of the three:

| The image is | It counts as |
| --- | --- |
| Exactly 2007 × 2853 or 1398 × 2034 | iPhone Duo |
| Narrow, such as 1320 × 2868 | iPhone |
| Anything wider | iPad |

The iPhone Duo is told by its exact size because its shape is close to an iPad's. When a screenshot lands under the wrong device, change it with the small menu on its thumbnail in the Studio, or say it at upload: `appshots upload streaks home.png --as duo`.

Upload each device's screenshot under the same name. A slide that uses `home` then shows the iPhone `home` on iPhone sizes, the Duo `home` on Duo sizes and the iPad `home` on iPad sizes. If a device has none of its own, the closest other one stands in, and the render says so.

## Raw screenshots

Any resolution from 300 pixels on the short side works. The screenshot is scaled to the device's screen. For the sharpest result, capture on the simulators the largest sizes are made for: an iPhone Pro Max, the iPhone Duo and the 13-inch iPad Pro. `appshots run` picks them for you.

## Header and search results

{{PLACEMENTS}}

These are the largest sizes App Store Connect accepts for them. See [Header and search results](/docs/store-assets).

## What appShots does not make

Landscape screenshots, app previews (videos), and Mac, Apple Watch, Apple TV or Vision Pro sizes.
