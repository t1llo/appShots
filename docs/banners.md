---
title: Banners
description: Make a GitHub README banner, a repository social preview, a link preview image and a 16:9 post image from your app's screenshots with appShots. Sizes, layouts, fields, and where each file goes.
---

A banner is a wide picture for outside the store: your app's screens in their devices, a headline, your background. appShots makes four of them from the screenshots, theme and fonts the project has already.

They are optional. A project has none until you add one.

## The four banners

{{BANNERS}}

A banner is shown whole wherever it goes. It has no safe area, unlike the [header and search results](/docs/store-assets) images, which the store crops.

## Make them

**In the Studio:** the **Banners** section of the project page adds, previews and edits each one. A new banner starts as a copy of one you have already, or else with the headline and screenshots of your slides.

**Through an agent:** ask for it in plain words, such as "make a banner for the README". The agent uses `set_creative_assets`, then `render`:

```json
{
  "project": "ledger",
  "readme": {
    "headline": "Your money, *at a glance*",
    "subheadline": "A calm budget app for the Mac.",
    "screenshots": ["overview", "phone"]
  }
}
```

```json
{ "project": "ledger", "creatives": ["readme"] }
```

With `creatives` alone, the render draws only those and leaves the slides as they are.

Each banner you pass replaces that one, and the others stay. `"remove": ["post"]` deletes one.

## Layouts

{{CREATIVE_LAYOUTS}}

A banner uses `split` unless you pick another: the copy on the left, up to three devices on the right. `fan` takes up to five screenshots, `sides` up to four and `wall` up to six, with the copy in the middle.

## Fields

The same as for the header and search results images:

| Field | What it is |
| --- | --- |
| `layout` | `split`, `fan`, `sides` or `wall`. Default `split` |
| `eyebrow`, `headline`, `subheadline` | The copy, as on a slide. Keep it short |
| `screenshots` | Names of uploaded screenshots, most important first. Without any, the banner is copy on the background |
| `badges` | Up to three, as on a slide |
| `logo` | Your app's own logo or icon. See [Logos and artwork](/docs/images) |
| `background`, `textColor`, `accentColor`, `font`, `textScale` | As on a slide. Left out, the project's theme decides |
| `device` | `frame`, `style`, `color`, `scale` and `shadow` |

## Mac, iPad and iPhone in one banner

Every screenshot is drawn as the device it is from: an iPhone one as an iPhone, a Mac one as a MacBook or a window. One banner can mix them. Name the Mac screenshot first and it stands in the middle, with a phone or a tablet in front of its lower corners.

## Where each one goes

A render writes the banners into a folder of their own, one per language:

```
en-US/banners/readme.png
en-US/banners/social.png
en-US/banners/link.png
en-US/banners/post.png
```

`appshots pull ledger` saves them under `./store-screenshots/ledger/en-US/banners/`. See [Render and export](/docs/export).

**`readme`.** Copy the file into the repository, such as `docs/banner.png`, and make it the first line of the README:

```markdown
![Ledger](docs/banner.png)
```

**`social`.** On GitHub, open the repository's **Settings → General → Social preview** and upload the file. GitHub takes a file of up to 1 MB there. The render warns when the file is larger. A plainer background without grain makes it smaller.

**`link`.** Put the file on your website and name it in the page's head:

```html
<meta property="og:image" content="https://example.com/link.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
```

**`post`.** A 16:9 picture for a post, a slide of a deck or a video thumbnail.

## Rules

Apple does not review banners, so its rules for store images do not apply. Figures, awards and reviews you show still have to be real.

For the devices alone, with nothing behind them, see [Mockups](/docs/mockups).
