import { BACKGROUNDS, BADGE_TONES, BADGE_TYPES, BADGES_SHOWN, DEVICE_COLOR_IDS, DEVICE_STYLES, EMPHASIS, FONT_GROUPS, FONTS, ICON_GROUPS, ICON_ROW_SIZE_IDS, ICON_ROW_STYLES, ICON_ROW_TONES, LOGO_SHAPES, LOGO_SIZE_IDS, STATUS_BARS } from "../../design.ts";
import { list, type Topic } from "./topic.ts";

/** How a slide looks: backgrounds, fonts, the device, badges, icons, images and the copy. */
export const LOOK_TOPICS: Topic[] = [
  {
    id: "backgrounds",
    title: "Backgrounds",
    body: () => `Presets: ${Object.entries(BACKGROUNDS)
    .map(([id, def]) => `\`${id}\` (${def.type})`)
    .join(", ")}.
Also \`"auto"\` (a mesh gradient derived from the slide's own screenshot), any hex colour, or a custom object such as \`{"type":"mesh","colors":["#0B1020","#1A2B52","#2A2A5E"],"noise":0.4}\`. In a mesh the first colour is the base and the others are soft blobs over it. Text colour flips between black and white automatically.
The presets are deliberately muted. Keep custom colours the same way unless the user asks for something loud: one hue family, moderate saturation, so the screenshot stays the most colourful thing on the slide.`,
  },
  {
    id: "fonts",
    title: "Fonts",
    body: () => `${FONT_GROUPS.map(
  (group) =>
    `- ${group}: ${Object.entries(FONTS)
      .filter(([, font]) => font.group === group)
      .map(([id, font]) => `\`${id}\` (${font.note.toLowerCase()})`)
      .join(", ")}`,
)
  .join("\n")}`,
  },
  {
    id: "device",
    title: "Device",
    body: () => `\`frame\`: auto, iphone, duo, ipad, mac or none (bare rounded screenshot). \`duo\` is the unfolded iPhone Duo, drawn as a plain thin frame. \`mac\` is a MacBook; see Mac apps for when a Mac screenshot gets one by itself. \`color\`: ${DEVICE_COLOR_IDS.join(", ")}. \`shadow\`: none, soft or strong.
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
\`statusBarTime\` is the time it shows (default \`9:41\`), and \`statusBarColor\` is \`auto\` (read off the screenshot), \`light\` (white) or \`dark\` (black). Use \`cover\` when the raw screenshots come from a real device and show an odd time or a low battery. Screenshots taken with \`appshots capture --clean\` are clean already. Use \`overlay\` for a web app's pages taken with \`appshots capture --web\`, which leave the status bar's place free.`,
  },
  {
    id: "badges",
    title: "Badges",
    body: () => `${list(BADGE_TYPES)}
\`tone\` sets the colour of the wreath, stars and icon:
${list(BADGE_TONES)}
A slide draws up to ${BADGES_SHOWN} with its copy; they shrink to stay on one row. On a slide without a device or cards they are drawn larger. Examples:
- \`{"type":"rating","title":"4.9","subtitle":"12K ratings","tone":"gold"}\`
- \`{"type":"laurel","icon":"trophy","title":"App of the Day","subtitle":"App Store","tone":"gold"}\`
- \`{"type":"laurel","title":"10K+","subtitle":"Downloads"}\`
- \`{"type":"review","stars":5,"title":"I got two hours of my day back.","subtitle":"Maya, App Store review"}\`
- \`{"type":"icon","icon":"shield","title":"Private","subtitle":"No account needed"}\`
A \`rating\` fills its stars from the score. A \`review\` is a card of its own: one per slide reads best, two at most, and the quote stays under about eight words.
Only use figures, awards and reviews the app really has, and quote a review as it was written: App Review rejects screenshots with invented ratings, download counts, accolades or testimonials. Ask the user for them; never make them up.`,
  },
  {
    id: "icon-rows",
    title: "Icon and logo rows",
    body: () => `\`iconRow\` puts up to 8 icons or brand logos in one row with the copy: the services the app works with, the apps it blocks, the places it shares to. \`icons\` lists them in order (see Icons; the Brands group holds the logos). Optional fields: \`label\`, a short line over the row such as "Works with"; \`position\`, \`bottom\` (below the subheadline, the default) or \`top\` (above the headline); \`size\`, ${ICON_ROW_SIZE_IDS.join(", ")} (default medium). \`style\`, default tiles:
${list(ICON_ROW_STYLES)}
\`tone\`, default brand:
${list(ICON_ROW_TONES)}
The row stays on one line, so with many icons they come out smaller; three to five read best. On a slide with nothing but copy, a \`large\` row is the picture. A black logo on a dark background, or a white one on a light background, is drawn in the text colour in the \`plain\` style so it stays visible.
Example: \`{"layout":"device-bottom","headline":"Social apps without *short videos*","screenshot":"home","iconRow":{"icons":["instagram","youtube","tiktok"],"label":"Works with"}}\`
Take a row off again with \`update_slide\` and \`"remove":["iconRow"]\`.`,
  },
  {
    id: "images",
    title: "Logo and images",
    body: () => `The user can upload pictures that are not screenshots: the app's logo or icon, and other artwork such as stickers, characters, hand-drawn arrows or shapes. \`get_project\` lists them under \`images\` by name. Upload more with \`appshots upload <project> <files> --image\` (PNG, SVG, JPEG or WebP; a PNG or SVG with a transparent background works best), or the user adds them in the Studio under "Logos and images". Never draw or generate artwork yourself and never take it from the web; use what the user gives you or what is in the app's project, such as its app icon.
\`logo\` puts one image at the top of the copy, above the eyebrow and headline: \`{"image":"logo","size":"medium","shape":"plain"}\`. \`size\`: ${LOGO_SIZE_IDS.join(", ")} (default medium). \`shape\`, default plain:
${list(LOGO_SHAPES)}
It suits the first slide and the header and search results assets, where it tells people whose app this is; on every slide it gets repetitive. A wordmark has to read on the background, so a white one needs a dark background.
\`images\` places up to 10 images freely on a slide. Each is \`{"image":"star","x":86,"y":12,"size":18}\`: \`x\` and \`y\` are where its centre is, in % of the canvas width from the left and of the canvas height from the top (default 50, 50), and \`size\` is its width in % of the canvas width (default 30). Values below 0 or above 100 let it run off the edge. Optional: \`rotate\` in degrees; \`layer\`, \`front\` (over the device and the copy, the default) or \`behind\` (on the background, under both); \`shadow\`, none, soft or strong, following the image's outline; \`flip\`, mirrored; \`opacity\`. Later images lie over earlier ones.
What works: a character peeking in from a bottom corner (\`"x":84,"y":92,"size":34\`), a sticker overlapping a corner of the device, two or three small shapes scattered around the headline at different angles, a large soft shape \`behind\` everything. Keep images off the headline and off the part of the screenshot the slide is about, and use few: one to three per slide. The same numbers land in different spots on the taller iPhone canvas and the wider iPad one, so look at both renders after placing anything.
Example: \`{"layout":"device-bottom","headline":"Habits that *stick*","screenshot":"home","logo":{"image":"app-icon","shape":"app-icon"},"images":[{"image":"mascot","x":84,"y":92,"size":34,"rotate":6,"shadow":"soft"}]}\`
Header and search results assets take a \`logo\`, which has to be the app's own, and no placed images. Take either off a slide again with \`update_slide\` and \`"remove":["logo"]\` or \`"remove":["images"]\`.`,
  },
  {
    id: "icons",
    title: "Icons",
    body: () => `For the \`icon\` of a badge or a feature, and the \`icons\` of an icon row. In a badge or a feature each is one colour: the accent colour, or gold on a gold badge.
${Object.entries(ICON_GROUPS)
  .map(([group, ids]) => `- ${group}: ${ids.join(", ")}`)
  .join("\n")}
The Brands group holds the logos of other companies, as simplified marks that an icon row can show in each company's own colours. They are trademarks, so use one only where the app really works with that service ("Works with Instagram", "Blocks Shorts on YouTube"), and never to suggest a partnership or an endorsement: App Review turns down screenshots that lean on another company's brand, and so can the company. Header and search results assets take no icon rows at all, because Apple allows no other company's logo there. A logo that is not in the list cannot be added; say so and leave it out, or name the service in the copy.`,
  },
  {
    id: "copy",
    title: "Copy",
    body: () => `- Headline: two to five words, one benefit per slide, verb first where it fits. It is set large so it still reads at the small size the store shows screenshots in search results; a longer one shrinks to fit, so shorten the words before reaching for \`textScale\`. Wrap a word in *asterisks* to mark it. \`emphasis\`, in the theme or on a slide, picks how: ${Object.entries(EMPHASIS)
    .map(([id, note]) => `\`${id}\` (${note.charAt(0).toLowerCase()}${note.slice(1).replace(/\.$/, "")})`)
    .join("; ")}. \`tint\` is the default. \`\\n\` forces a line break.
- Subheadline: one short sentence, or leave it out.
- Any text field also accepts \`{"en":"…","de":"…"}\`; list the locales on the project and every one is rendered. The first locale is the fallback, for text and for screenshots alike: a language without its own screenshot of a name shows the first language's (\`get_project\` lists what there is, and Uploading above says how to add one per language).
- Slide 1 does the selling: lead with the main benefit, or use the \`hero\` layout with real social proof. Vary layouts across the set so it does not read as one template repeated.`,
  },
];
