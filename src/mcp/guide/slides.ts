import { CARD_ICONS, CARD_LOOKS, FEATURE_STYLES, POINT_STYLES, LAYOUTS, REVIEWS_SHOWN } from "../../design.ts";
import { list, type Topic } from "./topic.ts";

/** The layouts, and the slides that show no screenshot. */
export const SLIDES_TOPICS: Topic[] = [
  {
    id: "layouts",
    title: "Layouts",
    body: () => `${list(LAYOUTS)}
\`duo\` and \`side-by-side\` take \`screenshot\` and \`screenshot2\`; \`trio\` takes \`screenshot3\` as well. A name with nothing uploaded under it is drawn as a labelled placeholder. Slides with several devices suit two steps of one flow, light next to dark, or an overview; keep the headline to one line there.
\`device-right\` and \`device-left\` are the layouts for a slide that says more: the copy stands in a column beside the device, always left-aligned, with room for a headline, a subheadline and three or four feature points (see below).`,
  },
  {
    id: "no-screenshot",
    title: "Slides without a screenshot",
    body: () => `Five layouts show no device: \`features\`, \`statement\`, \`stat\`, \`steps\` and \`reviews\`. They are for the slide where a claim, a number, a short how-to or other people's words sell better than one more screen, and for an app whose screens say little on their own. One or two per set is plenty; the rest should show the app. All of them take \`eyebrow\`, \`headline\`, \`subheadline\` and badges like any slide, lay themselves out for a phone, a tablet and a Mac canvas, and fit their type to the room there is.
- \`statement\`: the headline alone, set very large. One sentence of up to about six words, with the words that matter in *asterisks*. It suits the first slide of an app that is about an idea, and a slide in the middle that changes the subject. \`emphasis\` (see Copy) makes it more than plain text. Example: \`{"layout":"statement","headline":"Stop *scrolling.* Start living.","subheadline":"One tap blocks every app that eats your day.","emphasis":"marker"}\`
- \`stat\`: one giant figure. The first entry of \`features\` is it: \`value\` is the figure (\`"2M+"\`, \`"4.9"\`, \`"93%"\`; up to five characters come out largest), \`title\` says what it counts, and \`text\` is one line of small print such as where the number is from. Up to four more entries become a row of smaller figures under it. Example: \`{"layout":"stat","headline":"Join the *club*","features":[{"value":"2M+","title":"people focus with us"},{"value":"4.9","title":"App Store rating"},{"value":"#1","title":"in Productivity"}]}\`
- \`steps\`: \`features\` as numbered steps joined by a line, two to five of them, each a \`title\` and optionally one line of \`text\`. The numbers are drawn for you; a step's \`value\` stands in its place (such as \`"✓"\` on the last). A step's \`screenshot\` names a raw screenshot shown small beside it. Steps run down a portrait canvas and across a Mac's. Example: \`{"layout":"steps","headline":"Set up in a *minute*","features":[{"title":"Pick your apps","text":"Choose what distracts you most."},{"title":"Set a schedule"},{"title":"Get your time back"}]}\`
- \`reviews\`: the slide's \`review\` badges as a wall of quote cards, up to ${REVIEWS_SHOWN}. \`title\` is the quote, \`subtitle\` who said it (a person, or a publication for a line from the press), \`stars\` the rating (left out, five). Badges of any other type stay with the copy. Three read best on an iPhone; keep each quote to a sentence. Example: \`{"layout":"reviews","headline":"People *can't stop* talking","badges":[{"type":"review","title":"I got two hours of my day back.","subtitle":"Maya, App Store review"},{"type":"review","title":"Simple, calm and it just works.","subtitle":"The Verge"}]}\`
- \`features\`: cards, see the next section.
Every figure, quote and name on these slides has to be real, as with badges: ask the user for them and never make one up.`,
  },
  {
    id: "feature-slides",
    title: "Feature slides",
    body: () => `A slide with \`"layout":"features"\` lists what the app does as cards, the way a keynote sums up a release, and suits a "what's new" or "everything you get" slide.
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
Example: \`{"layout":"features","headline":"Everything you *need*","featureStyle":"bento","featureCards":{"look":"tint","icons":"badge"},"features":[{"icon":"video-off","title":"No short videos","text":"Reels and Shorts are gone.","color":"#7C5CFF"},{"value":"100%","title":"On your device","color":"#34D399"},{"icon":"timer","title":"Daily limits","color":"#F59E0B"}]}\``,
  },
  {
    id: "feature-points",
    title: "Feature points",
    body: () => `On a layout that shows a device, \`features\` is a short list with the copy, under the subheadline: what this screen does, in two to four points, each with an \`icon\` or a \`value\`, a \`title\` and optionally one line of \`text\`. The device gives up room for them, so use them where the slide is meant to explain; a slide that should hit hard keeps to its headline. \`featureStyle\` picks the look, default \`list\`:
${list(POINT_STYLES)}
- \`chips\` under a centred headline is the lightest; \`list\` and \`cards\` belong in the column of \`device-right\` or \`device-left\`, or under the headline of a slide whose device is made smaller.
- The points shrink together with the headline when the copy grows too tall.
Example: \`{"layout":"device-right","headline":"Everything that *keeps you* on track","screenshot":"home","features":[{"icon":"timer","title":"Daily limits","text":"Set a cap for every app"},{"icon":"bell","title":"Gentle nudges","text":"A reminder before time is up"},{"icon":"chart-bar","title":"Weekly report"}]}\`
Take them off again with \`update_slide\` and \`"remove":["features"]\`.`,
  },
];
