// Settings for what `npx remotion studio` and `npx remotion render` make in this folder. `appshots video compose
// --engine remotion` passes the codec, colours and audio on its own command line as well, and then encodes the
// result once more to Apple's specification, so a change here shows in the studio before it shows in a preview.
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setOverwriteOutput(true);
Config.setCodec("h264");
Config.setCrf(18);
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
// Each frame passes through a JPEG on its way to the encoder; above Remotion's 80, small caption text stays crisp.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
