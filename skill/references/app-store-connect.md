# Step 10: put it into App Store Connect

Part of the appshots skill: step 10 of SKILL.md in full, for the upload of a finished set and for the store page's texts.

Only when the user asked for it: with a yes in step 2, or in their own words at any time. The upload runs on this Mac with `appshots store`, which talks to Apple directly. It changes the store page of a version that is being prepared and nothing else: it cannot submit a version for review or release one, and neither do you, by any other means.

## The key

The command needs an App Store Connect API key of the user's own. If the `App Store Connect:` line of `appshots check` names a key, it is there already: go on. If not, ask the user for three things and tell them where they are:

- In App Store Connect, under **Users and Access → Integrations → App Store Connect API → Team Keys**: the **issuer ID** above the list of keys, the **key ID** beside the key, and the key file, `AuthKey_<key id>.p8`, which is downloaded once when the key is made.
- A new key should get the role **Marketing**. That is enough to make a version and to change screenshots and texts, and it cannot submit or release anything. Only the Account Holder or an Admin of the team can make a key.
- You need the **path** of the `.p8` file on this Mac, and never what is in it.

Then save them. This checks them with Apple and lists the apps the key reaches:

```bash
appshots store login --issuer <issuer id> --key-id <key id> --key <path to the .p8 file>
```

**The key file is not yours to read.** Do not open it, print it, copy it, move it or put it into the repository, and do not go looking for key files on the Mac: the path the user gives is all the command needs. If the user pastes the key's contents into the chat, do not use them: tell them a pasted key should be revoked in App Store Connect, and ask for the path of a new one. The key, its path and the IDs never go to the appShots server either, not as a tool's argument and not into a project.

## The upload

1. **Find the app.** Take the bundle id from the project (`PRODUCT_BUNDLE_IDENTIFIER`, or the toolkit's own setting) and look for it among the apps `appshots store login` or `appshots store apps` lists. Ask the user when it is not among them or several fit.
2. **Look first.** Run the dry run and show the user what it prints:

   ```bash
   appshots store push <project> --app <bundle id> --dry-run
   ```

   It names the version, and for each language and display how many screenshots would go up and what they would replace. It takes the files of the last render; add `--render` only when the slides changed since.
3. **If it says no version is being prepared,** a new one has to be created. Take the number from the app (`MARKETING_VERSION`, or the toolkit's own version setting) when that is higher than the latest version the message names. Otherwise ask the user which number the next version gets. Then add `--version <number>` to the dry run and the upload. A version number is not a build number, and no build is made or touched.
4. **If it says a language is not on the store page,** ask the user whether to add it. `--add-languages` does. If it says a language could go onto either of two, such as `en` onto `en-US` or `en-GB`, ask the user which, and name it with `--lang en=en-GB`. `--lang` uploads only the languages it names, so list the others after it, as in `--lang en=en-GB,de-DE`.
5. **Wait for the user's yes to that plan,** unless they already told you to upload without asking. Then run the same command without `--dry-run`.
6. **If Apple refuses a file,** the command says which and why, and ends with an error. Render again and run it once more. Do not work around it.

The command leaves three things out and says so: screenshots for the iPhone Duo, which App Store Connect's API has no display for yet, the header and search results assets, and banners. The first two the user drags in by hand.

`--lang de-DE,fr-FR` uploads only those languages, and `--only iphone,ipad` or `--only iphone-6.9` only those devices or folders. Mac screenshots need a macOS version of the app in App Store Connect: without one, leave them out with `--only iphone,ipad` and tell the user.

## The texts

Only when the user asks for them. `appshots store text --app <bundle id>` prints the store page's texts per language as JSON: `name`, `subtitle`, `description`, `keywords`, `promotionalText`, `whatsNew`, `supportUrl` and `marketingUrl`. To change some, hand back the same shape with only the ones to change:

```bash
appshots store text --app <bundle id> --set @texts.json --dry-run
```

Show the user the new texts in full and wait for their yes before you run it without `--dry-run`. Write for the store as for the slides: plain, specific, no invented figures. Apple's limits are 30 characters for the name and the subtitle, 100 for the keywords, 170 for the promotional text and 4000 for the description and what is new; the command refuses longer ones before anything is sent. An app on iOS and the Mac has texts for each: `--platform ios` or `--platform mac`.

## Then tell the user

- What went up: the version, the languages and the displays. And what did not: iPhone Duo screenshots, header and search results assets, a language that is not on the store page.
- If a version was created: its number, and that it has no build yet.
- That nothing was submitted. The link the command printed opens the app in App Store Connect, where they look the version over and submit it themselves.
