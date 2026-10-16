import { Composition } from "remotion";
import { AppPreview } from "./AppPreview";
import { durationOf, EMPTY, type Props } from "./props";

// One composition for every display and language: its size, length and frame rate come from the props it is
// rendered with, such as `npx remotion render src/index.ts AppPreview out/en-iphone.mp4 --props=props/en-iphone.json`.
export const RemotionRoot = () => (
  <Composition
    id="AppPreview"
    component={AppPreview}
    defaultProps={EMPTY}
    calculateMetadata={({ props }: { props: Props }) => ({ durationInFrames: durationOf(props), width: props.width, height: props.height, fps: props.fps })}
  />
);
