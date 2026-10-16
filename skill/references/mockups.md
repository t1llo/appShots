# Mockups for a website or a README

Part of the appshots skill: the devices alone, without slides, for outside the store.

A mockup is one raw screenshot inside its device with nothing behind it: a transparent PNG, cut to the device. Make them when the user asks for the devices alone, or offers a place for them: a landing page, a README, a press kit, a deck. They are not for App Store Connect, which takes no transparency.

1. Do step 1, then get the screens as in steps 5 and 6: a project, and the raw screenshots in it. An existing project already has them. Skip the questions, the plan and the copy.
2. Draw them. With the MCP tool, `render_mockups` with the project, and look at the picture it returns. Then `appshots mockups <project> --out <folder>` puts the PNGs where they are needed, such as `docs/` for a README or the site's image folder. Without `--out` they go to `./mockups/<project>/`. Each file is named `<screenshot>-<device>.png`.
3. Set the device only when asked or when the page calls for it, with `device` on the tool or the command's options: `--style clay` (or `outline`, `sketch`), `--color silver`, `--shadow soft`, `--rotate -8`, `--perspective left`, `--status-bar cover` for a clean 9:41, and `--width 1200` for a certain size. Left alone, a mockup is the plain device, upright, without a shadow, with the screenshot pixel for pixel, which suits a page that scales the picture itself. On a dark page a line drawing needs `--color silver`. What you set is saved with the project.
4. Put them on the page if that was the request, scaled by the page: `<img src="docs/home-iphone.png" alt="…" width="320">`. Write a real `alt` text.
5. Tell the user where the files are, and that {{SERVER}}/#/<project>/mockups shows them and lets them change the device and download again.

Mockups use none of the account's renders.
