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
| Bodies | JSON up to 2 MB, except file uploads, which send the file itself as the body |
| Errors | `{ "error": "A sentence saying why" }` with status 400, 401, 403, 404 or 413, or 409 for a change made on an older revision. A body over its limit gets 413, and the sentence names the limit, as does a picture with too many pixels or an upload the account has no room left for. Something the server did not expect is a 500, `{ "error": "Internal error", "ref": "1a2b3c4d" }`: whoever runs the server finds the details under `ref` in its log |

Create the token under **Connect an agent** in the Studio. The examples expect it in `APPSHOTS_TOKEN`.

## Projects

| Request | What it does |
| --- | --- |
| `GET /api/projects` | Lists your projects. One whose stored file cannot be read is listed with `damaged`, saying what is wrong |
| `POST /api/projects` | Creates one. Body: `name`, and optionally `locales`, `targets`, `theme`, `slides`, `deviceSlides`, `creatives` |
| `GET /api/projects/:id` | Returns the project with its screenshots, images and rendered files, and its `revision`, also sent as the `ETag` |
| `PUT /api/projects/:id` | Changes any of `name`, `locales`, `targets`, `theme`, `slides`, `deviceSlides`, `creatives`, `mockups`. Each one given is replaced as a whole. Answers like `GET`, with the new `revision` |
| `PATCH /api/projects/:id/slides/:index` | Changes one slide, counting from 0. See [One slide](#one-slide) |
| `GET /api/projects/:id/revisions` | Lists the versions kept of the project, newest first. See [Revisions](#revisions) |
| `POST /api/projects/:id/restore` | Makes an earlier version current again. Body: `{ "revision": 4 }` |
| `DELETE /api/projects/:id` | Deletes it with everything in it, its earlier versions too, and a damaged one as well |
| `GET /api/usage` | What the account keeps on the server: the number of `projects`, `slides`, `shots` and `images`, and their size in `bytes`. `uploadBytes` is the part that is screenshots and images, and `uploadLimit` the room the account has for those, where it has a limit. See [Limits](#limits) |
| `GET /api/meta` | The options the Studio offers: layouts, fonts, backgrounds, sizes and the rest. `deviceCatalog` lists each device with its models, and for each model its `sizes` in pixels and the export sizes made for it under `targets` |

```bash
curl -s {{SERVER}}/api/projects \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Streaks","locales":["en-US","de-DE"]}'
```

The answer holds the project's `id`, which every other request uses. The shape of `slides`, `theme` and `creatives` is on [Slides](/docs/slides), [Header and search results](/docs/store-assets) and [Banners](/docs/banners). `deviceSlides` holds the sets single devices have of their own, by `iphone`, `duo`, `ipad` and `mac`, such as `{ "ipad": [ … ] }`. A device that is not in it draws `slides`. See [A set for each device](/docs/slides#a-set-for-each-device). `creatives` holds both, by name: `header`, `search`, `universal`, `readme`, `social`, `link`, `post`. `targets` is the list of sizes the project exports, such as `["iphone-6.9","iphone-5.5"]`. Leave it out, or send `null` or `[]`, for the standard sizes. See [Sizes](/docs/sizes). `locales` holds each language once, and `en` and `EN` count as the same one: a language given twice is kept in its first spelling, and the answer to a `PUT` says so under `warnings`.

A field a project or a slide does not have, such as a misspelt `headlne`, is left out and the change goes through. The answer then names it under `warnings`, such as `["Ignored, because a project has no such field: slides[0].headlne."]`. `warnings` is only there when there is something to say.

### One slide

`PATCH /api/projects/:id/slides/:index` changes one slide and leaves the others as they are, as the MCP tool `update_slide` does. `:index` counts from 0, so `/slides/2` is the third slide. The body:

| Field | What it is |
| --- | --- |
| `changes` | Fields to set. They are merged over the slide, `device` included |
| `remove` | Names of fields to clear, such as `["subheadline", "badges"]` |
| `of` | `iphone`, `duo`, `ipad` or `mac`: the slide is in this device's own set. Left out, it is in the shared set |

```bash
curl -s -X PATCH {{SERVER}}/api/projects/streaks/slides/2 \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"changes":{"headline":"See your *progress*","device":{"offsetY":6}}}'
```

It answers like `GET`, with the slide as it is now under `slide`. A slide that is not there is a 400, such as `Slide 4 does not exist; the project has 3.` So is a body with neither `changes` nor `remove`, or with both empty, such as `{"headline": "…"}` with the slide's field outside `changes`. A change that leaves the slide as it was, such as one with only a misspelt field, is answered like any other but saves no revision. Under `warnings` it names a field the slide does not have, a screenshot that is not uploaded yet, a name in `remove` that slides do not have and a field of the body other than these three. It takes `If-Match` like `PUT`.

### Revisions

Every change to a project is saved as its next revision: `1` when it is made, one up with each change after that. Screenshots, images and renders are not part of it. The last 50 revisions are kept.

To change a project without saving over somebody else's edit, send the revision you made the change on in `If-Match`. When the project has moved on since, nothing is saved and the answer is `409`, with the project as it is now:

```bash
curl -s -X PUT {{SERVER}}/api/projects/streaks \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "7"' \
  -d '{"name":"Streaks Pro"}'
```

```json
{ "error": "Project \"streaks\" was changed since revision 7 and is at revision 8 now. Load it again and make the change on that.", "revision": 8, "project": { "project": { … }, "revision": 8, … } }
```

`If-Match` takes the `ETag` as `GET` sent it, such as `"7"`, or the bare number. Without it, a change is saved on whatever revision is current, as it always was.

`GET /api/projects/:id/revisions` answers `{ "revision": 8, "revisions": [ … ] }`, with one entry per version kept, newest first: its `revision`, the `time` it was saved, the `actor` that saved it (`studio`, `api` or `mcp`, and `unknown` for one saved before revisions were counted; the Studio says it is the Studio with the header `X-Appshots-Client: studio`) and its `size` in bytes. `revision` is `null` while the project is damaged.

`POST /api/projects/:id/restore` with `{ "revision": 4 }` saves revision 4 again as a new revision, so a restore can be undone the same way. It answers like `GET`, and takes `If-Match` too. Under `warnings` it names the screenshots and images the restored version uses that are not uploaded. It is also how a damaged project gets its work back: it opens again at the version restored.

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

iPhone, iPhone Duo, iPad or Mac is read from the size and shape of the image. Add `?device=iphone`, `?device=duo`, `?device=ipad` or `?device=mac` to the upload to say it yourself. Any other value is refused with status 400. See [Sizes](/docs/sizes#which-device-a-screenshot-counts-as).

A captured Mac window is stored without the shadow macOS adds, so its `width` and `height` in the `shots` list are those of the window. Its entry has `corner`, the radius of its round corners in pixels. See [Mac apps](/docs/mac).

A screenshot is for the project's first language unless you add `?locale=de-DE`. The language has to be one of the project's `locales`, and `de` finds `de-DE`. Each entry of the project's `shots` list says which `locale` it is for; the first language's have none. See [Languages](/docs/languages#screenshots-per-language).

The screenshots of a language taken out of `locales` are kept, so adding the language again brings them back, but no slide shows them, in no language. The project lists them apart, under `orphanedShots`, with the same keys as `shots`. Move one to a language the project has with `PATCH`, or delete it with `DELETE`. A file that cannot be read as a picture is left out of both lists, and the project's `warnings` name it so it can be uploaded again or deleted.

### Limits

A screenshot of more than 40 million pixels, or of more than 10000 pixels on a side, is refused with status 413 before it is decoded: no screen has that many, and a 6K display has about 20 million. A logo or other image is kept at no more than 2048 pixels a side, so it may also be a photo of up to 268 million pixels, as a JPEG that is not progressive, the way a camera saves one. Other images have the screenshot's limits. An SVG is drawn at a size that fits.

On a server with sign-in, each account other than the admin has room for {{MAX_UPLOADS}} of screenshots and images across its projects. Rendered files do not count. An upload past it is refused with status 413, and the sentence says how much room is left and how much the upload needs. Replacing a screenshot or image counts only what it adds, so a full account can still replace one with a smaller one. `GET /api/usage` gives `uploadBytes` and `uploadLimit`.

## Logos and images

| Request | What it does |
| --- | --- |
| `PUT /api/projects/:id/images/:name` | Uploads a logo or artwork. PNG, SVG, JPEG or WebP, up to 20 MB |
| `DELETE /api/projects/:id/images/:file` | Deletes one |

An image that cannot be read as a picture is left out of the project's `images`, and its `warnings` name it, as they do a screenshot.

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
| `POST /api/projects/:id/check` | Says what a render with the same body would do, without drawing anything or using a render. See [Check first](#check-first) |
| `GET /api/renders` | Your renders that are waiting, running or ended in the last hour, newest first, and `rendersLeft` |
| `GET /api/renders/:job` | One of them |
| `DELETE /api/renders/:job` | Cancels one that is waiting or running. It keeps nothing it drew |
| `GET /api/projects/:id/export.zip` | The files of the last render as a ZIP. `?render=1` renders everything first |
| `GET /files/:id/out/<language>/<size>/<number>.png` | One rendered file |
| `GET /files/:id/out/<language>/creative-assets/<name>.png` | One header or search results image |
| `GET /files/:id/out/<language>/banners/<name>.png` | One banner |

**`slides` counts from 0 here**, unlike the MCP tool, which counts from 1.

A finished render answers with `files`, `sheets`, `creatives` and `warnings`, one sentence each. Two more keys hold what the warnings about the copy say, as data:

- `lint`: one entry per finding and language, with its `rule` (such as `price`, `apple-recognition`, `headline-scaled` or `safe-area`), where it is (`slide` counting from 0, `ownSet` for a device's own set, or `placement`), the `locale`, the `field` such as `headline` or `badges[0].title`, the words or icons found under `match`, a measured `value` with its `limit`, and the `text` of the warning. A finished job of `GET /api/renders` has it too.
- `fit`: how the copy of each page came out: the share of its size it was set at (`scale`), whether it fits at all (`fits`), the `lines` of its headline, and whether text stands `outside` the safe area or the picture.

See [Slides](/docs/slides#what-a-render-checks) for what is checked.

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

Ask `GET /api/renders/<id>` until `state` is no longer `queued` or `running`. It ends as `done`, `failed` (with `error`) or `cancelled`. `done` of `total` is how many pictures are drawn so far. Then fetch `export.zip`. The render draws the project as it was when you asked, so changes made while it runs are not in it. Its files replace the old ones all at once when it is done; one that fails or is cancelled leaves the old ones as they were.

`locales` takes the project's own languages, matched without regard to case, and `de` finds `de-DE`. A language the project does not have is refused with status 400 before anything is drawn or counted.

### Check first

`POST /api/projects/:id/check` takes the body of a render and answers with what that render would do. It draws nothing, queues nothing and uses no render, so it can be asked before every render:

```bash
curl -s -X POST {{SERVER}}/api/projects/streaks/check \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"locales":["en-US"]}'
```

```json
{
  "ok": true,
  "refused": [],
  "warnings": ["Slide 3: no screenshot named \"stats\" has been uploaded, so a placeholder was drawn."],
  "plan": { "locales": ["en-US"], "targets": ["iphone-6.9"], "slides": { "iphone": [0, 1, 2] }, "creatives": [], "pictures": 3 },
  "rendersLeft": 6
}
```

- `ok` says whether the render would start. When it would not, `refused` gives each reason in the words the render would answer with, and the status is still 200: the check itself went through.
- `warnings` are the ones the render would give, such as a screenshot or image name nothing is uploaded under.
- `plan` is what it would draw: the languages, the sizes, the slides of each device counted from 0 (a device with a set of its own counts in that set), the header, search results and banner images, and how many pictures the browser draws, every language counted. It is left out when what was asked for cannot be drawn.
- `background` is taken and ignored, so the body you are about to render with can be sent as it is. Only a body that does not have the shape above, such as an unknown size or a negative slide, is refused with status 400, and an unknown project is a 404. Everything else a render would refuse with 400, such as a language the project lacks, a slide it does not have or an account without renders left, comes back in `refused` with status 200.

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
| `/skill.json` | A short hash of the skill and one of the command, which `appshots` compares its own copies with, and under `references` one of each of the skill's reference files |
| `/skill/<file>.md` | One of the skill's reference files, such as `/skill/screens.md`: the full text of a step that `/skill.md` names |
| `/install.sh` | The setup script. Without `PUBLIC_URL`, a request whose `Host` is not a plain name and port is a 400 |
| `/cli/appshots.mjs` | The `appshots` command |
| `/docs/<page>.md` | Any page of these docs as Markdown. Pages come with an `ETag`, so a reader that sends it back in `If-None-Match` gets a 304 while the page is the same |
| `/llms.txt`, `/llms-full.txt` | The docs as an index, and in one file, for language models |
