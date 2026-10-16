---
title: Accounts, tokens and limits
description: How accounts work in appShots. Sign in with Google, create and revoke API tokens for your agent, the limits per account, and how to delete your account and everything in it.
---

## Sign in

Sign in with a Google account on the [home page](/home). There is no password to set, and appShots never sees your Google password. It receives your email address and your name from Google, and nothing else. Google must have verified the address.

Your projects are yours alone. No account can see another's.

You stay signed in on that browser for 30 days after your last visit, so you are not signed out while you keep coming back. The [home page](/home) knows you too and takes you straight to your projects. **Sign out** under **Settings** signs you out on every browser at once. Your API tokens and connected apps keep working; revoke or disconnect them one by one below.

## Who can sign in

The person who runs the server decides, under **Admin** in the Studio:

- **Anyone with a Google account**, or
- **Only the people listed there**, by email address.

If the home page says your Google account is not on the list, ask whoever runs the server to add your address.

## API tokens

A token is what lets your agent, the `appshots` command or a script act as you. It starts with `appshots_`.

**Create one** under **Connect an agent** in the Studio, with **Create token**. It is shown once, inside the setup command. Run that command, and the token is saved on your Mac. See [Connect an agent](/docs/connect).

**See them** under **Settings**: the last four characters of each, the day it was created, and the day it was last used.

**Revoke one** with **Revoke** beside it. It stops working at once, everywhere it was used. Then create a new one and run the setup command again.

Good to know:

- The server stores a fingerprint of each token, not the token. A lost token cannot be shown again. Make a new one.
- A token reaches your projects, screenshots and renders. It cannot create or revoke tokens, delete your account or manage people. Those need a signed-in browser.
- Treat it like a password. Do not commit it, and do not paste it into a chat.
- An account holds up to 20 tokens. One per Mac or per agent makes it easy to revoke the right one.

## Connected apps

An app that adds appShots as a connector, such as claude.ai, Claude Desktop or ChatGPT, signs in with your account instead of using a token. appShots asks you first, on a page of its own that names the app and the address it sends you back to. Allow only an app you are adding yourself, right then. See [Add it as a connector](/docs/connect#add-it-as-a-connector).

**See them** under **Settings → Connected apps**: each app you let in, where it goes back to, the day you connected it and the day it was last used. Letting the same app in twice lists it twice.

**Disconnect one** with **Disconnect** beside it. It stops working at once. To use it again, connect it again in the app.

Good to know:

- An app reaches what a token reaches: your projects, screenshots and renders. It cannot change your account, make tokens or see anybody else's work.
- The name on the page is the one the app gave. The address it sends you back to is the part appShots checks, so look at that.
- An app renews its access by itself. One that goes unused for 30 days has to be let in again.
- The server stores fingerprints of the keys it gives an app, not the keys.
- An account keeps up to 50 connected apps. Letting in one more disconnects the one used longest ago.

## Limits

| | Limit |
| --- | --- |
| Projects per account | {{MAX_PROJECTS}} |
| Screenshots per project | {{MAX_SHOTS}} for each language |
| Logos and images per project | {{MAX_SHOTS}} |
| Slides per set | 10 |
| Languages per project | 40 |
| A screenshot file | 40 MB |
| An image file | 20 MB |
| Renders | {{RENDERS}} per account. See below |
| Renders at once | One running and one waiting per account |

The person who runs the server has no limit on projects, screenshots, images and renders.

## Renders

An account gets {{RENDERS}} renders. Every export uses one, whether it comes from **Export ZIP**, from `appshots pull --render` or from an agent's `render` tool, and whatever it draws. Previews in the Studio are free, and a render that fails or is cancelled uses none. See [Render and export](/docs/export#how-many-renders).

The Studio shows how many are left beside **Renders** in the sidebar and under **Settings**.

**To get more**, ask the person who runs the server. Under **Admin**, a click on the number of renders an account has left sets a new number for that account.

## Delete your account

**Settings → Delete account**, then type your email address to confirm. It deletes your account, every project, every screenshot, image and render, every token and every connected app, at once and for good. There is no undo and no backup to restore from.

One number outlives the account: how many renders it used, kept with a scrambled form of Google's id for you and nothing else. It is there so that deleting an account and signing up again does not hand out a fresh set of renders.

To leave one project only, delete the project. See [The Studio](/docs/studio#projects).

## What is stored about you

Your email address, your name, the fingerprints of your tokens, the apps you connected and the number of renders you made, besides the projects you make. The [privacy policy](/privacy) has the full list.
