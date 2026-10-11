---
title: MCP tools
description: Reference for the appShots MCP server. The endpoint, how to authenticate, and the nine tools an agent uses to create a project, build slides and render App Store screenshots.
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
3. Upload the raw screenshots. This goes through the [command line](/docs/cli) or the [HTTP API](/docs/api), because MCP has no way to send files.
4. `set_slides`.
5. `render`, and look at the pictures it returns.
6. `update_slide` and `render` with `slides` for single fixes.

## Tools

### get_design_guide

Returns the guide the server is built around: the workflow, how to upload screenshots, every layout, background, font, device option and badge, and the rules for header and search results images. No arguments. It always matches the server's version.

### list_projects

Lists the projects of the account: id, name, number of slides, languages and when each last changed. No arguments.

### create_project

| Argument | What it is |
| --- | --- |
| `name` | The app's name. Required |
| `locales` | The languages. Default `["en"]` |
| `theme` | The look every slide shares. See [Slides](/docs/slides#the-look) |

Returns the project's id and how to upload screenshots into it.

### get_project

`project` is the id. Returns the theme, the slides, the header and search results images, the screenshots and images uploaded so far, and `exportSizes`, the sizes a render writes.

### update_project

Changes `name`, `locales`, `targets` or `theme` of `project`. The theme is replaced as a whole, so send all of it. `targets` is the list of sizes the project exports, and `[]` goes back to the standard ones. See [Sizes](/docs/sizes).

### set_slides

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `slides` | One to ten slides, in store order. See [Slides](/docs/slides) |
| `theme` | Replaces the project's theme when given |

Replaces the whole set. It names screenshots that slides refer to but that are not uploaded yet.

### update_slide

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `slide` | The slide's number, starting at 1 |
| `changes` | Fields to set. They are merged over the slide, `device` included |
| `remove` | Names of fields to clear, such as `["subheadline", "badges"]` |

```json
{ "project": "streaks", "slide": 3, "changes": { "headline": "See your *progress*", "device": { "offsetY": 6 } } }
```

### set_creative_assets

Sets `header`, `search` or `universal` of `project`. Each one given replaces that asset, and the others stay. `remove` deletes assets by name. See [Header and search results](/docs/store-assets).

### render

| Argument | What it is |
| --- | --- |
| `project` | The id |
| `slides` | Slide numbers to render, starting at 1. Left out: all |
| `creatives` | Header and search results images to render. Left out: all of them, along with the slides. Given alone: the slides are left as they are. `[]` skips them |
| `targets` | Sizes for this render only. Left out: every size the project exports, which is the standard sizes of each device it has screenshots of. See [Sizes](/docs/sizes) |
| `locales` | Languages. Default: all of the project's |

Returns a contact sheet per device as a picture, a preview of each wide image with its safe area marked, a link to every PNG, a link to the ZIP, and warnings such as a missing screenshot.

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
