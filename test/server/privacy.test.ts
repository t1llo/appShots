import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { startServer } from "../helpers/spawn-server.ts";

// The privacy policy as each kind of server hands it out. The Umami address and website id are made up.

const UMAMI = { UMAMI_URL: "https://stats.example.com", UMAMI_WEBSITE_ID: "00000000-0000-4000-8000-000000000000" };

async function privacyOf(env: Record<string, string>): Promise<string> {
  const server = await startServer({ env });
  try {
    const response = await server.fetch("/privacy.md");
    assert.equal(response.status, 200);
    return await response.text();
  } finally {
    await server.stop();
  }
}

describe("the privacy policy", { concurrency: true }, () => {
  test("without analytics it says there are none", async () => {
    const page = await privacyOf({});
    assert.match(page, /This server uses no analytics and no tracking\./);
    assert.doesNotMatch(page, /Umami/);
    assert.doesNotMatch(page, /<!--|\{\{/);
  });

  test("with Umami it names the server and what it counts (docs-1)", async () => {
    const page = await privacyOf(UMAMI);
    assert.match(page, /with Umami, at `stats\.example\.com`/);
    assert.match(page, /\| The Umami server at `stats\.example\.com`/);
    assert.match(page, /`open_studio`/);
    assert.doesNotMatch(page, /records visits/);
    assert.doesNotMatch(page, /no analytics and no tracking/);
    assert.doesNotMatch(page, /<!--|\{\{/);
    assert.ok(!page.includes(UMAMI.UMAMI_WEBSITE_ID));
  });

  test("with the recorder on it says that visits are recorded (mcp-7)", async () => {
    const page = await privacyOf({ ...UMAMI, UMAMI_RECORDER: "on" });
    assert.match(page, /records visits/);
    assert.match(page, /The Studio never loads the recorder/);
    assert.doesNotMatch(page, /<!--|\{\{/);
  });
});
