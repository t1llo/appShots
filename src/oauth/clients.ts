import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { allow, safeEqual } from "../accounts.ts";
import { OAuthError, PageError } from "./errors.ts";
import { FetchError, fetchJson } from "./fetch.ts";
import { addClient, type AuthMethod, registeredClient, secret, sha256 } from "./store.ts";

// The apps that connect. An app makes itself known in one of two ways. It registers at /oauth/register (RFC 7591)
// and gets a client id from this server. Or it uses the https address of a JSON document about itself as its client
// id (a client ID metadata document), which the server fetches when the app first sends somebody to sign in. Either
// way the server learns a name it cannot check and the addresses it may send people back to, which it does check.

/** An app as the authorization and token endpoints see it, whichever way it made itself known. */
export interface Client {
  id: string;
  /** What the app calls itself. Empty when it did not say. */
  name: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  /** Whether it asked for refresh tokens. */
  refresh: boolean;
  /** For an app named by the address of its metadata document: the host that publishes the document. */
  documentHost?: string;
}

const GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);
const AUTH_METHODS = new Set<string>(["none", "client_secret_post", "client_secret_basic"]);
/** Schemes that are never an app's way back: they run code, show local files or leave the device unannounced. */
const NO_REDIRECT_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "filesystem:", "view-source:", "ftp:", "ws:", "wss:", "mailto:", "tel:", "sms:"]);

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/**
 * Why an address cannot be a redirect URI, or null when it can. Allowed are https, http on this machine's loopback
 * addresses, and the private-use schemes of native apps (RFC 8252), such as com.example.app:/callback.
 */
export function redirectProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return "A redirect URI has to be a string of up to 2000 characters.";
  const url = URL.parse(value);
  if (!url) return `${value} is not an absolute URI.`;
  if (value.includes("#")) return `${value} has a fragment, which a redirect URI may not have.`;
  if (url.username || url.password) return `${value} has a user name or password in it.`;
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:") return isLoopback(url.hostname) ? null : `${value} uses http on another machine than this one. Use https.`;
  if (NO_REDIRECT_SCHEMES.has(url.protocol)) return `${value} uses a scheme that cannot be a redirect URI.`;
  return null;
}

/** Whether a redirect URI leads back to the person's own machine, where any program could be listening. */
export function isLocalRedirect(uri: string): boolean {
  const url = URL.parse(uri);
  return !url || url.protocol !== "https:";
}

/** The host a redirect URI leads to, or its scheme for a native app's. */
export function redirectHost(uri: string): string {
  const url = URL.parse(uri);
  if (!url) return uri;
  return url.host || url.protocol.replace(/:$/, "");
}

/**
 * The redirect URI of an authorization request, checked against the app's: the very same string, except that on a
 * loopback address the port may differ, since an app on the person's machine listens on whichever port is free
 * (RFC 8252, section 7.3). Without one in the request, the app's only redirect URI. Null when neither holds.
 */
export function redirectFor(client: Client, asked: string | undefined): string | null {
  if (asked === undefined) return client.redirectUris.length === 1 ? client.redirectUris[0]! : null;
  if (client.redirectUris.includes(asked)) return asked;
  const url = URL.parse(asked);
  if (!url || url.protocol !== "http:" || !isLoopback(url.hostname) || asked.includes("#")) return null;
  const portless = (entry: URL) => `${entry.protocol}//${entry.hostname}${entry.pathname}${entry.search}`;
  const matches = client.redirectUris.some((entry) => {
    const known = URL.parse(entry);
    return known !== null && known.protocol === "http:" && portless(known) === portless(url);
  });
  return matches ? asked : null;
}

// ---------------------------------------------------------------- metadata, from a registration or a document

interface Metadata {
  name: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  grantTypes: string[];
}

/** A name to show: no control characters, no runs of spaces, at most 100 characters. */
const cleanName = (value: string) =>
  value
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

const stringList = (value: unknown) => Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** Checks what an app says about itself. `fail` builds the error, which differs for a registration and a document. */
function checkMetadata(input: Record<string, unknown>, document: boolean, fail: (code: string, message: string) => Error): Metadata {
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) throw fail("invalid_redirect_uri", "redirect_uris has to list from 1 to 10 redirect URIs.");
  for (const uri of uris) {
    const problem = redirectProblem(uri);
    if (problem) throw fail("invalid_redirect_uri", problem);
  }
  if (input.client_name !== undefined && typeof input.client_name !== "string") throw fail("invalid_client_metadata", "client_name has to be a string.");
  const name = cleanName((input.client_name as string | undefined) ?? "");
  if (document && !name) throw fail("invalid_client_metadata", "The document has no client_name.");

  const grantTypes = input.grant_types ?? ["authorization_code", "refresh_token"];
  if (!stringList(grantTypes) || !(grantTypes as string[]).every((type) => GRANT_TYPES.has(type)) || !(grantTypes as string[]).includes("authorization_code")) {
    throw fail("invalid_client_metadata", "grant_types has to include authorization_code and may add refresh_token, and nothing else.");
  }
  const responseTypes = input.response_types ?? ["code"];
  if (!stringList(responseTypes) || !(responseTypes as string[]).every((type) => type === "code")) throw fail("invalid_client_metadata", 'response_types may only be ["code"].');

  // RFC 7591 makes client_secret_basic the default. An app named by its document has no secret it could share with
  // this server, so it is a public client.
  const method = input.token_endpoint_auth_method ?? (document ? "none" : "client_secret_basic");
  if (typeof method !== "string" || !AUTH_METHODS.has(method) || (document && method !== "none")) {
    throw fail("invalid_client_metadata", `token_endpoint_auth_method has to be ${document ? "none" : "none, client_secret_post or client_secret_basic"}.`);
  }
  return { name, redirectUris: uris as string[], authMethod: method as AuthMethod, grantTypes: [...new Set(grantTypes as string[])] };
}

// ---------------------------------------------------------------- registration

/** Registers an app (RFC 7591) and answers with what it is registered as, its secret included once. */
export async function register(body: unknown): Promise<Record<string, unknown>> {
  if (!isRecord(body)) throw new OAuthError("invalid_client_metadata", "Send the client metadata as a JSON object.");
  const metadata = checkMetadata(body, false, (code, message) => new OAuthError(code, message));
  const id = `c${randomBytes(12).toString("hex")}`;
  const clientSecret = metadata.authMethod === "none" ? undefined : secret("appshots_cs_");
  const createdAt = new Date();
  const stored = await addClient({
    id,
    ...(clientSecret ? { secretHash: sha256(clientSecret) } : {}),
    ...metadata,
    createdAt: createdAt.toISOString(),
  });
  if (!stored) throw new OAuthError("temporarily_unavailable", "This server has too many apps registered right now. Try again later.", 503);
  return {
    client_id: id,
    client_id_issued_at: Math.floor(createdAt.getTime() / 1000),
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    ...(metadata.name ? { client_name: metadata.name } : {}),
    redirect_uris: metadata.redirectUris,
    grant_types: metadata.grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: metadata.authMethod,
  };
}

// ---------------------------------------------------------------- client ID metadata documents

/** Whether a client id is the address of a metadata document rather than an id this server gave out. */
export const isDocumentId = (id: string) => id.startsWith("https://");

/** Why an address cannot be a client id, or null when it can: https, a name rather than an IP address, a path, nothing else. */
export function documentIdProblem(id: string): string | null {
  const url = URL.parse(id);
  if (!url || url.protocol !== "https:" || id.length > 2000) return "is not an https address";
  if (url.href !== id) return "is not written the way a URL parser writes it back";
  if (url.pathname === "/" || url.hash || url.username || url.password) return "has to have a path and no fragment or password";
  if (url.port) return "has to be on the standard https port";
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) return "has to name a host, not an IP address";
  return null;
}

interface Kept {
  client: Client | null;
  /** Why the document could not be used, when it could not. */
  problem?: string;
  fetchedAt: number;
  until: number;
}

const MAX_DOCUMENTS = 500;
const HOUR = 3600 * 1000;

/** How long a document is kept: as long as it says, from a minute to a day, an hour when it does not say. */
const keepFor = (maxAge: number | null) => (maxAge === null ? HOUR : Math.min(24 * HOUR, Math.max(60_000, maxAge * 1000)));

/** Fetches a metadata document: fetchJson, unless a test stands in for the apps' websites. */
export type DocumentFetcher = (address: string) => Promise<{ body: unknown; maxAge: number | null }>;

/** Reads a metadata document into a client, or into the reason it cannot be one. */
async function readDocument(id: string, fetchDocument: DocumentFetcher): Promise<Kept> {
  const now = Date.now();
  try {
    const { body, maxAge } = await fetchDocument(id);
    if (!isRecord(body)) throw new PageError("The document is not a JSON object.");
    if (body.client_id !== id) throw new PageError("The client_id in the document is not the address it was fetched from.");
    const metadata = checkMetadata(body, true, (_code, message) => new PageError(message));
    const client: Client = {
      id,
      name: metadata.name,
      redirectUris: metadata.redirectUris,
      authMethod: "none",
      refresh: metadata.grantTypes.includes("refresh_token"),
      documentHost: new URL(id).host,
    };
    return { client, fetchedAt: now, until: maxAge === 0 ? now : now + keepFor(maxAge) };
  } catch (error) {
    if (!(error instanceof FetchError || error instanceof PageError)) throw error;
    const problem = error instanceof FetchError ? `appShots could not fetch it: ${error.message}.` : error.message;
    // A document that failed is not asked for again for a minute, whoever asks.
    return { client: null, problem, fetchedAt: now, until: now + 60_000 };
  }
}

/** The apps an authorization request can come from, with the metadata documents fetched so far. */
export function clientDirectory(fetchDocument: DocumentFetcher = fetchJson) {
  const documents = new Map<string, Kept>();
  /** Fetches under way, which a second request for the same document waits for instead of starting its own. */
  const fetching = new Map<string, Promise<Kept>>();
  return {
    /**
     * The app behind a client id. For a metadata document, the copy kept from an earlier fetch while it lasts. One
     * that does not list `redirectUri` is fetched again once it is a minute old, in case the app added the address
     * since. `visitor` is whoever asked, whose fetches are counted: the address of a document is theirs to choose.
     */
    async find(id: string, visitor: string | undefined, redirectUri?: string): Promise<Client> {
      if (!isDocumentId(id)) {
        const client = registeredClient(id);
        if (!client) throw new PageError("This app is not registered with appShots, or its registration ran out. Remove appShots from the app and add it again.");
        return { id: client.id, name: client.name, redirectUris: client.redirectUris, authMethod: client.authMethod, refresh: client.grantTypes.includes("refresh_token") };
      }
      const problem = documentIdProblem(id);
      if (problem) throw new PageError(`The app's client id ${problem}.`);
      const now = Date.now();
      let kept = documents.get(id);
      const stale = kept?.client && redirectUri !== undefined && !redirectFor(kept.client, redirectUri) && now - kept.fetchedAt > 60_000;
      if (!kept || kept.until <= now || stale) {
        let pending = fetching.get(id);
        if (!pending) {
          if (!allow(`client-document:${visitor}`, 20, 10 * 60_000)) throw new PageError("Too many apps were looked up from your address. Wait a few minutes and try again.");
          pending = readDocument(id, fetchDocument).finally(() => fetching.delete(id));
          fetching.set(id, pending);
        }
        kept = await pending;
        documents.delete(id);
        documents.set(id, kept);
        if (documents.size > MAX_DOCUMENTS) documents.delete(documents.keys().next().value!);
      }
      if (!kept.client) throw new PageError(`The app's details at ${id} cannot be used. ${kept.problem}`);
      return kept.client;
    },
  };
}

export type ClientDirectory = ReturnType<typeof clientDirectory>;

// ---------------------------------------------------------------- authenticating at the token endpoint

/** The id and secret of an Authorization: Basic header, which form-encodes both (RFC 6749, section 2.3.1). */
function basicCredentials(header: string): { id: string; secret: string } | null {
  const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  try {
    const unform = (value: string) => decodeURIComponent(value.replace(/\+/g, " "));
    return { id: unform(decoded.slice(0, colon)), secret: unform(decoded.slice(colon + 1)) };
  } catch {
    return null;
  }
}

/**
 * The client id of whoever calls the token or revocation endpoint, once it has proven to be that client: with its
 * secret in a Basic header or in the body, or with nothing for a public client. Throws invalid_client otherwise.
 */
export function authenticate(header: string | undefined, body: Record<string, unknown>): string {
  let id = typeof body.client_id === "string" ? body.client_id : undefined;
  let given = typeof body.client_secret === "string" ? body.client_secret : undefined;
  if (header?.toLowerCase().startsWith("basic ")) {
    const basic = basicCredentials(header);
    if (!basic) throw new OAuthError("invalid_client", "The Basic credentials cannot be read.", 401);
    if (id !== undefined && id !== basic.id) throw new OAuthError("invalid_request", "The client id in the body is not the one in the Authorization header.");
    id = basic.id;
    given = basic.secret;
  }
  if (!id) throw new OAuthError("invalid_client", "Send client_id.", 401);
  if (isDocumentId(id)) {
    if (given) throw new OAuthError("invalid_client", "An app named by its metadata document is a public client and has no secret here.", 401);
    return id;
  }
  const client = registeredClient(id);
  if (!client) throw new OAuthError("invalid_client", "This client is not registered here, or its registration ran out. Register again.", 401);
  if (client.authMethod === "none") return id;
  if (given === undefined || !client.secretHash || !safeEqual(sha256(given), client.secretHash)) throw new OAuthError("invalid_client", "The client secret is wrong or missing.", 401);
  return id;
}
