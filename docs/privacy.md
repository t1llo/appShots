---
title: Privacy policy
nav: Privacy
description: What appShots stores about you, why, for how long, and who else receives it. In short, your email and name from Google, your projects and screenshots, and nothing sold or shared for ads.
updated: 2026-10-11
---

This page says what this appShots server stores about you and what happens to it. It applies to {{SERVER}}.

## In short

- You sign in with Google. The server stores your email address and your name.
- Your projects, screenshots and renders are stored so you can work on them. No other account can see them.
- Nothing is sold, and nothing is used for advertising.
- The server calls no AI service.
- Deleting your account deletes all of it at once.

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

**Your account.** From Google: your email address, your name and Google's id for your account. Also the day the account was created.

**Your API tokens.** For each token: a fingerprint (a SHA-256 hash), its last four characters, the day it was created and the day it was last used. The token itself is not stored.

**Your work.** The projects you make: their names, the texts and settings of every slide, the screenshots and images you upload, and the rendered files.

**The list of people.** If the server only admits listed people, the email addresses on that list.

That is all the server keeps. It writes no log of the pages you open or the requests you make.

## What is kept in your browser

| Name | Kind | What it is for | How long |
| --- | --- | --- | --- |
| `appshots_session` | Cookie | Keeps you signed in. Scripts on the page cannot read it | 30 days |
| `appshots_oauth` | Cookie | Protects the sign-in while you are on Google's page | 10 minutes |
| `appshots.theme` | Local storage | Your choice of light or dark | Until you clear it |
| `appshots.guides` | Local storage | Whether the safe area guides are shown | Until you clear it |

These are needed for the site to work. None of them follows you to other sites.

## Signing in with Google

When you sign in, your browser goes to Google and comes back. The server asks Google for your email address, your name and your account's id, and for nothing else. It cannot read your mail, files or contacts. It never receives your Google password. Google learns that you signed in to this site. [Google's privacy policy](https://policies.google.com/privacy) covers their side.

<!-- if analytics -->
## Analytics

This server uses PostHog (`{{ANALYTICS_HOST}}`) to see how the site is used: which pages are opened, which buttons are clicked, and what kind of browser and screen is used. PostHog keeps an anonymous id in a cookie and in your browser's storage for this, and sees your IP address when your browser contacts it.

- You are **not identified**. Your email address and name are never sent to PostHog.
- On the public pages, PostHog may record the session: how the page was scrolled and clicked.
- **In the Studio, session recording is switched off.** Your projects and screenshots are not recorded.
- A browser's tracking protection or a content blocker stops all of it, and the site works the same.

[PostHog's privacy policy](https://posthog.com/privacy) covers their side.
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
| PostHog | Anonymous usage data and your IP address | Analytics |
<!-- endif -->
| The hosting provider of this server | Everything stored, as files on its disks | Running the server |

Nobody else. Your data is not sold, rented or shared for advertising, and it is not used to train AI models.

**Your agent is separate.** If you connect a coding agent, what it reads on your Mac and sends to its own maker is governed by that maker's terms, not by this page. appShots only receives what the agent uploads here.

## How long it is kept

Until you delete it.

- Deleting a screenshot, an image or a project removes it at once.
- Deleting your account removes the account, every project, every file and every token at once.
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
