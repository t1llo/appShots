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
| Sign-in | OAuth, for an app that adds appShots as a connector, or the header `Authorization: Bearer <token>`, with a token from **Connect an agent** in the Studio |
| Sessions | None. Every request stands alone |

claude.ai, Claude Desktop, ChatGPT and other apps that take a connector need only the address: they sign in with OAuth, and you allow them on a page of appShots. See [Add it as a connector](/docs/connect#add-it-as-a-connector). Agents set up with a command send a token in the header instead; the commands for each are in [Connect an agent](/docs/connect#only-the-mcp-connection).

A token, or an app you let in, reaches the projects of the account it belongs to and nothing else. See [Accounts, tokens and limits](/docs/accounts).

## The order of work

1. `get_design_guide`, once, before anything else.
2. `create_project`, or `list_projects` and `get_project` to continue one.
3. Upload the raw screenshots. This goes through the [command line](/docs/cli) or the [HTTP API](/docs/api), because MCP has no way to send files. A project in several languages can hold each screenshot once per language.
4. `set_slides`. For an app on more than one device, once more for each of the others with `device`, so every device has a set composed for its own canvas.
5. `render`, and look at the pictures it returns.
6. `update_slide` for the fixes, then `render` again. A change that made things worse is undone with `list_revisions` and `restore_project`.

Uploading the result to App Store Connect is not among the tools. It needs your App Store Connect key, which stays on your Mac, so the [command line](/docs/app-store-connect) does it.

Every `render` uses one of the account's renders, whatever it draws. So an agent writes the whole set first, renders it in one call, fixes everything it sees in one go and renders once more. The design guide tells it how many are left, and so does every `render`. See [Render and export](/docs/export#how-many-renders).

## Tools

### get_design_guide

Returns the guide the server is built around: the workflow, how to upload screenshots, every layout, background, font, device option and badge, what differs for a Mac app, and the rules for header and search results images and banners. It always matches the server's version.

Without arguments it is the whole guide. `topic` asks for one part of it, for an agent that knows what it is looking for, and the answer names the others: `workflow`, `uploading`, `sizes`, `device-sets`, `mac`, `web`, `layouts`, `no-screenshot`, `feature-slides`, `feature-points`, `backgrounds`, `fonts`, `device`, `badges`, `icon-rows`, `images`, `icons`, `copy`, `store-assets`, `banners` or `mockups`. A topic the guide does not have gets the whole guide, with the topics named first.

Two topics stand outside the whole guide. `core` is a short version of about two thousand tokens, for a model with a small context: the steps, an example set, the layouts, the rules, and which topic to read for anything else. `fields` lists every field of a slide, the theme and their parts with the values each takes, written out from the checks the tools make. The tool list shows the parts of a slide, such as a badge or the device, as plain objects to stay small, and this topic is where their fields are. See [Local models](/docs/connect#local-models).

### list_projects

Lists the projects of the account: id, name, number of slides, languages and when each last changed. `ownSets` names the devices that have a slide set of their own. A project whose stored file cannot be read is listed too, with `damaged` saying what is wrong: `restore_project` brings back an earlier revision of it. No arguments.

### create_project

| Argument | What it is |
| --- | --- |
| `name` | The app's name. Required |
| `locales` | The languages. Default `["en"]` |
| `theme` | The look every slide shares. See [Slides](/docs/slides#the-look) |

Returns the project's id and how to upload screenshots into it.

### get_project

`project` is the id. Returns the theme, the slides, the sets single devices have of their own under `deviceSlides`, the header and search results images and banners, the screenshots and images uploaded so far, and `exportSizes`, the sizes a render writes. Each screenshot is listed with its `device`, and with its `locale` when it was uploaded for one language only. A Mac screenshot also says whether it is `shown` as a `window` or inside a `MacBook`. See [Languages](/docs/languages#screenshots-per-language). `revision` is the version the project is at.

### update_project

Changes `name`, `locales`, `targets` or `theme` of `project`. The theme is replaced as a whole, so send all of it. `targets` is the list of sizes the project exports, and `[]` goes back to the standard ones. See [Sizes](/docs/sizes). `locales` holds each language once, and `en` and `EN` count as the same one: a language given twice is kept in its first spelling.

### list_revisions

`project` is the id. Every change to a project's name, theme, slides and assets is saved as its next revision, and the last 50 are kept. Returns the `revision` the project is at and the versions kept, newest first, each with its `revision`, the `time` it was saved, the `actor` that saved it (`studio`, `api` or `mcp`) and its `size`. Screenshots and images are not part of them.

### restore_project

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `revision` | The version to bring back, from `list_revisions` |

Saves that version again as a new revision, so a restore can be undone the same way. For when a change made things worse or wrote over the user's own edits, and for a project whose stored file is damaged.

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

A field slides do not have, such as a misspelt `headlne`, is left out, and the answer names it. `set_slides` does the same. The answer also names a screenshot the slide uses that is not uploaded yet, and a name in `remove` that slides do not have. A change that leaves the slide as it was saves no revision. The [HTTP API](/docs/api#one-slide) changes one slide the same way, counting from 0.

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
| `previews` | `false` answers without pictures: the links, the warnings, and how small each language's copy was set. For a render of many languages, or to check the copy after an edit. Default `true` |
| `preview` | `"store"` shows, in place of the contact sheets, the first three slides as the App Store shows them: in a search result and on the product page, light and dark |

Returns the contact sheets of the first language as pictures, one per device first and four at most, with links to any it leaves out, a preview of each wide image, the store's with their safe area marked, a link to every PNG, a link to the ZIP, warnings, and how many renders the account has left.

The warnings say what the pictures would not show at a glance: a screenshot that is missing, copy that had to shrink below three quarters of its size to fit or does not fit at all, a headline of more lines than read well, text outside the safe area of a header or search results image, and copy or logos App Review turns away, such as a price, "free", a ranking, a date, one of Apple's own awards, or another platform's logo. A finding in several languages is one warning that names them. See [Slides](/docs/slides#what-a-render-checks).

### render_mockups

Draws each raw screenshot in its device with nothing behind it: one transparent PNG per screenshot, for a website, a README or a deck. It needs no slides and uses no render.

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `screenshots` | Names of the screenshots to draw. Left out: all of them |
| `locale` | The language whose screenshots to draw. Default: the first |
| `device` | How every mockup is drawn: `frame`, `style`, `color`, `shadow`, `rotate`, `perspective`, `statusBar`, `statusBarTime`, `statusBarColor`. Given, it is laid over what the project had, so a call can change one field. `{}` goes back to the defaults |
| `width` | The width of each PNG in pixels. Left out: the screenshot pixel for pixel. `null` goes back to that |

```json
{ "project": "streaks", "device": { "style": "clay", "shadow": "soft", "rotate": -8 }, "width": 1200 }
```

What is given is saved with the project, so the Studio's Mockups page shows the same. A call that is refused, such as for a screenshot the project does not have, saves nothing. Returns a link to every PNG, a link to the ZIP and a picture of the mockups to check. See [Mockups](/docs/mockups).

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

A tool that cannot do what was asked answers with a plain sentence saying why: an unknown project, a slide that does not exist, a value outside its range. Something the server did not expect is answered with a reference, such as `Something went wrong on the server (ref 1a2b3c4d); try again.`, and whoever runs the server finds the details under it in the log. A missing or revoked token gets HTTP 401, and a request other than `POST` gets 405. See [Troubleshooting](/docs/troubleshooting).

The answers that hold data, such as those of `get_project` and `list_projects`, are JSON without indentation: they are read by the model, and spaces cost tokens.
