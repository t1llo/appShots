import { BACKGROUNDS, LAYOUTS } from "../../design.ts";
import { renderBudget } from "./start.ts";
import { list, type Topic } from "./topic.ts";

/** When to read each of the other topics. A test holds this to every topic the guide has. */
export const READ_NEXT: Record<string, string> = {
  fields: "every field of a slide, the theme, a badge, a feature, the device and the rest, with the values each takes",
  workflow: "the steps in full, revisions, and what to do after the render",
  uploading: "every way to get screenshots and images here, curl among them, and one screenshot per language",
  sizes: "the pixel sizes a render writes and how to add more",
  "device-sets": "an app with screenshots of more than one device: a set composed for each canvas",
  mac: "a macOS app",
  web: "a web app, or one made with Flutter, React Native, Expo, Capacitor, Tauri or Electron",
  layouts: "what each layout does",
  "no-screenshot": "the statement, stat, steps and reviews slides",
  "feature-slides": "the features layout: cards, their styles and looks",
  "feature-points": "a short list of points beside or under the device",
  backgrounds: "the presets, auto, and gradients of your own",
  fonts: "every font, by kind",
  device: "frame, style, colour, size, position, tilt and the status bar of the device",
  badges: "ratings, awards and reviews",
  "icon-rows": "a row of icons or brand logos",
  images: "the app's logo and other uploaded artwork on a slide",
  icons: "every icon id",
  copy: "headlines, emphasis and several languages",
  "store-assets": "the product page header and search results images of App Store Connect, and Apple's rules for them",
  banners: "a picture for the top of a README, a repository's social preview or a link preview",
  mockups: "devices alone on a transparent background, for a website or a README",
};

/**
 * The guide for a model with a small context: what one set needs, in a few thousand tokens, and which topic to read
 * for everything else. It is not a section of the whole guide, which stays as it was.
 */
export const CORE_TOPIC: Topic = {
  id: "core",
  title: "Start here",
  body: (base, space) => `appShots turns raw app screenshots into App Store screenshots: each screenshot in a device frame, with a headline, a background and badges, at the sizes App Store Connect takes. It works for iPhone, iPad, Mac and web apps. This is the short guide: enough for one set, with the topic to read for the rest at the end. \`get_design_guide\` without a topic returns the whole guide, which is long.

### The steps
1. \`create_project\` with the app's name, or \`list_projects\` to continue one. Keep the \`id\` it answers with.
2. Screenshots come from the user's Mac. This server cannot take them itself. With the user's CLI: \`appshots upload <project> <files or folders>\` sends screenshots that exist; \`appshots capture --name home --project <project> --clean\` takes the booted simulator. A Mac app: topic mac. A web app: topic web. Anything else: topic uploading.
3. \`get_project\` lists the screenshot names. A slide shows one by naming it in \`screenshot\`.
4. \`set_slides\` with the whole set in one call: up to 10 slides, and what they share in \`theme\`.
5. \`check_project\` says what a render would refuse or warn about, such as a screenshot name nothing is uploaded under. It uses no render, so call it before every render and fix what it names.
6. \`render\` draws the set and returns a contact sheet per device. Look at it, change what is off with \`update_slide\` (slides count from 1), and render once more.
7. The user downloads the PNGs from ${base}/#/<project>, or runs \`appshots pull <project>\`. \`appshots store push\` puts them into App Store Connect from the user's Mac (topic workflow).${renderBudget(space)}

### A set
\`\`\`json
{"project":"focus","theme":{"background":"midnight","font":"inter","accentColor":"#7C5CFF"},"slides":[
 {"layout":"hero","headline":"Take back *your time*","screenshot":"home","badges":[{"type":"rating","title":"4.8","subtitle":"App Store rating"}]},
 {"headline":"Block what *distracts*","subheadline":"One tap, every app.","screenshot":"block"},
 {"layout":"device-right","headline":"See your *week*","screenshot":"stats","features":[{"icon":"timer","title":"Daily limits"},{"icon":"chart-bar","title":"Weekly report"}]},
 {"layout":"statement","headline":"Less scrolling. *More living.*"}]}
\`\`\`
- \`headline\`: two to five words, one benefit per slide. *Asterisks* mark words for the accent colour, \`\\n\` breaks the line. \`subheadline\`: one short sentence, or none. \`eyebrow\`: a small line above.
- Any text can be \`{"en-US": "…", "de-DE": "…"}\` when the project has several \`locales\`.
- \`background\`: ${Object.keys(BACKGROUNDS).join(", ")}, \`"auto"\` (from the screenshot) or a hex colour.
- \`font\`: such as \`inter\`, \`manrope\`, \`fraunces\` (topic fonts).
- \`device\`: \`{"scale": 0.9, "offsetY": 6, "rotate": -5}\` moves the device of one slide; \`{"style": "clay"}\` in the theme changes them all (topic device).
- \`badges\`, \`features\`, \`iconRow\`, \`logo\`, \`images\`: topic fields lists what each takes.

### Layouts
${list(LAYOUTS)}
\`duo\` and \`side-by-side\` show \`screenshot\` and \`screenshot2\`, \`trio\` \`screenshot3\` as well. Vary the layouts across a set, show the app on most slides, and let slide 1 do the selling.

### After the render
- A headline that wraps into three lines or shrinks: use fewer words.
- The device covers the copy: \`update_slide\` with \`"changes":{"device":{"scale":0.85}}\`, or a layout with the device beside the copy.
- Text that does not stand out from the background: another \`background\`, or \`textColor\`.
- A field that should go: \`update_slide\` with \`"remove":["badges"]\`.
- A labelled placeholder where a screen should be: nothing is uploaded under that name. Check the names with \`get_project\`.
- A change that made things worse: \`list_revisions\` and \`restore_project\` bring an earlier version back.

### Rules
- Ratings, download counts, awards and reviews must be the app's real ones. Ask the user; never make one up. App Review rejects invented ones.
- Use only artwork the user uploaded or the app's own, such as its icon. Never draw, generate or download any.
- An app with screenshots of iPhone and iPad, or of a Mac, gets a set for each device: \`set_slides\` with \`"device":"ipad"\` (topic device-sets).
- When a call is refused, its answer names the field and what it takes. Fix that field and call again.

### Read next
${list(READ_NEXT)}
Call \`get_design_guide\` with one of these as \`topic\`.`,
};
