import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Layer, LIVE_TEXT, Words } from "./Caption";
import { originOf } from "./Intro";
import type { Card, Font } from "./props";

// The outro card: the project's background, the logo settling in, and the closing lines with what the app asks of
// its users (purchases, a subscription, a sign-in), which have to stay readable to the last frame.
export const Outro = ({ card, enter, fonts, dir }: { card: Card; enter: number; fonts: Font[]; dir: "ltr" | "rtl" }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const settle = spring({ frame: frame - enter, fps, config: { damping: 200 }, durationInFrames: Math.round(0.6 * fps) });
  const start = enter + Math.round(0.25 * fps);
  const shown = spring({ frame: frame - start, fps, config: { damping: 200 }, durationInFrames: Math.round(0.5 * fps) });
  return (
    <AbsoluteFill>
      {card.plate ? <Layer file={card.plate} /> : null}
      {card.logo ? (
        <AbsoluteFill style={{ opacity: settle, transform: `scale(${interpolate(settle, [0, 1], [0.85, 1])})`, transformOrigin: originOf(card.logo) }}>
          <Layer file={card.logo.file} />
        </AbsoluteFill>
      ) : null}
      {card.text ? (
        LIVE_TEXT ? (
          <Words picture={card.text} start={start} fonts={fonts} dir={dir} size={Math.round(width * 0.06)} />
        ) : (
          <AbsoluteFill style={{ opacity: shown, transform: `translateY(${interpolate(shown, [0, 1], [0.02, 0]) * width}px)` }}>
            <Layer file={card.text.file} />
          </AbsoluteFill>
        )
      ) : null}
    </AbsoluteFill>
  );
};
