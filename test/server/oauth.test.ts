import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { type OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { DocumentFetcher } from "../../src/oauth/clients.ts";
import { FetchError } from "../../src/oauth/fetch.ts";
import { startServer, type TestServer } from "../helpers/spawn-server.ts";
import { type TmpData, tmpData } from "../helpers/tmp-data.ts";

// MCP clients such as claude.ai, Claude Desktop and ChatGPT connecting with OAuth: discovery, registration, the
// consent page, codes and tokens, and an MCP client from the SDK going through all of it. The server believes it is
// at https://appshots.example.com, as behind a reverse proxy, and the test sends what is meant for that address to
// it. Accounts, apps and Google are made up: nothing here leaves this machine.

const ORIGIN = "https://appshots.example.com";
const REDIRECT = "https://app.example.com/callback";
const GOOGLE_AUTH_URL = "https://accounts.example.com/o/oauth2/auth";
const SECRET = "0123456789abcdef".repeat(4);
const SESSION_TTL = 30 * 24 * 3600 * 1000;

/** A session cookie as the server seals it. */
function sessionCookie(user: string): string {
  const payload = Buffer.from(JSON.stringify({ u: user, k: 1, _p: "session", _e: Date.now() + SESSION_TTL })).toString("base64url");
  return `appshots_session=${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

/** What a sealed value carries, read without checking its signature. */
const sealedData = (value: string) => JSON.parse(Buffer.from(value.split(".")[0]!, "base64url").toString("utf8"));

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A request with another Host header, which fetch() cannot send. */
function asHost(server: TestServer, host: string, route: string): Promise<number> {
  const { port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: route, headers: { Host: host } }, (response) => {
        response.resume();
        resolve(response.statusCode!);
      })
      .on("error", reject);
  });
}

/** Google's token endpoint as the sign-in calls it: every code is good for an ID token for `person`. */
async function standInForGoogle() {
  const google = { nonce: "", person: { sub: "google-3", email: "three@example.com", name: "Three" }, url: "", close: () => {} };
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const server = http.createServer((req, res) => {
    req.resume().on("end", () => {
      const claims = { iss: "https://accounts.google.com", aud: "test-client", nonce: google.nonce, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...google.person };
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id_token: `${part({ alg: "none" })}.${part(claims)}.` }));
    });
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  google.url = `http://127.0.0.1:${(server.address() as { port: number }).port}/token`;
  google.close = () => server.close();
  return google;
}

/** What an MCP client keeps between runs, in memory: its registration, its tokens and the page it last opened. */
class Memory implements OAuthClientProvider {
  readonly redirectUrl = REDIRECT;
  readonly clientMetadata: OAuthClientMetadata;
  readonly clientMetadataUrl: string | undefined;
  information: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = "";
  opened: URL | undefined;
  constructor(name: string, clientMetadataUrl?: string) {
    this.clientMetadata = { client_name: name, redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
    this.clientMetadataUrl = clientMetadataUrl;
  }
  clientInformation() {
    return this.information;
  }
  saveClientInformation(information: OAuthClientInformationMixed) {
    this.information = information;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.opened = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

describe("OAuth for MCP clients", () => {
  let server: TestServer;
  let data: TmpData;
  let google: Awaited<ReturnType<typeof standInForGoogle>>;
  // The apps' websites, for apps named by the address of their metadata document.
  const documents = new Map<string, unknown>();
  const fetched: string[] = [];
  const fetchClientDocument: DocumentFetcher = async (address) => {
    fetched.push(address);
    if (!documents.has(address)) throw new FetchError("it answered 404");
    return { body: documents.get(address), maxAge: null };
  };

  before(async () => {
    data = await tmpData("oauth");
    google = await standInForGoogle();
    const account = (id: string, email: string) => ({ id, email, name: email.split("@")[0], createdAt: "2026-01-01T00:00:00.000Z", epoch: 1, tokens: [] });
    const users = [account("u1", "person@example.com"), account("u2", "two@example.com"), account("u3", "gone@example.com")];
    await writeFile(path.join(data.dir, "accounts.json"), JSON.stringify({ signup: "open", signupChosen: true, allowed: [], users, spent: {} }));
    await writeFile(path.join(data.dir, "secret.key"), SECRET);
    server = await startServer({
      dataDir: data.dir,
      inProcess: true,
      deps: { fetchClientDocument },
      env: {
        GOOGLE_CLIENT_ID: "test-client",
        GOOGLE_CLIENT_SECRET: "test-secret",
        GOOGLE_AUTH_URL,
        GOOGLE_TOKEN_URL: google.url,
        ADMIN_EMAIL: "admin@example.com",
        PUBLIC_URL: ORIGIN,
        ALLOWED_HOSTS: "studio.test",
        RENDER_PREWARM: "off",
      },
    });
  });
  after(async () => {
    await server?.stop();
    google?.close();
    await data?.remove();
  });

  /** fetch() at the server's public address, which leads to the test's server. */
  const viaPublic = (url: string | URL, init?: RequestInit) => {
    const target = new URL(url);
    if (target.origin !== ORIGIN) throw new Error(`The client went to ${target.origin}, which is not the server.`);
    return fetch(`${server.url}${target.pathname}${target.search}`, init);
  };

  const listTools = (headers: Record<string, string> = {}) =>
    server.fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

  const registration = (metadata: Record<string, unknown> = {}) =>
    server.fetch("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Test App", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", ...metadata }),
    });

  async function register(metadata: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const response = await registration(metadata);
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }

  interface Asking {
    clientId: string;
    challenge: string;
    redirectUri?: string;
    state?: string;
    resource?: string;
  }

  const authorizeQuery = ({ clientId, challenge, redirectUri = REDIRECT, state = "state-1", resource = `${ORIGIN}/mcp` }: Asking) =>
    new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state, resource, scope: "mcp" });

  /** The authorization page for a request, as `user` sees it. */
  const consentPage = (query: URLSearchParams, user = "u1") => server.fetch(`/oauth/authorize?${query}`, { headers: { Cookie: sessionCookie(user) }, redirect: "manual" });

  const sealedOf = (html: string) => html.match(/name="request" value="([^"]+)"/)![1]!;

  const sendAnswer = (sealed: string, decision: string, { user = "u1", origin = ORIGIN } = {}) =>
    server.fetch("/oauth/authorize", {
      method: "POST",
      headers: { Cookie: sessionCookie(user), Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: sealed, decision }),
      redirect: "manual",
    });

  /** Answers the page and returns where the browser is sent back to. */
  async function answer(html: string, decision: "allow" | "deny", user = "u1"): Promise<URL> {
    const response = await sendAnswer(sealedOf(html), decision, { user });
    assert.equal(response.status, 303, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    return new URL(response.headers.get("location")!);
  }

  /** Lets the app in as `user` and returns the code it gets. */
  async function codeFor(asking: Asking, user = "u1"): Promise<string> {
    const page = await consentPage(authorizeQuery(asking), user);
    assert.equal(page.status, 200, await page.clone().text());
    const back = await answer(await page.text(), "allow", user);
    return back.searchParams.get("code")!;
  }

  const tokenRequest = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
    server.fetch("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) });

  const revokeRequest = (fields: Record<string, string>) =>
    server.fetch("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

  /** Goes through the whole flow for a public client and returns the tokens. */
  async function connect(clientId: string, { user = "u1", resource = `${ORIGIN}/mcp` } = {}): Promise<Record<string, any>> {
    const { verifier, challenge } = pkce();
    const code = await codeFor({ clientId, challenge, resource }, user);
    const response = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }

  async function oauthError(response: Response, status: number, error: string): Promise<void> {
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).error, error);
  }

  test("the server tells an MCP client where to sign in", async () => {
    const refused = await listTools();
    assert.equal(refused.status, 401);
    assert.equal(refused.headers.get("www-authenticate"), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="mcp"`);
    assert.deepEqual(await refused.json(), { error: "Unauthorized: send Authorization: Bearer <token>" });
    const unknown = await listTools(bearer("appshots_at_unknown"));
    assert.equal(unknown.headers.get("www-authenticate"), `Bearer error="invalid_token", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="mcp"`);
    const api = await server.fetch("/api/projects");
    assert.equal(api.headers.get("www-authenticate"), `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="mcp"`);

    const forMcp = await server.fetch("/.well-known/oauth-protected-resource/mcp");
    assert.equal(forMcp.headers.get("cache-control"), "no-store");
    assert.equal(forMcp.headers.get("access-control-allow-origin"), "*");
    const resource = await forMcp.json();
    assert.equal(resource.resource, `${ORIGIN}/mcp`);
    assert.deepEqual(resource.authorization_servers, [ORIGIN]);
    assert.deepEqual(resource.scopes_supported, ["mcp"]);
    assert.equal((await (await server.fetch("/.well-known/oauth-protected-resource")).json()).resource, ORIGIN);

    const metadata = await (await server.fetch("/.well-known/oauth-authorization-server")).json();
    assert.equal(metadata.issuer, ORIGIN);
    assert.equal(metadata.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
    assert.equal(metadata.token_endpoint, `${ORIGIN}/oauth/token`);
    assert.equal(metadata.registration_endpoint, `${ORIGIN}/oauth/register`);
    assert.equal(metadata.revocation_endpoint, `${ORIGIN}/oauth/revoke`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
    assert.equal(metadata.client_id_metadata_document_supported, true);
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);

    // An app in a browser asks first whether it may call the token endpoint.
    const preflight = await server.fetch("/oauth/token", { method: "OPTIONS", headers: { Origin: "https://app.example.com", "Access-Control-Request-Method": "POST" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

    // The names the server answers to are the same as for everything else of an account's.
    for (const route of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp", "/oauth/authorize"]) {
      assert.equal(await asHost(server, "rebound.example.com", route), 403, route);
      assert.notEqual(await asHost(server, "studio.test", route), 403, route);
    }
  });

  test("an app is let in once, and its token opens the MCP endpoint and nothing else", async () => {
    const app = await register();
    assert.match(app.client_id, /^c[0-9a-f]{24}$/);
    assert.equal(app.client_secret, undefined);
    assert.equal(app.token_endpoint_auth_method, "none");
    const { verifier, challenge } = pkce();
    const query = authorizeQuery({ clientId: app.client_id, challenge });

    // Nobody is signed in: the browser goes to sign in first, and is to come back to this very request.
    const away = await server.fetch(`/oauth/authorize?${query}`, { redirect: "manual" });
    assert.equal(away.status, 302);
    const signIn = new URL(away.headers.get("location")!, ORIGIN);
    assert.equal(signIn.pathname, "/auth/google");
    assert.equal(signIn.searchParams.get("next"), `/oauth/authorize?${query}`);

    const page = await consentPage(query);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.match(page.headers.get("content-security-policy")!, /default-src 'none'.*frame-ancestors 'none'/);
    const html = await page.text();
    assert.match(html, /Let Test App use your appShots account\?/);
    assert.match(html, /signed in as <b>person<\/b> \(person@example\.com\)/);
    assert.ok(html.includes(`<code>${REDIRECT}</code>`));
    assert.match(html, /appShots has not checked it/);

    const back = await answer(html, "allow");
    assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
    assert.equal(back.searchParams.get("state"), "state-1");
    assert.equal(back.searchParams.get("iss"), ORIGIN);

    const exchanged = await tokenRequest({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      client_id: app.client_id,
      redirect_uri: REDIRECT,
      resource: `${ORIGIN}/mcp`,
    });
    assert.equal(exchanged.status, 200);
    assert.equal(exchanged.headers.get("cache-control"), "no-store");
    const tokens = await exchanged.json();
    assert.match(tokens.access_token, /^appshots_at_/);
    assert.match(tokens.refresh_token, /^appshots_rt_/);
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.expires_in, 3600);
    assert.equal(tokens.scope, "mcp");

    const listed = await listTools(bearer(tokens.access_token));
    assert.equal(listed.status, 200);
    assert.ok((await listed.json()).result.tools.length > 0);
    // Meant for the MCP endpoint, the token opens nothing else of the account.
    const api = await server.fetch("/api/projects", { headers: bearer(tokens.access_token) });
    assert.equal(api.status, 401);
    assert.match(api.headers.get("www-authenticate")!, /error="invalid_token"/);

    // Each refresh token works once and comes with the next one.
    const renewing = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: app.client_id });
    assert.equal(renewing.status, 200);
    const renewed = await renewing.json();
    assert.notEqual(renewed.refresh_token, tokens.refresh_token);
    assert.equal((await listTools(bearer(renewed.access_token))).status, 200);
    // The one before comes back: somebody copied it, and the grant ends for them and the app alike.
    await oauthError(await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: app.client_id }), 400, "invalid_grant");
    for (const token of [tokens.access_token, renewed.access_token]) assert.equal((await listTools(bearer(token))).status, 401);
    await oauthError(await tokenRequest({ grant_type: "refresh_token", refresh_token: renewed.refresh_token, client_id: app.client_id }), 400, "invalid_grant");
  });

  test("revoking a refresh token ends the grant, and revoking an access token ends that token", async () => {
    const app = await register();
    const first = await connect(app.client_id);
    const second = await (await tokenRequest({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: app.client_id })).json();
    assert.equal((await revokeRequest({ token: first.access_token, client_id: app.client_id })).status, 200);
    assert.equal((await listTools(bearer(first.access_token))).status, 401);
    assert.equal((await listTools(bearer(second.access_token))).status, 200);

    // Another app cannot take this one's tokens away, and learns nothing from trying.
    const other = await register();
    assert.equal((await revokeRequest({ token: second.refresh_token, client_id: other.client_id })).status, 200);
    assert.equal((await listTools(bearer(second.access_token))).status, 200);

    assert.equal((await revokeRequest({ token: second.refresh_token, client_id: app.client_id })).status, 200);
    assert.equal((await listTools(bearer(second.access_token))).status, 401);
    await oauthError(await tokenRequest({ grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: app.client_id }), 400, "invalid_grant");
    assert.equal((await revokeRequest({ token: "appshots_rt_unknown", client_id: app.client_id })).status, 200);
  });

  test("a code works once, and a second try takes back what the first one got", async () => {
    const app = await register();
    const { verifier, challenge } = pkce();
    const code = await codeFor({ clientId: app.client_id, challenge });
    const fields = { grant_type: "authorization_code", code, code_verifier: verifier, client_id: app.client_id, redirect_uri: REDIRECT };
    const tokens = await (await tokenRequest(fields)).json();
    assert.equal((await listTools(bearer(tokens.access_token))).status, 200);

    await oauthError(await tokenRequest(fields), 400, "invalid_grant");
    assert.equal((await listTools(bearer(tokens.access_token))).status, 401);
    await oauthError(await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: app.client_id }), 400, "invalid_grant");
  });

  test("PKCE with S256 is required, and a code needs the verifier of its challenge", async () => {
    const app = await register();
    const { verifier, challenge } = pkce();
    const refusedWith = async (query: URLSearchParams, error: string) => {
      const response = await consentPage(query);
      assert.equal(response.status, 302);
      const back = new URL(response.headers.get("location")!);
      assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
      assert.equal(back.searchParams.get("error"), error);
      assert.equal(back.searchParams.get("state"), "state-1");
      assert.equal(back.searchParams.get("iss"), ORIGIN);
      assert.equal(back.searchParams.get("code"), null);
    };
    const without = authorizeQuery({ clientId: app.client_id, challenge });
    without.delete("code_challenge");
    await refusedWith(without, "invalid_request");
    const plain = authorizeQuery({ clientId: app.client_id, challenge: verifier });
    plain.set("code_challenge_method", "plain");
    await refusedWith(plain, "invalid_request");
    const token = authorizeQuery({ clientId: app.client_id, challenge });
    token.set("response_type", "token");
    await refusedWith(token, "unsupported_response_type");

    const code = await codeFor({ clientId: app.client_id, challenge });
    const fields = { grant_type: "authorization_code", code, client_id: app.client_id, redirect_uri: REDIRECT };
    await oauthError(await tokenRequest({ ...fields, code_verifier: pkce().verifier }), 400, "invalid_grant");
    // A wrong guess uses the code up.
    await oauthError(await tokenRequest({ ...fields, code_verifier: verifier }), 400, "invalid_grant");
    const another = await codeFor({ clientId: app.client_id, challenge });
    await oauthError(await tokenRequest({ ...fields, code: another }), 400, "invalid_grant");
  });

  test("the redirect URI has to be one the app registered, character for character", async () => {
    const other = "https://app.example.com/other";
    const app = await register({ redirect_uris: [REDIRECT, other] });
    const { verifier, challenge } = pkce();
    // One the app did not register: the person reads why, and goes nowhere.
    for (const redirectUri of ["https://elsewhere.example.com/callback", `${REDIRECT}/`, `${REDIRECT}?next=1`, "https://APP.example.com/callback", "http://app.example.com/callback"]) {
      const page = await consentPage(authorizeQuery({ clientId: app.client_id, challenge, redirectUri }));
      assert.equal(page.status, 400, redirectUri);
      assert.equal(page.headers.get("location"), null);
      assert.match(await page.text(), /not one of the addresses it registered/);
    }
    // An app with two has to say which one.
    const unsaid = authorizeQuery({ clientId: app.client_id, challenge });
    unsaid.delete("redirect_uri");
    assert.equal((await consentPage(unsaid)).status, 400);
    const unknown = await consentPage(authorizeQuery({ clientId: "c000000000000000000000000", challenge }));
    assert.equal(unknown.status, 400);
    assert.match(await unknown.text(), /not registered with appShots/);

    // The token request names the same one as the authorization request.
    const code = await codeFor({ clientId: app.client_id, challenge, redirectUri: other });
    await oauthError(await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: app.client_id, redirect_uri: REDIRECT }), 400, "invalid_grant");

    // An app on the person's own machine listens on whichever port is free (RFC 8252).
    const local = await register({ redirect_uris: ["http://127.0.0.1/callback"] });
    const page = await consentPage(authorizeQuery({ clientId: local.client_id, challenge, redirectUri: "http://127.0.0.1:53123/callback" }));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /on your own computer/);
    assert.equal((await consentPage(authorizeQuery({ clientId: local.client_id, challenge, redirectUri: "http://127.0.0.1:53123/other" }))).status, 400);

    // Registration takes no address that cannot be a way back.
    for (const uri of ["javascript:alert(1)", "data:text/html,hi", "http://app.example.com/callback", `${REDIRECT}#top`, "/callback"]) {
      await oauthError(await registration({ redirect_uris: [uri] }), 400, "invalid_redirect_uri");
    }
    await oauthError(await registration({ redirect_uris: [REDIRECT], response_types: ["token"] }), 400, "invalid_client_metadata");
  });

  test("a token is good for the resource it was asked for, and no other", async () => {
    const app = await register();
    const { challenge } = pkce();
    const elsewhere = await consentPage(authorizeQuery({ clientId: app.client_id, challenge, resource: "https://other.example.com/mcp" }));
    assert.equal(elsewhere.status, 302);
    assert.equal(new URL(elsewhere.headers.get("location")!).searchParams.get("error"), "invalid_target");

    // A token for the whole server opens the REST API as well.
    const whole = await connect(app.client_id, { resource: ORIGIN });
    assert.equal((await server.fetch("/api/projects", { headers: bearer(whole.access_token) })).status, 200);
    assert.equal((await listTools(bearer(whole.access_token))).status, 200);
    await oauthError(await tokenRequest({ grant_type: "refresh_token", refresh_token: whole.refresh_token, client_id: app.client_id, resource: `${ORIGIN}/mcp` }), 400, "invalid_target");

    // A token request cannot widen what the person allowed.
    const second = pkce();
    const code = await codeFor({ clientId: app.client_id, challenge: second.challenge });
    const fields = { grant_type: "authorization_code", code, code_verifier: second.verifier, client_id: app.client_id, redirect_uri: REDIRECT };
    await oauthError(await tokenRequest({ ...fields, resource: ORIGIN }), 400, "invalid_target");
    await oauthError(await tokenRequest({ ...fields, resource: "https://other.example.com/mcp" }), 400, "invalid_target");
  });

  test("the authorization page shows what the app says as text, and only that page can answer it", async () => {
    const app = await register({ client_name: `<script>alert("hi")</script> & Co` });
    const { challenge } = pkce();
    const page = await consentPage(authorizeQuery({ clientId: app.client_id, challenge, state: `"><b>state` }));
    const html = await page.text();
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("Let &lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt; &amp; Co use your appShots account?"));
    const sealed = sealedOf(html);

    // Another site's form, another account, or a changed answer is refused, and nobody is sent anywhere.
    const forged = await sendAnswer(sealed, "allow", { origin: "https://elsewhere.example.com" });
    assert.equal(forged.status, 403);
    assert.equal(forged.headers.get("location"), null);
    assert.equal((await sendAnswer(sealed, "allow", { user: "u2" })).status, 400);
    const changed = Buffer.from(JSON.stringify({ ...sealedData(sealed), redirectUri: "https://elsewhere.example.com/" })).toString("base64url");
    assert.equal((await sendAnswer(`${changed}.${sealed.split(".")[1]}`, "allow")).status, 400);

    // Cancelling tells the app so, with its state.
    const back = await answer(html, "deny");
    assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
    assert.equal(back.searchParams.get("error"), "access_denied");
    assert.equal(back.searchParams.get("state"), `"><b>state`);
    assert.equal(back.searchParams.get("iss"), ORIGIN);
    assert.equal(back.searchParams.get("code"), null);
  });

  test("an app with a secret proves it at the token endpoint", async () => {
    const basic = await register({ token_endpoint_auth_method: "client_secret_basic" });
    assert.match(basic.client_secret, /^appshots_cs_/);
    const { verifier, challenge } = pkce();
    const code = await codeFor({ clientId: basic.client_id, challenge });
    const fields = { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT };
    const credentials = (id: string, secret: string) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;

    await oauthError(await tokenRequest({ ...fields, client_id: basic.client_id }), 401, "invalid_client");
    const wrong = await tokenRequest(fields, { Authorization: credentials(basic.client_id, "appshots_cs_wrong") });
    assert.equal(wrong.headers.get("www-authenticate"), 'Basic realm="appShots"');
    await oauthError(wrong, 401, "invalid_client");
    const right = await tokenRequest(fields, { Authorization: credentials(basic.client_id, basic.client_secret) });
    assert.equal(right.status, 200);
    assert.equal((await listTools(bearer((await right.json()).access_token))).status, 200);

    const post = await register({ token_endpoint_auth_method: "client_secret_post" });
    const second = pkce();
    const postCode = await codeFor({ clientId: post.client_id, challenge: second.challenge });
    const posted = await tokenRequest({ grant_type: "authorization_code", code: postCode, code_verifier: second.verifier, redirect_uri: REDIRECT, client_id: post.client_id, client_secret: post.client_secret });
    assert.equal(posted.status, 200);
  });

  test("the Studio lists the apps an account let in, and disconnects them", async () => {
    const app = await register({ client_name: "Listed App" });
    const tokens = await connect(app.client_id, { user: "u2" });
    const listing = await server.fetch("/api/account/apps", { headers: { Cookie: sessionCookie("u2") } });
    assert.equal(listing.status, 200);
    assert.match(listing.headers.get("cache-control")!, /private/);
    const apps: Record<string, string>[] = await listing.json();
    const entry = apps.find((candidate) => candidate.name === "Listed App")!;
    assert.equal(entry.redirectHost, "app.example.com");
    assert.ok(entry.id && entry.createdAt && entry.lastUsedAt);
    const others: Record<string, string>[] = await (await server.fetch("/api/account/apps", { headers: { Cookie: sessionCookie("u1") } })).json();
    assert.equal(
      others.some((candidate) => candidate.id === entry.id),
      false,
    );

    // Only the browser can: not the app, even with a token for the whole server.
    const whole = await connect(app.client_id, { user: "u2", resource: ORIGIN });
    assert.equal((await server.fetch("/api/account/apps", { headers: bearer(whole.access_token) })).status, 403);

    const removed = await server.fetch(`/api/account/apps/${entry.id}`, { method: "DELETE", headers: { Cookie: sessionCookie("u2"), Origin: ORIGIN } });
    assert.equal(removed.status, 204);
    assert.equal((await listTools(bearer(tokens.access_token))).status, 401);
    await oauthError(await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: app.client_id }), 400, "invalid_grant");
    assert.equal((await listTools(bearer(whole.access_token))).status, 200);
  });

  test("deleting an account ends what its apps were given", async () => {
    const app = await register();
    const tokens = await connect(app.client_id, { user: "u3" });
    assert.equal((await listTools(bearer(tokens.access_token))).status, 200);
    const deleted = await server.fetch("/api/account", {
      method: "DELETE",
      headers: { Cookie: sessionCookie("u3"), Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "gone@example.com" }),
    });
    assert.equal(deleted.status, 204);
    assert.equal((await listTools(bearer(tokens.access_token))).status, 401);
    await oauthError(await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: app.client_id }), 400, "invalid_grant");
  });

  test("signing in with Google on the way brings the person back to the app's request", async () => {
    const app = await register({ client_name: "Round Trip" });
    const query = authorizeQuery({ clientId: app.client_id, challenge: pkce().challenge });
    const signIn = (await server.fetch(`/oauth/authorize?${query}`, { redirect: "manual" })).headers.get("location")!;
    const toGoogle = await server.fetch(signIn, { redirect: "manual" });
    assert.equal(toGoogle.status, 302);
    assert.ok(toGoogle.headers.get("location")!.startsWith(`${GOOGLE_AUTH_URL}?`));
    const pendingCookie = toGoogle.headers.getSetCookie()[0]!.split(";")[0]!;
    const pending = sealedData(pendingCookie.slice("appshots_oauth=".length));
    assert.equal(pending.next, `/oauth/authorize?${query}`);

    google.nonce = pending.nonce;
    const back = await server.fetch(`/auth/google/callback?${new URLSearchParams({ code: "google-code", state: pending.state })}`, { headers: { Cookie: pendingCookie }, redirect: "manual" });
    assert.equal(back.status, 302);
    assert.equal(back.headers.get("location"), `/oauth/authorize?${query}`);
    const session = back.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("appshots_session="))!
      .split(";")[0]!;
    const page = await server.fetch(back.headers.get("location")!, { headers: { Cookie: session } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /signed in as <b>Three<\/b> \(three@example\.com\)/);

    // Back to that page only: anywhere else would make the sign-in an open redirect.
    for (const next of ["https://elsewhere.example.com/oauth/authorize?x=1", "//elsewhere.example.com/oauth/authorize?x=1", "/api/account", `/oauth/authorize?${"x".repeat(2400)}`]) {
      const away = await server.fetch(`/auth/google?${new URLSearchParams({ next })}`, { redirect: "manual" });
      assert.equal(sealedData(away.headers.getSetCookie()[0]!.split(";")[0]!.slice("appshots_oauth=".length)).next, undefined, next);
    }
  });

  const transportFor = (memory: Memory) => new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { authProvider: memory, fetch: viaPublic });

  /** Runs an SDK client to where it sends the person to sign in, lets it in, and hands it the code. */
  async function signInWithSdk(memory: Memory): Promise<URL> {
    const transport = transportFor(memory);
    await assert.rejects(new Client({ name: "oauth-test", version: "1.0.0" }).connect(transport), UnauthorizedError);
    const opened = memory.opened!;
    const page = await consentPage(opened.searchParams);
    assert.equal(page.status, 200, await page.clone().text());
    const back = await answer(await page.text(), "allow");
    assert.equal(back.searchParams.get("iss"), ORIGIN);
    await transport.finishAuth(back.searchParams.get("code")!);
    return opened;
  }

  test("an MCP client from the SDK registers, signs in, connects and renews its token", async () => {
    const memory = new Memory("SDK Client");
    const opened = await signInWithSdk(memory);
    assert.equal(`${opened.origin}${opened.pathname}`, `${ORIGIN}/oauth/authorize`);
    assert.equal(opened.searchParams.get("resource"), `${ORIGIN}/mcp`);
    assert.equal(opened.searchParams.get("code_challenge_method"), "S256");
    assert.match(memory.information!.client_id, /^c[0-9a-f]{24}$/);

    const client = new Client({ name: "oauth-test", version: "1.0.0" });
    await client.connect(transportFor(memory));
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === "list_projects"));
    await client.close();

    // The access token is taken back. The next connection is refused once, and the client renews the token itself.
    const before = memory.saved!;
    assert.equal((await revokeRequest({ token: before.access_token, client_id: memory.information!.client_id })).status, 200);
    const again = new Client({ name: "oauth-test", version: "1.0.0" });
    await again.connect(transportFor(memory));
    assert.ok((await again.listTools()).tools.length > 0);
    await again.close();
    assert.notEqual(memory.saved!.access_token, before.access_token);
    assert.notEqual(memory.saved!.refresh_token, before.refresh_token);
  });

  test("an app named by the address of its metadata document connects without registering", async () => {
    const address = "https://tools.example.com/oauth/client.json";
    const metadata = { client_name: "Documented Client", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
    documents.set(address, { client_id: address, ...metadata });
    const memory = new Memory("Documented Client", address);
    const opened = await signInWithSdk(memory);
    assert.equal(opened.searchParams.get("client_id"), address);
    const client = new Client({ name: "oauth-test", version: "1.0.0" });
    await client.connect(transportFor(memory));
    assert.ok((await client.listTools()).tools.length > 0);
    await client.close();

    // The page says who vouches for the name, and the document is fetched once for both requests.
    const page = await consentPage(authorizeQuery({ clientId: address, challenge: pkce().challenge }));
    assert.match(await page.text(), /published at <b>tools\.example\.com<\/b>/);
    assert.equal(fetched.filter((entry) => entry === address).length, 1);

    // A document that is somebody else's, or missing, or not a document, is not used.
    const copied = "https://tools.example.com/oauth/copied.json";
    documents.set(copied, { client_id: address, ...metadata });
    const missing = "https://tools.example.com/oauth/missing.json";
    for (const [id, reason] of [
      [copied, /not the address it was fetched from/],
      [missing, /could not fetch it: it answered 404/],
      ["https://127.0.0.1/client.json", /has to name a host, not an IP address/],
      ["https://tools.example.com:8443/client.json", /standard https port/],
    ] as const) {
      const refused = await consentPage(authorizeQuery({ clientId: id, challenge: pkce().challenge }));
      assert.equal(refused.status, 400, id);
      assert.match(await refused.text(), reason);
    }
    // An address the document does not list is refused like any other.
    assert.equal((await consentPage(authorizeQuery({ clientId: address, challenge: pkce().challenge, redirectUri: "https://elsewhere.example.com/callback" }))).status, 400);
  });
});

describe("OAuth with sign-in off", () => {
  test("there is nothing to sign in to, and the MCP endpoint stays open", async () => {
    const server = await startServer();
    try {
      for (const route of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/oauth/authorize?client_id=x"]) {
        assert.equal((await server.fetch(route)).status, 404, route);
      }
      for (const route of ["/oauth/register", "/oauth/token", "/oauth/revoke"]) assert.equal((await server.fetch(route, { method: "POST" })).status, 404, route);
      const listed = await server.fetch("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(listed.status, 200);
      assert.equal(listed.headers.get("www-authenticate"), null);
    } finally {
      await server.stop();
    }
  });
});
