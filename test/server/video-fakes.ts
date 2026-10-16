import sharp from "sharp";
import type { LayerReport } from "../../src/video/cards.ts";
import type { Capture, PageCapturer } from "../../src/video/pages.ts";

// What the video layer tests draw with instead of the browser: plain PNGs of each artboard's size, and a report
// that says every layer fitted, unless a test says otherwise.

export interface FakeCapturer extends PageCapturer {
  /** Every page asked for, in order. */
  calls: Capture[];
  /** Runs before a page is "drawn": to hold it, fail it, or change the disk meanwhile. */
  before?: (capture: Capture) => Promise<void> | void;
  /** The fit a layer reports, by its id. 1 for the others. */
  fits: Record<string, number>;
}

export function fakeCapturer(): FakeCapturer {
  const fake: FakeCapturer = {
    calls: [],
    fits: {},
    async capture(capture) {
      fake.calls.push(capture);
      await fake.before?.(capture);
      const pictures = await Promise.all(
        capture.artboards.map((board) =>
          sharp({ create: { width: board.width, height: board.height, channels: board.opaque ? 3 : 4, background: board.opaque ? "#1E3A8A" : { r: 0, g: 0, b: 0, alpha: 0 } } })
            .png()
            .toBuffer(),
        ),
      );
      const report: LayerReport = Object.fromEntries(capture.artboards.map((board) => [board.id, { box: [10, 20, board.width - 20, 100], fit: fake.fits[board.id] ?? 1, lines: 1 }]));
      return { pictures, report };
    },
  };
  return fake;
}

/** A promise and the function that settles it, for holding a run where a test wants it. */
export function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}
