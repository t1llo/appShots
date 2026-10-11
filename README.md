# Shots

Self-hosted App Store screenshot generator for iPhone and iPad. Describe the slides to Claude (copy, look, badges such as "10K+ downloads", a five-star rating or an award wreath), feed it screenshots straight from the simulator or a plugged-in iPhone, and get back PNGs at the exact sizes App Store Connect accepts.

![An example set: five slides rendered for the 6.9-inch iPhone](docs/example.jpg)

It is three things:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Server | Docker or `npm start` | Renders slides, stores projects, serves the web gallery, the REST API and the MCP endpoint at `/mcp` |
| MCP endpoint | Part of the server | Lets Claude create projects, write slides and render them |
| `shots` CLI | Your Mac | Captures the simulator or a connected device and uploads the screenshot; a container cannot see your USB devices, so this part stays local |

## Run it locally

Needs Node 24 or newer.

```bash
npm install
npm run browser   # one-time download of the headless Chromium used for rendering
npm start         # http://localhost:3000
```

Without `SHOTS_TOKEN` the server is open to anyone who can reach the port, which is fine on localhost and nowhere else.

To run the container instead:

```bash
cp .env.example .env   # then set SHOTS_TOKEN
docker compose -f docker-compose.yaml -f compose.local.yaml up --build
```

## Deploy

1. Start the stack from this repository, with `docker-compose.yaml`.
2. Set `SHOTS_TOKEN` to a long random string (`openssl rand -hex 32`). The stack refuses to start without it.
3. Give the `shots` service a domain on port `3000`.

Projects, uploaded screenshots and renders live in the `shots-data` volume. `PUBLIC_URL` is optional; set it only if the links handed back to Claude should use a different origin than the one Claude called.

## Connect Claude

```bash
claude mcp add --transport http shots https://shots.example.com/mcp --header "Authorization: Bearer $SHOTS_TOKEN"
```

Then ask in plain words, for example:

> Make App Store screenshots for my habit tracker in project "streaks". Six slides, dark purple look, open with a hero slide with a laurel badge "4.8 · App Store rating" and one for "50K+ downloads", then one slide per feature using the screenshots home, stats and widgets.

Claude answers with a contact sheet of the rendered set, a link to the gallery and a ZIP link. Tools: `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `render`.

The endpoint authenticates with a bearer header, so it works with clients that can send one (Claude Code, the Agent SDK, `mcp-remote`). It does not implement OAuth.

## Capture from your Mac

The CLI has no dependencies. Run it as `node cli/shots.mjs`, or `npm link` once to get a `shots` command.

```bash
shots login https://shots.example.com          # asks for the token, stores it in ~/.config/shots
shots devices                                  # booted simulators and connected devices
shots capture --name home --project streaks    # from the booted simulator, uploaded straight away
shots capture --name home --device --project streaks   # from the plugged-in, unlocked iPhone or iPad
shots capture --name home --clean              # simulator only: 9:41, full battery and signal
shots pull streaks --render                    # render everything and unpack it into ./store-screenshots/streaks
```

The `--name` is what slides refer to (`"screenshot": "home"`). Capturing the same name again replaces the screenshot, and every slide using it updates. An iPhone and an iPad screenshot can share a name; each target size picks the matching one.

Simulator capture uses `simctl`. Device capture uses `devicectl device capture screenshot`, which needs Xcode 27 or newer and a device that is unlocked and trusts the Mac. If `xcode-select` points at the Command Line Tools, the CLI switches to `/Applications/Xcode.app` by itself.

## Web gallery

Open the server in a browser to see every slide as a live preview at export size, edit copy, layout, badges and style, drop in screenshots, and download the set as a ZIP. Changes Claude makes through MCP show up in an open gallery within a few seconds.

## Slides

A project has a theme and up to ten slides. Every style field can be set on the theme and overridden per slide.

- **Layouts:** `device-bottom`, `device-top`, `device-center`, `tilted`, `duo` (two devices), `hero` (badges above the headline)
- **Badges** (up to four per slide): `laurel` (wreath), `stars`, `icon`, `pill`; with a title, a subtitle, a star value and an icon (`trophy`, `crown`, `medal`, `star`, `heart`, `download`, `bolt`, `shield`, `check`)
- **Backgrounds:** presets (`midnight`, `aurora`, `ember`, `ocean`, `sunset`, `candy`, `forest`, `graphite`, `peach`, `mint`, `lavender`, `sky`, `paper`, `ink`), `auto` (colours taken from the slide's screenshot), a hex colour, or a custom `{type, colors}` gradient or mesh
- **Fonts:** Inter, Manrope, Plus Jakarta Sans, Sora, Space Grotesk, Bricolage Grotesque, Fraunces, Instrument Serif (bundled, nothing is fetched at render time)
- **Device:** frame (`auto`, `iphone`, `ipad`, `none`), colour, scale, rotation, perspective, offset, shadow
- **Text:** `*asterisks*` tint words with the accent colour, a newline forces a break, and any text can be a `{ "en-US": "...", "de-DE": "..." }` map for localized sets

Output sizes, portrait: iPhone 6.9" (1320×2868), iPhone 6.5" (1284×2778), iPad 13" (2064×2752), iPad 12.9" (2048×2732). By default a render produces the 6.9" set, plus the 13" iPad set once the project has iPad screenshots. Files are opaque PNGs laid out as `<locale>/<target>/01.png`.

## REST API

Everything the gallery and the CLI do goes through `/api`, with the same bearer token:

```
GET    /api/projects                       list
POST   /api/projects                       create {name, locales?, theme?, slides?}
GET    /api/projects/:id                   project, screenshots, rendered files
PUT    /api/projects/:id                   update {name?, locales?, theme?, slides?}
DELETE /api/projects/:id
PUT    /api/projects/:id/shots/:name       upload a screenshot (raw image body, ?device=iphone|ipad to override detection)
DELETE /api/projects/:id/shots/:file
POST   /api/projects/:id/render            {targets?, locales?, slides?}
GET    /api/projects/:id/export.zip        ?render=1 renders first
```

## Good to know

- Portrait only; there is no landscape or Apple Watch/TV output.
- Put only real figures and awards in badges. App Review rejects screenshots with invented download counts, ratings or rankings.
- The device frames are drawn in CSS, not Apple's product images.
- One shared token guards everything. Put the server behind HTTPS and rotate the token by changing `SHOTS_TOKEN`.
