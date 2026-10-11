# appShots

Self-hosted App Store screenshot generator for iPhone and iPad. Describe the slides to Claude (copy, look, badges such as "10K+ downloads", a five-star rating or an award wreath), feed it screenshots straight from the simulator or a plugged-in iPhone, and get back PNGs at the exact sizes App Store Connect accepts. It also makes the wide images for App Store Connect's Header and Search Results tab.

![An example set: five slides rendered for the 6.9-inch iPhone](docs/example.jpg)

It is four things:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Server | Docker or `npm start` | Renders slides, stores projects, serves the home page, the Studio (the editor in the browser), the REST API and the MCP endpoint at `/mcp` |
| MCP endpoint | Part of the server | Lets Claude create projects, write slides and render them |
| `appshots` CLI | Your Mac | Captures the simulator or a connected device and uploads the screenshot; a container cannot see your USB devices, so this part stays local |
| `/appshots` skill | Claude Code on your Mac | Does the whole job in an app's repository: runs the app, captures the screens, writes the copy and builds the set |

## Run it locally

Needs Node 24 or newer.

```bash
npm install
npm run browser   # one-time download of the headless Chromium used for rendering
npm run build     # bundles the Studio and the home page into web/dist
npm start         # http://localhost:3000
```

The server runs straight from its TypeScript sources. Only the Studio (React, TanStack Router and TanStack Query, bundled by Vite) and the home page have a build step; run `npm run build` again after changing anything in `web/`. To work on the Studio with hot reload, run `npm run dev` and `npm run dev:web` side by side and open the address Vite prints.

Without the three sign-in settings (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL`) there is no sign-in, no home page and no accounts: whoever can reach the port works in the server's own space. That is fine on localhost and nowhere else. Set only one or two of them and the server refuses to start, so a typo cannot leave a deployed server open. The home page is also at `/home`, which is where to look at it while sign-in is off.

To run the container instead:

```bash
cp .env.example .env   # then fill in the sign-in settings
docker compose -f docker-compose.yaml -f compose.local.yaml up --build
```

The compose file always asks for the sign-in settings. For a local container, add `http://localhost:3000/auth/google/callback` to the OAuth client's redirect URIs and set `PUBLIC_URL=http://localhost:3000`.

## Deploy

1. Create the Google OAuth client described under [Sign in with Google](#sign-in-with-google).
2. Start the stack from this repository, with `docker-compose.yaml`.
3. Set `PUBLIC_URL` to the address people will use, for example `https://appshots.example.com`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `ADMIN_EMAIL`, your own Google address. The stack refuses to start without them.
5. Give the `appshots` service a domain on port `3000`.

Everything lives in the `appshots-data` volume: projects, uploaded screenshots, renders, accounts and the key that signs sessions.

## People and accounts

Everybody signs in with Google. There are no passwords.

- **The admin** is the Google address in `ADMIN_EMAIL`. The admin is always let in, works in the server's own space without limits, and decides who else gets in. To hand the server to someone else, change the variable and redeploy.
- **Everyone else** gets a private space on their first sign-in: their own projects, screenshots, renders and API tokens. Nobody sees anybody else's work, the admin included.

Visitors who are not signed in see the public home page. Its **Open Studio** button (`/studio`) signs them in with Google and drops them in the Studio. Who that works for is set under **People** in the sidebar (admin only):

- **Anyone with a Google account** is the default: whoever finds the address can sign in and gets a space of their own. [What open sign-in costs](#what-open-sign-in-costs) says what that means for the machine.
- **Only the people listed here** closes it. Add the Google address of each person you want to let in; anyone else is turned away after choosing their Google account.
- **Remove** deletes a person's account with all of its projects, and takes them off the list. Their sessions and tokens stop working at once.

People manage their own tokens, or delete their account, under **Account**. Accounts other than the admin are capped at 20 projects and 40 screenshots per project (`USER_MAX_PROJECTS`, `USER_MAX_SHOTS`), and one account renders one set at a time.

### Sign in with Google

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an OAuth client of type "Web application" with:

- **Authorised JavaScript origin:** `<PUBLIC_URL>`, for example `https://appshots.example.com`
- **Authorised redirect URI:** `<PUBLIC_URL>/auth/google/callback`

Put its client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. appShots asks Google for the name and email address only, and accepts an address only when Google says it is verified.

While the OAuth consent screen is in "Testing", Google itself only lets in the test users listed there. Publish it ("In production") before inviting anyone else; the name and email scopes need no review by Google.

### What open sign-in costs

The server makes no paid calls. Claude runs on each person's own subscription, on their own machine, so more people cost nothing per use. What they use is this one machine:

- **CPU and memory.** A render drives a headless Chromium: about a second per slide on a recent Mac, more on a small server, and a few hundred megabytes of memory while it runs. Renders are queued one at a time for the whole server, so many people at once means waiting, not a bigger bill.
- **Disk.** This is what grows. An account can hold 20 projects of 40 screenshots, each up to 40 MB when uploaded, plus the rendered sets. A handful of people is nothing; a few hundred accounts filled to the cap would not fit on a small disk. Lower `USER_MAX_PROJECTS` and `USER_MAX_SHOTS` if the disk is small, and keep an eye on the volume.
- **Abuse.** Anyone can sign in, so somebody may script uploads or renders. The caps and the render queue bound the damage, and **Remove** under People deletes an account with everything in it.

If that is more than you want to carry, switch to **Only the people listed here** under People.

### Upgrading from a version with `APPSHOTS_TOKEN`

- `APPSHOTS_TOKEN` is no longer read. The projects it reached are the server's own space, which now belongs to the admin.
- Claude and the CLI need a personal token instead: sign in, open **Connect**, create one, and run `claude mcp add` and `appshots login` again.
- Accounts made with an email and a password, or through an invite link, are kept: the account and its projects come back on the first Google sign-in with the same address. Their old passwords and tokens are discarded.
- Sign-in is open to anyone with a Google account unless you picked the list under People or put somebody on it. A server that was invite-only is open after the upgrade; choose **Only the people listed here** to close it again.

## Connect Claude

```bash
claude mcp add --transport http appshots https://appshots.example.com/mcp --header "Authorization: Bearer <token>"
```

Claude cannot sign in with Google, so it uses a personal token: **Connect** in the sidebar creates one and fills in the command. Then ask in plain words, for example:

> Make App Store screenshots for my habit tracker in project "streaks". Six slides, dark purple look, open with a hero slide with a laurel badge "4.8 · App Store rating" and one for "50K+ downloads", then one slide per feature using the screenshots home, stats and widgets.

Claude answers with a contact sheet of the rendered set, a link to the Studio and a ZIP link. Tools: `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `set_creative_assets`, `render`. Every tool works inside the space the token belongs to.

The endpoint authenticates with a bearer header, so it works with clients that can send one (Claude Code, the Agent SDK, `mcp-remote`). It does not implement OAuth.

## Let Claude do the whole set

The server hands out a Claude Code skill at `/skill.md`, with its own address filled in. Install it once:

```bash
mkdir -p ~/.claude/skills/appshots && curl -fsS https://appshots.example.com/skill.md -o ~/.claude/skills/appshots/SKILL.md
```

Then open Claude Code in an app's repository and type `/appshots`, or just ask for App Store screenshots. Claude reads the code to learn what the app does, builds and runs it in the iOS Simulator (or uses a plugged-in, unlocked iPhone or iPad), fills it with believable content, captures the screens worth showing, writes the headlines, builds the set through the MCP tools, looks at the render and fixes what is off. It needs the MCP endpoint and the CLI from the two sections around this one, and tells you the command if either is missing.

The skill is plain text with no secrets in it, which is why `/skill.md` needs no sign-in. Its source is [skill/SKILL.md](skill/SKILL.md); **Connect** in the Studio shows the install command with the right address.

## Capture from your Mac

The CLI is one file with no dependencies. In a checkout, run it as `node cli/appshots.mjs`, or `npm link` once to get an `appshots` command. People without the repository download the same file from **Connect** in the Studio.

```bash
appshots login https://appshots.example.com       # asks for the token, stores it in ~/.config/appshots
appshots devices                                  # booted simulators and connected devices
appshots capture --name home --project streaks    # from the booted simulator, uploaded straight away
appshots capture --name home --device --project streaks   # from the plugged-in, unlocked iPhone or iPad
appshots capture --name home --clean              # simulator only: 9:41, full battery and signal
appshots pull streaks --render                    # render everything and unpack it into ./store-screenshots/streaks,
                                                  # header and search results assets included
```

The `--name` is what slides refer to (`"screenshot": "home"`). Capturing the same name again replaces the screenshot, and every slide using it updates. An iPhone and an iPad screenshot can share a name; each target size picks the matching one.

Simulator capture uses `simctl`. Device capture uses `devicectl device capture screenshot`, which needs Xcode 27 or newer and a device that is unlocked and trusts the Mac. If `xcode-select` points at the Command Line Tools, the CLI switches to `/Applications/Xcode.app` by itself.

## The Studio

Open the server in a browser and sign in to see every slide as a live preview at export size, edit copy, layout, badges and style, drop in screenshots, and download the set as a ZIP. Below the slides, the Header and search results section adds, previews and edits the three store assets, with the safe area drawn as a dashed frame. Projects sit in the sidebar. Changes Claude makes through MCP show up in an open Studio within a few seconds.

## Slides

A project has a theme and up to ten slides. Every style field can be set on the theme and overridden per slide.

- **Layouts:** `device-bottom`, `device-top`, `device-center`, `tilted`, `duo` (two devices), `hero` (badges above the headline)
- **Badges** (up to four per slide): `laurel` (wreath), `stars`, `icon`, `pill`; with a title, a subtitle, a star value and an icon (`trophy`, `crown`, `medal`, `star`, `heart`, `download`, `bolt`, `shield`, `check`)
- **Backgrounds:** presets (`midnight`, `aurora`, `ember`, `ocean`, `sunset`, `candy`, `forest`, `graphite`, `peach`, `mint`, `lavender`, `sky`, `paper`, `ink`), `auto` (colours taken from the slide's screenshot), a hex colour, or a custom `{type, colors}` gradient or mesh
- **Fonts:** Inter, Manrope, Plus Jakarta Sans, Sora, Space Grotesk, Bricolage Grotesque, Fraunces, Instrument Serif (bundled, nothing is fetched at render time)
- **Device:** frame (`auto`, `iphone`, `ipad`, `none`), colour, scale, rotation, perspective, offset, shadow
- **Text:** `*asterisks*` tint words with the accent colour, a newline forces a break, and any text can be a `{ "en-US": "...", "de-DE": "..." }` map for localized sets

Output sizes, portrait: iPhone 6.9" (1320×2868), iPhone 6.5" (1284×2778), iPad 13" (2064×2752), iPad 12.9" (2048×2732). By default a render produces the 6.9" set, plus the 13" iPad set once the project has iPad screenshots. Files are opaque PNGs laid out as `<locale>/<target>/01.png`.

## Header and search results assets

App Store Connect has a **Header and Search Results** tab under Product Page Information. An image uploaded there is shown at the top of the product page, or with the app in search results, on iOS 27 and iPadOS 27 or later. Both are optional and set per language; without them the store keeps using screenshots in those places.

A project can hold one of each, built from the same screenshots and theme as its slides:

| Asset | Size | Safe area | Used for |
| --- | --- | --- | --- |
| `header` | 3840×1646 (21:9) | 1646×661 at 1097, 493 | The product page header |
| `search` | 3840×2560 (3:2) | 2168×1030 at 836, 765 | The search results asset |
| `universal` | 5244×2950 (16:9) | 1402×962 at 1921, 660 | One file for both; it is what "Use header asset in search results" expects |

The store crops these images differently on each device and orientation, and only the safe area is always visible. appShots therefore centres the copy and shrinks it until it fits inside that area, and treats everything around it as decoration that may be cut off. The Studio and the previews Claude gets draw the safe area as a dashed frame; the exported PNG does not contain it.

- **Layouts:** `fan` (copy above up to five fanned devices), `sides` (copy between up to four devices), `wall` (copy over a dimmed wall of bare screenshots). Without screenshots an asset is copy on the background, without copy it is the devices alone.
- **Per asset:** eyebrow, headline, subheadline, up to six screenshots in order of importance, up to three badges, background, font, colours, headline size, and the device frame, colour, size and shadow. What an asset leaves out comes from the project theme.
- **Output:** opaque PNGs at `<locale>/creative-assets/header.png`, `search.png` and `universal.png`, rendered with the slides and included in the ZIP.

Apple reviews these images and asks for more restraint than in screenshots: one clear idea, a short phrase at most, no prices, discounts, web addresses or copyright symbols, no logos of other platforms, no claims or awards that cannot be verified and no Apple accolades (Editors' Choice, App of the Day, Apple Design Award), and text translated for every language it is uploaded for. See Apple's [creative asset specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/).

Apple publishes the safe areas as a design template, not as numbers. The values above are measured from that template, so check each asset in App Store Connect's preview before submitting. The video variants of these assets are not generated.

## REST API

Everything the Studio and the CLI do goes through `/api`, with the same bearer token. A token only ever reaches the projects of the space it belongs to.

```
GET    /api/projects                       list
POST   /api/projects                       create {name, locales?, theme?, slides?}
GET    /api/projects/:id                   project, screenshots, rendered files
PUT    /api/projects/:id                   update {name?, locales?, theme?, slides?, creatives?: {header?, search?, universal?}}
DELETE /api/projects/:id
PUT    /api/projects/:id/shots/:name       upload a screenshot (raw image body, ?device=iphone|ipad to override detection)
DELETE /api/projects/:id/shots/:file
POST   /api/projects/:id/render            {targets?, locales?, slides?, creatives?}
GET    /api/projects/:id/export.zip        ?render=1 renders first
```

A render without `slides` and `creatives` produces everything. `slides` (zero-based indexes) or `creatives` (`header`, `search`, `universal`) narrow it to those, and `"creatives": []` renders the slides alone.

Account settings and the People page need a browser sign-in; an API token cannot create more tokens or manage people.

## Good to know

- Screenshots are portrait only; there is no landscape or Apple Watch/TV output.
- Put only real figures and awards in badges. App Review rejects screenshots with invented download counts, ratings or rankings.
- The device frames are drawn in CSS, not Apple's product images.
- Put the server behind HTTPS. No passwords are stored. `accounts.json` on the data volume holds each person's name, email address and Google account id, the list of allowed addresses, and API tokens as SHA-256 hashes; a token is shown once when it is created.
