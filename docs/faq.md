---
title: Questions and answers
nav: FAQ
description: Short answers about appShots. What it is, which agents it works with, whether you need a Mac, what happens to your screenshots, fonts and device frames, and what it does not do.
---

## The basics

### What is appShots?

A tool that turns raw screenshots of your iPhone, iPad or Mac app into the framed, captioned images the App Store shows, at the exact sizes App Store Connect accepts. You can use it by hand in the browser, or let a coding agent do the whole set. See the [overview](/docs).

### Do I need an agent?

No. The [Studio](/docs/studio) does everything by hand. An agent saves the time: it captures the screens, writes the headlines and builds the set.

### Which agents work?

Claude Code, Codex, OpenCode and Pi have a ready setup. Any other agent works if it can use an MCP server or run shell commands. See [Connect an agent](/docs/connect).

### Do I need a Mac?

For the Studio, any modern browser will do. Capturing screens from a simulator or a device needs a Mac with Xcode, and capturing a Mac app's window needs a Mac. A web app's pages are captured with Chrome, Edge or Brave and no Xcode. Screenshots you have already can be uploaded from anywhere.

### How long does a set take?

With an agent, ten to twenty minutes from "make my screenshots" to the ZIP. Most of that is building the app and opening its screens.

### Is it made by Apple?

No. appShots is not affiliated with Apple. App Store and iPhone are trademarks of Apple Inc.

## What it makes

### Does it use AI to generate the images?

No. The server draws every slide from your screenshots, text and settings, the same way each time. There is no image model, and the server calls no AI service. The agent you connect is what writes the copy and picks the layouts.

### Can it make Google Play screenshots?

Not at Google Play's sizes. It exports App Store sizes for iPhone, iPhone Duo, iPad and Mac. See [Sizes](/docs/sizes).

### Do I have to design every iPhone size?

No. You design the set once for the iPhone, and once each for the iPhone Duo and the iPad if your app runs on them. The export holds every size App Store Connect lists. See [Sizes](/docs/sizes).

### Does it work for Mac apps?

Yes. The Mac is a device like the iPhone and the iPad. Capture the app's window with `appshots capture --mac`, or upload a screenshot of it, and the set is exported in landscape at the Mac App Store's size. A window is shown as a window, an app in full screen inside a MacBook. See [Mac apps](/docs/mac).

### Does it work with Flutter, React Native or a web app?

Yes. An app is captured where it runs, whatever it is built with. A Flutter, React Native, Expo or Capacitor app runs in the simulator, started by its own command. A Tauri or Electron app is captured as a window on the Mac. A web app is captured page by page with `appshots capture --web`, at the size of an iPhone, an iPad or a Mac. See [Web apps and other toolkits](/docs/web-apps).

### Can it make a banner for my README?

Yes. A project can have a README banner, a social preview for the repository, a link preview and a 16:9 picture for a post, made from the same screenshots and theme. See [Banners](/docs/banners).

### Can I get the device alone, for my website?

Yes. The **Mockups** page of a project shows every screenshot in its device with nothing behind it, to download as a transparent PNG. An agent and the `appshots mockups` command do the same. See [Mockups](/docs/mockups).

### Can it upload the screenshots to App Store Connect?

Yes, with an API key of your own. `appshots store push` puts every language into its language and every folder onto its display, in the version you are preparing or a new one, and it can change the texts of the store page. It never submits anything for review. See [Upload to App Store Connect](/docs/app-store-connect).

### Landscape screenshots, or app preview videos?

iPhone and iPad sets are portrait, and a Mac set is landscape. There are no landscape iPhone or iPad sets and no videos.

### Can I use my own fonts?

Not yet. There are {{FONT_COUNT}} built in, listed on [Slides](/docs/slides#fonts). They are open-source fonts that are free to use in commercial images.

### Can I add my own logo or artwork?

Yes. See [Logos and artwork](/docs/images).

### Are the device frames allowed on the App Store?

The frames are drawn by appShots and are not Apple's product photos. Framed screenshots are common on the store. Apple decides each case. See [What App Review accepts](/docs/app-review).

### Who owns the images?

You do. They are made from your screenshots and your words.

## Your data

### Who can see my screenshots?

Your account, and the person who runs the server, who has access to its disk. No other account can. See the [privacy policy](/privacy).

### Does my agent send my code to appShots?

No. The agent reads your code on your Mac. What reaches the server is the screenshots it uploads and the slides it writes. What your agent sends to its own maker is between you and them.

### Does appShots get my App Store Connect key?

No. Uploading to App Store Connect is done by the `appshots` command on your Mac, which talks to Apple directly. The key file stays where you put it, and neither the key nor its path is sent to the appShots server. See [Upload to App Store Connect](/docs/app-store-connect#where-the-key-is-kept).

### How do I delete everything?

**Settings → Delete account** in the Studio. See [Accounts, tokens and limits](/docs/accounts#delete-your-account).

## Working with it

### Can I change what the agent made?

Yes. Everything is editable in the Studio, and the agent can keep working on it afterwards. Both edit the same project.

### How many sets can I export?

An account gets {{RENDERS}} renders, and every export uses one. Working in the Studio and looking at the previews uses none. When they are used up, the person who runs the server can give you more. See [Render and export](/docs/export#how-many-renders).

### Do I have to wait while it renders?

No. **Export ZIP** renders in the background. Keep working or switch to another tab, and the ZIP downloads when it is done.

### Can two people work on one project?

Not yet. A project belongs to one account.

### How do I get the newest version?

The Studio and the server's tools update by themselves. On your Mac, run `appshots update`. See [Update](/docs/update).

### Something does not work.

See [Troubleshooting](/docs/troubleshooting), and run `appshots check`.
