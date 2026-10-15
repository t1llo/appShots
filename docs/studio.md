---
title: The Studio
description: A tour of the appShots Studio, the editor in the browser. Projects, slides and a set for each device, the theme, assets, languages, header and search results images, Export ZIP, mockups, settings and the admin page.
---

The Studio is the editor at [{{SERVER}}](/studio). It shows every slide as a live preview at the exact export size. Whatever an agent builds through MCP appears here within a few seconds, and everything it builds can be changed by hand.

Changes save by themselves. There is no Save button.

- **Undo and redo:** ⌘Z and ⇧⌘Z, or Ctrl+Z and Ctrl+Shift+Z, or the two arrows in the bar at the top.
- **When a save fails,** the bar says why and the Studio tries again by itself. Closing the page while something is not saved asks first.
- **When the project changes elsewhere** while you work, in another tab, by an agent or through the API, both sets of changes are kept. If both changed the same field, yours stays and a note under the bar offers **Use theirs**.

## Projects

One project per app. **All projects** lists them with their slides, their languages and when they last changed, and the sidebar keeps them one click away.

- **New project** asks for a name and the languages.
- **Rename:** click the project's title in the bar at the top and type, or use the three dots beside the project. The project's address stays the same, so links to it keep working.
- **Delete:** the three dots beside the project, or **Delete this project…** at the bottom of the **Project** tab. Its slides, screenshots, images and renders go with it. This cannot be undone.

A project has three parts, in the bar at the top: **Slides**, **Assets** and **Mockups**.

## Slides

A set has up to ten slides, in store order. The line above the previews sets what they show:

| Control | What it does |
| --- | --- |
| iPhone, iPhone Duo, iPad, Mac | The device the previews are for. The Mac's are landscape. See [Mac apps](/docs/mac) |
| The size beside it | Where a device has two shapes, such as the 13-inch and the 11-inch iPad, which one is shown |
| The language | The texts and screenshots shown, and the language you are typing for. **+ Language** adds one |
| S, M, L | How large the previews are |

- **+ Add slide** adds one at the end.
- Click a slide to edit it. Its fields open on the right, and the preview follows as you type.
- **Move earlier**, **Move later**, **Duplicate** and **Delete** are at the top of the fields.
- An image placed on the selected slide can be dragged in the preview.

### A set for each device

A new project has one set, and every device draws it on its own canvas. That gives a full export from one design.

A device can have a set of its own instead. **Give the iPad its own slides** under the device switch starts one as a copy of the shared set. From then on the two are changed separately: another layout, other screenshots, more or fewer slides. A dot on the device switch marks a device with its own set, and **Use the shared slides again** removes it.

The theme, the languages and the screenshots stay shared, so the sets match. See [Slides](/docs/slides#a-set-for-each-device).

### The fields of a slide

Each group folds away under its name.

| Group | What you set |
| --- | --- |
| Layout | One of {{LAYOUT_COUNT}}, shown as small sketches. See [Slides](/docs/slides#layouts) |
| Screenshot | Click a thumbnail. Layouts with two or three devices take two or three |
| Text | Eyebrow, headline and subheadline. `*Asterisks*` mark a word, and Return forces a line break |
| Device | Size, position, tilt, 3D turn, frame colour and shadow. With two or three devices also the angle between them and their distance |
| Features | Cards on a feature slide with their look, icons and columns, the figures of a stat slide, the steps of a steps slide, or short points beside the headline |
| Badges | Wreath, stars, rating, review, icon or pill. On a reviews slide also the reviews of its wall |
| Icons and logos | Up to eight icons or logos with a label such as "Works with" |
| Your logo | An uploaded image over the headline |
| Images | Uploaded artwork placed anywhere on the slide |
| Style for this slide | Background, font, colours, alignment, headline size and how marked words look, for this slide only. Also the device look, from realistic to a hand-drawn sketch, and a clean status bar |
| JSON | The slide as the API sees it, to read or paste |

## The theme

The **Project** tab holds what the whole project shares: its name, its languages, the export sizes and the theme. The theme is the background, the font, the text and accent colour, the alignment and the device. Every slide of every set uses it unless the slide sets its own value. Change the theme once and everything follows.

## Assets

**Assets** holds the files the slides are made of.

**Screenshots** are grouped by device. Drop files anywhere in the window, or use **Upload**. Uploading a file with the name of an existing one replaces it everywhere. The tag on a screenshot is its device, and choosing another one files the screenshot there. A screenshot that a slide, a banner or a store image uses has its name in full colour. See [Get your screens in](/docs/screens).

**Logos and images** is everything else a slide can show: your logo or app icon, a mascot, stickers, shapes. Drop PNG, SVG, JPEG or WebP files on that section. A slide picks them under **Your logo** and **Images**. See [Logos and artwork](/docs/images).

## Header and search results

Under the slides. Adds, previews and edits the wide images for the Header and Search Results tab of App Store Connect. **Show safe area** draws the part every device shows as a dashed frame. The frame is a guide and never in the exported file. See [Header and search results](/docs/store-assets).

## Banners

Under them. Adds, previews and edits wide pictures for outside the store: a README banner, a repository's social preview, a link preview and a 16:9 picture for a post. They are shown whole wherever they go, so they have no safe area. See [Banners](/docs/banners).

## Languages

The language switch above the slides sets what the page shows: the texts, and each language's own screenshots. It is also the language you are typing and uploading for. **+ Language** next to it adds one, and **Project → Languages** lists them, removes one or makes another the first.

With a language other than the first picked, **Assets** shows that language's own screenshots. The dimmed ones are the first language's, standing in until you upload this language's version: drop the files under the same names, or use the arrow on a dimmed one. See [Languages](/docs/languages).

## Export ZIP

**Export ZIP** renders the whole project and downloads it: every slide of every set for every language and every display of App Store Connect, plus the header and search results images and the banners. **Project → Export sizes** lists the sizes and lets you add the older ones. See [Render and export](/docs/export).

The render runs on the server, in the background. It starts once your latest changes are saved. You can keep editing, open another project or switch to another tab while it works. What you change after pressing the button is not in that render.

- **Renders** in the sidebar shows each render with its progress. The × beside a running one cancels it.
- When it is done, the ZIP downloads by itself. If you were on another tab, the tab's title says so and the download starts when you come back. **Download ZIP** in the list fetches it again.
- **Notify me when it is done** asks your browser for permission to show a notification, for when the tab is in the background.
- A render an agent starts shows up in the same list.
- The number beside **Renders** is how many your account has left. See [Accounts, tokens and limits](/docs/accounts#renders).

## Mockups

**Mockups** shows every screenshot in its device with nothing behind it, to download as a transparent PNG for a website or a README. The device's look, colour, shadow and tilt are set on the right and apply to all of them. See [Mockups](/docs/mockups).

## Settings

**Settings** in the sidebar, or a click on your name at the top of it.

| Part | What is there |
| --- | --- |
| Account | Who is signed in, **Sign out**, how much you keep on this server and how many renders you have left |
| Appearance | Auto, Light or Dark. Auto follows your device, and the browser remembers the choice |
| Agents and the command line | **Connect** for the setup command, and the command that brings an installed skill up to date. See [Update](/docs/update) |
| API tokens | Create and revoke the tokens your agents use. See [Accounts, tokens and limits](/docs/accounts) |
| Delete account | Removes your account with everything in it. The person who runs the server does not have it |

## Admin

The person who runs the server has **Admin** in the sidebar. It shows the server in numbers: accounts, projects, screenshots, renders made and storage used. Under them it sets who can sign in and lists the people, each with their projects, their storage and their renders. A click on a person's renders sets how many they have left.

The admin sees how much everybody keeps and never what it is. See [Accounts, tokens and limits](/docs/accounts).

## The sidebar

| Item | What it does |
| --- | --- |
| Your name | Opens the settings |
| All projects | Every project in a table |
| Projects | The projects, and **+** for a new one |
| Renders | The renders under way and the ones that just finished, and how many your account has left |
| Connect an agent | The setup command for your agent, with a token. See [Connect an agent](/docs/connect) |
| Docs | These pages |
| Admin | The server in numbers and who can use it. Only for the person who runs it |
| Settings | Your account, the appearance, tokens and updates |
