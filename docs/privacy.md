---
title: Privacy policy
nav: Privacy
description: What appShots stores about you, why, for how long, and who else receives it. In short, your email and name from Google, your projects and screenshots, and nothing sold or shared for ads.
updated: 2026-10-15
---

This page says what this appShots server stores about you and what happens to it. It applies to {{SERVER}}.

## In short

- You sign in with Google. The server stores your email address and your name.
- Your projects, screenshots and renders are stored so you can work on them. No other account can see them.
- Nothing is sold, and nothing is used for advertising.
- The server calls no AI service.
- Deleting your account deletes all of it at once. Only a count of the renders it used stays, with no name or address beside it.

## Who is responsible

<!-- if operator -->
This server is run by {{OPERATOR}}.
<!-- else -->
This server is run by the person or company that set it up.
<!-- endif -->
<!-- if contact -->
For anything about your data, write to [{{CONTACT}}](mailto:{{CONTACT}}).
<!-- else -->
For anything about your data, contact whoever gave you access to this server.
<!-- endif -->

## What is stored

**Your account.** From Google: your email address, your name and Google's id for your account. Also the day the account was created and the number of renders you made.

**Your API tokens.** For each token: a fingerprint (a SHA-256 hash), its last four characters, the day it was created and the day it was last used. The token itself is not stored.

**Your work.** The projects you make: their names, the texts and settings of every slide, the screenshots and images you upload, and the rendered files. Each project also keeps its last 50 versions of the names, texts and settings, so that a change can be undone. Screenshots and images are not part of them.

**The list of people.** If the server only admits listed people, the email addresses on that list.

That is all the server keeps. It writes no log of the pages you open or the requests you make.

## What is kept in your browser

| Name | Kind | What it is for | How long |
| --- | --- | --- | --- |
| `appshots_session` | Cookie | Keeps you signed in. Scripts on the page cannot read it | 30 days after your last visit |
| `appshots_oauth` | Cookie | Protects the sign-in while you are on Google's page | 10 minutes |
| `appshots.theme` | Local storage | Your choice of light or dark | Until you clear it |
| `appshots.guides` | Local storage | Whether the safe area guides are shown | Until you clear it |
| `appshots.zoom` | Local storage | How large the Studio shows the slide previews | Until you clear it |
| `appshots.backdrop` | Local storage | The backdrop behind the mockups in the Studio | Until you clear it |
| `appshots.storeLook` | Local storage | Whether the store preview shows light, dark or both | Until you clear it |

These are needed for the site to work. None of them follows you to other sites.

## Signing in with Google

When you sign in, your browser goes to Google and comes back. The server asks Google for your email address, your name and your account's id, and for nothing else. It cannot read your mail, files or contacts. It never receives your Google password. Google learns that you signed in to this site. [Google's privacy policy](https://policies.google.com/privacy) covers their side.

<!-- if analytics -->
## Analytics

This server counts how the site is used with Umami, at `{{ANALYTICS_HOST}}`. Umami sets no cookie and keeps no id in your browser. When a page opens, your browser sends it the page's address and title, the page you came from, your browser's language and the size of your screen. The Umami server sees your IP address when your browser contacts it, and works out your country and your kind of browser and device from the request.

It counts the pages opened on the home page, in the docs and in the Studio, and seven actions. Each action carries at most one word from a fixed list:

| Action | Counted when | What goes with it |
| --- | --- | --- |
| `open_studio` | A link to the Studio is followed | Where on the page the link is |
| `open_github` | A link to the source code on GitHub is followed | Where on the page the link is |
| `pick_agent` | An agent is picked on the home page | Which agent |
| `copy_command` | A setup command is copied | On the home page, the agent it is for |
| `create_project` | A project is created in the Studio | Nothing |
| `connect_agent` | A token is made under **Connect an agent** | Which agent |
| `export` | The screenshots or the mockups are downloaded | Which of the two |

- You are **not identified**. Your email address and name are never sent to Umami.
- **In the Studio, Umami learns only that the Studio was opened** and which of the actions above happened. Every page there is sent with the title "appShots Studio", and the part of the address after the `#`, which names the open project, stays in your browser. Your projects, your screenshots and what you type are never sent.
<!-- endif -->
<!-- if recorder -->
- On the home page and in the docs, Umami also **records visits**: how the page was scrolled and clicked, so that a visit can be replayed. Where the home page shows the name of whoever is signed in, the name is hidden in the recording. **The Studio never loads the recorder**, so your projects and screenshots are never recorded.
<!-- endif -->
<!-- if analytics -->
- A browser's tracking protection or a content blocker stops all of it, and the site works the same.
<!-- else -->
## Analytics

This server uses no analytics and no tracking.
<!-- endif -->

## Security

- Connections are encrypted with HTTPS.
- Sign-in attempts are counted per IP address for fifteen minutes, in memory only, to stop guessing. Nothing of it is written to disk.
- Each account's files are kept apart, and every request is checked against the account that sent it.
- The company hosting the server may keep technical connection logs of its own.

## Who receives your data

| Who | What | Why |
| --- | --- | --- |
| Google | That you signed in to this site | Sign-in |
<!-- if analytics -->
| The Umami server at `{{ANALYTICS_HOST}}`, used by whoever runs this server | The pages you open, the actions above and your IP address | Analytics |
<!-- endif -->
| The hosting provider of this server | Everything stored, as files on its disks | Running the server |

Nobody else. Your data is not sold, rented or shared for advertising, and it is not used to train AI models.

**Your agent is separate.** If you connect a coding agent, what it reads on your Mac and sends to its own maker is governed by that maker's terms, not by this page. appShots only receives what the agent uploads here.

## How long it is kept

Until you delete it.

- Deleting a screenshot, an image or a project removes it at once. A project's earlier versions go with it.
- Deleting your account removes the account, every project, every file and every token at once.
- One thing stays after that: the number of renders the account used, next to a SHA-256 hash of Google's id for it. It holds no name and no address, and it only serves to give you the same count back if you sign up again.
- If the person running the server keeps backups of its disk, deleted data can remain in those until they are overwritten.

## Your rights

You can, at any time:

- **See and take out your data.** Everything is in the Studio. **Export ZIP** downloads the renders, and the [HTTP API](/docs/api) returns each project as JSON.
- **Correct it.** Projects are yours to edit. Your name comes from Google on sign-in.
- **Delete it.** See [Accounts, tokens and limits](/docs/accounts#delete-your-account).
<!-- if contact -->
- **Ask.** Write to [{{CONTACT}}](mailto:{{CONTACT}}) for a copy of what is stored, or to object to how it is used.
<!-- else -->
- **Ask.** Contact the person who runs this server for a copy of what is stored, or to object to how it is used.
<!-- endif -->

If you live in the European Union, the United Kingdom or another place with a data protection law, you also have the right to complain to your data protection authority.

## Children

appShots is a tool for people who publish apps. It is not meant for children, and accounts need a Google account.

## Changes

When this page changes, the date at the top changes with it.
