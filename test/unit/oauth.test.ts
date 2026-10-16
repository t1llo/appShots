import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { tmpData } from "../helpers/tmp-data.ts";

// The rules of src/oauth one at a time: which addresses a token, a redirect or a client id may be, which addresses the
// server fetches from, how the token endpoint tells apps apart, and how long an app's document is kept. The modules
// read their settings and oauth.json when first imported, so they are imported once the environment points at a
// throwaway directory. Every app and address is made up, and nothing goes out on the network.

const data = await tmpData("oauth");
after(() => data.remove());
for (const name of Object.keys(process.env)) if (/^(GOOGLE_|UMAMI_|USER_)|^(ADMIN_EMAIL|PUBLIC_URL|ALLOWED_HOSTS|TRUST_PROXY|HOST|PORT)$/.test(name)) delete process.env[name];
Object.assign(process.env, { DATA_DIR: data.dir, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", ADMIN_EMAIL: "admin@example.com" });
const { canonicalResource, challenge, covers } = await import("../../src/oauth/metadata.ts");
const { authenticate, clientDirectory, documentIdProblem, redirectFor, redirectProblem, register } = await import("../../src/oauth/clients.ts");
const { FetchError, fetchJson, isPrivateAddress } = await import("../../src/oauth/fetch.ts");
const { OAuthError, PageError } = await import("../../src/oauth/errors.ts");

const ORIGIN = "https://appshots.example.com";
const CALLBACK = "https://app.example.com/callback";

const failsWith = (code: string) => (error: unknown) => error instanceof OAuthError && error.error === code;

test("a resource is the server's origin or its MCP endpoint, however its scheme and host are written", () => {
  assert.equal(canonicalResource(ORIGIN, ORIGIN), ORIGIN);
  assert.equal(canonicalResource(`${ORIGIN}/`, ORIGIN), ORIGIN);
  assert.equal(canonicalResource(`${ORIGIN}/mcp`, ORIGIN), `${ORIGIN}/mcp`);
  assert.equal(canonicalResource(`${ORIGIN}/mcp/`, ORIGIN), `${ORIGIN}/mcp`);
  assert.equal(canonicalResource("HTTPS://AppShots.Example.com/mcp", ORIGIN), `${ORIGIN}/mcp`);
  assert.equal(canonicalResource("https://appshots.example.com:443/mcp", ORIGIN), `${ORIGIN}/mcp`);
  for (const other of [
    "https://other.example.com/mcp",
    "http://appshots.example.com/mcp",
    "https://appshots.example.com:8443/mcp",
    `${ORIGIN}/api`,
    `${ORIGIN}/mcp?x=1`,
    `${ORIGIN}/mcp#x`,
    `${ORIGIN}/mcp#`,
    "https://user:pass@appshots.example.com/mcp",
    "/mcp",
    "not an address",
  ]) {
    assert.equal(canonicalResource(other, ORIGIN), null, other);
  }
});

test("a token for the MCP endpoint reaches that only, and one for the server reaches everything", () => {
  assert.equal(covers(ORIGIN, ORIGIN, "/api/projects"), true);
  assert.equal(covers(ORIGIN, ORIGIN, "/mcp"), true);
  assert.equal(covers(`${ORIGIN}/mcp`, ORIGIN, "/mcp"), true);
  for (const path of ["/api/projects", "/files/p1/shots/home.png", "/mcpx", "/"]) assert.equal(covers(`${ORIGIN}/mcp`, ORIGIN, path), false, path);
  // A token given out under another address of the server, such as before PUBLIC_URL was set, is not good here.
  assert.equal(covers("http://localhost:8080/mcp", ORIGIN, "/mcp"), false);

  assert.equal(challenge(ORIGIN, "/mcp", false), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="mcp"`);
  assert.equal(challenge(ORIGIN, "/api/projects", true), `Bearer error="invalid_token", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="mcp"`);
});

test("a redirect URI is https, http on this machine, or a native app's own scheme", () => {
  for (const uri of [CALLBACK, `${CALLBACK}?from=app`, "http://localhost:8080/cb", "http://127.0.0.1/cb", "http://[::1]:9000/cb", "com.example.app:/oauth", "exampleapp://oauth/callback"]) {
    assert.equal(redirectProblem(uri), null, uri);
  }
  for (const uri of [
    "http://app.example.com/cb",
    "http://localhost.example.com/cb",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,hi",
    "file:///etc/hosts",
    `${CALLBACK}#top`,
    "https://user:secret@app.example.com/cb",
    "/callback",
    "",
    42,
    `https://app.example.com/${"x".repeat(2000)}`,
  ]) {
    assert.notEqual(redirectProblem(uri), null, String(uri));
  }
});

test("a redirect URI matches the app's to the character, but for the port of a loopback address", () => {
  const client = { id: "c1", name: "App", redirectUris: [CALLBACK, "http://127.0.0.1/cb", "http://localhost:8080/cb?x=1"], authMethod: "none" as const, refresh: true };
  assert.equal(redirectFor(client, CALLBACK), CALLBACK);
  assert.equal(redirectFor(client, "http://127.0.0.1:49152/cb"), "http://127.0.0.1:49152/cb");
  assert.equal(redirectFor(client, "http://localhost:49152/cb?x=1"), "http://localhost:49152/cb?x=1");
  for (const uri of [
    "https://app.example.com:8443/callback",
    `${CALLBACK}/`,
    "https://app.example.com/Callback",
    "https://127.0.0.1/cb",
    "http://127.0.0.1:49152/other",
    "http://127.0.0.1:49152/cb#x",
    "http://localhost:49152/cb",
    "http://[::1]:49152/cb",
  ]) {
    assert.equal(redirectFor(client, uri), null, uri);
  }
  // Without one in the request, only an app with a single redirect URI has one to go back to.
  assert.equal(redirectFor(client, undefined), null);
  assert.equal(redirectFor({ ...client, redirectUris: [CALLBACK] }, undefined), CALLBACK);
});

test("a client id document is at an https address on a name, with a path, written the way a parser writes it", () => {
  assert.equal(documentIdProblem("https://app.example.com/oauth/client.json"), null);
  for (const id of [
    "http://app.example.com/client.json",
    "https://app.example.com",
    "https://app.example.com/",
    "https://app.example.com:8443/client.json",
    "https://127.0.0.1/client.json",
    "https://[::1]/client.json",
    "https://user@app.example.com/client.json",
    "https://app.example.com/client.json#x",
    "https://APP.example.com/client.json",
    "https://app.example.com/a/../client.json",
  ]) {
    assert.notEqual(documentIdProblem(id), null, id);
  }
});

test("documents are fetched from public addresses only", async () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "198.51.100.7",
    "::1",
    "::",
    "fd12::1",
    "fe80::1",
    "::127.0.0.1",
    "::a9fe:a9fe",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "localhost",
    "",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["1.2.3.4", "2600::1"]) assert.equal(isPrivateAddress(address), false, address);

  const refusal = (address: string) =>
    fetchJson(address).then(
      () => assert.fail(`${address} was fetched`),
      (error: unknown) => {
        assert.ok(error instanceof FetchError);
        return error.message;
      },
    );
  assert.match(await refusal("http://app.example.com/client.json"), /not https/);
  assert.match(await refusal("https://127.0.0.1/client.json"), /IP address/);
  // The name is resolved by the connection itself, and an answer on this machine ends it before it starts.
  assert.match(await refusal("https://localhost/client.json"), /not on the public internet/);
});

test("a document has five seconds to arrive in full, however steadily it trickles in", async (t) => {
  // A server on this machine stands in for the app's website: the HTTPS request goes to it over plain HTTP instead.
  let trickling!: () => void;
  const started = new Promise<void>((resolve) => (trickling = resolve));
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "max-age=600" });
    if (request.url === "/quick.json") return response.end('{"client_id":"quick"}');
    // A byte every 50 ms keeps the connection busy, and after 2 seconds the document would be complete.
    response.write("{");
    let sent = 0;
    const drip = setInterval(() => {
      if (++sent === 5) trickling();
      if (sent < 40) response.write(" ");
      else response.end("}");
    }, 50);
    response.on("close", () => clearInterval(drip));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  t.mock.method(https, "get", (url: URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) =>
    http.get({ host: "127.0.0.1", port, path: url.pathname, headers: options.headers, agent: false }, callback),
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });

  assert.deepEqual(await fetchJson("https://app.example.com/quick.json"), { body: { client_id: "quick" }, maxAge: 600 });

  const slow = fetchJson("https://app.example.com/slow.json");
  await started;
  t.mock.timers.tick(5000);
  await assert.rejects(slow, (error) => error instanceof FetchError && /within 5 seconds/.test(error.message));
});

test("registering checks what the app says about itself, and gives a secret to an app that wants one", async () => {
  const redirect_uris = [CALLBACK];
  for (const [metadata, code] of [
    [null, "invalid_client_metadata"],
    [[], "invalid_client_metadata"],
    [{}, "invalid_redirect_uri"],
    [{ redirect_uris: [] }, "invalid_redirect_uri"],
    [{ redirect_uris: Array(11).fill(CALLBACK) }, "invalid_redirect_uri"],
    [{ redirect_uris, grant_types: ["client_credentials"] }, "invalid_client_metadata"],
    [{ redirect_uris, grant_types: ["refresh_token"] }, "invalid_client_metadata"],
    [{ redirect_uris, response_types: ["code", "token"] }, "invalid_client_metadata"],
    [{ redirect_uris, token_endpoint_auth_method: "private_key_jwt" }, "invalid_client_metadata"],
    [{ redirect_uris, client_name: 42 }, "invalid_client_metadata"],
  ] as const) {
    await assert.rejects(register(metadata), failsWith(code), JSON.stringify(metadata));
  }

  // RFC 7591 makes a secret the default. Characters that could disguise the name are taken out of it.
  const confidential = await register({ redirect_uris, client_name: "  Spaced\u0000  Name‮ " });
  assert.equal(confidential.token_endpoint_auth_method, "client_secret_basic");
  assert.match(confidential.client_secret as string, /^appshots_cs_/);
  assert.equal(confidential.client_name, "Spaced Name");
  assert.deepEqual(confidential.grant_types, ["authorization_code", "refresh_token"]);
  const open = await register({ redirect_uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code"] });
  assert.equal(open.client_secret, undefined);
  assert.equal(open.client_name, undefined);
});

test("the token endpoint tells apps apart by their id and, for an app that has one, its secret", async () => {
  const confidential = await register({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_basic" });
  const id = confidential.client_id as string;
  const secret = confidential.client_secret as string;
  const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  assert.equal(authenticate(basic(id, secret), {}), id);
  // Both parts of the header are form-encoded (RFC 6749, section 2.3.1).
  assert.equal(authenticate(basic(id, secret.replace(/-/g, "%2D")), {}), id);
  assert.equal(authenticate(undefined, { client_id: id, client_secret: secret }), id);

  const refused = (header: string | undefined, body: Record<string, unknown>, code = "invalid_client") => assert.throws(() => authenticate(header, body), failsWith(code));
  refused(basic(id, "appshots_cs_wrong"), {});
  refused(undefined, { client_id: id });
  refused(undefined, { client_id: id, client_secret: `${secret}x` });
  refused(basic(id, secret), { client_id: "c-another" }, "invalid_request");
  refused("Basic !!!", {});
  refused(undefined, {});
  refused(undefined, { client_id: "c000000000000000000000000" });

  // An app named by its document, and one registered without a secret, are public clients.
  const document = "https://app.example.com/client.json";
  assert.equal(authenticate(undefined, { client_id: document }), document);
  refused(undefined, { client_id: document, client_secret: "something" });
  const open = await register({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
  assert.equal(authenticate(undefined, { client_id: open.client_id }), open.client_id);
});

test("an app's document is kept as long as it says, and fetched again for an address it did not list", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-06-01T00:00:00Z") });
  const address = "https://app.example.com/client.json";
  let document: Record<string, unknown> = { client_id: address, client_name: "Documented App", redirect_uris: [CALLBACK] };
  let maxAge: number | null = null;
  let fetches = 0;
  const directory = clientDirectory(async () => {
    fetches++;
    return { body: document, maxAge };
  });
  const find = (redirectUri?: string) => directory.find(address, "visitor-a", redirectUri);

  const client = await find(CALLBACK);
  assert.deepEqual(client, { id: address, name: "Documented App", redirectUris: [CALLBACK], authMethod: "none", refresh: true, documentHost: "app.example.com" });
  // Without max-age, the copy is used for an hour.
  t.mock.timers.tick(59 * 60_000);
  await find();
  assert.equal(fetches, 1);
  // An address the copy does not list sends the server back to the document, which may list it by now.
  const added = "https://app.example.com/added";
  document = { ...document, redirect_uris: [CALLBACK, added] };
  assert.deepEqual((await find(added)).redirectUris, [CALLBACK, added]);
  assert.equal(fetches, 2);
  // Not more than once a minute, though.
  await find("https://app.example.com/unlisted");
  assert.equal(fetches, 2);
  t.mock.timers.tick(61 * 60_000);
  await find();
  assert.equal(fetches, 3);

  // max-age is followed, from a minute to a day.
  maxAge = 7 * 24 * 3600;
  t.mock.timers.tick(61 * 60_000);
  await find();
  assert.equal(fetches, 4);
  t.mock.timers.tick(23 * 3600_000);
  await find();
  assert.equal(fetches, 4);
  t.mock.timers.tick(2 * 3600_000);
  maxAge = 0;
  await find();
  await find();
  assert.equal(fetches, 6);

  // A document that cannot be used is not asked for again for a minute.
  for (const [broken, reason] of [
    [{ ...document, client_id: "https://app.example.com/other.json" }, /not the address it was fetched from/],
    [{ ...document, client_name: undefined }, /no client_name/],
    [{ ...document, token_endpoint_auth_method: "client_secret_basic" }, /has to be none/],
    [{ ...document, redirect_uris: ["javascript:alert(1)"] }, /cannot be a redirect URI/],
    [[document], /not a JSON object/],
  ] as const) {
    document = broken as Record<string, unknown>;
    const before: number = fetches;
    await assert.rejects(find(), (error) => error instanceof PageError && reason.test(error.message));
    await assert.rejects(find(), PageError);
    assert.equal(fetches, before + 1);
    t.mock.timers.tick(61_000);
  }
});

test("two requests for the same document at once wait for one fetch", async () => {
  const address = "https://app.example.com/shared.json";
  let fetches = 0;
  const answers: (() => void)[] = [];
  const directory = clientDirectory(async () => {
    fetches++;
    await new Promise<void>((resolve) => answers.push(resolve));
    return { body: { client_id: address, client_name: "Shared App", redirect_uris: [CALLBACK] }, maxAge: null };
  });
  const first = directory.find(address, "visitor-d");
  const second = directory.find(address, "visitor-e");
  await new Promise((resolve) => setImmediate(resolve));
  for (const answer of answers) answer();
  assert.equal((await first).name, "Shared App");
  assert.equal((await second).name, "Shared App");
  assert.equal(fetches, 1);
});

test("one visitor can have only so many documents fetched", async () => {
  const directory = clientDirectory(async (address) => ({ body: { client_id: address, client_name: "App", redirect_uris: [CALLBACK] }, maxAge: null }));
  for (let i = 0; i < 20; i++) await directory.find(`https://app.example.com/client-${i}.json`, "visitor-b");
  await assert.rejects(directory.find("https://app.example.com/client-20.json", "visitor-b"), /Too many apps/);
  // Somebody else is not held up, nor is a document fetched already.
  await directory.find("https://app.example.com/client-20.json", "visitor-c");
  await directory.find("https://app.example.com/client-0.json", "visitor-b");
  // A registered app is never fetched.
  await assert.rejects(directory.find("c000000000000000000000000", "visitor-b"), /not registered with appShots/);
});
