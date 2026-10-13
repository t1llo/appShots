import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import sharp from "sharp";
import { CREATIVE_CAPACITY, creativeLayout } from "./creative.ts";
import {
  BACKGROUNDS,
  BADGE_TONES,
  BADGE_TYPES,
  BADGES_SHOWN,
  CARD_ICONS,
  CARD_LOOKS,
  CREATIVE_LAYOUTS,
  DEVICE_COLOR_IDS,
  DEVICE_STYLES,
  EMPHASIS,
  FEATURE_STYLES,
  POINT_STYLES,
  FONT_GROUPS,
  FONTS,
  ICON_GROUPS,
  ICON_ROW_SIZE_IDS,
  ICON_ROW_STYLES,
  ICON_ROW_TONES,
  LAYOUTS,
  LOGO_SHAPES,
  LOGO_SIZE_IDS,
  REVIEWS_SHOWN,
  STATUS_BARS,
} from "./design.ts";
import { rendersLeft } from "./accounts.ts";
import { mockupName, mockupShots } from "./mockup.ts";
import { defaultTargets, type Mockup, mockupSheet, renderMockup, renderProject } from "./render.ts";
import { allSlides, creativeSchema, localeSchema, mockupsSchema, type Project, slideSchema, slugSchema, targetsSchema, themeSchema } from "./schema.ts";
import { DEVICE_KINDS, DEVICE_LABELS, PLACEMENT_IDS, PLACEMENTS, type PlacementId, placementsOf, sourceOf, type Target, TARGET_IDS, TARGETS } from "./sizes.ts";
import { createProject, getProject, InputError, listImages, listProjects, listShots, outDir, type Shot, shotLocale, type Space, type StoredImage, updateProject } from "./store.ts";
import { deviceShape } from "./template.ts";

function uploadHelp(base: string, id: string): string {
  return [
    "This server cannot see the user's devices, so raw screenshots are captured on their Mac and uploaded:",
    `- With the bundled CLI: \`appshots upload ${id} <files or folders>\` sends screenshots that exist already. \`appshots capture --name home --project ${id} --clean\` grabs the booted simulator; add \`--device\` for a connected iPhone or iPad. \`appshots launch <bundle id> --capture home --to ${id} -- <launch arguments>\` starts an installed app on one screen and captures it in one go. A Mac app runs on the Mac itself: \`appshots capture --mac <app name> --name home --project ${id}\` takes its frontmost window (see Mac apps). A web app is drawn page by page: \`appshots capture --web <address> --name home --project ${id}\` (see Web apps and other toolkits). \`appshots check\` reports what there is to work with: the project, what it is made with and the commands that start it.`,
    `- With curl: \`curl -fsS -X PUT -H "Authorization: Bearer $APPSHOTS_TOKEN" -H "Content-Type: image/png" --data-binary @home.png "${base}/api/projects/${id}/shots/home"\` (the token is the one this MCP connection uses)`,
    "The last path segment is the screenshot name slides refer to. iPhone, iPhone Duo, iPad or Mac is told from the picture, and one name can hold a variant for each: a picture wider than it is tall is a Mac's, and so is a captured window, which has see-through round corners. `get_project` lists what each one was filed under; when that is wrong, upload it again with `--as iphone`, `--as duo`, `--as ipad` or `--as mac` (`?device=` with curl).",
    "A project in several languages can hold each screenshot once per language, under the same name. Upload the first language's as above: every other language shows those until it has its own. Then start the app in the next language and upload under the same names with `--lang de-DE` (`?locale=de-DE` with curl); `appshots launch <bundle id> --lang de-DE --capture home --to " + id + "` does both in one go. The language has to be one of the project's `locales`, and slides keep naming the screenshot as before: the render picks the variant of the language it draws.",
    `A logo or other artwork for the slides (see Logo and images) goes up the same way: \`appshots upload ${id} logo.png --image\`, or with curl to \`${base}/api/projects/${id}/images/<name>\`. PNG, SVG, JPEG and WebP are taken, and transparency is kept.`,
  ].join("\n");
}

/** On an account whose renders are counted, how to spend them. Nothing where they are not. */
function renderBudget(space: Space): string {
  const left = rendersLeft(space.id);
  if (left == null) return "";
  return `\nRenders are counted on this account: every call to \`render\` uses one, whatever it draws, and ${left === 0 ? "none are left" : `${left} ${left === 1 ? "is" : "are"} left`}. So write the whole set before the first render, render everything in one call, fix all you see in one go and render once more. Do not render slide by slide. When none are left, say so: the person who runs the server can give the account more.`;
}

function designGuide(base: string, space: Space): string {
  const list = (entries: Record<string, string>) =>
    Object.entries(entries)
      .map(([key, value]) => `- \`${key}\`: ${value}`)
      .join("\n");
  return `# appShots: App Store screenshot generator

## Workflow
1. \`create_project\`, or \`list_projects\` / \`get_project\` to continue an existing one.
2. Get raw screenshots into the project (see Uploading below), then check them with \`get_project\`.
3. \`set_slides\` with the copy and design for the whole set. Put shared styling in \`theme\`; slides override it. Then give every other device the project has screenshots of a set composed for its own canvas (see A set for each device).
4. \`render\`. It returns one contact sheet image per device: look at each, fix what is off with \`update_slide\`, render again.
5. Optionally \`set_creative_assets\` for the product page header and the search results asset, or for a banner outside the store such as the picture at the top of a README (see Banners), and \`render\` again.
6. The user downloads the PNGs from ${base}/#/<project> or with \`appshots pull <project>\`. \`appshots store push <project> --app <bundle id>\` puts them into App Store Connect instead, from the user's Mac with an API key of their own: that key never comes here, so no tool takes one, and nothing is submitted for review.${renderBudget(space)}
When what is wanted is not store screenshots but the devices alone, for a website or a README, see Mockups at the end: that needs only steps 1 and 2. For a macOS app, read Mac apps before step 2; for a web app, or an app made with Flutter, React Native, Expo, Capacitor, Tauri or Electron, read Web apps and other toolkits.

## Uploading
${uploadHelp(base, "<project>")}

## Output sizes
A set is designed once per device: iPhone, iPhone Duo, iPad and Mac. Each device shows its own variant of a screenshot name, and can have slides of its own (see A set for each device). App Store Connect has one screenshot slot per display, and each takes its own pixel size, so a render writes one folder per size:
${Object.entries(TARGETS as Record<string, Target>)
  .map(([id, target]) => `- \`${id}\`: ${target.width}×${target.height}, for "${target.slot}"${target.standard ? ", standard" : ""}${target.from ? `, the ${target.from} picture scaled` : ""}`)
  .join("\n")}
Left to itself, \`render\` writes the standard sizes of every device the project has screenshots of (iPhone while it has none). The others are for older displays, for the Duo's cover display and the smaller sizes the Mac App Store takes as well: add them with \`update_project\` \`targets\` only when the user asks. Sizes marked as scaled are the same picture as the size they name, so judge the design on one contact sheet per device. iPhone and iPad sets are portrait, a Mac set is landscape. Up to 10 slides per set.

## A set for each device
The project's \`slides\` are the shared set. Every device draws them on its own canvas, with its own variant of each screenshot name. That is where a project starts, not where it should end: an iPhone's canvas is tall and narrow, an iPad's is close to square and a Mac's is wide, and a slide composed for one rarely sits best on another. So when a project has screenshots of more than one device, design each device on its own:
- \`set_slides\` without \`device\` writes the shared set. Compose it for the iPhone, or for the one device the app has.
- \`set_slides\` with \`"device":"ipad"\` (or \`mac\`, \`duo\`, \`iphone\`) gives that device a set of its own, which it draws in place of the shared one. Start from the shared slides and recompose each for that canvas. The sets may tell the same story in the same words, and a slide that already sits well stays as it is; what matters is that each was looked at on its own canvas. They may also differ in number and in order.
- \`update_slide\` with \`"of":"ipad"\` changes one slide of that device's own set. It is \`of\` there because \`device\` inside \`changes\` is how the slide's device is drawn. \`get_project\` lists the sets under \`deviceSlides\`.
- \`set_slides\` with a \`device\` and an empty \`slides\` list takes the device's own set away, so it shows the shared one again.
What usually changes from the iPhone's set:
- iPad: there is width to spare. \`device-right\` and \`device-left\` use it where a centred phone-style slide leaves bands at the sides, and \`duo\`, \`side-by-side\` and \`trio\` show more at once. A tablet screenshot shows more of the app, so one slide can cover what took two.
- Mac: the canvas is wide and short. Put the copy beside the window (\`device-right\`, \`device-left\`) or keep it to one line above. See Mac apps.
- iPhone Duo: its canvas has a tablet's shape with a phone's screens; treat it like the iPad.
- \`features\`, \`statement\`, \`stat\`, \`steps\` and \`reviews\` lay themselves out for each canvas and can be carried over unchanged.
- Each device names the screenshots it has. A screen that exists only on the iPhone is drawn as an iPhone on the other canvases too, which is rarely what an iPad set wants.
A render draws every device from its own set and returns a contact sheet for each. The \`slides\` of \`render\` count within each device's set.

## Mac apps
The same server makes the screenshots of a macOS app for the Mac App Store. Find out which kind of app this is before anything else: an Xcode target whose \`SDKROOT\` is \`macosx\` or whose \`SUPPORTED_PLATFORMS\` holds \`macosx\`, a Swift package with \`.macOS\` in its \`platforms\`, or an Electron or Tauri app is a Mac app. An app for iPhone and Mac gets both: one project holds iPhone, iPad and Mac screenshots side by side.
- A Mac app runs on the user's Mac, not in a simulator, so \`appshots run\` and \`launch\` are not for it. Build and open it the project's own way, for an Xcode project \`xcodebuild -scheme <scheme> -configuration Debug -derivedDataPath build build\` and then \`open build/Build/Products/Debug/<App>.app\` (\`--args <launch arguments>\` opens it on one screen; \`open\` only brings a running app to the front, so quit the app before opening it with other arguments). Bring it to the screen to show and take the window with \`appshots capture --mac <app name> --name <name> --project <project>\`.
- A Tauri, Electron or Flutter app for the desktop is started by its own command, which \`appshots check\` names, such as \`npm run tauri dev\`. It keeps running while the app is open, so it goes into the background. Run from source, the window goes by the name of its program, such as \`Electron\` or the Cargo package, and \`appshots capture --mac\` alone lists the apps that have a window open.
- That needs the Screen Recording permission for the terminal the command runs in. When macOS refuses, the command says where to switch it on; pass that on to the user, or ask them to take the window themselves (Shift-Command-4, then Space, then a click on the window) and upload the file with \`appshots upload <project> <file> --as mac\`.
- A captured window is shown as that window: its own round corners, a soft shadow, the shadow macOS adds cut away. A picture that fills its rectangle and has about the shape of a display (1.45 to 1.85 times as wide as tall), such as an app in full screen, is shown inside a MacBook. \`get_project\` says which of the two each Mac screenshot is \`shown\` as. \`"frame":"mac"\` in \`device\` asks for the MacBook and \`"frame":"none"\` for the bare window, whatever the picture is. Neither has a status bar. The MacBook is silver unless \`color\` says otherwise.
- A window suits a small app better than a full screen: it is drawn large, so its text stays readable, where a full screen in a MacBook turns into fine print. A MacBook makes a good first slide.
- The Mac App Store takes 1 to 10 landscape pictures of 16:10. \`mac-2880\` (2880×1800) is the size exported, and that one size is all the store needs.
- Every layout works on the wide canvas. What differs there: the copy of \`device-right\` and \`device-left\` gets the narrower part and the device the wider one; a MacBook that would be cut off only slightly at the bottom is made small enough to show whole; in \`duo\`, \`side-by-side\` and \`trio\`, laptops and windows stand level instead of fanned out; a \`features\` slide lays its cards across. There is little height, so one line of headline and one of subheadline is the most a slide with a device below takes well.
- A slide shows the Mac variant of a screenshot name on the Mac canvas and the iPhone variant on the iPhone canvas. So for an app on both, give the same screen the same name on every device, then give the Mac a slide set of its own with \`set_slides\` and \`"device":"mac"\`, composed for the wide canvas: other layouts, other screens or another order as the Mac app needs.
- A name that has no Mac screenshot is drawn as the device it has one of. That is how a Mac slide says "also on iPhone": \`duo\` or \`side-by-side\` with \`screenshot\` the Mac one and \`screenshot2\` one that exists for the iPhone only.

## Web apps and other toolkits
An app is captured where it runs, whatever it is built with. \`appshots check\`, run in the app's folder, says what the project is made with and gives the commands that start it.
- An iPhone or iPad app made with Flutter, React Native, Expo, Capacitor or Tauri runs in the simulator like any other. \`appshots run\` builds Xcode projects only, so \`appshots boot\` boots the simulator the store sizes ask for and prints the toolkit's own run command for it, such as \`flutter run -d <udid>\`. That command keeps running, so it goes into the background. Once the app is up, \`appshots capture --clean\` takes the screen.
- A web app is drawn page by page. \`appshots capture --web <address> --name <name> --project <project>\` draws the page with the Chrome, Edge or Brave on the user's computer, without a window, at the size of an iPhone (1320×2868), and uploads it as an iPhone screenshot. \`--as ipad\`, \`--as mac\` and \`--as duo\` draw it at those sizes. \`--dark\` and \`--lang\` set the colour scheme and the language the page is asked for, \`--init <script>\` runs JavaScript before the page's own on every load (sample data in \`localStorage\`), \`--eval <script>\` runs it in the loaded page (the click that opens the screen), and \`--profile <folder>\` keeps a sign-in between captures.
- A page drawn for an iPhone or iPad is laid out as an installed web app is, between the status bar and the home indicator. The home indicator is in the picture. The status bar is not: its place at the top is left free in the page's own colour, and \`"statusBar":"overlay"\` in the theme's \`device\` draws one there. A page that asks for the whole screen with \`viewport-fit=cover\` runs under the status bar and is given the safe area to keep to.
- A page drawn for a Mac (2880×1800) fills its rectangle, so it is shown inside a MacBook, and \`"frame":"none"\` shows it bare. It gets a wide slide set like any Mac app: see Mac apps.

## Layouts
${list(LAYOUTS)}
\`duo\` and \`side-by-side\` take \`screenshot\` and \`screenshot2\`; \`trio\` takes \`screenshot3\` as well. A name with nothing uploaded under it is drawn as a labelled placeholder. Slides with several devices suit two steps of one flow, light next to dark, or an overview; keep the headline to one line there.
\`device-right\` and \`device-left\` are the layouts for a slide that says more: the copy stands in a column beside the device, always left-aligned, with room for a headline, a subheadline and three or four feature points (see below).

## Slides without a screenshot
Five layouts show no device: \`features\`, \`statement\`, \`stat\`, \`steps\` and \`reviews\`. They are for the slide where a claim, a number, a short how-to or other people's words sell better than one more screen, and for an app whose screens say little on their own. One or two per set is plenty; the rest should show the app. All of them take \`eyebrow\`, \`headline\`, \`subheadline\` and badges like any slide, lay themselves out for a phone, a tablet and a Mac canvas, and fit their type to the room there is.
- \`statement\`: the headline alone, set very large. One sentence of up to about six words, with the words that matter in *asterisks*. It suits the first slide of an app that is about an idea, and a slide in the middle that changes the subject. \`emphasis\` (see Copy) makes it more than plain text. Example: \`{"layout":"statement","headline":"Stop *scrolling.* Start living.","subheadline":"One tap blocks every app that eats your day.","emphasis":"marker"}\`
- \`stat\`: one giant figure. The first entry of \`features\` is it: \`value\` is the figure (\`"2M+"\`, \`"4.9"\`, \`"93%"\`; up to five characters come out largest), \`title\` says what it counts, and \`text\` is one line of small print such as where the number is from. Up to four more entries become a row of smaller figures under it. Example: \`{"layout":"stat","headline":"Join the *club*","features":[{"value":"2M+","title":"people focus with us"},{"value":"4.9","title":"App Store rating"},{"value":"#1","title":"in Productivity"}]}\`
- \`steps\`: \`features\` as numbered steps joined by a line, two to five of them, each a \`title\` and optionally one line of \`text\`. The numbers are drawn for you; a step's \`value\` stands in its place (such as \`"✓"\` on the last). A step's \`screenshot\` names a raw screenshot shown small beside it. Steps run down a portrait canvas and across a Mac's. Example: \`{"layout":"steps","headline":"Set up in a *minute*","features":[{"title":"Pick your apps","text":"Choose what distracts you most."},{"title":"Set a schedule"},{"title":"Get your time back"}]}\`
- \`reviews\`: the slide's \`review\` badges as a wall of quote cards, up to ${REVIEWS_SHOWN}. \`title\` is the quote, \`subtitle\` who said it (a person, or a publication for a line from the press), \`stars\` the rating (left out, five). Badges of any other type stay with the copy. Three read best on an iPhone; keep each quote to a sentence. Example: \`{"layout":"reviews","headline":"People *can't stop* talking","badges":[{"type":"review","title":"I got two hours of my day back.","subtitle":"Maya, App Store review"},{"type":"review","title":"Simple, calm and it just works.","subtitle":"The Verge"}]}\`
- \`features\`: cards, see the next section.
Every figure, quote and name on these slides has to be real, as with badges: ask the user for them and never make one up.

## Feature slides
A slide with \`"layout":"features"\` lists what the app does as cards, the way a keynote sums up a release, and suits a "what's new" or "everything you get" slide.
\`features\` holds up to 8 entries, most important first. Each has a \`title\` of two to four words, an \`icon\` (see Icons) or a \`value\` (a big figure or word in its place, such as \`"0"\`, \`"24h"\` or \`"100%"\`), and optionally one short line of \`text\`. \`featureStyle\` picks the arrangement:
${list(FEATURE_STYLES)}
- \`bento\` and \`grid\` read best with 3 to 6 features and little or no \`text\`; \`cards\` with 2 to 5, each with a line of \`text\`; \`list\` with 4 to 8.
- The type shrinks until every card fits, so shorter titles come out larger. With \`"align":"left"\` the cards go left-aligned too.
- The headline sits above the cards and stays short. Badges work here as on any slide.
A feature can also carry:
- \`color\`: a hex colour of its own, for its icon, its figure and a wash over its card. Give each card its own for a colourful set, or only the one that matters most. Left out, the accent colour.
- \`image\`: the name of an uploaded image in place of the icon, such as the app's own artwork (see Logo and images).
- \`screenshot\`: the name of a raw screenshot shown small on the card. On a \`bento\` or \`grid\` card it stands under the title and runs off the lower edge; in a \`cards\` or \`list\` row it is a thumbnail where the icon would be. It turns a feature slide into an overview of the app's screens.
\`featureCards\` sets how all cards of the slide look. \`look\`, default glass:
${list(CARD_LOOKS)}
\`icons\`, default gradient:
${list(CARD_ICONS)}
\`columns\`, 1 to 4, sets how many \`grid\` cards, \`cards\` or \`list\` rows stand side by side; left out, what suits the canvas.
Example: \`{"layout":"features","headline":"Everything you *need*","featureStyle":"bento","featureCards":{"look":"tint","icons":"badge"},"features":[{"icon":"video-off","title":"No short videos","text":"Reels and Shorts are gone.","color":"#7C5CFF"},{"value":"100%","title":"On your device","color":"#34D399"},{"icon":"timer","title":"Daily limits","color":"#F59E0B"}]}\`

## Feature points
On a layout that shows a device, \`features\` is a short list with the copy, under the subheadline: what this screen does, in two to four points, each with an \`icon\` or a \`value\`, a \`title\` and optionally one line of \`text\`. The device gives up room for them, so use them where the slide is meant to explain; a slide that should hit hard keeps to its headline. \`featureStyle\` picks the look, default \`list\`:
${list(POINT_STYLES)}
- \`chips\` under a centred headline is the lightest; \`list\` and \`cards\` belong in the column of \`device-right\` or \`device-left\`, or under the headline of a slide whose device is made smaller.
- The points shrink together with the headline when the copy grows too tall.
Example: \`{"layout":"device-right","headline":"Everything that *keeps you* on track","screenshot":"home","features":[{"icon":"timer","title":"Daily limits","text":"Set a cap for every app"},{"icon":"bell","title":"Gentle nudges","text":"A reminder before time is up"},{"icon":"chart-bar","title":"Weekly report"}]}\`
Take them off again with \`update_slide\` and \`"remove":["features"]\`.

## Backgrounds
Presets: ${Object.entries(BACKGROUNDS)
    .map(([id, def]) => `\`${id}\` (${def.type})`)
    .join(", ")}.
Also \`"auto"\` (a mesh gradient derived from the slide's own screenshot), any hex colour, or a custom object such as \`{"type":"mesh","colors":["#0B1020","#1A2B52","#2A2A5E"],"noise":0.4}\`. In a mesh the first colour is the base and the others are soft blobs over it. Text colour flips between black and white automatically.
The presets are deliberately muted. Keep custom colours the same way unless the user asks for something loud: one hue family, moderate saturation, so the screenshot stays the most colourful thing on the slide.

## Fonts
${FONT_GROUPS.map(
  (group) =>
    `- ${group}: ${Object.entries(FONTS)
      .filter(([, font]) => font.group === group)
      .map(([id, font]) => `\`${id}\` (${font.note.toLowerCase()})`)
      .join(", ")}`,
)
  .join("\n")}

## Device
\`frame\`: auto, iphone, duo, ipad, mac or none (bare rounded screenshot). \`duo\` is the unfolded iPhone Duo, drawn as a plain thin frame. \`mac\` is a MacBook; see Mac apps for when a Mac screenshot gets one by itself. \`color\`: ${DEVICE_COLOR_IDS.join(", ")}. \`shadow\`: none, soft or strong.
Where the device stands and how large it is can be set per slide, in the slide's own \`device\`, on top of what the layout does:
- \`scale\`: 0.4 to 1.6, default 1. Smaller leaves the copy more room; larger turns the screen into a detail shot.
- \`offsetX\`, \`offsetY\`: a shift in percent of the canvas width and height, -60 to 60. Positive is right and down. \`"offsetY":8\` lets a device bleed further off the bottom; \`"offsetX":-12\` moves it left to make room on the right.
- \`rotate\`: a tilt in degrees, -45 to 45. \`perspective\`: \`left\` or \`right\` turns it in 3D.
Example: \`{"layout":"device-right","headline":"See the *whole week*","screenshot":"stats","device":{"scale":1.2,"offsetY":8,"rotate":-5}}\`
Move in small steps and render to look: the device is cut off at the canvas edge, and nothing stops it from covering the copy.
On the layouts with several devices (duo, side-by-side, trio):
- \`spread\`: the angle between the devices in degrees, 0 to 60. 0 stands them parallel; a larger angle fans them out. Default 11 for duo, 14 for trio, 0 for side-by-side.
- \`gap\`: pushes them apart (positive) or together (negative), in percent of the canvas width, -30 to 30.
- \`rotate\` turns the whole group. Example: \`"device":{"spread":24,"gap":4}\`
\`style\` is how the frame is drawn. Set it once in the theme so the whole set matches:
${list(DEVICE_STYLES)}
An outline or sketch frame casts no shadow unless \`shadow\` asks for one.
\`statusBar\` draws a clean status bar at the top of the screenshot, with the time, the signal, Wi-Fi and a full battery:
${list(STATUS_BARS)}
\`statusBarTime\` is the time it shows (default \`9:41\`), and \`statusBarColor\` is \`auto\` (read off the screenshot), \`light\` (white) or \`dark\` (black). Use \`cover\` when the raw screenshots come from a real device and show an odd time or a low battery. Screenshots taken with \`appshots capture --clean\` are clean already. Use \`overlay\` for a web app's pages taken with \`appshots capture --web\`, which leave the status bar's place free.

## Badges
${list(BADGE_TYPES)}
\`tone\` sets the colour of the wreath, stars and icon:
${list(BADGE_TONES)}
A slide draws up to ${BADGES_SHOWN} with its copy; they shrink to stay on one row. On a slide without a device or cards they are drawn larger. Examples:
- \`{"type":"rating","title":"4.9","subtitle":"12K ratings","tone":"gold"}\`
- \`{"type":"laurel","icon":"trophy","title":"App of the Day","subtitle":"App Store","tone":"gold"}\`
- \`{"type":"laurel","title":"10K+","subtitle":"Downloads"}\`
- \`{"type":"review","stars":5,"title":"I got two hours of my day back.","subtitle":"Maya, App Store review"}\`
- \`{"type":"icon","icon":"shield","title":"Private","subtitle":"No account needed"}\`
A \`rating\` fills its stars from the score. A \`review\` is a card of its own: one per slide reads best, two at most, and the quote stays under about eight words.
Only use figures, awards and reviews the app really has, and quote a review as it was written: App Review rejects screenshots with invented ratings, download counts, accolades or testimonials. Ask the user for them; never make them up.

## Icon and logo rows
\`iconRow\` puts up to 8 icons or brand logos in one row with the copy: the services the app works with, the apps it blocks, the places it shares to. \`icons\` lists them in order (see Icons; the Brands group holds the logos). Optional fields: \`label\`, a short line over the row such as "Works with"; \`position\`, \`bottom\` (below the subheadline, the default) or \`top\` (above the headline); \`size\`, ${ICON_ROW_SIZE_IDS.join(", ")} (default medium). \`style\`, default tiles:
${list(ICON_ROW_STYLES)}
\`tone\`, default brand:
${list(ICON_ROW_TONES)}
The row stays on one line, so with many icons they come out smaller; three to five read best. On a slide with nothing but copy, a \`large\` row is the picture. A black logo on a dark background, or a white one on a light background, is drawn in the text colour in the \`plain\` style so it stays visible.
Example: \`{"layout":"device-bottom","headline":"Social apps without *short videos*","screenshot":"home","iconRow":{"icons":["instagram","youtube","tiktok"],"label":"Works with"}}\`
Take a row off again with \`update_slide\` and \`"remove":["iconRow"]\`.

## Logo and images
The user can upload pictures that are not screenshots: the app's logo or icon, and other artwork such as stickers, characters, hand-drawn arrows or shapes. \`get_project\` lists them under \`images\` by name. Upload more with \`appshots upload <project> <files> --image\` (PNG, SVG, JPEG or WebP; a PNG or SVG with a transparent background works best), or the user adds them in the Studio under "Logos and images". Never draw or generate artwork yourself and never take it from the web; use what the user gives you or what is in the app's project, such as its app icon.
\`logo\` puts one image at the top of the copy, above the eyebrow and headline: \`{"image":"logo","size":"medium","shape":"plain"}\`. \`size\`: ${LOGO_SIZE_IDS.join(", ")} (default medium). \`shape\`, default plain:
${list(LOGO_SHAPES)}
It suits the first slide and the header and search results assets, where it tells people whose app this is; on every slide it gets repetitive. A wordmark has to read on the background, so a white one needs a dark background.
\`images\` places up to 10 images freely on a slide. Each is \`{"image":"star","x":86,"y":12,"size":18}\`: \`x\` and \`y\` are where its centre is, in % of the canvas width from the left and of the canvas height from the top (default 50, 50), and \`size\` is its width in % of the canvas width (default 30). Values below 0 or above 100 let it run off the edge. Optional: \`rotate\` in degrees; \`layer\`, \`front\` (over the device and the copy, the default) or \`behind\` (on the background, under both); \`shadow\`, none, soft or strong, following the image's outline; \`flip\`, mirrored; \`opacity\`. Later images lie over earlier ones.
What works: a character peeking in from a bottom corner (\`"x":84,"y":92,"size":34\`), a sticker overlapping a corner of the device, two or three small shapes scattered around the headline at different angles, a large soft shape \`behind\` everything. Keep images off the headline and off the part of the screenshot the slide is about, and use few: one to three per slide. The same numbers land in different spots on the taller iPhone canvas and the wider iPad one, so look at both renders after placing anything.
Example: \`{"layout":"device-bottom","headline":"Habits that *stick*","screenshot":"home","logo":{"image":"app-icon","shape":"app-icon"},"images":[{"image":"mascot","x":84,"y":92,"size":34,"rotate":6,"shadow":"soft"}]}\`
Header and search results assets take a \`logo\`, which has to be the app's own, and no placed images. Take either off a slide again with \`update_slide\` and \`"remove":["logo"]\` or \`"remove":["images"]\`.

## Icons
For the \`icon\` of a badge or a feature, and the \`icons\` of an icon row. In a badge or a feature each is one colour: the accent colour, or gold on a gold badge.
${Object.entries(ICON_GROUPS)
  .map(([group, ids]) => `- ${group}: ${ids.join(", ")}`)
  .join("\n")}
The Brands group holds the logos of other companies, as simplified marks that an icon row can show in each company's own colours. They are trademarks, so use one only where the app really works with that service ("Works with Instagram", "Blocks Shorts on YouTube"), and never to suggest a partnership or an endorsement: App Review turns down screenshots that lean on another company's brand, and so can the company. Header and search results assets take no icon rows at all, because Apple allows no other company's logo there. A logo that is not in the list cannot be added; say so and leave it out, or name the service in the copy.

## Copy
- Headline: two to five words, one benefit per slide, verb first where it fits. It is set large so it still reads at the small size the store shows screenshots in search results; a longer one shrinks to fit, so shorten the words before reaching for \`textScale\`. Wrap a word in *asterisks* to mark it. \`emphasis\`, in the theme or on a slide, picks how: ${Object.entries(EMPHASIS)
    .map(([id, note]) => `\`${id}\` (${note.charAt(0).toLowerCase()}${note.slice(1).replace(/\.$/, "")})`)
    .join("; ")}. \`tint\` is the default. \`\\n\` forces a line break.
- Subheadline: one short sentence, or leave it out.
- Any text field also accepts \`{"en":"…","de":"…"}\`; list the locales on the project and every one is rendered. The first locale is the fallback, for text and for screenshots alike: a language without its own screenshot of a name shows the first language's (\`get_project\` lists what there is, and Uploading above says how to add one per language).
- Slide 1 does the selling: lead with the main benefit, or use the \`hero\` layout with real social proof. Vary layouts across the set so it does not read as one template repeated.

## Header and search results assets
App Store Connect has a "Header and Search Results" tab under Product Page Information. The images uploaded there show at the top of the product page and with the app in search results on iOS 27 and iPadOS 27 or later. They are optional and set per language; without them the store keeps showing screenshots there. Build them with \`set_creative_assets\` from the same screenshots and theme as the slides:
${placementsOf("store")
  .map((id) => [id, PLACEMENTS[id]] as const)
  .map(([id, p]) => `- \`${id}\`: ${p.label}, ${p.width}×${p.height} (${p.ratio}). ${p.note} Safe area ${p.safe.width}×${p.safe.height} at ${p.safe.x},${p.safe.y}.`)
  .join("\n")}
The store crops these images differently per device and orientation, and only the safe area is always shown. So the copy is always centred and kept inside it, and everything outside it has to work as decoration that may be cut off. A header and a search asset can be made separately, or one \`universal\` asset serves both (App Store Connect's "Use header asset in search results" switch needs the universal file).
Each asset takes \`layout\`, \`eyebrow\`, \`headline\`, \`subheadline\`, \`screenshots\` (a list of names, most important first), \`badges\` (up to 3), \`background\`, \`font\`, \`textColor\`, \`accentColor\`, \`textScale\` and \`device\` (\`frame\`, \`style\`, \`color\`, \`scale\`, \`shadow\`, \`statusBar\`). What an asset leaves out comes from the project theme. Layouts:
${Object.entries(CREATIVE_LAYOUTS)
  .map(([id, note]) => `- \`${id}\`: ${note}`)
  .join("\n")}
Without screenshots an asset is copy on the background; without copy it is the devices alone.
Apple reviews these assets and is stricter than with screenshots:
- One clear idea. The headline is a short phrase that adds to the picture and makes the app's purpose obvious at a glance; a subheadline is rarely needed. Text is optional.
- No prices, discounts, web addresses or copyright symbols, and no logos of or references to other platforms.
- No claims or awards that cannot be verified, and no Apple accolades at all (Editors' Choice, App of the Day, Game of the Day, Apple Design Award).
- Translate the text for every language the asset is uploaded for, or leave it out. The content has to suit a 4+ age rating.
\`render\` returns a preview of each asset with the safe area drawn as a dashed frame, which is not part of the PNG. Check that nothing important falls outside it.

## Banners
\`set_creative_assets\` also makes wide pictures for outside the store, from the same screenshots and theme. They are what the repository and the website of an app usually lack: the picture at the top of the README, and the one a link to the project shows.
${placementsOf("banner")
  .map((id) => [id, PLACEMENTS[id]] as const)
  .map(([id, p]) => `- \`${id}\`: ${p.label}, ${p.width}×${p.height} (${p.ratio}). ${p.note}`)
  .join("\n")}
A banner takes the fields of the assets above. It is shown whole, so it has no safe area, and Apple's rules for store assets do not apply to it; figures, awards and reviews still have to be real. Left to itself it uses the \`split\` layout: the copy in a column on the left, up to ${CREATIVE_CAPACITY.split} devices on the right. \`fan\`, \`sides\` and \`wall\` work as well, with the copy in the middle. Keep the copy short: a headline, perhaps a subheadline, and the app's \`logo\` when it has one uploaded.
Mac screenshots come out as MacBooks or windows and iPhone ones as iPhones, and one banner can mix them: name the Mac screenshot first and it stands in the middle, with a phone or a tablet in front of its lower corners.
A render writes them to \`<language>/banners/<name>.png\`, apart from the store's pictures, and \`appshots pull <project>\` puts them in \`./store-screenshots/<project>/<language>/banners/\`. Where each goes:
- \`readme\`: copy the file into the repository, such as \`docs/banner.png\`, and make \`![<App name>](docs/banner.png)\` the first line of the README. When you are working in the user's repository, do that for them.
- \`social\`: the user uploads it under the repository's Settings, General, Social preview. GitHub takes a file of up to 1 MB there, and the render warns when it is larger.
- \`link\`: the page's \`og:image\`, as in \`<meta property="og:image" content="https://example.com/link.png">\`, with \`og:image:width\` 1200 and \`og:image:height\` 630.
Example: \`{"project":"ledger","readme":{"headline":"Your money, *at a glance*","subheadline":"A calm budget app for the Mac.","screenshots":["overview","phone"]}}\`

## Mockups
For a website, a README, a press kit or a slide deck, \`render_mockups\` draws each raw screenshot inside its device with nothing behind it: one transparent PNG per screenshot, cut to the device. There is no slide, no copy and no background, so nothing has to be designed first, and it uses no render. These are not for App Store Connect, which takes no transparency.
- \`device\` sets how every mockup is drawn, with the fields of Device above that make sense for a device on its own: \`frame\`, \`style\`, \`color\`, \`shadow\`, \`rotate\`, \`perspective\`, \`statusBar\`, \`statusBarTime\`, \`statusBarColor\`. It is separate from the theme. A mockup casts no shadow unless \`shadow\` asks for one, so it sits on a page of any colour; a shadow is part of the PNG and is made for a light page.
- \`width\` is the width of each PNG in pixels. Left out, the screenshot is shown pixel for pixel, which is the sharpest and suits a page that scales the picture itself. A turned device makes a wider picture than an upright one.
- \`screenshots\` picks some by name; left out, every screenshot of the project is drawn, each device variant as its own file named \`<name>-<device>.png\`. A Mac screenshot comes out as a window or inside a MacBook, by the rule in Mac apps.
What is given is saved with the project, so ${base}/#/<project>/mockups shows the same, and the user can change it there. They download the PNGs from that page, from the links the tool returns, or with \`appshots mockups <project>\`, which puts them in \`./mockups/<project>/\`: the place to send them when the pictures are to go into a repository. A line drawing (\`outline\`, \`sketch\`) is drawn in near-black unless a \`color\` is set; on a dark page give it \`"color":"silver"\`.`;
}

function describe(project: Project, shots: Shot[], images: StoredImage[], base: string) {
  return {
    id: project.id,
    name: project.name,
    locales: project.locales,
    theme: project.theme,
    slides: project.slides.map((slide, i) => ({ slide: i + 1, ...slide })),
    // Devices that draw a set of their own. Any other device draws `slides`.
    deviceSlides: Object.fromEntries(Object.entries(project.deviceSlides).map(([device, set]) => [device, (set ?? []).map((slide, i) => ({ slide: i + 1, ...slide }))])),
    creativeAssets: project.creatives,
    mockups: project.mockups,
    screenshots: shots.map((shot) => ({
      name: shot.name,
      device: shot.device,
      ...(shot.locale ? { locale: shot.locale } : {}),
      size: `${shot.width}×${shot.height}`,
      // What a Mac screenshot is drawn as while no slide asks for the other.
      ...(shot.device === "mac" ? { shown: deviceShape(shot, {}, "mac").frame === "none" ? "window" : "MacBook" } : {}),
    })),
    images: images.map((image) => ({ name: image.name, size: `${image.width}×${image.height}` })),
    exportSizes: defaultTargets(shots, project.targets),
    studio: `${base}/#/${project.id}`,
  };
}

const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });
const json = (value: unknown): CallToolResult => text(JSON.stringify(value, null, 2));

/** Tool failures go back to the model as readable text so it can correct the call. */
async function guard(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

function unknownScreenshots(project: Project, shots: Shot[]): string[] {
  const known = new Set(shots.map((shot) => shot.name));
  const missing = new Set<string>();
  const named = [
    ...allSlides(project).flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3, ...(slide.features ?? []).map((feature) => feature.screenshot)]),
    ...Object.values(project.creatives).flatMap((creative) => creative?.screenshots ?? []),
  ];
  for (const name of named) if (name && !known.has(name)) missing.add(name);
  return [...missing];
}

function unknownImages(project: Project, images: StoredImage[]): string[] {
  const known = new Set(images.map((image) => image.name));
  const missing = new Set<string>();
  const named = [
    ...allSlides(project).flatMap((slide) => [slide.logo?.image, ...(slide.images ?? []).map((placed) => placed.image), ...(slide.features ?? []).map((feature) => feature.image)]),
    ...Object.values(project.creatives).map((creative) => creative?.logo?.image),
  ];
  for (const name of named) if (name && !known.has(name)) missing.add(name);
  return [...missing];
}

/** What a project names without having it: screenshots come out as placeholders, images are left out. */
async function missingNote(space: Space, project: Project, shots?: Shot[]): Promise<string> {
  const screenshots = unknownScreenshots(project, shots ?? (await listShots(space, project.id)));
  const images = unknownImages(project, await listImages(space, project.id));
  return [
    screenshots.length ? `\nNot uploaded yet, so these will render as placeholders: ${screenshots.join(", ")}.` : "",
    images.length ? `\nNo image is uploaded under these names, so they will be left out: ${images.join(", ")}.` : "",
  ].join("");
}

/**
 * A small JPEG of a rendered asset. A store asset has its safe area drawn in, so the model can check what a narrow
 * crop keeps; a banner is shown whole and has none.
 */
async function creativePreview(file: string, placement: PlacementId): Promise<string> {
  const { width, height, safe, kind } = PLACEMENTS[placement];
  const scale = 1400 / width;
  const [w, h] = [1400, Math.round(height * scale)];
  const frame = (colour: string, extra: string) =>
    `<rect x="${safe.x * scale}" y="${safe.y * scale}" width="${safe.width * scale}" height="${safe.height * scale}" fill="none" stroke="${colour}" stroke-width="3" ${extra}/>`;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${frame("#FFFFFF", 'stroke-opacity=".7"')}${frame("#FF2D78", 'stroke-dasharray="12 8"')}</svg>`;
  const data = await sharp(file)
    .resize(w, h)
    .composite(kind === "store" ? [{ input: Buffer.from(overlay) }] : [])
    .jpeg({ quality: 80 })
    .toBuffer();
  return data.toString("base64");
}

const project = slugSchema.describe("Project id");
const slideNumber = z.number().int().min(1).max(10).describe("Slide number, starting at 1");
const deviceKind = z.enum(DEVICE_KINDS);

/** `space` is the account the request was authenticated as; every tool works inside it. */
export function createMcpServer(base: string, space: Space): McpServer {
  const server = new McpServer(
    { name: "appshots", version: "0.1.0" },
    {
      instructions:
        "Generates App Store screenshots for iPhone, iPad and Mac apps and for web apps, whatever they are built with: raw app screenshots placed in device frames with headlines, backgrounds and social-proof badges, exported at exact store sizes. Also makes the product page header and search results assets of App Store Connect, wide banners for a README or a link preview, and transparent device mockups. Call get_design_guide first.",
    },
  );

  server.registerTool(
    "get_design_guide",
    {
      title: "Design guide",
      description:
        "How to use this server: the workflow, how screenshots get uploaded, what differs for a Mac app, every layout, background, font, device option and badge, the rules for header and search results assets, and banners and mockups for outside the store. Read this before building a set.",
      annotations: { readOnlyHint: true },
    },
    () => guard(async () => text(designGuide(base, space))),
  );

  server.registerTool(
    "list_projects",
    { title: "List projects", description: "Lists the screenshot projects of this account.", annotations: { readOnlyHint: true } },
    () =>
      guard(async () => {
        const projects = await listProjects(space);
        return json(projects.map((p) => ({ id: p.id, name: p.name, slides: p.slides.length, ownSets: Object.keys(p.deviceSlides), locales: p.locales, updatedAt: p.updatedAt })));
      }),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Creates a project (one per app) and returns its id plus how to upload raw screenshots into it.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("App or project name"),
        locales: z.array(localeSchema).min(1).max(40).optional().describe('Locales to render, default ["en"]'),
        theme: themeSchema.optional().describe("Styling shared by every slide"),
      },
    },
    (input) =>
      guard(async () => {
        const created = await createProject(space, input);
        return text(`Created project "${created.id}".\n\n${uploadHelp(base, created.id)}\n\nStudio: ${base}/#/${created.id}`);
      }),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Returns a project's theme, slides, header and search results assets, banners, the raw screenshots, and the logos and other images uploaded so far.",
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    (input) => guard(async () => json(describe(await getProject(space, input.project), await listShots(space, input.project), await listImages(space, input.project), base))),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update project",
      description: "Changes a project's name, locales, theme or export sizes. The theme is replaced as a whole.",
      inputSchema: {
        project,
        name: z.string().min(1).max(80).optional(),
        locales: z.array(localeSchema).min(1).max(40).optional(),
        theme: themeSchema.optional(),
        targets: targetsSchema.optional().describe("Sizes every render and the ZIP hold from now on. [] goes back to the standard sizes of the devices the project has screenshots of"),
      },
    },
    ({ project: id, ...patch }) => guard(async () => json(describe(await updateProject(space, id, patch), await listShots(space, id), await listImages(space, id), base))),
  );

  server.registerTool(
    "set_slides",
    {
      title: "Set slides",
      description:
        "Replaces a whole slide set, in store order, and optionally the theme. Without `device` it is the project's shared set, which every device draws that has none of its own. With `device` it is that device's own set, composed for its canvas; an empty list there takes the device's own set away again. Nothing is rendered until you call render.",
      inputSchema: {
        project,
        slides: z.array(slideSchema).max(10),
        device: deviceKind.optional().describe("The device this set is for: it then draws these slides in place of the shared ones. Left out, the shared set is replaced"),
        theme: themeSchema.optional().describe("Replaces the project theme when given"),
      },
    },
    ({ project: id, slides, device, theme }) =>
      guard(async () => {
        if (!device) {
          if (slides.length === 0) throw new Error("Give at least one slide.");
          const updated = await updateProject(space, id, { slides, theme });
          const own = DEVICE_KINDS.filter((kind) => updated.deviceSlides[kind]);
          const note = own.length ? ` ${own.map((kind) => DEVICE_LABELS[kind]).join(" and ")} ${own.length === 1 ? "has a set of its own and does" : "have sets of their own and do"} not show these.` : "";
          return text(`Saved ${slides.length} slide${slides.length === 1 ? "" : "s"}.${note} Call render to see them.${await missingNote(space, updated)}`);
        }
        const current = await getProject(space, id);
        const { [device]: _own, ...others } = current.deviceSlides;
        const updated = await updateProject(space, id, { deviceSlides: slides.length ? { ...others, [device]: slides } : others, theme });
        const label = DEVICE_LABELS[device];
        if (slides.length === 0) return text(`The ${label} has no slide set of its own any more and shows the shared one.`);
        return text(`Saved ${slides.length} slide${slides.length === 1 ? "" : "s"} for the ${label} alone. Call render to see them.${await missingNote(space, updated)}`);
      }),
  );

  server.registerTool(
    "update_slide",
    {
      title: "Update slide",
      description:
        "Changes one slide. Fields in `changes` are merged over the slide (nested `device` included); list field names in `remove` to clear them. `of` picks a device's own slide set; left out, the shared set is changed.",
      inputSchema: {
        project,
        slide: slideNumber,
        of: deviceKind.optional().describe("Change the slide in this device's own set (see A set for each device). Left out, the shared set"),
        changes: slideSchema.optional(),
        remove: z.array(z.string()).optional().describe("Slide fields to clear, e.g. [\"subheadline\", \"badges\"]"),
      },
    },
    ({ project: id, slide, of, changes, remove }) =>
      guard(async () => {
        const current = await getProject(space, id);
        const set = of ? current.deviceSlides[of] : current.slides;
        if (!set) throw new Error(`The ${DEVICE_LABELS[of!]} has no slide set of its own. Give it one with set_slides and "device", or leave "of" out to change the shared slide.`);
        const existing = set[slide - 1];
        if (!existing) throw new Error(`Slide ${slide} does not exist; ${of ? `the ${DEVICE_LABELS[of]} set` : "the project"} has ${set.length}.`);
        const next: Record<string, unknown> = { ...existing, ...changes };
        if (changes?.device) next.device = { ...existing.device, ...changes.device };
        for (const field of remove ?? []) delete next[field];
        const slides = set.map((s, i) => (i === slide - 1 ? slideSchema.parse(next) : s));
        await updateProject(space, id, of ? { deviceSlides: { ...current.deviceSlides, [of]: slides } } : { slides });
        const missing = unknownImages({ ...current, slides: [slides[slide - 1]!], deviceSlides: {}, creatives: {} }, await listImages(space, id));
        const result = json({ slide, ...(of ? { of } : {}), ...slides[slide - 1] });
        if (missing.length) result.content.push({ type: "text", text: `No image is uploaded under these names, so they will be left out: ${missing.join(", ")}.` });
        return result;
      }),
  );

  server.registerTool(
    "set_creative_assets",
    {
      title: "Set header, search results and banner images",
      description:
        "Designs the project's wide images. For the Header and Search Results tab of App Store Connect: the product page header, the search results asset, or one universal asset for both. For outside the store: a README banner, the social preview of a repository, the link preview of a web page, and a 16:9 picture for a post. Each one given replaces that one; the others stay. Nothing is rendered until you call render.",
      inputSchema: {
        project,
        header: creativeSchema.optional().describe("Product page header, 3840×1646"),
        search: creativeSchema.optional().describe("Search results asset, 3840×2560"),
        universal: creativeSchema.optional().describe("Universal asset, 5244×2950, cropped by App Store Connect for both places"),
        readme: creativeSchema.optional().describe("Banner for the top of a README or a web page, 2400×800"),
        social: creativeSchema.optional().describe("Social preview of a GitHub repository, 1280×640"),
        link: creativeSchema.optional().describe("Link preview of a web page (its og:image), 1200×630"),
        post: creativeSchema.optional().describe("Picture for a post, a deck or a video thumbnail, 1920×1080"),
        remove: z.array(z.enum(PLACEMENT_IDS)).optional().describe("Assets to delete from the project"),
      },
    },
    ({ project: id, remove, ...given }) =>
      guard(async () => {
        const current = await getProject(space, id);
        const creatives = { ...current.creatives };
        for (const placement of PLACEMENT_IDS) if (given[placement]) creatives[placement] = given[placement];
        for (const placement of remove ?? []) delete creatives[placement];
        const updated = await updateProject(space, id, { creatives });
        const shots = await listShots(space, id);
        const lines = PLACEMENT_IDS.filter((placement) => updated.creatives[placement]).map((placement) => {
          const creative = updated.creatives[placement]!;
          const layout = creativeLayout(creative, placement);
          const extra = (creative.screenshots?.length ?? 0) - CREATIVE_CAPACITY[layout];
          return `- ${placement}: ${PLACEMENTS[placement].label}, ${layout} layout${extra > 0 ? ` (it shows ${CREATIVE_CAPACITY[layout]} screenshots, so the last ${extra} will be left out)` : ""}`;
        });
        const note = await missingNote(space, updated, shots);
        return text(lines.length ? `The project now has these assets:\n${lines.join("\n")}\nCall render to see them.${note}` : "The project has no header, search results or banner images now.");
      }),
  );

  server.registerTool(
    "render",
    {
      title: "Render screenshots",
      description:
        "Renders the slides to PNGs at exact App Store sizes, and the header and search results assets and the banners if the project has any. Returns images to review plus download links. Pass `slides` or `creatives` to re-render only those while iterating.",
      inputSchema: {
        project,
        slides: z.array(slideNumber).optional().describe("Slide numbers to render; all when omitted"),
        creatives: z
          .array(z.enum(PLACEMENT_IDS))
          .optional()
          .describe("Header and search results assets and banners to render. Left out, all of them are rendered along with the slides; given alone, the slides are left as they are; [] skips them."),
        targets: z.array(z.enum(TARGET_IDS)).optional().describe("Sizes for this render only; defaults to the project's export sizes. While iterating, one size per device is enough, such as [\"iphone-6.9\"]"),
        locales: z.array(localeSchema).optional().describe("Defaults to every project locale"),
      },
    },
    ({ project: id, slides, creatives, targets, locales }) =>
      guard(async () => {
        const result = await renderProject(space, id, { targets, locales, creatives, slides: slides?.map((n) => n - 1) });
        const count = result.files.length + result.creatives.length;
        const lines = [`Rendered ${count} PNG${count === 1 ? "" : "s"}.`];
        const sets = new Map<string, typeof result.files>();
        for (const file of result.files) sets.set(`${file.target} ${file.locale}`, [...(sets.get(`${file.target} ${file.locale}`) ?? []), file]);
        for (const [first, ...rest] of [...sets.values()].map((set) => set.sort((a, b) => a.slide - b.slide))) {
          const size = TARGETS[first!.target];
          const source = sourceOf(first!.target);
          const copy = source === first!.target ? "" : `, the ${source} picture scaled`;
          lines.push("", `${first!.target} (${size.width}×${size.height}, for "${size.slot}"${copy}), ${first!.locale}:`);
          // A scaled size shows nothing its source does not, so its files are named by their folder.
          if (copy && sets.has(`${source} ${first!.locale}`)) lines.push(`  ${rest.length ? `${rest.length + 1} files` : "1 file"} under ${base}/files/${id}/out/${path.dirname(first!.path)}/`);
          else for (const file of [first!, ...rest]) lines.push(`  ${String(file.slide + 1).padStart(2, "0")}  ${base}/files/${id}/out/${file.path}`);
        }
        for (const kind of ["store", "banner"] as const) {
          const drawn = result.creatives.filter((file) => PLACEMENTS[file.placement].kind === kind);
          if (drawn.length === 0) continue;
          lines.push("", kind === "store" ? "Header and search results assets (the dashed frame in the previews marks the safe area and is not in the PNG):" : "Banners:");
          for (const file of drawn) lines.push(`  ${file.placement} (${file.width}×${file.height}), ${file.locale}  ${base}/files/${id}/out/${file.path}`);
        }
        lines.push("", `Studio: ${base}/#/${id}`, `ZIP of everything: ${base}/api/projects/${id}/export.zip (or \`appshots pull ${id}\`)`, `Into App Store Connect, from the user's Mac with their own API key: \`appshots store push ${id} --app <bundle id> --dry-run\``);
        const left = rendersLeft(space.id);
        if (left != null) lines.push("", left === 0 ? "That was this account's last render. The person who runs the server can give it more." : `Renders left on this account: ${left}.`);
        if (result.warnings.length) lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));

        const content: CallToolResult["content"] = [{ type: "text", text: lines.join("\n") }];
        // One sheet per shape is enough to judge the design; other locales differ only in copy.
        const shown = result.sheets.filter((sheet) => sheet.locale === result.sheets[0]!.locale).slice(0, 4);
        for (const sheet of shown) {
          const data = await readFile(path.join(outDir(space, id), sheet.path));
          content.push({ type: "image", data: data.toString("base64"), mimeType: "image/jpeg" });
        }
        for (const file of result.creatives.filter((creative) => creative.locale === result.creatives[0]!.locale)) {
          content.push({ type: "image", data: await creativePreview(path.join(outDir(space, id), file.path), file.placement), mimeType: "image/jpeg" });
        }
        return { content };
      }),
  );

  server.registerTool(
    "render_mockups",
    {
      title: "Render device mockups",
      description:
        "Draws the project's raw screenshots inside their devices with nothing behind them: one transparent PNG per screenshot, for a website, a README or a press kit. Needs no slides and uses no render. Not for App Store Connect, which takes no transparency. Returns a preview and download links.",
      inputSchema: {
        project,
        screenshots: z.array(slugSchema).optional().describe("Screenshot names to draw; every screenshot when omitted"),
        locale: localeSchema.optional().describe("The language whose screenshots are drawn. Defaults to the project's first"),
        device: mockupsSchema.shape.device.describe("How every mockup is drawn. Saved with the project and replaces what was set before; left out, the saved one is used"),
        width: mockupsSchema.shape.width.unwrap().nullable().optional().describe("Width of each PNG in pixels, saved with the project. null goes back to showing the screenshot pixel for pixel"),
      },
    },
    ({ project: id, screenshots, locale, device, width }) =>
      guard(async () => {
        let current = await getProject(space, id);
        if (device !== undefined || width !== undefined) {
          const mockups = { ...current.mockups, ...(device ? { device } : {}) };
          if (width === null) delete mockups.width;
          else if (width !== undefined) mockups.width = width;
          current = await updateProject(space, id, { mockups });
        }
        const shots = await listShots(space, id);
        if (shots.length === 0) throw new InputError(`This project has no screenshots yet, so there is nothing to make mockups of.\n\n${uploadHelp(base, id)}`);
        const language = locale ? (shotLocale(current, locale) ?? current.locales[0]!) : current.locales[0]!;
        const unknown = (screenshots ?? []).filter((name) => !shots.some((shot) => shot.name === name));
        if (unknown.length) throw new InputError(`No screenshot is uploaded under ${unknown.map((name) => `"${name}"`).join(", ")}. The project has: ${[...new Set(shots.map((shot) => shot.name))].join(", ")}.`);
        const wanted = mockupShots(current, shots, language).filter((shot) => !screenshots?.length || screenshots.includes(shot.name));

        const drawn: Mockup[] = [];
        const lines = [`Drew ${wanted.length} mockup${wanted.length === 1 ? "" : "s"}, each a PNG with nothing behind the device.`, ""];
        const pad = Math.max(...wanted.map((shot) => mockupName(shot).length));
        for (const shot of wanted) {
          const mockup = await renderMockup(space, current, shot);
          drawn.push(mockup);
          lines.push(`  ${mockupName(shot).padEnd(pad)}  ${mockup.width}×${mockup.height}  ${base}/api/projects/${id}/mockups/${encodeURIComponent(shot.file)}`);
        }
        const query = language === current.locales[0] ? "" : `?locale=${encodeURIComponent(language)}`;
        lines.push(
          "",
          `ZIP of them all: ${base}/api/projects/${id}/mockups.zip${query} (or \`appshots mockups ${id}${query ? ` --lang ${language}` : ""}\`, which unpacks it into ./mockups/${id}/)`,
          `Studio: ${base}/#/${id}/mockups`,
          "",
          "The preview below shows them on grey. The PNGs themselves are transparent around the device.",
        );
        // Eight are enough to judge the look; the rest differ only in the screenshot.
        const sheet = await mockupSheet(drawn.slice(0, 8));
        return { content: [{ type: "text", text: lines.join("\n") }, { type: "image", data: sheet.toString("base64"), mimeType: "image/jpeg" }] };
      }),
  );

  return server;
}
