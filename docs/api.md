---
title: HTTP API
description: Reference for the appShots HTTP API. Upload raw screenshots and images, read and change projects, render, download the finished set as a ZIP, and fetch device mockups, with a bearer token.
---

Everything the Studio does goes through a small JSON API. Use it from a script or from CI. For an agent, [MCP](/docs/mcp) is the better fit.

## Basics

| | |
| --- | --- |
| Base address | `{{SERVER}}/api` |
| Sign-in | The header `Authorization: Bearer <token>` |
| Bodies | JSON, except file uploads, which send the file itself as the body |
| Errors | `{ "error": "A sentence saying why" }` with status 400, 401, 403 or 404 |

Create the token under **Connect an agent** in the Studio. The examples expect it in `APPSHOTS_TOKEN`.

## Projects

| Request | What it does |
| --- | --- |
| `GET /api/projects` | Lists your projects |
| `POST /api/projects` | Creates one. Body: `name`, and optionally `locales`, `targets`, `theme`, `slides`, `deviceSlides`, `creatives` |
| `GET /api/projects/:id` | Returns the project with its screenshots, images and rendered files |
| `PUT /api/projects/:id` | Changes any of `name`, `locales`, `targets`, `theme`, `slides`, `deviceSlides`, `creatives`, `mockups`. Each one given is replaced as a whole |
| `DELETE /api/projects/:id` | Deletes it with everything in it |
| `GET /api/usage` | What the account keeps on the server: the number of `projects`, `slides`, `shots` and `images`, and their size in `bytes` |

```bash
curl -s {{SERVER}}/api/projects \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Streaks","locales":["en-US","de-DE"]}'
```

The answer holds the project's `id`, which every other request uses. The shape of `slides`, `theme` and `creatives` is on [Slides](/docs/slides), [Header and search results](/docs/store-assets) and [Banners](/docs/banners). `deviceSlides` holds the sets single devices have of their own, by `iphone`, `duo`, `ipad` and `mac`, such as `{ "ipad": [ … ] }`. A device that is not in it draws `slides`. See [A set for each device](/docs/slides#a-set-for-each-device). `creatives` holds both, by name: `header`, `search`, `universal`, `readme`, `social`, `link`, `post`. `targets` is the list of sizes the project exports, such as `["iphone-6.9","iphone-5.5"]`. Leave it out, or send `null` or `[]`, for the standard sizes. See [Sizes](/docs/sizes).

## Screenshots

```bash
curl -s -X PUT {{SERVER}}/api/projects/streaks/shots/home \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  --data-binary @home.png
```

| Request | What it does |
| --- | --- |
| `PUT /api/projects/:id/shots/:name` | Uploads a raw screenshot under that name. PNG, JPEG or WebP, up to 40 MB. An existing one with that name, device and language is replaced |
| `PATCH /api/projects/:id/shots/:file` | Files one under another device, another language, or both. Body: `{ "device": "ipad" }`, `{ "locale": "de-DE" }`, or `{ "locale": null }` for the first language. Replaces what was there under the name |
| `DELETE /api/projects/:id/shots/:file` | Deletes one. `:file` is the `file` value from the project's `shots` list |

iPhone, iPhone Duo, iPad or Mac is read from the size and shape of the image. Add `?device=iphone`, `?device=duo`, `?device=ipad` or `?device=mac` to the upload to say it yourself. See [Sizes](/docs/sizes#which-device-a-screenshot-counts-as).

A captured Mac window is stored without the shadow macOS adds, so its `width` and `height` in the `shots` list are those of the window. Its entry has `corner`, the radius of its round corners in pixels. See [Mac apps](/docs/mac).

A screenshot is for the project's first language unless you add `?locale=de-DE`. The language has to be one of the project's `locales`, and `de` finds `de-DE`. Each entry of the project's `shots` list says which `locale` it is for; the first language's have none. See [Languages](/docs/languages#screenshots-per-language).

## Logos and images

| Request | What it does |
| --- | --- |
| `PUT /api/projects/:id/images/:name` | Uploads a logo or artwork. PNG, SVG, JPEG or WebP, up to 20 MB |
| `DELETE /api/projects/:id/images/:file` | Deletes one |

## Render and download

```bash
curl -s -X POST {{SERVER}}/api/projects/streaks/render \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"locales":["en-US"]}'
```

| Request | What it does |
| --- | --- |
| `POST /api/projects/:id/render` | Renders and answers when it is done. Body, all optional: `targets`, `locales`, `slides`, `creatives`, `background`. Without `targets`, every size the project exports |
| `GET /api/renders` | Your renders that are waiting, running or ended in the last hour, newest first, and `rendersLeft` |
| `GET /api/renders/:job` | One of them |
| `DELETE /api/renders/:job` | Cancels one that is waiting or running |
| `GET /api/projects/:id/export.zip` | The files of the last render as a ZIP. `?render=1` renders everything first |
| `GET /files/:id/out/<language>/<size>/<number>.png` | One rendered file |
| `GET /files/:id/out/<language>/creative-assets/<name>.png` | One header or search results image |
| `GET /files/:id/out/<language>/banners/<name>.png` | One banner |

**`slides` counts from 0 here**, unlike the MCP tool, which counts from 1.

The whole set in one request:

```bash
curl -s -o streaks.zip "{{SERVER}}/api/projects/streaks/export.zip?render=1" \
  -H "Authorization: Bearer $APPSHOTS_TOKEN"
```

Rendering takes a while, so give the request a generous timeout. See [Render and export](/docs/export) for the layout of the ZIP.

### Without waiting

With `"background": true` the request answers at once, with status 202 and the render as a job:

```bash
curl -s -X POST {{SERVER}}/api/projects/streaks/render \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"background":true}'
```

```json
{ "job": { "id": "5f0c…", "project": "streaks", "name": "Streaks", "state": "queued", "done": 0, "total": 0 }, "rendersLeft": 6 }
```

Ask `GET /api/renders/<id>` until `state` is no longer `queued` or `running`. It ends as `done`, `failed` (with `error`) or `cancelled`. `done` of `total` is how many pictures are drawn so far. Then fetch `export.zip`. The render draws the project as it was when you asked, so changes made while it runs are not in it.

### Counted renders

Every answer to a render carries `rendersLeft`: how many the account has left, or `null` where they are not counted. Each render uses one, and one that fails or is cancelled uses none. At zero a render is refused with status 400. See [Render and export](/docs/export#how-many-renders).

## Mockups

Each screenshot in its device on a transparent background. They are drawn when they are asked for and use no render. See [Mockups](/docs/mockups).

```bash
curl -s -o home-iphone.png "{{SERVER}}/api/projects/streaks/mockups/home.iphone.png?width=1200" \
  -H "Authorization: Bearer $APPSHOTS_TOKEN"
```

| Request | What it does |
| --- | --- |
| `GET /api/projects/:id/mockups` | Lists them: `settings`, and per mockup its `name`, `device`, the `png` address and the name to save it as. `?locale=de-DE` for another language |
| `GET /api/projects/:id/mockups/:file` | One as a PNG. `:file` is the `file` value of a screenshot. `?width=1200` sets the width for this request, and `?download=1` sends it as a download |
| `GET /api/projects/:id/mockups.zip` | All of them as a ZIP. `?locale=de-DE` for one language only |

How the device is drawn is the project's `mockups` value, set with `PUT /api/projects/:id`:

```json
{ "mockups": { "device": { "style": "clay", "color": "silver", "shadow": "soft", "rotate": -8 }, "width": 1200 } }
```

`device` takes `frame`, `style`, `color`, `shadow`, `rotate`, `perspective`, `statusBar`, `statusBarTime` and `statusBarColor`, as on [Slides](/docs/slides#device). Without `width`, the screenshot is shown pixel for pixel. To try settings without saving them, add them to a request as `?settings=<the same JSON, URL-encoded>`.

## What a token cannot do

Creating and revoking tokens, deleting the account and managing who can sign in need a signed-in browser. A token that leaks can therefore not make more tokens.

## Public addresses

These need no token:

| Address | What it is |
| --- | --- |
| `/healthz` | Answers when the server is up |
| `/skill.md` | The skill, as the server hands it out |
| `/skill.json` | A short hash of the skill and one of the command, which `appshots` compares its own copies with |
| `/install.sh` | The setup script |
| `/cli/appshots.mjs` | The `appshots` command |
| `/docs/<page>.md` | Any page of these docs as Markdown |
| `/llms.txt`, `/llms-full.txt` | The docs as an index, and in one file, for language models |
