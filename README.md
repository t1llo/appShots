# appShots

App Store screenshots for iPhone, iPad and Mac, made by your coding agent or by hand.

[![Hosted app: live](https://img.shields.io/website?url=https%3A%2F%2Fshots.beffa.xyz&label=hosted%20app&up_message=live)](https://shots.beffa.xyz)
[![MCP server](https://img.shields.io/badge/MCP-server-8250df?logo=modelcontextprotocol&logoColor=white)](#connect-an-agent)
[![Self-host with Docker Compose](https://img.shields.io/badge/self--host-Docker%20Compose-2496ED?logo=docker&logoColor=white)](#host-it)
[![License: GPL-3.0](https://img.shields.io/github/license/t1llo/appShots)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/t1llo/appShots)](https://github.com/t1llo/appShots/commits/main)

**[Try it at shots.beffa.xyz](https://shots.beffa.xyz)** · [Docs](https://shots.beffa.xyz/docs) · [Host it yourself](#host-it)

![An example set: five slides rendered for the 6.9-inch iPhone](docs/example.jpg)

You give it the raw screens of your app. It puts them in device frames with a headline, a background and badges such as "10K+ downloads" or a five-star rating, and exports PNGs at the exact sizes App Store Connect accepts.

A coding agent can do the whole job over MCP: work out how your app is run, run it, capture the screens, write the copy, build the set, look at the render and fix what is off. The app can be an Xcode project, a Flutter, React Native, Expo, Capacitor, Tauri or Electron app, or a web app.

## Try it, or host it yourself

appShots runs as an app at **[shots.beffa.xyz](https://shots.beffa.xyz)**. Sign in with Google, open the Studio or connect your agent with one line, and make a set. There is no server to set up.

This repository is that same app, under the GPL-3.0 licence. To keep your screenshots to yourself, [host it](#host-it): two Docker commands run it on your own machine, and one Docker Compose file puts it on a server with your own sign-in and limits.

## What it makes

- **Screenshot sets** for iPhone, iPhone Duo, iPad and Mac, at every size App Store Connect lists and in every language of the app. Each device can have a set of its own.
- **Header and search results assets**: the wide images of App Store Connect's Header and Search Results tab, with the copy kept inside the safe area.
- **Banners** for the top of a README, a GitHub social preview, a link preview or a post.
- **Mockups**: every screenshot in its device on a transparent background, for a website or a deck.
- **The upload to App Store Connect**: one command puts every language into its language and every size onto its display, in the version you are preparing or a new one, and can change the texts of the store page. It runs on your Mac with an API key of your own, which never reaches the server, and it submits nothing.

It comes with seventeen layouts, 41 fonts, 199 icons, badges, feature cards and backgrounds that can take their colours from the screenshot. The fonts are bundled and the device frames are drawn in CSS, so nothing is fetched while rendering.

## Examples

Renders as they came out of appShots, scaled down and laid side by side. The [home page](https://shots.beffa.xyz) shows more.

A party game's set for the iPhone: seven slides, designed once and exported for the 6.9, 6.5, 6.3 and 6.1-inch displays.

![Seven iPhone slides on dark red, from Find the spy among you with two award wreaths to Settle the score](docs/examples/iphone.webp)

A Mac app at 2880×1800, its windows beside the headline or under it, and a slide of feature cards.

![Six Mac slides on dark green, among them Ten Mac apps. One menu bar. and Private by default](docs/examples/mac.webp)

The banner for the top of a README.

![A README banner: app icon, headline, tagline and two award wreaths on the left, three iPhones on the right](docs/examples/banner.webp)

## How it fits together

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Server | Docker or `npm start` | Renders slides, stores projects, serves the home page, the Studio (the editor in the browser), the docs, the REST API and the MCP endpoint at `/mcp` |
| MCP endpoint | Part of the server | Lets an agent create projects, write slides and render them |
| `appshots` CLI | Your Mac | Captures the simulator, a connected device, the window of a Mac app or the pages of a web app and uploads the screenshot; a container cannot see your simulator or your USB devices, so this part stays local. Also reaches the server's tools for agents without MCP |
| `appshots` skill | Your agent, on your Mac | Does the whole job in an app's repository: reads how the app is run, runs it, captures the screens, writes the copy and builds the set. Works in Claude Code, Codex, OpenCode, Pi and anything else that reads a skill or follows a file |

## Quick start

Needs Node 24 or newer.

```bash
git clone https://github.com/t1llo/appShots.git
cd appShots
npm install
npm run browser   # one-time download of the headless Chromium used for rendering
npm run build     # bundles the Studio and the home page into web/dist
npm start         # http://localhost:3000
```

Started like this the server has no sign-in, no home page and no accounts: whoever can reach the port works in the server's own space. That is fine on localhost and nowhere else. The home page is at `/home` and the docs are at `/docs`.

With Docker in place of Node, see [On your own machine](#on-your-own-machine).

## Host it

appShots is one Docker container with one volume, so it runs wherever Docker does. Host it on your own machine for yourself, or on a server for other people too.

Everything it stores is in the `appshots-data` volume: projects, uploaded screenshots, renders, accounts and the key that signs sessions. Back it up; nothing else holds state.

### On your own machine

You need Docker, for example [Docker Desktop](https://www.docker.com/products/docker-desktop/), and nothing else.

1. Get the code:

   ```bash
   git clone https://github.com/t1llo/appShots.git
   cd appShots
   ```

2. Build the container. The first build takes a few minutes, because it downloads the Chromium that draws the slides.

   ```bash
   docker build -t appshots .
   ```

3. Start it:

   ```bash
   docker run -d --name appshots --init -p 127.0.0.1:3000:3000 -v appshots-data:/data appshots
   ```

4. Open `http://localhost:3000`. That is the Studio, and **Connect an agent** in its sidebar sets up your agent.

`docker stop appshots` stops the server, and `docker start appshots` brings it back with everything in it.

Only this machine can reach a server started like this, and it has no sign-in and no accounts: whoever can reach the port works in the server's own space. That is fine on your own machine and nowhere else. To have sign-in and accounts here as well, follow steps 1 to 4 for a server, with `PUBLIC_URL=http://localhost:3000` and `http://localhost:3000/auth/google/callback` among the OAuth client's redirect URIs.

### On a server

You need a server with Docker, a domain that points at it, and a Google account to make the sign-in with.

1. Create the Google OAuth client described under [Sign in with Google](#sign-in-with-google).

2. On the server, get the code and make the settings file:

   ```bash
   git clone https://github.com/t1llo/appShots.git
   cd appShots
   cp .env.example .env
   ```

3. Fill in `.env`:

   ```ini
   PUBLIC_URL=https://appshots.example.com
   GOOGLE_CLIENT_ID=<the client ID from step 1>
   GOOGLE_CLIENT_SECRET=<the client secret from step 1>
   ADMIN_EMAIL=<your own Google address>
   ```

   `PUBLIC_URL` is the address people will use. The server refuses to start without the other three.

4. Start it:

   ```bash
   docker compose -f docker-compose.yaml -f compose.local.yaml up -d --build
   ```

   The server now answers on `127.0.0.1:3000` of that machine and on no other address. `APPSHOTS_PORT` in `.env` moves it to another port.

5. Put a reverse proxy with HTTPS in front of that port. With [Caddy](https://caddyserver.com) this is the whole configuration:

   ```text
   appshots.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   With nginx or another proxy, pass `X-Forwarded-Proto` and `X-Forwarded-For` on and allow uploads of 40 MB (`client_max_body_size 40m`).

6. Open your domain and sign in with the address in `ADMIN_EMAIL`. You are the admin, and the Admin page decides who else gets in.

To update, run `git pull` and step 4 again.

With a hosting panel that builds and deploys a Compose file from a repository, or a proxy that runs in Docker itself, use `docker-compose.yaml` alone in place of steps 4 and 5. It publishes no port on the host: give the `appshots` service your domain on port `3000`, and the four settings as environment variables.

### Settings

| Variable | Default | What it sets |
| --- | --- | --- |
| `PUBLIC_URL` | each request's host | The public origin. Used for the Google redirect, in the links an agent gets back, in the skill and in the sitemap |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | The OAuth client people sign in with |
| `ADMIN_EMAIL` | none | Your own Google address, which becomes the admin |
| `USER_MAX_PROJECTS` | `20` | Projects an account other than the admin can hold |
| `USER_MAX_SHOTS` | `40` | Screenshots per project and language, and images per project |
| `USER_RENDER_CREDITS` | `10` | Renders each account other than the admin gets |
| `OPERATOR_NAME`, `CONTACT_EMAIL` | none | Who runs the server and where to write, as the privacy policy and the terms name them |
| `UMAMI_URL`, `UMAMI_WEBSITE_ID`, `UMAMI_RECORDER` | off | Page analytics, see [Analytics](#analytics) |
| `CLIENT_IP_HEADER` | none | The request header a CDN in front puts the visitor's address in, see below |
| `PORT` | `3000` | The port the server listens on |
| `DATA_DIR` | `data`, in the container `/data` | Where everything is stored |

Set all three sign-in settings or none. With only one or two of them the server refuses to start, so a typo cannot leave a deployed server open.

With a CDN or a second proxy in front of your reverse proxy, set `CLIENT_IP_HEADER` to the header that service puts the visitor's address in, such as `CF-Connecting-IP`. Sign-in attempts are counted per address, and without it they would all count against that service. Set it only when every request comes through that service, since anyone else could send the header themselves.

### Sign in with Google

Everybody signs in with Google. There are no passwords.

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an OAuth client of type "Web application" with:

- **Authorised JavaScript origin:** `<PUBLIC_URL>`, for example `https://appshots.example.com`
- **Authorised redirect URI:** `<PUBLIC_URL>/auth/google/callback`

Put its client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. appShots asks Google for the name and email address only, and accepts an address only when Google says it is verified.

While the OAuth consent screen is in "Testing", Google itself only lets in the test users listed there. Publish it ("In production") before inviting anyone else; the name and email scopes need no review by Google.

### People and accounts

- **The admin** is the Google address in `ADMIN_EMAIL`. The admin is always let in, works in the server's own space without limits, and decides who else gets in. To hand the server to someone else, change the variable and redeploy.
- **Everyone else** gets a private space on their first sign-in: their own projects, screenshots, renders and API tokens. Nobody sees anybody else's work, the admin included.

Who can sign in is set on the **Admin** page, which only the admin has in the sidebar:

- **Anyone with a Google account** is the default: whoever finds the address can sign in and gets a space of their own.
- **Only the people listed here** closes it. Add the Google address of each person you want to let in; anyone else is turned away after choosing their Google account.
- **Remove** deletes a person's account with all of its projects, and takes them off the list. Their sessions and tokens stop working at once.

The Admin page also shows the server in numbers: accounts, projects, screenshots, renders made and storage used, and the same for each person. It shows how much everybody keeps and never what it is.

**Renders are counted.** Every account other than the admin's gets 10 renders (`USER_RENDER_CREDITS`). One render is one export, whatever it draws; previews in the Studio are free, and a render that fails or is cancelled uses none. A click on the number on the Admin page sets a new one for an account. Deleting an account does not reset the count: the number of renders used is kept beside a hash of the Google account id, so signing up again gives the same count back.

People manage their own tokens, or delete their account, under **Settings**.

### What open sign-in costs

The server makes no paid calls. The agent runs on each person's own subscription, on their own machine, so more people cost nothing per use. What they use is this one machine:

- **CPU and memory.** A render drives a headless Chromium: about a second per slide on a recent Mac, more on a small server, and a few hundred megabytes of memory while it runs. Renders are queued one at a time for the whole server, so many people at once means waiting, not a bigger bill.
- **Disk.** This is what grows. An account can hold 20 projects of 40 screenshots per language, each up to 40 MB when uploaded, plus the rendered sets. Lower `USER_MAX_PROJECTS` and `USER_MAX_SHOTS` if the disk is small, and keep an eye on the volume.
- **Abuse.** Anyone can sign in, so somebody may script uploads or renders. The caps, the counted renders and the render queue bound the damage, and **Remove** on the Admin page deletes an account with everything in it.

If that is more than you want to carry, switch to **Only the people listed here** on the Admin page.

### Analytics

Off unless you turn it on. With `UMAMI_URL` set to the address of your [Umami](https://umami.is) server, such as `https://stats.example.com`, and `UMAMI_WEBSITE_ID` to the id this site has on it, the home page, the docs and the Studio load Umami's script. Neither value is a secret: both sit in the page source. Umami sets no cookie.

It reports page views and seven actions: opening the Studio, following a link to GitHub, choosing an agent, copying a command, creating a project, connecting an agent and exporting. With `PUBLIC_URL` set, only pages opened under that address are counted, so a copy running somewhere else adds nothing.

The Studio shows people's unreleased apps. From there Umami learns that the Studio was opened and that one of those actions happened, and never the name of a project, anything typed, or who is signed in.

`UMAMI_RECORDER=on` also loads Umami's recorder, which replays visits, on the home page and the docs. The Studio never loads it, and the name of whoever is signed in is masked where the home page shows it. What it records and how often is set for the website in Umami.

The analytics section of the privacy policy appears only while both settings are there.

### Docs, privacy policy and terms

The server has its own documentation at `/docs`, a privacy policy at `/privacy` and terms at `/terms`, all public. Each page is a Markdown file in [`docs/`](docs). The reference tables in them (layouts, fonts, icons, sizes) are filled in from the code, so they cannot fall behind it.

- Every page is also there as Markdown, at its address with `.md` on the end, and for a request that asks for `text/markdown`.
- `/llms.txt` lists the pages for language models, and `/llms-full.txt` holds all of them in one file.
- `/sitemap.xml` and `/robots.txt` are for search engines. They need `PUBLIC_URL` to carry the right address.

Set `OPERATOR_NAME` and `CONTACT_EMAIL` to put a name and a contact address on the privacy policy and the terms. Without them the pages say "the person who runs this server". Both pages are a starting point written for this software, not legal advice: read them, and change `docs/privacy.md` and `docs/terms.md` to fit who you are and where you are.

## Connect an agent

**Connect an agent** in the Studio's sidebar asks which agent you use, then what it should do, and gives the steps with your token already filled in.

| Agent | Skill goes to | Start it with | MCP connection |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/skills/appshots` | `/appshots` | `claude mcp add`, for every folder |
| Codex | `~/.agents/skills/appshots` | `$appshots` | `codex mcp add`, plus the token in `~/.codex/config.toml` |
| OpenCode | `~/.agents/skills/appshots` | Ask for the screenshots | `opencode mcp add --global` |
| Pi | `~/.agents/skills/appshots` | `/skill:appshots` | None: Pi has no MCP, the skill uses `appshots call` |
| Something else | `~/.agents/skills/appshots` | "Read `~/.agents/skills/appshots/SKILL.md` and follow it" | By hand, if the agent has MCP |

### One command for everything

```bash
curl -fsS https://appshots.example.com/install.sh | APPSHOTS_TOKEN=<token> sh -s codex
```

Connect shows this with a real token in place of `<token>` and your agent at the end: `claude` (also what you get with nothing after `sh`), `codex`, `opencode`, `pi` or `other`. It needs Node on the Mac, and does four things:

1. Checks the token against the server and saves it in `~/.config/appshots`.
2. Puts the CLI next to the skill and links it as `appshots` in `~/.local/bin`, `~/bin` or next to `claude`, whichever is on your PATH.
3. Installs the skill where that agent looks for skills.
4. Connects the agent to the server's MCP endpoint for every folder, with the agent's own command, replacing an older `appshots` entry.

`install.sh`, the skill and the CLI hold no secrets, so the server hands them out without sign-in; the token is the only thing that opens anything.

Then open the agent in an app's repository and start the skill, or just ask for App Store screenshots. The agent checks the setup, asks a handful of questions (which devices, where the screens come from, the look, any real ratings or logos to show), reads a little of the code to learn what the app does, gets the screens, writes the headlines, builds the set, looks at the render and fixes what is off. The skill's source is [skill/SKILL.md](skill/SKILL.md).

The repository does not have to be an Xcode project. The agent reads what the app is made with and starts it with the toolkit's own command: a Flutter, React Native, Expo or Capacitor app in the simulator, a Tauri or Electron app in its window, a web app in a browser. See [docs/web-apps.md](docs/web-apps.md).

### Staying current

The server hands out the skill and the CLI it was deployed with. A Mac that was set up before catches up with one command, which needs no token and leaves the agent's connection alone:

```bash
appshots update
```

Every command says so in one line when the copies on the Mac are behind: it compares them with the hashes at `/skill.json`, at most twice a day.

### Only the MCP connection

```bash
claude mcp add --transport http --scope user appshots https://appshots.example.com/mcp --header "Authorization: Bearer <token>"
opencode mcp add --global --url https://appshots.example.com/mcp --header "Authorization=Bearer <token>" appshots
```

Codex takes no header on its command line, so use the setup command above for it, or add the server yourself in `~/.codex/config.toml`:

```toml
[mcp_servers.appshots]
url = "https://appshots.example.com/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

Then ask in plain words, for example:

> Make App Store screenshots for my habit tracker in project "streaks". Six slides, dark purple look, open with a hero slide with a laurel badge "4.8 · App Store rating" and one for "50K+ downloads", then one slide per feature using the screenshots home, stats and widgets.

The agent answers with a contact sheet of the rendered set, a link to the Studio and a ZIP link. Tools: `get_design_guide`, `list_projects`, `create_project`, `get_project`, `update_project`, `set_slides`, `update_slide`, `set_creative_assets`, `render`, `render_mockups`, `list_revisions`, `restore_project`. Every tool works inside the space the token belongs to.

The endpoint is Streamable HTTP and authenticates with a bearer header, so it works with any client that can send one. It does not implement OAuth.

### Without MCP

The CLI reaches the same tools, for Pi and any other agent that can run a command but has no MCP:

```bash
appshots tools                                    # every tool and its arguments
appshots call create_project '{"name": "Streaks"}'
appshots call set_slides @slides.json             # arguments from a file, or - for stdin
appshots call render '{"project": "streaks"}'     # pictures a tool returns are saved, and the paths printed
```

## Capture from your Mac

The setup command above installs the CLI. It is one file with no dependencies, so in a checkout it also runs as `node cli/appshots.mjs`, or as `appshots` after `npm link`.

```bash
appshots check                                    # the server, the skill, Xcode, the project here and what it is made
                                                  # with, simulators, installed apps and devices, each with what to do next
appshots run                                      # build the Xcode project in this folder and launch it in a simulator
appshots run --ipad --dark --lang de              # on the 13-inch iPad Pro, dark, in German
appshots shoot streaks home stats detail --clean  # you open each screen and press Return; it captures and uploads
appshots launch com.example.streaks --capture stats --to streaks -- -appshots stats
                                                  # start an installed app with launch arguments,
                                                  # capture the screen and upload it, in one command
appshots capture --name home --project streaks    # from the booted simulator, uploaded straight away
appshots capture --name home --device --project streaks   # from the plugged-in, unlocked iPhone or iPad
appshots capture --mac Ledger --name overview --project ledger   # the frontmost window of a Mac app
appshots capture --web http://localhost:3000/stats --name stats --project streaks
                                                  # a page of a web app at iPhone size; --as ipad or --as mac for those
appshots boot                                     # boot the simulator for a Flutter, React Native, Expo or Capacitor
                                                  # app, and print that toolkit's run command with the udid in it
appshots upload streaks ./screens                 # screenshots you already have: files, or a folder of them
appshots upload streaks logo.svg mascot.png --image   # a logo and other artwork for the slides
appshots pull streaks --render                    # render everything and unpack it into ./store-screenshots/streaks
appshots mockups streaks --style clay --shadow soft   # transparent device mockups into ./mockups/streaks
appshots store login                              # save an App Store Connect API key: issuer ID, key ID and the path
                                                  # of the .p8 file. The role Marketing is enough, and the key stays put
appshots store push streaks --app com.example.streaks --dry-run
                                                  # what would go into App Store Connect: each language and display.
                                                  # Without --dry-run it uploads. Nothing is ever submitted for review
appshots store text --app com.example.streaks     # the store page's texts as JSON; --set writes them back
appshots update                                   # the skill and the CLI as the server has them now
```

The `--name` is what slides refer to (`"screenshot": "home"`). Capturing the same name again replaces the screenshot, and every slide using it updates. An iPhone, an iPad and a Mac screenshot can share a name; each target size picks the matching one. `--lang <code>` files a screenshot under one of the project's languages.

Simulator capture uses `simctl`. Device capture uses `devicectl device capture screenshot`, which needs Xcode 27 or newer and a device that is unlocked and trusts the Mac. `capture --mac` takes an app's frontmost window with `screencapture`, which macOS allows only when the terminal has the Screen Recording permission. `capture --web` draws the page with the Chrome, Edge or Brave that is installed, without opening a window, and needs no Xcode. Every command and option is in [docs/cli.md](docs/cli.md).

## The Studio

Open the server in a browser and sign in to see every slide as a live preview at export size. Click a slide to edit it: its fields open on the right, with the layouts as small sketches, the screenshots as thumbnails, and sliders for the device's size, position and tilt. Changes an agent makes through MCP show up in an open Studio within a few seconds.

A project has three parts: **Slides**, **Assets** (screenshots, logos and images) and **Mockups**. The header and search results assets and the banners are edited beside the slides, **Export ZIP** renders in the background, and the appearance is light, dark or automatic. [docs/studio.md](docs/studio.md) walks through all of it.

## Slides

A project has a theme and up to ten slides. Every style field can be set on the theme and overridden per slide. `slides` is the set every device shares, drawn again for each canvas; a device can have a set of its own in `deviceSlides`.

- **Layouts:** one device (`device-bottom`, `device-top`, `device-center`, `tilted`, `closeup`, `floating`, `hero` with badges above the headline), the device beside a column of copy (`device-right`, `device-left`), several devices (`duo`, `side-by-side`, `trio`), and five with no device at all: `features` (cards), `statement` (the headline as the picture), `stat` (one giant figure and a row of smaller ones), `steps` (numbered steps joined by a line) and `reviews` (a wall of quote cards)
- **Feature cards and points:** up to eight things the app does, as cards with an icon or a figure on a `features` slide, or as a short list next to the headline on every other layout
- **Badges:** `laurel` (wreath), `stars`, `rating` (the figure with five stars), `review` (a quote with its author), `icon`, `pill`; plain or in `gold`
- **Icon and logo rows:** up to eight icons or logos under the copy with an optional label such as "Works with"
- **Your own artwork:** a logo over the headline, and up to ten uploaded images placed anywhere on a slide
- **Icons:** 199 of them, 43 of which are logos of services such as YouTube, Instagram, Spotify, Slack and Notion. They are the fill weight of [Phosphor Icons](https://phosphoricons.com) (MIT)
- **Backgrounds:** fourteen presets, `auto` (colours taken from the slide's screenshot), a hex colour, or a custom gradient or mesh
- **Fonts:** 41, in sans, rounded, display, serif, handwritten and mono
- **Device:** frame (`iphone`, `duo`, `ipad`, `mac`, `none`), colour, shadow, size, place, tilt and a turn in 3D, drawn as the device looks (`real`), in one matte colour (`clay`), as a line drawing (`outline`) or as one drawn by hand (`sketch`)
- **Status bar:** a clean one, with 9:41, full signal, Wi-Fi and a full battery, drawn over the one a screenshot came with
- **Text:** `*asterisks*` mark a word, as a tint, a marker stroke or an underline; a newline forces a break; and any text can be a `{ "en-US": "...", "de-DE": "..." }` map for localized sets

Every field with its values is in [docs/slides.md](docs/slides.md).

### Output sizes

A set is designed once per device and exported at the exact size of every display App Store Connect lists. Sizes of the same shape are one picture drawn at the largest size and scaled, so they look alike everywhere.

| Folder | Pixels | Display in App Store Connect | Exported |
| --- | --- | --- | --- |
| `iphone-6.9` | 1320×2868 | iPhone with Dynamic Island (large display) | always |
| `iphone-6.3` | 1206×2622 | iPhone with Dynamic Island (medium display) | always |
| `iphone-6.5` | 1284×2778 | iPhone with Face ID (large display) | always |
| `iphone-6.1` | 1170×2532 | iPhone with Face ID (medium display) | always |
| `iphone-duo` | 2007×2853 | iPhone Duo | with Duo screenshots |
| `ipad-13` | 2064×2752 | iPad 13" display | with iPad screenshots |
| `ipad-11` | 1668×2420 | iPad 11" display | with iPad screenshots |
| `mac-2880` | 2880×1800 | Mac | with Mac screenshots |
| `iphone-5.5`, `iphone-4.7`, `iphone-4`, `iphone-3.5` | 1242×2208, 750×1334, 640×1136, 640×960 | iPhone with Home Button | when chosen |
| `iphone-duo-cover` | 1398×2034 | iPhone Duo | when chosen |
| `ipad-12.9`, `ipad-10.5`, `ipad-9.7` | 2048×2732, 1668×2224, 1536×2048 | older iPads | when chosen |
| `mac-2560`, `mac-1440`, `mac-1280` | 2560×1600, 1440×900, 1280×800 | Mac | when chosen |

Files are opaque PNGs laid out as `<locale>/<target>/01.png`, and the ZIP has a `README.txt` that says which folder goes onto which display.

### Beyond the screenshot set

| | Sizes | Read more |
| --- | --- | --- |
| **Mac apps** | 2880×1800, landscape. A captured window is drawn as that window, a full-screen picture inside a MacBook | [docs/mac.md](docs/mac.md) |
| **Web apps and other toolkits** | A web app's pages are captured at 1320×2868 for the iPhone, 2064×2752 for the iPad or 2880×1800 for the Mac. Flutter, React Native, Expo, Capacitor, Tauri and Electron apps are captured where they run | [docs/web-apps.md](docs/web-apps.md) |
| **Header and search results** | `header` 3840×1646, `search` 3840×2560, `universal` 5244×2950, with the copy inside Apple's safe area | [docs/store-assets.md](docs/store-assets.md) |
| **Banners** | `readme` 2400×800, `social` 1280×640, `link` 1200×630, `post` 1920×1080 | [docs/banners.md](docs/banners.md) |
| **Mockups** | One transparent PNG per screenshot and device, cut to the device | [docs/mockups.md](docs/mockups.md) |

Apple publishes the safe areas of the header and search results assets as a design template, not as numbers. The values appShots uses are measured from that template, so check each asset in App Store Connect's preview before submitting.

## REST API

Everything the Studio and the CLI do goes through `/api`, with the same bearer token. A token only ever reaches the projects of the space it belongs to, and cannot create more tokens or manage people.

```bash
curl -X PUT -H "Authorization: Bearer $APPSHOTS_TOKEN" -H "Content-Type: image/png" \
  --data-binary @home.png https://appshots.example.com/api/projects/streaks/shots/home
curl -X POST -H "Authorization: Bearer $APPSHOTS_TOKEN" https://appshots.example.com/api/projects/streaks/render
curl -H "Authorization: Bearer $APPSHOTS_TOKEN" -o streaks.zip https://appshots.example.com/api/projects/streaks/export.zip
```

Every request is in [docs/api.md](docs/api.md).

## Documentation

A running server shows these pages at `/docs`, with its own address in the examples and the reference tables filled in from the code. Their sources are in [`docs/`](docs), where a `{{NAME}}` stands for such a value.

| | Pages |
| --- | --- |
| Start | [Overview](docs/index.md) · [Quick start](docs/quick-start.md) · [Connect an agent](docs/connect.md) · [Update](docs/update.md) |
| Make a set | [The skill](docs/skill.md) · [Get your screens in](docs/screens.md) · [Mac apps](docs/mac.md) · [Web apps and other toolkits](docs/web-apps.md) · [The Studio](docs/studio.md) · [Logos and artwork](docs/images.md) · [Languages](docs/languages.md) · [Render and export](docs/export.md) · [Upload to App Store Connect](docs/app-store-connect.md) · [Mockups](docs/mockups.md) · [Banners](docs/banners.md) · [App Review rules](docs/app-review.md) |
| Reference | [Slides](docs/slides.md) · [Header and search results](docs/store-assets.md) · [Sizes](docs/sizes.md) · [Command line](docs/cli.md) · [MCP tools](docs/mcp.md) · [HTTP API](docs/api.md) |
| Help | [Accounts, tokens and limits](docs/accounts.md) · [Troubleshooting](docs/troubleshooting.md) · [FAQ](docs/faq.md) |

## Development

The server runs straight from its TypeScript sources on Node 24; only the web pages have a build step.

| Folder | What is in it |
| --- | --- |
| `src/` | The server: slide templates, the renderer, the store, accounts, the REST API, the MCP tools and the docs site |
| `web/` | The Studio and the home page: React, TanStack Router and TanStack Query, bundled by Vite into `web/dist` |
| `cli/` | The `appshots` command, one file with no dependencies, and `install.sh` |
| `skill/` | The skill agents install |
| `docs/` | The pages served at `/docs`, `/privacy` and `/terms` |

```bash
npm run dev         # the server, restarting on changes
npm run dev:web     # the Studio with hot reload; open the address Vite prints
npm run typecheck   # the server and the web sources
npm run build       # web/dist, after changing anything in web/
npm run icons       # rebuilds src/icons.ts from the list in scripts/icons.mjs
```

To add a docs page, put `docs/<name>.md` there with a `title` and a `description` at the top, and add its name to `SECTIONS` in `src/site.ts`.

Issues and pull requests are welcome. Run `npm run typecheck` before sending one.

## Good to know

- iPhone and iPad sets are portrait only and a Mac set is landscape; there is no Apple Watch or Apple TV output.
- Put only real figures, reviews and awards in badges, on a `stat` slide and on a `reviews` slide. App Review rejects screenshots with invented download counts, ratings or rankings.
- Logos are other companies' trademarks. Show them only for services the app really works with, and none in the header and search results assets, where Apple does not allow them.
- The device frames are drawn in CSS, not Apple's product images.
- No passwords are stored. `accounts.json` on the data volume holds each person's name, email address, Google account id and number of renders, the list of allowed addresses, and API tokens as SHA-256 hashes; a token is shown once when it is created.
- appShots is not affiliated with Apple. Apple, App Store, iPhone, iPad and Mac are trademarks of Apple Inc.

## License

Copyright (C) 2026 Tillo Beffa. appShots is free software under the [GNU General Public License, version 3](LICENSE). It comes with no warranty.

The licence covers the appShots code. The screenshots, mockups and banners you make with it are yours.

The icons are from [Phosphor Icons](https://phosphoricons.com) (MIT). The fonts are installed from [Fontsource](https://fontsource.org), each under its own licence: the SIL Open Font License for all but Roboto Slab and Permanent Marker, which are under Apache-2.0.
