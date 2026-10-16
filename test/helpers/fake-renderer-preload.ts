// Loaded first into a server process a test starts (startServer's `imports`), so that it draws without a browser.
// FAKE_RENDER_DELAY_MS says how long each page takes to load.

import { useRenderer } from "../../src/render.ts";
import { fakeRenderer } from "./fake-renderer.ts";

useRenderer(fakeRenderer({ delayMs: Number(process.env.FAKE_RENDER_DELAY_MS ?? 0) }).renderer);
