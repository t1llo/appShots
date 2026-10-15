import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { png } from "../helpers/images.ts";
import { startServer } from "../helpers/spawn-server.ts";
import { tmpData } from "../helpers/tmp-data.ts";

// How the server answers over HTTP in setups the contract tests do not cover: other settings, other folders.

describe("http", { concurrency: true }, () => {
  test("files are served from a data directory inside a hidden folder", async () => {
    const data = await tmpData("hidden");
    const dir = path.join(data.dir, ".appshots", "data");
    await mkdir(dir, { recursive: true });
    const server = await startServer({ dataDir: dir });
    try {
      const created = await server.fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hidden" }) });
      const { id } = (await created.json()) as { id: string };
      const shot = await server.fetch(`/api/projects/${id}/shots/home`, { method: "PUT", body: new Uint8Array(await png(1320, 2868)) });
      assert.equal(shot.status, 201);
      const { file } = (await shot.json()) as { file: string };
      const served = await server.fetch(`/files/${id}/shots/${file}`);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/png");
    } finally {
      await server.stop();
      await data.remove();
    }
  });
});
