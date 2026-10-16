# App preview, animated with Remotion

This folder draws the captions, the intro and the outro of this app's App Store previews with animation. appShots
wrote it with `appshots video remotion`, and leaves the changes you make to it alone.

Built with [Remotion](https://www.remotion.dev). Remotion is not open source and is not part of appShots: it is
installed here from npm under its own licence. It is free for individuals, for companies of up to 3 people and for
non-profits; a larger company needs a Remotion Company License. See [remotion.pro/license](https://remotion.pro/license).

## How a preview is made

```sh
appshots video compose --engine remotion
```

For each language and display of `appshots.video.json`, appShots

1. cuts each scene's recording to its length and size, without captions;
2. copies those clips, the pictures the appShots server drew in the project's style, its font and the music into
   `public/`;
3. writes `props/<language>-<display>.json`, the props of the `AppPreview` composition;
4. renders it: `npx remotion render src/index.ts AppPreview out/<language>-<display>.mp4 --props=props/<language>-<display>.json`;
5. encodes the result once more to Apple's specification, takes the poster frame and checks the file.

The previews end up in `appshots-video/out/`, as they do without Remotion.

## Changing it

| File | What it draws |
| --- | --- |
| `src/AppPreview.tsx` | The order of the parts, the transitions between them and the music |
| `src/Intro.tsx` | The intro card: background, logo and headline |
| `src/Scene.tsx` | One scene: its footage and its caption |
| `src/Caption.tsx` | How a caption comes in; `LIVE_TEXT` switches from the server's pictures to live text in the project's font |
| `src/Outro.tsx` | The outro card |
| `src/props.ts` | What the props hold |

To look at a change frame by frame, compose once so that `props/` and `public/` are there, then open the studio:

```sh
npx remotion studio --props=props/en-iphone.json
```

appShots rewrites only `props/` and `public/` when the plan changes; it leaves the files above as they are.
`appshots video remotion --again` brings them back to appShots' template, after showing which of them you changed
and asking.

Apple's rules still apply to what you draw: the video has to show the app as it is, text over it is fine, and
devices, hands and frames around the footage are not. `appshots video check` tells you whether a file meets
Apple's specification.

## Remotion's skills for coding agents

Remotion has its own skills for coding agents, which help an agent change these files:

```sh
npx remotion skills add
```

## The first render

The first render downloads Chrome Headless Shell (about 170 MB) into `node_modules/`. Rendering a 30-second preview
takes a minute or two on a recent Mac.
