# Several devices, other languages, and artwork

Part of the appshots skill: what step 6 of SKILL.md adds when the set is for more than one device or language, and when the user gave you a logo or other artwork.

## Several devices

For an app on iPhone and Mac, capture the same screens under the same names on both. The Mac then gets a slide set of its own in step 8. Read Mac apps in the design guide before writing the slides: the canvas is wide and short, so the copy has to be shorter still.

For the iPad or the Duo set, capture the same names on that simulator. One name holds one screenshot of each device, and every slide picks the one of the device it is drawn for. Each of these devices gets a slide set of its own in step 8 as well.

## Other languages

For another language, when the user asked for it and the app itself is translated: list the language in the project's `locales` first, then capture the same names again with `--lang`, which starts the app in that language and files the screenshot under it:

```bash
appshots launch <bundle id> --lang de-DE --capture stats --to <project> -- <launch arguments>
appshots capture --web <address> --lang de-DE --name stats --project <project>      # a web app
appshots upload <project> <folder> --lang de-DE      # or files the user already has in that language
```

The slides stay as they are: each language's set shows its own screenshot of a name, and the first language's where it has none. So an app that is not translated needs no second round of captures, only translated copy.

## Look at what you captured

The PNGs are also saved in `./raw-shots`. Open each one and look at it before moving on; capture again under the same name to replace it. Do not commit `raw-shots/`.

## A logo and other artwork

Only when the user gave you files in step 2, or asked for the app's icon on the slides. These are not screenshots, so they go up with `--image`:

```bash
appshots upload <project> logo.svg mascot.png --image             # PNG, SVG, JPEG or WebP, named after the files
appshots upload <project> <the 1024 px icon in the asset catalogue> --image --name app-icon
```

`get_project` lists them under `images`. A slide shows one over its headline with `logo`, and places others anywhere with `images`; the design guide has the fields. Use only what the user gave you or what is in the repository. Do not draw, generate or download artwork.
