# Steps 7 to 9 in full

Part of the appshots skill: writing the copy, building and rendering the set, and handing it over, with everything steps 7 to 9 of SKILL.md say.

## 7. Write the copy

- A headline is two to five words and one benefit. Say what the user gets, not what the feature is called: "Never miss a day", not "Reminder notifications". Verb first where it fits.
- Wrap the one word that matters in `*asterisks*` to tint it.
- A subheadline is one short sentence, and most slides are better without it.
- Use the words the app itself uses. No "best", "ultimate" or "#1", and nothing the app does not do.
- Badges, the figures of a `stat` slide and the reviews of a `reviews` slide only with the real figures and reviews the user gave you in step 2. Without any, leave them out. Invented ones get the app rejected.
- A row of logos only for services the app really works with, as the user named them in step 2.
- The app's logo belongs on the first slide, not on every one. Other artwork: one to three images on a slide, clear of the headline and of the part of the screen the slide is about.
- Write in the app's main language. Add other languages only when asked, as `{"en-US": "...", "de-DE": "..."}` maps, with the locales listed on the project. The first locale is the one the others fall back to, for texts and screenshots alike.

## 8. Build and render

1. `set_slides` with the whole set and the theme. Take the theme from the app: its accent colour, a muted background in the same family or `auto`, one font for the set. Vary the layouts so it does not read as one template repeated: one device, a close-up, the device beside a column of feature points, two or three devices on one slide, a feature slide. If the screenshots come from a real device and show an odd time or a low battery, set `"device": {"statusBar": "cover"}` in the theme: it paints a clean 9:41 status bar over theirs. If they are a web app's, taken with `appshots capture --web` for an iPhone or iPad, set `"device": {"statusBar": "overlay"}` instead: it draws the 9:41 status bar into the place those pictures leave free at the top. The theme's `device.style` draws the frames as `clay`, `outline` or `sketch` instead of the real device, when the user wants a calmer or a hand-drawn look; on a slide with two or three devices, `device.spread` is the angle between them.
2. **A set for every other device,** before the first render. When the project has screenshots of more than one device, the set from 1 is the iPhone's, and each of the others gets its own: `set_slides` again with `"device": "ipad"`, `"device": "mac"` or `"device": "duo"`. Do not send the iPhone's slides unchanged. Start from them and compose each slide for that canvas: an iPad's is close to square and a Mac's is wide, so the layout, the size and place of the device and how much copy fits all change. The sets tell the same story in the same words and share the theme, and they may differ in layouts, in the screens they show, in order and in number. A slide that already sits well on the other canvas stays as it is. A set for each device in the design guide says what usually changes. With one device only, skip this.
3. **Check before you render.** `check_project` takes the same arguments as `render` and says what that render would draw, what it would refuse and what it would warn about: a screenshot name nothing is uploaded under, a slide that does not exist, a language the project lacks, an account without renders left. It uses no render. Fix what it names, and check again until it says the render would start.
4. `render` with `"creatives": []`. It writes every size of every device the project has screenshots of, each from its own set: sizes of the same shape are the same picture scaled, so there is nothing to design per size and no `targets` to pass. Look at the contact sheet it returns for each device as a customer would: is each headline readable at thumbnail size, does the device crop hide the point of the screen, does the set hold together?
5. Fix everything that is off with `update_slide`, and in a device's own set with `"of": "ipad"` added, then render those slides in one call, as in `"slides": [2, 5], "creatives": []`. Two rounds at most. `render` says how many renders the account has left when they are counted: each call uses one, so never spend one on a single small fix, and when none are left, say so and stop. The person who runs the server can give the account more. Stop when it is good, not when it is perfect. When the device hides the point of its screen or crowds the copy, move or resize it on that slide with `device`: `scale`, `offsetX` and `offsetY`, in small steps. A placed image that covers something moves with its `x`, `y` and `size`; look at every device's sheet, because the same numbers land elsewhere on a wider canvas, and change them in that device's own set. A bad edit can be undone: every change is kept as a revision, `list_revisions` lists them and `restore_project` brings one back, also when a change wrote over what the user tuned in the Studio.
6. Only if the user asked for them: `set_creative_assets` for the product page header and the search results image, then `render` with `"creatives": ["header", "search"]`. Keep their copy to one short phrase. The preview marks the safe area with a dashed frame so you can check that the copy is inside it; that frame is not in the file. Apple reviews these more strictly than screenshots.

**App preview videos.** When the user asks for an app preview video, run `appshots video guide` and follow it. The CLI records the app on the Mac, the server draws the captions in the project's style, and the CLI cuts the video, checks it against Apple's rules and can place it in App Store Connect.

## 9. Hand over

Tell the user:

- The Studio link, {{SERVER}}/#/<project>, where every slide can still be edited by hand.
- How to get the files: **Export ZIP** in the Studio, or `appshots pull <project>` for `./store-screenshots/<project>`. There is one folder per display of App Store Connect, and `README.txt` says which folder goes onto which display. A display only takes the files of its own folder.
- If they did not ask for the upload: that `appshots store push <project>` can put the set into App Store Connect for them, with an API key of their own that stays on this Mac. One line, no more.
- The slides with their headlines, in order.
- For a Mac set: the files are in the `mac-2880` folder, 2880×1800, and go onto the macOS version of the app in App Store Connect.
- Which devices have a set of their own, and how those differ from the iPhone's.
- What you assumed or left out: no iPad or Duo set, no badges, a screen you could not reach, a file you changed for the debug launch argument, sample data you put into a local database.
- That header and search results assets, if made, should be checked in App Store Connect's preview before submitting.
- If the `appshots` MCP server answered 401 and you used the command instead: running the setup command again, from this folder, repairs the connection.

When the user said yes to the upload in step 2, go on with step 10, in `app-store-connect.md`, once they are happy with the set.
