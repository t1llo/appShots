import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, staticFile, useVideoConfig } from "remotion";
import { loadFonts } from "./Caption";
import { Intro } from "./Intro";
import { Outro } from "./Outro";
import { durationOf, type Music as MusicProps, type Props } from "./props";
import { Scene } from "./Scene";

/** Seconds the music takes to come up at the start, as in the previews appShots cuts itself. */
const FADE_IN = 0.3;

// The music under the whole preview, looped when it is shorter, faded in at the start and out at the end. The
// fades follow the preview's frames, not each round of the loop.
const Music = ({ music, frames }: { music: MusicProps; frames: number }) => {
  const { fps } = useVideoConfig();
  const fadeIn = Math.max(1, Math.round(FADE_IN * fps));
  const fadeOut = Math.min(Math.round(music.fadeOut * fps), Math.floor(frames / 2));
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const volume = (frame: number) =>
    music.volume * Math.min(interpolate(frame, [0, fadeIn], [0, 1], clamp), fadeOut > 0 ? interpolate(frame, [frames - fadeOut, frames], [1, 0], clamp) : 1);
  return <Audio src={staticFile(music.file)} loop loopVolumeCurveBehavior="extend" trimBefore={Math.round(music.start * fps)} volume={volume} />;
};

// The preview: the intro card, the scenes and the outro card, one after another, joined by the plan's transition.
// Remotion has no dissolve of its own, so a dissolve fades here as well.
export const AppPreview = (props: Props) => {
  loadFonts(props.fonts);
  const { fonts, dir, transition } = props;
  const overlap = transition.type === "none" ? 0 : transition.frames;
  const parts: Array<{ key: string; frames: number; draw: (enter: number) => ReactNode }> = [
    ...(props.intro ? [{ key: "intro", frames: props.intro.frames, draw: () => <Intro card={props.intro!} fonts={fonts} dir={dir} /> }] : []),
    ...props.scenes.map((scene) => ({ key: `scene-${scene.id}`, frames: scene.frames, draw: (enter: number) => <Scene scene={scene} enter={enter} fonts={fonts} dir={dir} /> })),
    ...(props.outro ? [{ key: "outro", frames: props.outro.frames, draw: (enter: number) => <Outro card={props.outro!} enter={enter} fonts={fonts} dir={dir} /> }] : []),
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <TransitionSeries>
        {parts.flatMap((part, at) => [
          ...(at > 0 && overlap > 0 ? [<TransitionSeries.Transition key={`${part.key}-in`} presentation={fade()} timing={linearTiming({ durationInFrames: overlap })} />] : []),
          <TransitionSeries.Sequence key={part.key} durationInFrames={part.frames}>
            {part.draw(at > 0 ? overlap : 0)}
          </TransitionSeries.Sequence>,
        ])}
      </TransitionSeries>
      {props.music ? <Music music={props.music} frames={durationOf(props)} /> : null}
    </AbsoluteFill>
  );
};
