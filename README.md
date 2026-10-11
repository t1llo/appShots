# appShots

Self-hosted App Store screenshot generator for iPhone and iPad. Describe the slides to Claude (copy, look, badges such as "10K+ downloads", a five-star rating or an award wreath), feed it screenshots straight from the simulator or a plugged-in iPhone, and get back PNGs at the exact sizes App Store Connect accepts.

![An example set: five slides rendered for the 6.9-inch iPhone](docs/example.jpg)

It is three things:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Server | Docker or `npm start` | Renders slides, stores projects, serves the web gallery, the REST API and the MCP endpoint at `/mcp` |
| MCP endpoint | Part of the server | Lets Claude create projects, write slides and render them |
| `appshots` CLI | Your Mac | Captures the simulator or a connected device and uploads the screenshot; a container cannot see your USB devices, so this part stays local |

## Run it locally

Needs Node 24 or newer.

```bash
npm install
npm run browser   # one-time download of the headless Chromium used for rendering
npm start         # http://localhost:3000
```

Without `APPSHOTS_TOKEN` there is no sign-in and no accounts: whoever can reach the port is the owner. That is fine on localhost and nowhere else.

To run the container instead:

```bash
cp .env.example .env   # then set APPSHOTS_TOKEN
docker compose -f docker-compose.yaml -f compose.local.yaml up --build
```

## Deploy

1. Start the stack from this repository, with `docker-compose.yaml`.
2. Set `APPSHOTS_TOKEN` to a long random string (`openssl rand -hex 32`). The stack refuses to start without it.
3. Set `PUBLIC_URL` to the address people will use, for example `https://appshots.example.com`.
4. Give the `appshots` service a domain on port `3000`.

Everything lives in the `appshots-data` volume: projects, uploaded screenshots, renders, accounts and the key that signs sessions.

## People and accounts

The server has one owner and any number of accounts.

- **You, the owner,** sign in with the server token (`APPSHOTS_TOKEN`) through "Sign in with the server token" on the sign-in page. The same token is your bearer token for Claude and the CLI. Changing it signs you out everywhere.
- **Everyone else** has an account with an email and a password, or signs in with Google. Each account gets a private space: its own projects, screenshots, renders and API tokens. Accounts cannot see each other's work, and neither can they see yours.

Open **People** in the sidebar (owner only) to manage this:

- **Invite only** is the default. Create an invite link and send it to one person; it creates one account and expires after 14 days.
- **Anyone can sign up** opens `/signup` to everybody who can reach the address. Rendering costs CPU, so open it only if you mean to.
- Remove an account, with all of its projects, or create a password reset link for it. There is no outgoing email: you pass invite and reset links on yourself. A reset link works once, for 24 hours, and revokes the account's sessions and tokens.

People manage their own tokens and password, or delete their account, under **Account**. Accounts other than the owner are capped at 20 projects and 40 screenshots per project (`USER_MAX_PROJECTS`, `USER_MAX_SHOTS`), and one account renders one set at a time.

### Sign in with Google

Optional. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an OAuth client of type "Web application", add `<PUBLIC_URL>/auth/google/callback` as an authorised redirect URI, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server. The sign-in page then shows "Continue with Google".

Sign-up rules still apply: in invite-only mode a new Google user needs an invite link, and "Sign up with Google" on that link uses it. An email that already has a password account is not linked to a Google sign-in automatically.

## Connect Claude

```bash
claude mcp add --transport http appshots https://appshots.example.com/mcp --header "Authorization: Bearer <token>"
```

The token is `APPSHOTS_TOKEN` for the owner, or a personal token for an account: **Connect** in the sidebar creates one and fills in the command. Then ask in plain words, for example:

> Make App Store screenshots for my habit tracker in project "streaks". Six slides, dark purple look, open with a hero slide with a laurel badge "4.8 · App Store rating" and one for "50K+ downloads", then one slide per feature using the screenshots home, stats and widgets.

Claude answers with a contact sheet of the rendered set, a link to the gallery and a ZIP link. Tools: `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `render`. Every tool works inside the space the token belongs to.

The endpoint authenticates with a bearer header, so it works with clients that can send one (Claude Code, the Agent SDK, `mcp-remote`). It does not implement OAuth.

## Capture from your Mac

The CLI is one file with no dependencies. In a checkout, run it as `node cli/appshots.mjs`, or `npm link` once to get an `appshots` command. People without the repository download the same file from **Connect** in the gallery.

```bash
appshots login https://appshots.example.com       # asks for the token, stores it in ~/.config/appshots
appshots devices                                  # booted simulators and connected devices
appshots capture --name home --project streaks    # from the booted simulator, uploaded straight away
appshots capture --name home --device --project streaks   # from the plugged-in, unlocked iPhone or iPad
appshots capture --name home --clean              # simulator only: 9:41, full battery and signal
appshots pull streaks --render                    # render everything and unpack it into ./store-screenshots/streaks
```

The `--name` is what slides refer to (`"screenshot": "home"`). Capturing the same name again replaces the screenshot, and every slide using it updates. An iPhone and an iPad screenshot can share a name; each target size picks the matching one.

Simulator capture uses `simctl`. Device capture uses `devicectl device capture screenshot`, which needs Xcode 27 or newer and a device that is unlocked and trusts the Mac. If `xcode-select` points at the Command Line Tools, the CLI switches to `/Applications/Xcode.app` by itself.

## Web gallery

Open the server in a browser to see every slide as a live preview at export size, edit copy, layout, badges and style, drop in screenshots, and download the set as a ZIP. Projects sit in the sidebar. Changes Claude makes through MCP show up in an open gallery within a few seconds.

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

Everything the gallery and the CLI do goes through `/api`, with the same bearer token. A token only ever reaches the projects of the space it belongs to.

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

Account settings and the People page need a browser sign-in; an API token cannot create more tokens, change a password or manage accounts.

## Good to know

- Portrait only; there is no landscape or Apple Watch/TV output.
- Put only real figures and awards in badges. App Review rejects screenshots with invented download counts, ratings or rankings.
- The device frames are drawn in CSS, not Apple's product images.
- Put the server behind HTTPS. Passwords are stored as scrypt hashes and API tokens as SHA-256 hashes in `accounts.json` on the data volume; a token is shown once when it is created.
