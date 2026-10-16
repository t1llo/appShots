import { createHash } from "node:crypto";
import { hasAccess, safeEqual, type User, userById } from "../accounts.ts";
import { authenticate, type Client, type ClientDirectory, redirectFor, redirectHost } from "./clients.ts";
import { OAuthError, PageError } from "./errors.ts";
import { canonicalResource, covers, mcpResource, SCOPE } from "./metadata.ts";
import {
  ACCESS_TTL,
  addCode,
  CODE_TTL,
  dropAccess,
  dropCode,
  endGrant,
  findCode,
  grantByAccess,
  grantByRefresh,
  grantFromCode,
  grantOfAccess,
  grantOfCode,
  type Issued,
  renew,
  secret,
  sha256,
} from "./store.ts";

// The authorization code flow of OAuth 2.1 as an MCP client goes through it: an authorization request that a signed-in
// person allows, a code for the app, and tokens for the code. PKCE with S256 is required, and every token is bound to
// the resource it was asked for (RFC 8707), so one meant for the MCP endpoint opens nothing else.

/** One value of a parameter. OAuth parameters may not be repeated, and a repeated one is refused rather than guessed at. */
function one(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new OAuthError("invalid_request", `${name} was sent more than once.`);
  return value;
}

// ---------------------------------------------------------------- the authorization request

/** An authorization request once it has been checked: what the person is asked to allow. */
export interface Asked {
  client: Client;
  redirectUri: string;
  redirectGiven: boolean;
  challenge: string;
  resource: string;
  scope: string;
  state?: string;
}

/** An error to send back to the app at its redirect URI, which by then is known to be its own. */
export class RedirectError extends OAuthError {
  redirectUri: string;
  state?: string;
  constructor(error: string, description: string, redirectUri: string, state?: string) {
    super(error, description);
    this.redirectUri = redirectUri;
    this.state = state;
  }
}

/**
 * Checks an authorization request. Until the client and its redirect URI are known, a problem throws PageError, for
 * the person in the browser to read. After that it throws RedirectError, for the app.
 */
export async function checkAuthorization(query: Record<string, unknown>, origin: string, visitor: string | undefined, clients: ClientDirectory): Promise<Asked> {
  let clientId: string | undefined;
  let asked: string | undefined;
  try {
    clientId = one(query, "client_id");
    asked = one(query, "redirect_uri");
  } catch (error) {
    throw new PageError((error as Error).message);
  }
  if (!clientId) throw new PageError("The app sent no client_id.");
  const client = await clients.find(clientId, visitor, asked);
  const redirectUri = redirectFor(client, asked);
  if (!redirectUri) {
    throw new PageError(
      asked === undefined ? "The app did not say where to send you back to." : `The app asked to send you back to ${asked}, which is not one of the addresses it registered.`,
    );
  }

  let state: string | undefined;
  const fail = (error: string, description: string) => new RedirectError(error, description, redirectUri, state);
  try {
    state = one(query, "state");
    const responseType = one(query, "response_type");
    if (responseType !== "code") throw fail("unsupported_response_type", "response_type has to be code.");
    const challenge = one(query, "code_challenge");
    const method = one(query, "code_challenge_method");
    if (!challenge) throw fail("invalid_request", "code_challenge is required: this server takes PKCE with S256 only.");
    if (method !== "S256") throw fail("invalid_request", "code_challenge_method has to be S256.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw fail("invalid_request", "code_challenge is not the base64url form of a SHA-256.");
    const resource = resourceOf(query, origin) ?? mcpResource(origin);
    return { client, redirectUri, redirectGiven: asked !== undefined, challenge, resource, scope: SCOPE, ...(state !== undefined ? { state } : {}) };
  } catch (error) {
    if (error instanceof RedirectError) throw error;
    if (error instanceof OAuthError) throw fail(error.error, error.message);
    throw error;
  }
}

/**
 * The resource a request names, in its canonical form, or undefined when it names none. An address that is not this
 * server's is invalid_target. Several may be named as long as they are the same.
 */
function resourceOf(params: Record<string, unknown>, origin: string): string | undefined {
  const raw = params.resource;
  if (raw === undefined || raw === "") return undefined;
  const values = (Array.isArray(raw) ? raw : [raw]).map((value) => (typeof value === "string" ? canonicalResource(value, origin) : null));
  if (values.some((value) => value === null)) throw new OAuthError("invalid_target", `This server issues tokens for ${origin}/mcp and ${origin} only.`);
  if (new Set(values).size > 1) throw new OAuthError("invalid_target", "Ask for one resource at a time.");
  return values[0]!;
}

/** What the person is asked to allow, as plain data: the consent page carries it along, sealed, to the answer. */
export interface Approval {
  clientId: string;
  clientName: string;
  refresh: boolean;
  redirectUri: string;
  redirectGiven: boolean;
  challenge: string;
  resource: string;
  scope: string;
  state?: string;
}

export function approvalOf({ client, ...asked }: Asked): Approval {
  return { clientId: client.id, clientName: client.name || redirectHost(asked.redirectUri), refresh: client.refresh, ...asked };
}

/** Issues the code for an allowed request. The code itself goes to the app; the server keeps its hash. */
export async function issueCode(approval: Approval, user: User): Promise<string> {
  const code = secret("");
  await addCode({
    hash: sha256(code),
    clientId: approval.clientId,
    clientName: approval.clientName,
    redirectUri: approval.redirectUri,
    redirectGiven: approval.redirectGiven,
    challenge: approval.challenge,
    resource: approval.resource,
    scope: approval.scope,
    userId: user.id,
    refresh: approval.refresh,
    expiresAt: Date.now() + CODE_TTL,
  });
  return code;
}

// ---------------------------------------------------------------- the token endpoint

/** The answer of the token endpoint (RFC 6749, section 5.1). */
function tokenAnswer({ grant, access, refresh }: Issued) {
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, ...(refresh ? { refresh_token: refresh } : {}), scope: grant.scope };
}

const pkce = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Answers a token request, for the authorization_code and refresh_token grants. */
export async function token(header: string | undefined, body: Record<string, unknown>, origin: string): Promise<Record<string, unknown>> {
  const clientId = authenticate(header, body);
  const grantType = one(body, "grant_type");
  if (grantType === "authorization_code") return tokenAnswer(await exchange(clientId, body, origin));
  if (grantType === "refresh_token") return tokenAnswer(await refresh(clientId, body, origin));
  throw new OAuthError(grantType ? "unsupported_grant_type" : "invalid_request", grantType ? `This server does not take the ${grantType} grant.` : "Send grant_type.");
}

async function exchange(clientId: string, body: Record<string, unknown>, origin: string): Promise<Issued> {
  const value = one(body, "code");
  const verifier = one(body, "code_verifier");
  const redirectUri = one(body, "redirect_uri");
  const resource = resourceOf(body, origin);
  if (!value) throw new OAuthError("invalid_request", "Send code.");
  // Nothing is awaited from here until the grant is made, so a code cannot be exchanged twice.
  const code = findCode(sha256(value));
  if (!code || code.clientId !== clientId) throw new OAuthError("invalid_grant", "The code is not valid, has run out, or was issued to another client.");
  if (code.grantId) {
    // A code that comes back was copied on its way. Whatever it gave the first time is taken back (RFC 6749, 4.1.2).
    const earlier = grantOfCode(code);
    if (earlier) await endGrant(earlier);
    throw new OAuthError("invalid_grant", "The code was used already. The tokens it gave have been revoked.");
  }
  if (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(pkce(verifier), code.challenge)) {
    dropCode(code);
    throw new OAuthError("invalid_grant", "The code_verifier does not match the code_challenge.");
  }
  if ((code.redirectGiven || redirectUri !== undefined) && redirectUri !== code.redirectUri) {
    dropCode(code);
    throw new OAuthError("invalid_grant", "redirect_uri is not the one the code was issued for.");
  }
  if (resource !== undefined && resource !== code.resource) throw new OAuthError("invalid_target", "The resource is not the one the code was issued for.");
  const issued = await grantFromCode(code, redirectHost(code.redirectUri));
  if (!issued) throw new OAuthError("invalid_grant", "The code was used already.");
  return issued;
}

async function refresh(clientId: string, body: Record<string, unknown>, origin: string): Promise<Issued> {
  const value = one(body, "refresh_token");
  const resource = resourceOf(body, origin);
  if (!value) throw new OAuthError("invalid_request", "Send refresh_token.");
  const found = grantByRefresh(value);
  if (!found || found.grant.clientId !== clientId) throw new OAuthError("invalid_grant", "The refresh token is not valid, has run out, or was issued to another client.");
  const { grant, retired } = found;
  if (retired) {
    // Each refresh token works once. One that comes back after it was swapped was copied, and nobody can tell the
    // app from whoever copied it: the grant ends and the person connects the app again (OAuth 2.1, section 4.3.1).
    await endGrant(grant);
    throw new OAuthError("invalid_grant", "The refresh token was used already. The grant has been revoked; connect the app again.");
  }
  const user = userById(grant.userId);
  if (!user || !hasAccess(user)) {
    await endGrant(grant);
    throw new OAuthError("invalid_grant", "The account this grant belongs to can no longer sign in.");
  }
  if (resource !== undefined && resource !== grant.resource) throw new OAuthError("invalid_target", "The resource is not the one the grant was given for.");
  return renew(grant);
}

// ---------------------------------------------------------------- revocation and use

/**
 * Revokes a token (RFC 7009). A refresh token ends its grant with every access token in it; an access token goes on
 * its own. A token that is unknown, or another client's, is left alone, and the answer is the same either way.
 */
export async function revoke(header: string | undefined, body: Record<string, unknown>): Promise<void> {
  const clientId = authenticate(header, body);
  const value = one(body, "token");
  if (!value) throw new OAuthError("invalid_request", "Send token.");
  const byRefresh = grantByRefresh(value);
  if (byRefresh) {
    if (byRefresh.grant.clientId === clientId) await endGrant(byRefresh.grant);
    return;
  }
  if (grantOfAccess(value)?.clientId === clientId) await dropAccess(value);
}

/** The account an OAuth access token acts for, when the token is good and meant for `path` on this server. */
export function userByAccessToken(token: string, origin: string, path: string): User | null {
  const grant = grantByAccess(token);
  if (!grant || !covers(grant.resource, origin, path)) return null;
  const user = userById(grant.userId);
  return user && hasAccess(user) ? user : null;
}
