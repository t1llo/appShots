---
title: HTTP API
description: Reference for the appShots HTTP API. Upload raw screenshots and images, read and change projects, render, and download the finished set as a ZIP, with a bearer token.
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
| `POST /api/projects` | Creates one. Body: `name`, and optionally `locales`, `theme`, `slides`, `creatives` |
| `GET /api/projects/:id` | Returns the project with its screenshots, images and rendered files |
| `PUT /api/projects/:id` | Changes any of `name`, `locales`, `theme`, `slides`, `creatives`. Each one given is replaced as a whole |
| `DELETE /api/projects/:id` | Deletes it with everything in it |

```bash
curl -s {{SERVER}}/api/projects \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Streaks","locales":["en-US","de-DE"]}'
```

The answer holds the project's `id`, which every other request uses. The shape of `slides`, `theme` and `creatives` is on [Slides](/docs/slides) and [Header and search results](/docs/store-assets).

## Screenshots

```bash
curl -s -X PUT {{SERVER}}/api/projects/streaks/shots/home \
  -H "Authorization: Bearer $APPSHOTS_TOKEN" \
  --data-binary @home.png
```

| Request | What it does |
| --- | --- |
| `PUT /api/projects/:id/shots/:name` | Uploads a raw screenshot under that name. PNG, JPEG or WebP, up to 40 MB. An existing one with that name and device kind is replaced |
| `DELETE /api/projects/:id/shots/:file` | Deletes one. `:file` is the `file` value from the project's `shots` list |

iPhone or iPad is read from the shape of the image. Add `?device=iphone` or `?device=ipad` to say it yourself.

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
  -d '{"targets":["iphone-6.9"],"locales":["en-US"]}'
```

| Request | What it does |
| --- | --- |
| `POST /api/projects/:id/render` | Renders. Body, all optional: `targets`, `locales`, `slides`, `creatives` |
| `GET /api/projects/:id/export.zip` | The files of the last render as a ZIP. `?render=1` renders everything first |
| `GET /files/:id/out/<language>/<size>/<number>.png` | One rendered file |

**`slides` counts from 0 here**, unlike the MCP tool, which counts from 1.

The whole set in one request:

```bash
curl -s -o streaks.zip "{{SERVER}}/api/projects/streaks/export.zip?render=1" \
  -H "Authorization: Bearer $APPSHOTS_TOKEN"
```

Rendering takes a while, so give the request a generous timeout. See [Render and export](/docs/export) for the layout of the ZIP.

## What a token cannot do

Creating and revoking tokens, deleting the account and managing who can sign in need a signed-in browser. A token that leaks can therefore not make more tokens.

## Public addresses

These need no token:

| Address | What it is |
| --- | --- |
| `/healthz` | Answers when the server is up |
| `/skill.md` | The skill, as the server hands it out |
| `/install.sh` | The setup script |
| `/cli/appshots.mjs` | The `appshots` command |
| `/docs/<page>.md` | Any page of these docs as Markdown |
| `/llms.txt`, `/llms-full.txt` | The docs as an index, and in one file, for language models |
