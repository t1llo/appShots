import { Video } from "@remotion/media";
import { AbsoluteFill, staticFile } from "remotion";
import { Caption } from "./Caption";
import type { Font, Scene as SceneProps } from "./props";

// One scene: its footage, which appShots has already cut, placed and brought to 30 frames a second, with the
// caption on top. `enter` is how many frames the transition into the scene takes.
export const Scene = ({ scene, enter, fonts, dir }: { scene: SceneProps; enter: number; fonts: Font[]; dir: "ltr" | "rtl" }) => (
  <AbsoluteFill>
    <Video src={staticFile(scene.video)} muted style={{ width: "100%", height: "100%" }} />
    {scene.caption ? <Caption caption={scene.caption} enter={enter} fonts={fonts} dir={dir} /> : null}
  </AbsoluteFill>
);
