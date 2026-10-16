import { loadFont } from "@remotion/fonts";
import type { CSSProperties } from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Caption as CaptionProps, Font, Picture } from "./props";

/**
 * How the captions and the cards' text are drawn.
 * - false: the pictures the appShots server drew, in the project's style, exactly as its screenshots set text.
 * - true: live text in the project's font, word by word, to restyle or animate it here. It takes its place from
 *   the server's pictures, but not their panel or colours: set those below.
 */
export const LIVE_TEXT = false;

/** Live text's colour and the shadow that keeps it readable on any screen. */
const INK = "#ffffff";
const SHADOW = "0 0.06em 0.4em rgba(0, 0, 0, 0.45)";

/** Frames after its scene has come in before a caption does. */
const DELAY = 3;

const loaded = new Set<string>();

/** Loads the project's font for live text, once for each file. */
export function loadFonts(fonts: Font[]) {
  if (!LIVE_TEXT) return;
  for (const font of fonts) {
    if (loaded.has(font.file)) continue;
    loaded.add(font.file);
    loadFont({ family: font.family, url: staticFile(font.file), weight: font.weight, style: font.style, unicodeRange: font.unicodeRange });
  }
}

/** The CSS font stack of live text: the project's font, then the system's. */
export const fontStack = (fonts: Font[]) => [...new Set(fonts.map((font) => `"${font.family}"`)), "system-ui", "sans-serif"].join(", ");

const full: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" };

/** One of the server's pictures, which are as large as the video and line up with it. */
export const Layer = ({ file, style }: { file: string; style?: CSSProperties }) => <Img src={staticFile(file)} style={{ ...full, ...style }} />;

/** A picture's words as live text, in the box the server set them in, rising in one after another from `start`. */
export const Words = ({ picture, start, fonts, dir, size }: { picture: Picture; start: number; fonts: Font[]; dir: "ltr" | "rtl"; size: number }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const [x, y, w, h] = picture.box ?? [width * 0.07, height * 0.06, width * 0.86, height * 0.14];
  let at = 0;
  return (
    <div
      dir={dir}
      style={{ position: "absolute", left: x, top: y, width: w, height: h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: INK, textShadow: SHADOW, fontFamily: fontStack(fonts), fontWeight: 800, fontSize: size, lineHeight: 1.1 }}
    >
      {picture.text.split("\n").map((line, row) => (
        <div key={row}>
          {line.split(/\s+/).filter(Boolean).map((word, index) => {
            const shown = spring({ frame: frame - start - 2 * at++, fps, config: { damping: 200 }, durationInFrames: Math.round(0.4 * fps) });
            return (
              <span key={index} style={{ display: "inline-block", whiteSpace: "pre", opacity: shown, transform: `translateY(${interpolate(shown, [0, 1], [0.3, 0])}em)` }}>
                {index > 0 ? ` ${word}` : word}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** A scene's caption: it springs in from its edge once the scene has come in through the transition. */
export const Caption = ({ caption, enter, fonts, dir }: { caption: CaptionProps; enter: number; fonts: Font[]; dir: "ltr" | "rtl" }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const start = enter + DELAY;
  const shown = spring({ frame: frame - start, fps, config: { damping: 200 }, durationInFrames: Math.round(0.5 * fps) });
  const rise = interpolate(shown, [0, 1], [caption.position === "bottom" ? 0.03 : -0.03, 0]) * width;
  return (
    <AbsoluteFill style={{ opacity: shown, transform: `translateY(${rise}px)` }}>
      {LIVE_TEXT ? <Words picture={caption} start={start} fonts={fonts} dir={dir} size={Math.round(width * 0.07)} /> : <Layer file={caption.file} />}
    </AbsoluteFill>
  );
};
