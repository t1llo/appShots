---
title: Web apps and other toolkits
nav: Web apps and toolkits
description: Make store screenshots of an app that is not an Xcode project. Capture a web app's pages at iPhone, iPad and Mac size with one command, and start a Flutter, React Native, Expo, Capacitor, Tauri or Electron app with its own command before capturing it.
---

Your app does not have to be an Xcode project. An app is captured where it runs, and there are three such places:

| The app | Made with | It runs | A screen is captured with |
| --- | --- | --- | --- |
| iPhone or iPad app | Xcode, Flutter, React Native, Expo, Capacitor, Tauri | In the iOS Simulator, or on a plugged-in device | `appshots capture --clean` |
| Mac app | Xcode, Tauri, Electron, Flutter | In a window on your Mac | `appshots capture --mac <app>` |
| Web app | Next.js, Vite, SvelteKit, Rails, Django and the like | As pages in a browser | `appshots capture --web <address>` |

What differs from one toolkit to the next is how the app is started. Run this in the app's folder, and it reads the project and tells you:

```bash
appshots check
```

```text
Project: no Xcode workspace or project here, and 'appshots run' builds only those. This app is captured as its toolkit runs it:
Made with Next.js (package.json):
  In a browser: 'pnpm dev' in the background (usually at http://localhost:3000; it prints the address it took), then 'appshots capture --web http://localhost:3000 --name <name>'
Browser: Google Chrome, which draws the pages for 'appshots capture --web'
```

It knows Flutter, Expo, React Native, Capacitor, Tauri, Electron, the common web frameworks (Next.js, Nuxt, SvelteKit, Astro, Remix, Angular, Vite and others), Rails, Django, Laravel, Phoenix and a plain `index.html`. In a repository that holds several apps, it lists the folders they are in.

## A web app

Start the app the way you always do. Then every screen is an address:

```bash
appshots capture --web http://localhost:3000 --name home --project streaks
appshots capture --web http://localhost:3000/stats --name stats --project streaks
```

The command draws the page at the exact size of an iPhone screenshot, without opening a window, and uploads it. It uses the Chrome, Edge or Brave that is installed and downloads nothing. That browser runs with a profile of its own, so it sees none of your sign-ins, history or extensions.

It waits until the page has loaded and stopped fetching. If the address answers with an error such as 404, it says so. A file works as well: `--web index.html`.

### Sizes

| Option | The page is laid out at | The picture |
| --- | --- | --- |
| none | 440 × 956 points | 1320 × 2868, an iPhone's |
| `--as ipad` | 1032 × 1376 points | 2064 × 2752, an iPad's |
| `--as mac` | 1440 × 900 points | 2880 × 1800, a Mac's, shown inside a MacBook |
| `--as duo` | 669 × 951 points | 2007 × 2853, an iPhone Duo's |

`--viewport 1280x800` lays the page out at another size. For a set on several devices, capture each address once per device under the same name. Each device's slides then show its own picture. See [Sizes](/docs/sizes).

### The status bar and the home indicator

On an iPhone or iPad the page is laid out as an installed web app is: between the status bar and the home indicator. The home indicator is drawn. The status bar's place stays free, in the colour of the page's top edge, and the theme draws a clean one into it:

```json
{ "device": { "statusBar": "overlay" } }
```

In the Studio that is **Status bar** in the device settings. See [Status bar](/docs/slides#status-bar).

A page that asks for the whole screen with `viewport-fit=cover` gets it, together with the safe area a phone would report through `env(safe-area-inset-top)`. It then runs under the status bar, as it does on a phone.

### Reach a screen

| Option | What it does |
| --- | --- |
| `--init <script>` | JavaScript that runs before the page's own, on every load. For sample data in `localStorage`, a cookie banner that is already dismissed, a fixed date. `--init @seed.js` reads it from a file |
| `--eval <script>` | JavaScript that runs in the loaded page before the picture is taken: the click that opens a tab or a dialog, a scroll. `await` works in it. When it leads to another page, that page is captured |
| `--wait <seconds>` | Time the page gets to settle once it has loaded. One second unless you say otherwise |
| `--dark`, `--light` | The colour scheme the page is asked for |
| `--lang <code>` | The language the browser reports. The screenshot is filed under that [language](/docs/languages#screenshots-per-language) |
| `--profile <folder>` | Keeps cookies and storage in this folder between captures, for pages behind a sign-in |

```bash
appshots capture --web localhost:3000/stats --name stats --project streaks --dark \
  --init "localStorage.setItem('demo', '1')" \
  --eval "document.querySelector('[data-tab=week]').click()"
```

`appshots shoot` is for apps you open by hand, so it does not take `--web`. Screenshots you take in your own browser can be [uploaded](/docs/screens#from-files-you-have) like any others.

### What you need

Node.js 18 or newer and one of Google Chrome, Chromium, Microsoft Edge or Brave. `APPSHOTS_BROWSER` points the command at another Chromium browser. This kind of capture needs no Xcode.

## An iPhone or iPad app from another toolkit

It runs in the iOS Simulator like any other app. Only the build is the toolkit's own, so `appshots run`, which builds Xcode projects, is replaced by two commands:

```bash
appshots boot                       # boots the simulator the store sizes ask for and prints its udid
flutter run -d <udid>               # your toolkit's run command, with that udid
```

| Toolkit | Its run command |
| --- | --- |
| Flutter | `flutter run -d <udid>` |
| Expo | `npx expo run:ios --device <udid>`, or `npx expo start --ios` for Expo Go |
| React Native | `npx react-native run-ios --udid <udid>` |
| Capacitor | `npm run build && npx cap run ios --target <udid>` |
| Tauri | `npm run tauri ios dev "<simulator name>"` |

`boot` prints the one that fits the project in the current folder, with the udid filled in. `--ipad` and `--duo` boot those simulators instead. From there on everything is as in [Get your screens in](/docs/screens):

```bash
appshots capture --name home --project streaks --clean
appshots shoot streaks home stats detail --clean
```

Once the app is installed, `appshots launch <bundle id>` starts it again without a build.

A Capacitor app is its web pages inside a native shell. Capturing the pages with `--web` is quicker and looks the same, unless a screen depends on a native plugin such as the camera.

## A desktop app from Tauri, Electron or Flutter

It is a Mac app, and its window is captured as described in [Mac apps](/docs/mac):

```bash
npm run tauri dev                   # or npm run start, flutter run -d macos
appshots capture --mac pond --name overview --project pond
```

An app that runs from source goes by the name of its program instead of the name in the menu bar: `Electron` for an Electron app, the name of the Cargo package for a Tauri app. `appshots check` says which, and `appshots capture --mac` alone lists the apps that have a window open.

## With an agent

[The skill](/docs/skill) does all of this by itself. It runs `appshots check`, starts the app with the command that names, captures each screen, and stops what it started. For a web app it reads the routes off the router and reaches a screen by its address, with `--init` and `--eval` where a screen needs data or a click.

It uses the sample data and the test account the project already has, and never a real account. When a screen needs a sign-in it has no test account for, it asks you.
