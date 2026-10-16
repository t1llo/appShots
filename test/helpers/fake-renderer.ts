import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";
import type { Renderer, Window } from "../../src/render.ts";

// A stand-in for the browser, for tests of what happens around a render: waiting, cancelling, deleting, exporting.
// It loads no page and draws a small picture of one colour for each, as quickly or as slowly as the test needs.
// Everything else, the credits, the queue, the staging folders and putting a run's pictures in place, is the real thing.

export interface FakeRendererOptions {
  /** How long each page takes to load, in milliseconds. */
  delayMs?: number;
  /** Waited for before each page is drawn, so a test can hold a render where it is. */
  gate?: () => Promise<void>;
}

export interface FakeRenderer {
  renderer: Renderer;
  /** The pages loaded so far, by address. */
  loads: string[];
  /** How many windows are open now. */
  open(): number;
}

let picture: Promise<Buffer> | undefined;
const blue = () => (picture ??= sharp({ create: { width: 4, height: 4, channels: 3, background: "#3B82F6" } }).png().toBuffer());

export function fakeRenderer(options: FakeRendererOptions = {}): FakeRenderer {
  const loads: string[] = [];
  let open = 0;
  const renderer: Renderer = async (_space, size) => {
    open++;
    let closed = false;
    const window = {
      // A mockup asks the page where its device is drawn: all of it, here.
      page: { evaluate: async () => ({ left: 0, top: 0, right: size.width, bottom: size.height }) },
      async resize() {},
      async load(url: string) {
        loads.push(url);
        if (options.delayMs) await sleep(options.delayMs);
        await options.gate?.();
      },
      shoot: () => blue(),
      async close() {
        if (closed) return;
        closed = true;
        open--;
      },
    };
    return window as unknown as Window;
  };
  return { renderer, loads, open: () => open };
}
