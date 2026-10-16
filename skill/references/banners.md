# A banner for a README or a link

Part of the appshots skill: a wide picture with a headline, for outside the store.

A banner is a wide picture with the app's screens in their devices, a headline and the project's background, for outside the store. Make one when the user asks for a README banner or header, a social preview for the repository, a link preview (`og:image`) or a 16:9 picture for a post.

1. Do step 1, then get a project with its raw screenshots as in steps 5 and 6. An existing project already has them, and its theme. Skip the questions and the plan.
2. `set_creative_assets` with the banner asked for: `readme` (2400×800), `social` (1280×640, GitHub's social preview), `link` (1200×630) or `post` (1920×1080). Give it a headline of a few words, perhaps a subheadline, and one to three `screenshots`. Banners in the design guide has every field. In a new project, set the theme first with `update_project`: the app's accent colour and a background in the same family.
3. `render` with `"creatives": ["readme"]`. That draws the banner alone and leaves the slides as they are. It uses one render, so make every banner that was asked for in one call. Look at the preview it returns, and fix and render once more at most.
4. `appshots pull <project>` saves it as `./store-screenshots/<project>/<language>/banners/readme.png`. For a README, copy it into the repository, such as `docs/banner.png`, and make `![<App name>](docs/banner.png)` the first line of the README. Do not commit `store-screenshots/`.
5. Tell the user what only they can do: a `social` banner is uploaded under the repository's Settings, General, Social preview, where GitHub takes a file of up to 1 MB; a `link` banner goes onto their website as the page's `og:image`.
