import { rendersLeft } from "../../accounts.ts";
import { type Target, TARGETS } from "../../sizes.ts";
import type { Space } from "../../storage/paths.ts";
import type { Topic } from "./topic.ts";

/** How raw screenshots and images get into project `id`: the CLI, or curl. */
export function uploadHelp(base: string, id: string): string {
  return [
    "This server cannot see the user's devices, so raw screenshots are captured on their Mac and uploaded:",
    `- With the bundled CLI: \`appshots upload ${id} <files or folders>\` sends screenshots that exist already. \`appshots capture --name home --project ${id} --clean\` grabs the booted simulator; add \`--device\` for a connected iPhone or iPad. \`appshots launch <bundle id> --capture home --to ${id} -- <launch arguments>\` starts an installed app on one screen and captures it in one go. A Mac app runs on the Mac itself: \`appshots capture --mac <app name> --name home --project ${id}\` takes its frontmost window (see Mac apps). A web app is drawn page by page: \`appshots capture --web <address> --name home --project ${id}\` (see Web apps and other toolkits). \`appshots check\` reports what there is to work with: the project, what it is made with and the commands that start it.`,
    `- With curl: \`curl -fsS -X PUT -H "Authorization: Bearer $APPSHOTS_TOKEN" -H "Content-Type: image/png" --data-binary @home.png "${base}/api/projects/${id}/shots/home"\` (the token is the one this MCP connection uses)`,
    "The last path segment is the screenshot name slides refer to. iPhone, iPhone Duo, iPad or Mac is told from the picture, and one name can hold a variant for each: a picture wider than it is tall is a Mac's unless it has the exact size of an iPhone or iPad screenshot turned on its side, and so is a captured window, which has see-through round corners. `get_project` lists what each one was filed under; when that is wrong, upload it again with `--as iphone`, `--as duo`, `--as ipad` or `--as mac` (`?device=` with curl).",
    "A project in several languages can hold each screenshot once per language, under the same name. Upload the first language's as above: every other language shows those until it has its own. Then start the app in the next language and upload under the same names with `--lang de-DE` (`?locale=de-DE` with curl); `appshots launch <bundle id> --lang de-DE --capture home --to " + id + "` does both in one go. The language has to be one of the project's `locales`, and slides keep naming the screenshot as before: the render picks the variant of the language it draws.",
    `A logo or other artwork for the slides (see Logo and images) goes up the same way: \`appshots upload ${id} logo.png --image\`, or with curl to \`${base}/api/projects/${id}/images/<name>\`. PNG, SVG, JPEG and WebP are taken, and transparency is kept.`,
  ].join("\n");
}

/** On an account whose renders are counted, how to spend them. Nothing where they are not. */
export function renderBudget(space: Space): string {
  const left = rendersLeft(space.id);
  if (left == null) return "";
  return `\nRenders are counted on this account: every call to \`render\` uses one, whatever it draws, and ${left === 0 ? "none are left" : `${left} ${left === 1 ? "is" : "are"} left`}. So write the whole set before the first render, render everything in one call, fix all you see in one go and render once more. Do not render slide by slide. When none are left, say so: the person who runs the server can give the account more.`;
}

/** Where to begin: the steps of a set, how screenshots get here, the sizes and a set for each device. */
export const START_TOPICS: Topic[] = [
  {
    id: "workflow",
    title: "Workflow",
    body: (base, space) => `1. \`create_project\`, or \`list_projects\` / \`get_project\` to continue an existing one.
2. Get raw screenshots into the project (see Uploading below), then check them with \`get_project\`.
3. \`set_slides\` with the copy and design for the whole set. Put shared styling in \`theme\`; slides override it. Then give every other device the project has screenshots of a set composed for its own canvas (see A set for each device).
4. \`render\`. It returns one contact sheet image per device: look at each, fix what is off with \`update_slide\`, render again. Its warnings name what a picture of one language does not show: copy that had to shrink or runs long in another language, and words or logos App Review turns away, such as a price, "free", "#1" or another platform's logo. Fix those too. \`previews: false\` answers in words alone, for a render of many languages; \`preview: "store"\` shows the first three slides as a search result and the product page show them. Every change is kept as a revision: when one made things worse, or wiped out the user's own tuning, \`list_revisions\` shows the versions and \`restore_project\` brings one back.
5. Optionally \`set_creative_assets\` for the product page header and the search results asset, or for a banner outside the store such as the picture at the top of a README (see Banners), and \`render\` again.
6. The user downloads the PNGs from ${base}/#/<project> or with \`appshots pull <project>\`. \`appshots store push <project> --app <bundle id>\` puts them into App Store Connect instead, from the user's Mac with an API key of their own: that key never comes here, so no tool takes one, and nothing is submitted for review.${renderBudget(space)}
When what is wanted is not store screenshots but the devices alone, for a website or a README, see Mockups at the end: that needs only steps 1 and 2. For a macOS app, read Mac apps before step 2; for a web app, or an app made with Flutter, React Native, Expo, Capacitor, Tauri or Electron, read Web apps and other toolkits.`,
  },
  {
    id: "uploading",
    title: "Uploading",
    body: (base) => `${uploadHelp(base, "<project>")}`,
  },
  {
    id: "sizes",
    title: "Output sizes",
    body: () => `A set is designed once per device: iPhone, iPhone Duo, iPad and Mac. Each device shows its own variant of a screenshot name, and can have slides of its own (see A set for each device). App Store Connect has one screenshot slot per display, and each takes its own pixel size, so a render writes one folder per size:
${Object.entries(TARGETS as Record<string, Target>)
  .map(([id, target]) => `- \`${id}\`: ${target.width}×${target.height}, for "${target.slot}"${target.standard ? ", standard" : ""}${target.from ? `, the ${target.from} picture scaled` : ""}`)
  .join("\n")}
Left to itself, \`render\` writes the standard sizes of every device the project has screenshots of (iPhone while it has none). The others are for older displays, for the Duo's cover display and the smaller sizes the Mac App Store takes as well: add them with \`update_project\` \`targets\` only when the user asks. Sizes marked as scaled are the same picture as the size they name, so judge the design on one contact sheet per device. iPhone and iPad sets are portrait, a Mac set is landscape. Up to 10 slides per set.`,
  },
  {
    id: "device-sets",
    title: "A set for each device",
    body: () => `The project's \`slides\` are the shared set. Every device draws them on its own canvas, with its own variant of each screenshot name. That is where a project starts, not where it should end: an iPhone's canvas is tall and narrow, an iPad's is close to square and a Mac's is wide, and a slide composed for one rarely sits best on another. So when a project has screenshots of more than one device, design each device on its own:
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
A render draws every device from its own set and returns a contact sheet for each. The \`slides\` of \`render\` count within each device's set.`,
  },
];
