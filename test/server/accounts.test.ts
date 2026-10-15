import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { startServer } from "../helpers/spawn-server.ts";
import { tmpData } from "../helpers/tmp-data.ts";

// How the server treats its accounts file when it starts and while it runs. Everything here is made up for the
// test: example.com addresses, a token minted on the spot and a sign-in that never reaches Google.

/** The settings that turn sign-in on. No request in these tests goes to Google. */
const SIGN_IN = { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", ADMIN_EMAIL: "admin@example.com" };

async function refusedStart(accounts: (file: string) => Promise<void>): Promise<string> {
  const data = await tmpData("accounts");
  try {
    await accounts(path.join(data.dir, "accounts.json"));
    const error: Error = await startServer({ dataDir: data.dir }).then(
      async (server) => {
        await server.stop();
        throw new Error("The server started");
      },
      (refused: Error) => refused,
    );
    return error.message;
  } finally {
    await data.remove();
  }
}

// Each test has its own server and data directory, so they run side by side.
describe("accounts", { concurrency: true }, () => {
  test("a server whose accounts file cannot be read does not start (srv-7)", async () => {
    const output = await refusedStart((file) => mkdir(file));
    assert.match(output, /Cannot read .*accounts\.json/);
    assert.match(output, /does not start without its accounts/);
  });

  test("a server whose accounts file is not JSON does not start (srv-7)", async () => {
    const output = await refusedStart((file) => writeFile(file, '{"users": ['));
    assert.match(output, /accounts\.json is not a valid accounts file/);
  });

  test("a server whose accounts file holds something else than accounts does not start (srv-7)", async () => {
    const texts = ["[]", "null", '"users"'];
    const outputs = await Promise.all(texts.map((text) => refusedStart((file) => writeFile(file, text))));
    for (const [i, output] of outputs.entries()) assert.match(output, /not a valid accounts file/, texts[i]);
  });

  test("a server without an accounts file starts with none", async () => {
    const server = await startServer({ env: SIGN_IN });
    try {
      assert.equal((await server.fetch("/healthz")).status, 200);
      assert.equal((await server.fetch("/api/projects")).status, 401);
    } finally {
      await server.stop();
    }
  });

  test(
    "a token still works when the disk refuses to note when it was last used (srv-6)",
    { skip: (process.getuid?.() === 0 && "root writes into a read-only folder anyway") || false },
    async () => {
      const data = await tmpData("token");
      const token = `appshots_${randomBytes(24).toString("base64url")}`;
      const user = {
        id: "u1",
        email: "person@example.com",
        name: "Person",
        createdAt: "2026-01-01T00:00:00.000Z",
        epoch: 0,
        tokens: [{ id: "t1", name: "Test", hash: createHash("sha256").update(token).digest("hex"), hint: token.slice(-4), createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }],
      };
      await writeFile(path.join(data.dir, "accounts.json"), JSON.stringify({ signup: "open", signupChosen: true, allowed: [], users: [user], spent: {} }));
      await writeFile(path.join(data.dir, "secret.key"), randomBytes(32).toString("hex"));
      // Nothing more can be written to the data directory, so saving the date fails.
      await chmod(data.dir, 0o555);
      const server = await startServer({ dataDir: data.dir, env: SIGN_IN });
      try {
        const headers = { Authorization: `Bearer ${token}` };
        assert.equal((await server.fetch("/api/projects", { headers })).status, 200);
        // Nobody waits for the save, so its failure shows a moment later.
        for (let tries = 0; tries < 100 && !server.output().includes("Could not save when a token was last used"); tries++) await sleep(20);
        assert.match(server.output(), /Could not save when a token was last used/);
        // Still up and still letting the token in.
        assert.equal((await server.fetch("/api/usage", { headers })).status, 200);
        assert.equal((await server.fetch("/healthz")).status, 200);
      } finally {
        await server.stop();
        await chmod(data.dir, 0o755);
        await data.remove();
      }
    },
  );
});
