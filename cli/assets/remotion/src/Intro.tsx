import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Layer, LIVE_TEXT, Words } from "./Caption";
import type { Card, Font, Picture } from "./props";

/** The point a picture grows from: the middle of what it shows, or of the video. */
export const originOf = (picture: Picture) => (picture.box ? `${picture.box[0] + picture.box[2] / 2}px ${picture.box[1] + picture.box[3] / 2}px` : "50% 50%");

// The intro card: the project's background, the logo springing up from nothing, then the headline, either wiped in
// along its reading direction as the server drew it, or word by word as live text.
export const Intro = ({ card, fonts, dir }: { card: Card; fonts: Font[]; dir: "ltr" | "rtl" }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 120 } });
  const start = Math.round(0.35 * fps);
  const shown = spring({ frame: frame - start, fps, config: { damping: 200 }, durationInFrames: Math.round(0.6 * fps) });
  // The wipe runs over the text's own box, so it starts with the first letter rather than the edge of the video.
  const [x, , w] = card.text?.box ?? [0, 0, width];
  const edge = x + w * shown;
  const wipe = dir === "rtl" ? `inset(0 0 0 ${x + w - w * shown}px)` : `inset(0 ${width - edge}px 0 0)`;
  return (
    <AbsoluteFill>
      {card.plate ? <Layer file={card.plate} /> : null}
      {card.logo ? (
        <AbsoluteFill style={{ opacity: interpolate(pop, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }), transform: `scale(${pop})`, transformOrigin: originOf(card.logo) }}>
          <Layer file={card.logo.file} />
        </AbsoluteFill>
      ) : null}
      {card.text ? (
        LIVE_TEXT ? (
          <Words picture={card.text} start={start} fonts={fonts} dir={dir} size={Math.round(width * 0.08)} />
        ) : (
          <AbsoluteFill style={{ opacity: shown, clipPath: wipe }}>
            <Layer file={card.text.file} />
          </AbsoluteFill>
        )
      ) : null}
    </AbsoluteFill>
  );
};
