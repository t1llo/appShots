import { CREATIVE_LAYOUTS } from "../../design.ts";
import { CREATIVE_CAPACITY } from "../../creative.ts";
import { PLACEMENTS, placementsOf } from "../../sizes.ts";
import type { Topic } from "./topic.ts";

/** The pictures besides the screenshots: header and search results assets, banners and mockups. */
export const WIDE_TOPICS: Topic[] = [
  {
    id: "store-assets",
    title: "Header and search results assets",
    body: () => `App Store Connect has a "Header and Search Results" tab under Product Page Information. The images uploaded there show at the top of the product page and with the app in search results on iOS 27 and iPadOS 27 or later. They are optional and set per language; without them the store keeps showing screenshots there. Build them with \`set_creative_assets\` from the same screenshots and theme as the slides:
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
\`render\` returns a preview of each asset with the safe area drawn as a dashed frame, which is not part of the PNG. Check that nothing important falls outside it; the render warns when text does.`,
  },
  {
    id: "banners",
    title: "Banners",
    body: () => `\`set_creative_assets\` also makes wide pictures for outside the store, from the same screenshots and theme. They are what the repository and the website of an app usually lack: the picture at the top of the README, and the one a link to the project shows.
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
Example: \`{"project":"ledger","readme":{"headline":"Your money, *at a glance*","subheadline":"A calm budget app for the Mac.","screenshots":["overview","phone"]}}\``,
  },
  {
    id: "mockups",
    title: "Mockups",
    body: (base) => `For a website, a README, a press kit or a slide deck, \`render_mockups\` draws each raw screenshot inside its device with nothing behind it: one transparent PNG per screenshot, cut to the device. There is no slide, no copy and no background, so nothing has to be designed first, and it uses no render. These are not for App Store Connect, which takes no transparency.
- \`device\` sets how every mockup is drawn, with the fields of Device above that make sense for a device on its own: \`frame\`, \`style\`, \`color\`, \`shadow\`, \`rotate\`, \`perspective\`, \`statusBar\`, \`statusBarTime\`, \`statusBarColor\`. It is separate from the theme. A mockup casts no shadow unless \`shadow\` asks for one, so it sits on a page of any colour; a shadow is part of the PNG and is made for a light page.
- \`width\` is the width of each PNG in pixels. Left out, the screenshot is shown pixel for pixel, which is the sharpest and suits a page that scales the picture itself. A turned device makes a wider picture than an upright one.
- \`screenshots\` picks some by name; left out, every screenshot of the project is drawn, each device variant as its own file named \`<name>-<device>.png\`. A Mac screenshot comes out as a window or inside a MacBook, by the rule in Mac apps.
What is given is saved with the project, so ${base}/#/<project>/mockups shows the same, and the user can change it there. They download the PNGs from that page, from the links the tool returns, or with \`appshots mockups <project>\`, which puts them in \`./mockups/<project>/\`: the place to send them when the pictures are to go into a repository. A line drawing (\`outline\`, \`sketch\`) is drawn in near-black unless a \`color\` is set; on a dark page give it \`"color":"silver"\`.`,
  },
];
