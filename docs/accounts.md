---
title: Accounts, tokens and limits
description: How accounts work in appShots. Sign in with Google, create and revoke API tokens for your agent, the limits per account, and how to delete your account and everything in it.
---

## Sign in

Sign in with a Google account on the [home page](/home). There is no password to set, and appShots never sees your Google password. It receives your email address and your name from Google, and nothing else. Google must have verified the address.

Your projects are yours alone. No account can see another's.

You stay signed in on that browser for 30 days. **Sign out** in the sidebar ends it sooner.

## Who can sign in

The person who runs the server decides, under **People** in the Studio:

- **Anyone with a Google account**, or
- **Only the people listed there**, by email address.

If the home page says your Google account is not on the list, ask whoever runs the server to add your address.

## API tokens

A token is what lets your agent, the `appshots` command or a script act as you. It starts with `appshots_`.

**Create one** under **Connect an agent** in the Studio, with **Create token**. It is shown once, inside the setup command. Run that command, and the token is saved on your Mac. See [Connect an agent](/docs/connect).

**See them** under **Account**: the last four characters of each, the day it was created, and the day it was last used.

**Revoke one** with **Revoke** beside it. It stops working at once, everywhere it was used. Then create a new one and run the setup command again.

Good to know:

- The server stores a fingerprint of each token, not the token. A lost token cannot be shown again. Make a new one.
- A token reaches your projects, screenshots and renders. It cannot create or revoke tokens, delete your account or manage people. Those need a signed-in browser.
- Treat it like a password. Do not commit it, and do not paste it into a chat.
- An account holds up to 20 tokens. One per Mac or per agent makes it easy to revoke the right one.

## Limits

| | Limit |
| --- | --- |
| Projects per account | {{MAX_PROJECTS}} |
| Screenshots per project | {{MAX_SHOTS}} |
| Logos and images per project | {{MAX_SHOTS}} |
| Slides per set | 10 |
| Languages per project | 40 |
| A screenshot file | 40 MB |
| An image file | 20 MB |
| Renders at once | One running and one waiting per account |

The person who runs the server has no limit on projects, screenshots and images.

## Delete your account

**Account → Delete account**, then type your email address to confirm. It deletes your account, every project, every screenshot, image and render, and every token, at once and for good. There is no undo and no backup to restore from.

To leave one project only, delete the project. See [The Studio](/docs/studio#projects).

## What is stored about you

Your email address, your name, and the fingerprints of your tokens, besides the projects you make. The [privacy policy](/privacy) has the full list.
