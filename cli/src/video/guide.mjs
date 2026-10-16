// The playbook `appshots video guide` prints. It ships inside the CLI, so the skill points at it rather than
// repeating it, and the two cannot say different things about the same version of the commands.

export const GUIDE = `# App preview videos

An app preview is 15 to 30 seconds of real recordings of the app, cut together, with a caption on each moment in
every language. appShots records the app on this Mac, the server draws the captions, cards and background in the
project's style, and the CLI cuts the video, checks it against Apple's rules and can place it in App Store Connect.
Footage never leaves the Mac. Make the screenshots first: a preview takes its captions, fonts and background from
the project.

## 1. Check the Mac

Run \`appshots check\`. Besides Xcode and the server it reports:
- **ffmpeg**, which cuts the video. If it is missing, ask the user before installing it (\`brew install ffmpeg\`,
  about 100 MB). Never install it without a yes.
- **Screen Recording**, which only a Mac app needs: the terminal app has to be allowed under System Settings >
  Privacy & Security > Screen & System Audio Recording.
- **devicectl screen recording**, which only a physical iPhone or iPad needs. Recording a device is experimental;
  the simulator is the better source.

## 2. Ask once, in one message

Record nothing before the answers.
- **What it is for**: the App Store. Marketing cuts come later; say so if asked.
- **Which displays**: iPhone (one file covers every current iPhone), iPad, Mac. A Mac app needs a plan of its own.
- **Which languages**: all of the project's, or only the primary one. Every language is recorded separately: give
  the time \`appshots video plan\` estimates. Offer to record the primary language once and reuse it with captions
  in each language (\`"footage": "primary"\`), and say that the app's own text then stays in that language.
- **The story**: 3 to 5 moments, proposed from the project's slides (each slide's headline becomes a scene's
  caption). The user confirms, reorders or cuts.
- **How the app reaches each moment**: demo data behind a debug-only launch argument, an existing UI test, a
  Maestro flow or another script, steps on a web page, or the user drives it by hand while the CLI records (see
  Drivers below).
- **Music**: the user's own file, licensed for use in the App Store, or silence. appShots ships no music and
  suggests none.
- **Animated text with Remotion**: optional. If they want it, explain its licence (step 9) before anything is
  installed.

## 3. Write the plan

\`appshots video init\` writes \`appshots.video.json\` from the slides: the first slide's headline on the intro
card, then one scene per slide with that slide's headline as its caption. Change it to the story the user chose
and give each scene its \`drive\`. Then run \`appshots video plan\` and show the user the storyboard: the scenes,
each caption in the primary language, the seconds, the total per display and the recording time. Fix what it
warns about, and get an OK before recording.

\`\`\`json
{
  "version": 1,
  "project": "p_example",
  "app": { "platform": "ios", "bundleId": "com.example.notes" },
  "displays": ["iphone", "ipad"],
  "locales": ["en", "de"],
  "intro": { "headline": { "slide": 1 } },
  "outro": { "lines": [{ "slide": 4, "field": "sub" }], "disclosure": ["subscription"] },
  "scenes": [
    { "id": "inbox", "caption": { "slide": 2 }, "launch": { "args": ["-AppshotsDemo", "inbox"] },
      "drive": { "uitest": "NotesUITests/PreviewTests/testInbox" }, "trim": "auto" },
    { "id": "search", "caption": { "slide": 3 }, "launch": { "args": ["-AppshotsDemo", "search"] }, "drive": { "wait": 6 } },
    { "id": "share", "caption": "Share in one tap", "drive": "manual", "record": { "seconds": 8 } }
  ],
  "poster": { "scene": "inbox" }
}
\`\`\`

- A caption is \`{ "slide": 2 }\` (that slide's headline; \`"field": "eyebrow"\` or \`"sub"\` for another line), one
  text, or one text per language (\`{ "en": "…", "de": "…" }\`). Taking it from a slide keeps it translated.
- Each scene runs \`(end - start) / speed + hold\` seconds, cut by \`trim\` (\`"auto"\` cuts a still head and tail).
  Scenes overlap by the transition (fade, 0.4 s). Aim for 20 to 28 seconds in all.
- \`intro\` and \`outro\` are short cards (1.5 and 2 s). Leave them out, or keep them short: the first 3 seconds
  should show the app.
- \`poster\` picks the still shown before the preview plays: by default 1 s after the first scene's caption is in.

## 4. Make the app drivable, only with consent

Propose any change to the user's app and make it only after they agree: a \`-AppshotsDemo\` launch argument that
fills in demo data, gated by \`#if DEBUG\`; a UI test; an accessibility identifier. The data recorded must be
fictional: no real names, emails, phone numbers, prices or dates.

## 5. Record

Run \`appshots video record\`. It records each scene in each language on each display that has no recording yet:
iPhone on the 6.9-inch simulator and iPad on the 13-inch one, with a clean status bar, the app in that language.
\`--sim <name>\`, \`--device <name>\` (experimental), \`--mac <app>\` (a window, \`--window 1440x900\`) and
\`--web <url>\` choose the source. \`video plan\` says how long it takes; ask before recording more than 20
minutes in all.

Then run \`appshots video sheet --raw\` and look at the contact sheet. A wrong screen, the keyboard up, a spinner
or real data: record that scene again with \`appshots video record --scene <id> --again\`. A recording made
elsewhere (QuickTime with the iPhone as camera, Xcode) goes in with \`appshots video import <file> --scene <id>\`.

## 6. Layers

Run \`appshots video layers\`. The server draws the captions, cards, background and touch ring of each display in
every language, in the project's style. A new set uses one render; asking again for the same text is free. It
warns about a caption it had to shrink, or one drawn in another language because the project has no text for it:
fix the slide or the plan, and ask again.

## 7. Compose

Run \`appshots video compose\`. It writes \`appshots-video/out/<locale>/<display>/preview.mp4\`, its poster and
its check, and ends with the check's lines. \`--draft\` is faster for a first look and cannot be uploaded.

## 8. Review

Look at \`appshots video sheet\` and at the poster of one language, and read the check's lines
(\`appshots video check <file>\` checks any video). \`appshots video poster --at <seconds>\` picks another poster.
Make at most two rounds of changes before showing the user.

## 9. Optional: Remotion

Only if the user asked for animated text and agreed to Remotion's licence. \`appshots video remotion\` explains
the licence: Remotion is not open source; it is free for individuals, companies of up to 3 people and non-profits,
and a larger company needs a Remotion Company License. Pass \`--yes\` only after the user agreed in chat. It writes
a Remotion project into \`appshots-video/remotion/\` and installs it there. Then \`appshots video compose --engine
remotion\`.

## 10. Hand over

Tell the user where the files are. Upload only if they ask: first \`appshots video push --dry-run\` and show
what it would do, then \`appshots video push\` after a yes. Say that Apple processes a preview for up to 24 hours,
and that nothing has been submitted for review.

## Drivers

A scene's \`drive\` says how the app gets through that moment while it is recorded:
- \`"manual"\`: the user drives the app; recording stops on Return or after \`record.seconds\`. Needs a person at
  the terminal.
- \`{ "wait": 6 }\`: the app plays a demo by itself, for that many seconds.
- \`{ "uitest": "AppUITests/PreviewTests/testInbox" }\`: an XCUITest method, built once and run against the
  simulator.
- \`{ "command": ["maestro", "test", "flows/inbox.yaml"] }\`: any command, run from the plan's folder with
  \`APPSHOTS_LOCALE\`, \`APPSHOTS_DISPLAY\`, \`APPSHOTS_SCENE\`, \`APPSHOTS_UDID\` and \`APPSHOTS_TOUCH_LOG\` set.
- \`{ "web": [{ "goto": "/inbox" }, { "click": "#new" }, { "type": ["#title", "Groceries"] }, { "wait": 1 }] }\`:
  steps on a web app's page, recorded frame by frame.

\`launch\` sets the scene's start: \`args\` for the app, \`url\` as a deep link, \`appearance\` light or dark.

## Touches

The simulator records no touches. A driver can say where it taps by printing \`APPSHOTS_TOUCH <ms> <x> <y>\` (or
adding that line to \`$APPSHOTS_TOUCH_LOG\`), in milliseconds since it started and in points, and the compose
draws a ring there. In a UI test, tap with this instead of \`tap()\`:

\`\`\`swift
extension XCUIElement {
  func appshotsTap(since start: Date) {
    print("APPSHOTS_TOUCH \\(Int(Date().timeIntervalSince(start) * 1000)) \\(Int(frame.midX)) \\(Int(frame.midY))")
    tap()
  }
}
\`\`\`

Set \`let start = Date()\` as the test's first line, then \`app.buttons["Share"].appshotsTap(since: start)\`.
\`"touches": false\` on a scene leaves its rings out.

## Content rules

- Only real recordings of the app (App Review guideline 2.3.4). Captions over them are allowed; hands, device
  frames and framing around the recording are not.
- No prices, no dates, no "free" and no rankings in captions. When the app has in-app purchases, a subscription or
  needs a login, say so in the outro: \`"disclosure": ["iap", "subscription", "login"]\`.
- Fictional data only. Licensed music only.
- Previews play muted and loop: the first 3 seconds show the app, the poster is the app's screen, and the captions
  carry the message.
- 15 to 30 seconds; aim for 20 to 28. Up to three previews per display and language.

## Files

\`\`\`
appshots.video.json                 the plan: commit it
appshots-video/
  .gitignore                        keeps the large folders below out of git
  raw/<display>/<locale>/<scene>.mov    the recordings, with a <scene>.json beside each
  work/                             cut scenes and other intermediate files
  layers/<set>/                     the layers the server drew
  out/<locale>/<display>/preview.mp4    the previews, with preview.poster.png and preview.check.json
  remotion/                         only after 'appshots video remotion'
\`\`\`
`;

/** `appshots video guide`: prints the playbook. */
export function guide() {
  process.stdout.write(GUIDE);
}
