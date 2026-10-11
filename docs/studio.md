---
title: The Studio
description: A tour of the appShots Studio, the editor in the browser. Projects, slides, the theme, screenshots, logos and images, languages, header and search results images, Export ZIP, and mockups.
---

The Studio is the editor at [{{SERVER}}](/studio). It shows every slide as a live preview at the exact export size. Whatever an agent builds through MCP appears here within a few seconds, and everything it builds can be changed by hand.

Changes save by themselves. There is no Save button.

## Projects

One project per app. Projects are in the sidebar on the left.

- **New project** asks for a name and the languages.
- **Rename:** click the project's title and type, or use the three dots beside the project in the sidebar. The project's address stays the same, so links to it keep working.
- **Delete:** the three dots in the sidebar, or **Delete this project…** at the bottom of the **Project** tab. Its slides, screenshots, images and renders go with it. This cannot be undone.

## Slides

A set has up to ten slides, in store order. You design it once, and it is exported at every size. The switch in the heading shows the previews for the **iPhone**, the **iPhone Duo**, the **iPad** or the **Mac**. The Mac's are landscape. See [Mac apps](/docs/mac). Where a device has two shapes, such as the 13-inch and the 11-inch iPad, a menu beside the switch picks which one is shown.

- **+ Add slide** adds one at the end.
- Click a slide to edit it. The editor opens on the right beside a large preview.
- **Move earlier**, **Move later**, **Duplicate** and delete are at the top of the editor.

In the editor, from top to bottom:

| Part | What you set |
| --- | --- |
| Layout | One of thirteen, shown as small sketches. See [Slides](/docs/slides#layouts) |
| Copy | Eyebrow, headline and subheadline. `*Asterisks*` tint a word with the accent colour, and Return forces a line break |
| Screenshot | Click a thumbnail. Layouts with two or three devices take two or three |
| Device | Size, position, tilt, 3D turn, frame colour and shadow. With two or three devices also the angle between them and their distance |
| Features | Cards on a feature slide, or short points beside the headline |
| Badges | Up to four: wreath, stars, rating, review, icon or pill |
| Icon row | Up to eight icons or logos with a label such as "Works with" |
| Your logo | An uploaded image over the headline |
| Images | Uploaded artwork placed anywhere on the slide. Drag it in the large preview |
| Look | Background, font, colours, alignment and headline size for this slide only. Also the device look, from realistic to a hand-drawn sketch, and a clean status bar |

## The theme

The **Project** tab holds the look of the whole set: background, font, text and accent colour, alignment and the device. Every slide uses it unless the slide sets its own value. Change the theme once and the whole set follows.

## Screenshots

Drop files anywhere on the page, or use the upload button. Click a screenshot to put it in the selected slide. Uploading a file with the name of an existing one replaces it everywhere. A project with screenshots of more than one device shows the device on each thumbnail, and clicking it files the screenshot under another one. See [Get your screens in](/docs/screens).

## Logos and images

Everything else a slide can show: your logo or app icon, a mascot, stickers, shapes. Drop PNG, SVG, JPEG or WebP files on that section, then click one to place it on the selected slide. See [Logos and artwork](/docs/images).

## Header and search results

Adds, previews and edits the wide images for the Header and Search Results tab of App Store Connect. **Show safe area** draws the part every device shows as a dashed frame. The frame is a guide and never in the exported file. See [Header and search results](/docs/store-assets).

## Banners

Adds, previews and edits wide pictures for outside the store: a README banner, a repository's social preview, a link preview and a 16:9 picture for a post. They are shown whole wherever they go, so they have no safe area. See [Banners](/docs/banners).

## Languages

The language switch beside the slides sets what the page shows: the texts, and each language's own screenshots. It is also the language you are typing and uploading for. **+ Language** next to it adds one, and **Project → Languages** lists them, removes one or makes another the first.

With a language other than the first picked, **Screenshots** shows that language's own. The dimmed ones are the first language's, standing in until you upload this language's version: drop the files under the same names, or use the arrow on a dimmed one. See [Languages](/docs/languages).

## Export ZIP

**Export ZIP** renders the whole set and downloads it: every slide for every language and every display of App Store Connect, plus the header and search results images and the banners. **Project → Export sizes** lists the sizes and lets you add the older ones. See [Render and export](/docs/export).

The render runs on the server, in the background. You can keep editing, open another project or switch to another tab while it works. What you change after pressing the button is not in that render.

- **Renders** in the sidebar shows each render with its progress. The × beside a running one cancels it.
- When it is done, the ZIP downloads by itself. If you were on another tab, the tab's title says so and the download starts when you come back. **Download ZIP** in the list fetches it again.
- **Notify me when it is done** asks your browser for permission to show a notification, for when the tab is in the background.
- A render an agent starts shows up in the same list.
- The number beside **Renders** is how many your account has left. See [Accounts, tokens and limits](/docs/accounts#renders).

## Mockups

The switch at the top of a project goes from **App Store** to **Mockups**: every screenshot in its device with nothing behind it, to download as a transparent PNG for a website or a README. The device's look, colour, shadow and tilt are set on the right and apply to all of them. See [Mockups](/docs/mockups).

## The sidebar

| Item | What it does |
| --- | --- |
| Renders | The renders under way and the ones that just finished, and how many your account has left |
| Connect an agent | The setup command for your agent, with a token. See [Connect an agent](/docs/connect) |
| Docs | These pages |
| Account | Your API tokens, and deleting your account. See [Accounts, tokens and limits](/docs/accounts) |
| Sign out | Ends the session in this browser |
| Auto, Light, Dark | The appearance. Auto follows your device, and the browser remembers the choice |
