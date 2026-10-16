import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { tmpData } from "../helpers/tmp-data.ts";

// An error after part of an answer has gone out. The handler reads the accounts module, which reads its settings
// when it is first imported, so that happens only once the environment points at a throwaway directory.

const data = await tmpData("http-errors");
after(() => data.remove());
for (const name of Object.keys(process.env)) if (/^(GOOGLE_|UMAMI_|USER_)|^(ADMIN_EMAIL|PUBLIC_URL|ALLOWED_HOSTS|TRUST_PROXY|HOST|PORT)$/.test(name)) delete process.env[name];
process.env.DATA_DIR = data.dir;
const { default: express } = await import("express");
const { errorHandler } = await import("../../src/http/errors.ts");
const { writeZip } = await import("../../src/zip.ts");

test("an archive that fails part of the way breaks the connection off rather than end as if it were whole", async () => {
  const logged: unknown[][] = [];
  const log = { log: () => {}, warn: () => {}, error: (...args: unknown[]) => void logged.push(args) };
  const app = express();
  app.get("/archive.zip", async (_req, res) => {
    res.type("zip");
    async function* entries() {
      yield { name: "first.png", data: Buffer.alloc(256 * 1024, 1) };
      throw new Error("The disk went away");
    }
    await writeZip(res, entries());
    res.end();
  });
  app.use(errorHandler(log));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/archive.zip`);
    assert.equal(response.status, 200);
    await assert.rejects(response.arrayBuffer(), "the download fails rather than end short");
    assert.equal(logged.length, 1, "the server's own trouble goes to the log");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
