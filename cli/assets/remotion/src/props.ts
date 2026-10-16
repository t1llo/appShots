// What the AppPreview composition is made from. `appshots video compose --engine remotion` writes one props file
// per language and display into props/, and copies every file they name into public/: the scenes' footage, the
// pictures the appShots server drew in the project's style, its font and the music.

/** A picture the appShots server drew, transparent and as large as the video, with what it shows. */
export type Picture = {
  /** Its file in public/. */
  file: string;
  /** Where its text or logo sits in the video: x, y, width and height in pixels. */
  box: [number, number, number, number] | null;
  /** Its words as plain text, for drawing them live instead. */
  text: string;
};

export type Caption = Picture & { position: "top" | "bottom" };

/** The intro or outro card. */
export type Card = {
  frames: number;
  /** The project's background, opaque, in public/. */
  plate: string | null;
  logo: Picture | null;
  text: Picture | null;
};

export type Scene = {
  id: string;
  /** The scene's footage in public/: already cut, placed and as large as the video, 30 frames a second, silent. */
  video: string;
  frames: number;
  caption: Caption | null;
};

/** One file of the project's font, as its stylesheet on the appShots server names it. */
export type Font = { family: string; file: string; weight?: string; style?: string; unicodeRange?: string };

export type Music = {
  /** In public/, brought to the loudness of the previews appShots cuts itself. */
  file: string;
  /** 0 to 1. */
  volume: number;
  /** Seconds into the file the preview's music starts. */
  start: number;
  /** Seconds it fades out over at the end. */
  fadeOut: number;
};

export type Props = {
  width: number;
  height: number;
  fps: number;
  locale: string;
  dir: "ltr" | "rtl";
  captionStyle: "panel" | "shadow" | "band";
  intro: Card | null;
  scenes: Scene[];
  outro: Card | null;
  /** How one part goes over into the next; parts overlap by its frames. */
  transition: { type: "fade" | "dissolve" | "none"; frames: number };
  music: Music | null;
  fonts: Font[];
};

/** The frames of every part, in the order they play: the intro card, the scenes, the outro card. */
export const lengths = (props: Props) => [...(props.intro ? [props.intro.frames] : []), ...props.scenes.map((scene) => scene.frames), ...(props.outro ? [props.outro.frames] : [])];

/** How long the preview runs: its parts, less the frames where two of them overlap in a transition. */
export function durationOf(props: Props) {
  const parts = lengths(props);
  const overlap = props.transition.type === "none" ? 0 : props.transition.frames;
  return Math.max(1, parts.reduce((sum, frames) => sum + frames, 0) - Math.max(0, parts.length - 1) * overlap);
}

/** What the studio shows before appShots has written any props: an empty iPhone preview. */
export const EMPTY: Props = {
  width: 886,
  height: 1920,
  fps: 30,
  locale: "en",
  dir: "ltr",
  captionStyle: "panel",
  intro: null,
  scenes: [],
  outro: null,
  transition: { type: "fade", frames: 12 },
  music: null,
  fonts: [],
};
