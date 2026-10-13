---
title: MCP tools
description: Reference for the appShots MCP server. The endpoint, how to authenticate, and the ten tools an agent uses to create a project, build slides, render App Store screenshots and draw device mockups.
---

appShots is a remote MCP server. An agent connects to it once and can then build and render sets by itself.

## The endpoint

| | |
| --- | --- |
| Address | `{{SERVER}}/mcp` |
| Transport | Streamable HTTP, `POST` only |
| Sign-in | The header `Authorization: Bearer <token>`, with a token from **Connect an agent** in the Studio |
| Sessions | None. Every request stands alone |

There is no OAuth, so add it with a header. Pasting the address into a connector dialog that expects a sign-in page does not work. The exact commands for each agent are in [Connect an agent](/docs/connect#only-the-mcp-connection).

A token reaches the projects of the account it belongs to and nothing else. See [Accounts, tokens and limits](/docs/accounts).

## The order of work

1. `get_design_guide`, once, before anything else.
2. `create_project`, or `list_projects` and `get_project` to continue one.
3. Upload the raw screenshots. This goes through the [command line](/docs/cli) or the [HTTP API](/docs/api), because MCP has no way to send files. A project in several languages can hold each screenshot once per language.
4. `set_slides`. For an app on more than one device, once more for each of the others with `device`, so every device has a set composed for its own canvas.
5. `render`, and look at the pictures it returns.
6. `update_slide` for the fixes, then `render` again.

Uploading the result to App Store Connect is not among the tools. It needs your App Store Connect key, which stays on your Mac, so the [command line](/docs/app-store-connect) does it.

Every `render` uses one of the account's renders, whatever it draws. So an agent writes the whole set first, renders it in one call, fixes everything it sees in one go and renders once more. The design guide tells it how many are left, and so does every `render`. See [Render and export](/docs/export#how-many-renders).

## Tools

### get_design_guide

Returns the guide the server is built around: the workflow, how to upload screenshots, every layout, background, font, device option and badge, what differs for a Mac app, and the rules for header and search results images and banners. No arguments. It always matches the server's version.

### list_projects

Lists the projects of the account: id, name, number of slides, languages and when each last changed. `ownSets` names the devices that have a slide set of their own. No arguments.

### create_project

| Argument | What it is |
| --- | --- |
| `name` | The app's name. Required |
| `locales` | The languages. Default `["en"]` |
| `theme` | The look every slide shares. See [Slides](/docs/slides#the-look) |

Returns the project's id and how to upload screenshots into it.

### get_project

`project` is the id. Returns the theme, the slides, the sets single devices have of their own under `deviceSlides`, the header and search results images and banners, the screenshots and images uploaded so far, and `exportSizes`, the sizes a render writes. Each screenshot is listed with its `device`, and with its `locale` when it was uploaded for one language only. A Mac screenshot also says whether it is `shown` as a `window` or inside a `MacBook`. See [Languages](/docs/languages#screenshots-per-language).

### update_project

Changes `name`, `locales`, `targets` or `theme` of `project`. The theme is replaced as a whole, so send all of it. `targets` is the list of sizes the project exports, and `[]` goes back to the standard ones. See [Sizes](/docs/sizes).

### set_slides

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `slides` | One to ten slides, in store order. See [Slides](/docs/slides) |
| `device` | `iphone`, `duo`, `ipad` or `mac`: the set is for this device alone, which then draws it in place of the shared one. Left out, the shared set is replaced |
| `theme` | Replaces the project's theme when given |

Replaces the whole set. It names screenshots that slides refer to but that are not uploaded yet.

A project starts with one shared set that every device draws on its own canvas. An agent designs the iPhone's first and then gives the iPad and the Mac a set of their own, with the same story recomposed for the wider canvas:

```json
{ "project": "streaks", "device": "ipad", "slides": [{ "layout": "device-right", "screenshot": "home", "headline": "Never miss a *day*" }] }
```

With `device` and an empty `slides` list, the device's own set is removed and it shows the shared one again. See [A set for each device](/docs/slides#a-set-for-each-device).

### update_slide

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `slide` | The slide's number, starting at 1 |
| `of` | `iphone`, `duo`, `ipad` or `mac`: the slide is in this device's own set. Left out, it is in the shared set |
| `changes` | Fields to set. They are merged over the slide, `device` included |
| `remove` | Names of fields to clear, such as `["subheadline", "badges"]` |

```json
{ "project": "streaks", "slide": 3, "changes": { "headline": "See your *progress*", "device": { "offsetY": 6 } } }
```

### set_creative_assets

Sets the wide pictures of `project`: `header`, `search` or `universal` for App Store Connect, and the banners `readme`, `social`, `link` and `post` for outside the store. Each one given replaces that picture, and the others stay. `remove` deletes them by name. See [Header and search results](/docs/store-assets) and [Banners](/docs/banners).

### render

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `slides` | Slide numbers to render, starting at 1. Left out: all |
| `creatives` | Header and search results images and banners to render. Left out: all of them, along with the slides. Given alone: the slides are left as they are. `[]` skips them |
| `targets` | Sizes for this render only. Left out: every size the project exports, which is the standard sizes of each device it has screenshots of. See [Sizes](/docs/sizes) |
| `locales` | Languages. Default: all of the project's |

Returns a contact sheet per device as a picture, a preview of each wide image, the store's with their safe area marked, a link to every PNG, a link to the ZIP, warnings such as a missing screenshot, and how many renders the account has left.

### render_mockups

Draws each raw screenshot in its device with nothing behind it: one transparent PNG per screenshot, for a website, a README or a deck. It needs no slides and uses no render.

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `screenshots` | Names of the screenshots to draw. Left out: all of them |
| `locale` | The language whose screenshots to draw. Default: the first |
| `device` | How every mockup is drawn: `frame`, `style`, `color`, `shadow`, `rotate`, `perspective`, `statusBar`, `statusBarTime`, `statusBarColor`. Given, it is laid over what the project had |
| `width` | The width of each PNG in pixels. Left out: the screenshot pixel for pixel. `null` goes back to that |

```json
{ "project": "streaks", "device": { "style": "clay", "shadow": "soft", "rotate": -8 }, "width": 1200 }
```

What is given is saved with the project, so the Studio's Mockups page shows the same. Returns a link to every PNG, a link to the ZIP and a picture of the mockups to check. See [Mockups](/docs/mockups).

## Try it without an agent

```bash
appshots tools
appshots call list_projects
```

Or with curl:

```bash
curl -s {{SERVER}}/mcp \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Errors

A tool that cannot do what was asked answers with a plain sentence saying why: an unknown project, a slide that does not exist, a value outside its range. A missing or revoked token gets HTTP 401. See [Troubleshooting](/docs/troubleshooting).
