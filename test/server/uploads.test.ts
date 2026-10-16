import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { bombPng, png } from "../helpers/images.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";
import { type TmpData, tmpData } from "../helpers/tmp-data.ts";

// What the server takes as an upload, and what it shows of the screenshots it keeps. Every picture is made up for
// the test, and the account signs in with a token minted on the spot.

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const upload = (data: Buffer, init: RequestInit = {}): RequestInit => ({ ...init, method: "PUT", body: new Uint8Array(data) });

describe("uploads", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer({ inProcess: true });
  });
  after(() => server?.stop());

  async function createProject(name: string, locales?: string[]): Promise<string> {
    const answer = await server.fetch("/api/projects", json("POST", { name, ...(locales ? { locales } : {}) }));
    assert.equal(answer.status, 201);
    return ((await answer.json()) as { id: string }).id;
  }

  test("a decompression bomb is answered 413 and is not kept (srv-2)", async () => {
    const id = await createProject("Bomb");
    for (const route of [`/api/projects/${id}/shots/bomb`, `/api/projects/${id}/images/bomb`]) {
      const answer = await server.fetch(route, upload(bombPng(16000, 16000)));
      assert.equal(answer.status, 413, route);
      assert.equal(answer.headers.get("cache-control"), "no-store");
      assert.match(((await answer.json()) as { error: string }).error, /16000×16000 pixels, more than any screen has/);
    }
    const detail = (await (await server.fetch(`/api/projects/${id}`)).json()) as { shots: unknown[]; images: unknown[] };
    assert.deepEqual([detail.shots, detail.images], [[], []]);
  });

  test("screenshots of a language the project dropped are listed apart and can be deleted (store-14)", async () => {
    const id = await createProject("Dropped", ["en-US", "fr-FR"]);
    assert.equal((await server.fetch(`/api/projects/${id}/shots/home?locale=fr-FR`, upload(await png(1320, 2868)))).status, 201);
    assert.equal((await server.fetch(`/api/projects/${id}/shots/home`, upload(await png(1320, 2868)))).status, 201);
    assert.equal((await server.fetch(`/api/projects/${id}`, json("PUT", { locales: ["en-US"] }))).status, 200);

    type Detail = { shots: { file: string }[]; orphanedShots: { file: string; locale: string }[] };
    const detail = (await (await server.fetch(`/api/projects/${id}`)).json()) as Detail;
    assert.deepEqual(detail.shots.map((shot) => shot.file), ["home.iphone.png"]);
    assert.deepEqual(detail.orphanedShots.map((shot) => [shot.file, shot.locale]), [["home.iphone.fr-FR.png", "fr-FR"]]);
    // Its file is still sent, for the Studio's thumbnail.
    assert.equal((await server.fetch(`/files/${id}/shots/home.iphone.fr-FR.png`)).status, 200);

    assert.equal((await server.fetch(`/api/projects/${id}/shots/home.iphone.fr-FR.png`, { method: "DELETE" })).status, 204);
    const after = (await (await server.fetch(`/api/projects/${id}`)).json()) as Detail;
    assert.deepEqual(after.orphanedShots, []);
    assert.deepEqual(await readdir(path.join(server.dataDir, "projects", id, "shots")), [".index.json", "home.iphone.png"]);
  });

  test("an unreadable screenshot is named in the warnings, not a failure of the project (store-5)", async (t) => {
    // The server logs it too, in this process.
    t.mock.method(console, "warn", () => {});
    const id = await createProject("Unreadable");
    assert.equal((await server.fetch(`/api/projects/${id}/shots/home`, upload(await png(1320, 2868)))).status, 201);
    await writeFile(path.join(server.dataDir, "projects", id, "shots", "broken.iphone.png"), "not a picture");
    const answer = await server.fetch(`/api/projects/${id}`);
    assert.equal(answer.status, 200);
    const detail = (await answer.json()) as { shots: { file: string }[]; warnings?: string[] };
    assert.deepEqual(detail.shots.map((shot) => shot.file), ["home.iphone.png"]);
    assert.ok(detail.warnings?.some((warning) => warning.includes("broken.iphone.png")), JSON.stringify(detail.warnings));
    assert.equal((await server.fetch(`/api/projects/${id}/shots/broken.iphone.png`, { method: "DELETE" })).status, 204);
    assert.equal(((await (await server.fetch(`/api/projects/${id}`)).json()) as { warnings?: string[] }).warnings, undefined);
  });

  test("the index of a folder is not sent as a file", async () => {
    const id = await createProject("Index");
    assert.equal((await server.fetch(`/api/projects/${id}/shots/home`, upload(await png(1320, 2868)))).status, 201);
    for (const route of [`/files/${id}/shots/.index.json`, `/files/${id}/shots/%2Eindex.json`]) assert.equal((await server.fetch(route)).status, 404, route);
    assert.equal((await server.fetch(`/files/${id}/shots/home.iphone.png`)).status, 200);
  });

  test("moving a Mac window answers with its corner (store-13)", async () => {
    const id = await createProject("Corner", ["en-US", "de-DE"]);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect x="40" y="40" width="1520" height="920" rx="20" fill="#FFFFFF"/></svg>';
    const saved = (await (await server.fetch(`/api/projects/${id}/shots/main`, upload(await sharp(Buffer.from(svg)).png().toBuffer()))).json()) as { file: string; corner?: number };
    assert.ok(saved.corner, JSON.stringify(saved));
    const moved = await server.fetch(`/api/projects/${id}/shots/${saved.file}`, json("PATCH", { locale: "de-DE" }));
    assert.equal(moved.status, 200);
    assert.equal(((await moved.json()) as { corner?: number }).corner, saved.corner);
  });
});

describe("an account's room for uploads", () => {
  let server: TestServer;
  let data: TmpData;
  const token = `appshots_${randomBytes(24).toString("base64url")}`;
  const as = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  before(async () => {
    data = await tmpData("room");
    const tokens = [{ id: "t1", name: "Test", hash: createHash("sha256").update(token).digest("hex"), hint: token.slice(-4), createdAt: "2026-01-01T00:00:00.000Z" }];
    const user = { id: "u1", email: "person@example.com", name: "Person", createdAt: "2026-01-01T00:00:00.000Z", epoch: 1, tokens };
    await writeFile(path.join(data.dir, "accounts.json"), JSON.stringify({ signup: "open", signupChosen: true, allowed: [], users: [user], spent: {} }));
    const env = { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", ADMIN_EMAIL: "admin@example.com", USER_MAX_UPLOADS_MB: "1" };
    server = await startServer({ dataDir: data.dir, env });
  });
  after(async () => {
    await server?.stop();
    await data?.remove();
  });

  test("an upload past it is answered 413, and the usage says how much there is (store-8)", async () => {
    const created = await server.fetch("/api/projects", as(json("POST", { name: "Full" })));
    assert.equal(created.status, 201);
    const { id } = (await created.json()) as { id: string };
    // Noise hardly compresses: 600 KB or so each, so the second does not fit in 1 MB.
    const noise = (seed: number) => sharp({ create: { width: 640, height: 400, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128 + seed, sigma: 60 } } }).png().toBuffer();
    assert.equal((await server.fetch(`/api/projects/${id}/shots/one?device=mac`, as(upload(await noise(0))))).status, 201);
    const refused = await server.fetch(`/api/projects/${id}/shots/two?device=mac`, as(upload(await noise(1))));
    assert.equal(refused.status, 413);
    assert.match(((await refused.json()) as { error: string }).error, /has room for 1 MB\. Delete some to make room\./);
    const usage = (await (await server.fetch("/api/usage", as())).json()) as { shots: number; uploadBytes: number; uploadLimit: number };
    assert.equal(usage.shots, 1);
    assert.equal(usage.uploadLimit, 1024 * 1024);
    assert.ok(usage.uploadBytes > 500_000 && usage.uploadBytes <= usage.uploadLimit, String(usage.uploadBytes));
  });
});
