import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.ts";
import { writeFileAtomic } from "../storage/atomic.ts";

// What OAuth leaves on disk: the apps that registered themselves, the codes waiting to be exchanged, and the grants
// people gave. It is oauth.json, next to accounts.json. Codes and tokens are kept as their SHA-256 like API tokens,
// so the file alone lets nobody in. Losing it costs no work: every connected app signs in once more.

/** How a client proves who it is at the token endpoint. "none" is a public client: an app on somebody's machine. */
export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";

/** An app that registered itself at /oauth/register. One that is named by the address of its metadata document is never stored. */
export interface RegisteredClient {
  id: string;
  /** SHA-256 of the secret, for a client that authenticates with one. */
  secretHash?: string;
  /** What the app calls itself. Nobody has checked it. */
  name: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  grantTypes: string[];
  createdAt: string;
  /** When somebody last let it in or it last refreshed a token, to the hour. */
  lastUsedAt?: string;
}

export interface Code {
  hash: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  /** Whether the authorization request named the redirect URI, in which case the token request has to name it again. */
  redirectGiven: boolean;
  /** The PKCE challenge: the SHA-256 of the client's verifier, in base64url. */
  challenge: string;
  resource: string;
  scope: string;
  userId: string;
  /** Whether the client registered for refresh tokens. */
  refresh: boolean;
  expiresAt: number;
  /** Set once the code has been exchanged, to the grant it gave. A second exchange ends that grant. */
  grantId?: string;
}

/** What a person allowed one app: a refresh token that renews itself, and the access tokens it has handed out. */
export interface Grant {
  id: string;
  userId: string;
  clientId: string;
  clientName: string;
  /** The host the app sends people back to, the one thing about it that was checked. Settings shows it. */
  redirectHost: string;
  resource: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string;
  refreshHash?: string;
  refreshExpiresAt?: number;
  /** Refresh tokens that were swapped for new ones. One that comes back was copied, and the grant ends. */
  retired: string[];
  access: { hash: string; expiresAt: number }[];
}

interface State {
  clients: RegisteredClient[];
  codes: Code[];
  grants: Grant[];
}

/** How long an access token works. A leaked one is of use for an hour at most. */
export const ACCESS_TTL = 3600 * 1000;
/** A refresh token runs out after 30 days without use. Every use hands out a new one that starts the 30 days again. */
export const REFRESH_TTL = 30 * 24 * 3600 * 1000;
/** A code is exchanged within seconds of being issued. It works once, and for five minutes. */
export const CODE_TTL = 5 * 60 * 1000;

const MAX_CLIENTS = 1000;
const MAX_GRANTS_PER_USER = 50;
const RETIRED_KEPT = 10;
const DAY = 24 * 3600 * 1000;

const file = path.join(config.dataDir, "oauth.json");

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? value.filter((entry) => entry !== null && typeof entry === "object") : []);

async function load(): Promise<State> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { clients: [], codes: [], grants: [] };
    throw new Error(`Cannot read ${file}: ${(error as Error).message}. Fix the file or its permissions and start again.`);
  }
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {}
  if (saved !== null && typeof saved === "object" && !Array.isArray(saved)) {
    const { clients, codes, grants } = saved as Partial<Record<keyof State, unknown>>;
    return {
      clients: list<RegisteredClient>(clients).map((client) => ({ ...client, redirectUris: list<string>(client.redirectUris), grantTypes: list<string>(client.grantTypes) })),
      codes: list(codes),
      grants: list<Grant>(grants).map((grant) => ({ ...grant, retired: list(grant.retired), access: list(grant.access) })),
    };
  }
  // Nothing in it is worth refusing to start for: the apps connect again. The file is kept for a look.
  const aside = `${file}.damaged-${Date.now()}`;
  await rename(file, aside).catch(() => {});
  console.warn(`${file} is not a valid OAuth file and was moved to ${aside}. Apps connected over OAuth have to be connected again.`);
  return { clients: [], codes: [], grants: [] };
}

const state = await load();

let byAccess = new Map<string, { grant: Grant; expiresAt: number }>();
let byRefresh = new Map<string, Grant>();
let byRetired = new Map<string, Grant>();
let byCode = new Map<string, Code>();

/** Builds the lookups again. Called after anything that adds or removes a code, a grant or a token. */
function reindex(): void {
  byAccess = new Map(state.grants.flatMap((grant) => grant.access.map((entry) => [entry.hash, { grant, expiresAt: entry.expiresAt }] as const)));
  byRefresh = new Map(state.grants.filter((grant) => grant.refreshHash).map((grant) => [grant.refreshHash!, grant]));
  byRetired = new Map(state.grants.flatMap((grant) => grant.retired.map((hash) => [hash, grant] as const)));
  byCode = new Map(state.codes.map((code) => [code.hash, code]));
}

/** Drops what can no longer be used: codes and tokens that ran out, grants with nothing left, apps nobody uses. */
function prune(now = Date.now()): void {
  state.codes = state.codes.filter((code) => code.expiresAt > now);
  for (const grant of state.grants) grant.access = grant.access.filter((entry) => entry.expiresAt > now);
  state.grants = state.grants.filter((grant) => grant.access.length > 0 || (grant.refreshHash && (grant.refreshExpiresAt ?? 0) > now));
  const inUse = new Set([...state.grants.map((grant) => grant.clientId), ...state.codes.map((code) => code.clientId)]);
  // An app that registered and was never let in goes after a day. One that was in use goes half a year after it last
  // was: an app keeps its client id for a long time, and would otherwise be told it is unknown when it comes back.
  state.clients = state.clients.filter((client) => {
    if (inUse.has(client.id)) return true;
    return client.lastUsedAt ? now - Date.parse(client.lastUsedAt) < 180 * DAY : now - Date.parse(client.createdAt) < DAY;
  });
}

let writing: Promise<void> = Promise.resolve();
function save(): Promise<void> {
  prune();
  reindex();
  writing = writing
    .catch(() => {})
    .then(async () => {
      await mkdir(config.dataDir, { recursive: true });
      await writeFileAtomic(file, JSON.stringify(state, null, 2), { mode: 0o600 });
    });
  return writing;
}

/** Saves without anybody waiting. A failure is reported and the change is saved with the next one. */
const saveLater = (what: string) => void save().catch((error: unknown) => console.error(`Could not save ${what}:`, error));

prune();
reindex();

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** A secret of 256 random bits with a prefix that says what it is, so a leaked one can be told apart. */
export const secret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

const recently = (iso: string | undefined) => iso !== undefined && Date.now() - Date.parse(iso) < 3600_000;

// ---------------------------------------------------------------- clients

export const registeredClient = (id: string) => state.clients.find((client) => client.id === id);

/** Stores a client that registered itself, making room among the ones never used when the list is full. */
export async function addClient(client: RegisteredClient): Promise<boolean> {
  prune();
  if (state.clients.length >= MAX_CLIENTS) {
    const unused = state.clients.findIndex((entry) => !entry.lastUsedAt);
    if (unused === -1) return false;
    state.clients.splice(unused, 1);
  }
  state.clients.push(client);
  await save();
  return true;
}

function touchClient(id: string): void {
  const client = registeredClient(id);
  if (client && !recently(client.lastUsedAt)) client.lastUsedAt = new Date().toISOString();
}

// ---------------------------------------------------------------- codes

export async function addCode(code: Code): Promise<void> {
  state.codes.push(code);
  touchClient(code.clientId);
  await save();
}

/** The code with this hash while it lasts, whether or not it has been exchanged already. */
export function findCode(hash: string): Code | undefined {
  const code = byCode.get(hash);
  return code && code.expiresAt > Date.now() ? code : undefined;
}

/** Throws a code away unused, after a token request that got it wrong: the next try has to start over. */
export function dropCode(code: Code): void {
  code.expiresAt = 0;
  saveLater("a code that was thrown away");
}

// ---------------------------------------------------------------- grants and tokens

export interface Issued {
  grant: Grant;
  access: string;
  refresh?: string;
}

/** Hands out a new access token, and a new refresh token in place of the one before. Nothing is awaited. */
function hand(grant: Grant, refresh: boolean): Issued {
  const now = Date.now();
  const access = secret("appshots_at_");
  grant.access.push({ hash: sha256(access), expiresAt: now + ACCESS_TTL });
  if (!refresh) return { grant, access };
  const token = secret("appshots_rt_");
  if (grant.refreshHash) grant.retired = [...grant.retired, grant.refreshHash].slice(-RETIRED_KEPT);
  grant.refreshHash = sha256(token);
  grant.refreshExpiresAt = now + REFRESH_TTL;
  return { grant, access, refresh: token };
}

/**
 * Exchanges a code for a new grant. The code is marked as used before anything is awaited, so two requests with the
 * same code cannot both get through. Returns null for a code that was used already.
 */
export async function grantFromCode(code: Code, redirectHost: string): Promise<Issued | null> {
  if (code.grantId) return null;
  const now = new Date().toISOString();
  const grant: Grant = {
    id: `g${randomBytes(9).toString("hex")}`,
    userId: code.userId,
    clientId: code.clientId,
    clientName: code.clientName,
    redirectHost,
    resource: code.resource,
    scope: code.scope,
    createdAt: now,
    lastUsedAt: now,
    retired: [],
    access: [],
  };
  code.grantId = grant.id;
  const issued = hand(grant, code.refresh);
  state.grants.push(grant);
  // Somebody who connects app after app keeps the 50 they used last.
  const theirs = state.grants.filter((entry) => entry.userId === code.userId).sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));
  for (const old of theirs.slice(0, Math.max(0, theirs.length - MAX_GRANTS_PER_USER))) state.grants.splice(state.grants.indexOf(old), 1);
  touchClient(code.clientId);
  await save();
  return issued;
}

/** The grant a code gave, so that a code that comes back a second time can take it away again. */
export const grantOfCode = (code: Code) => state.grants.find((grant) => grant.id === code.grantId);

/** The grant whose refresh token this is, and whether the token was swapped for a newer one already. */
export function grantByRefresh(token: string): { grant: Grant; retired: boolean } | null {
  const hash = sha256(token);
  const current = byRefresh.get(hash);
  if (current) return (current.refreshExpiresAt ?? 0) > Date.now() ? { grant: current, retired: false } : null;
  const retired = byRetired.get(hash);
  return retired ? { grant: retired, retired: true } : null;
}

/**
 * Swaps the grant's refresh token for a new one, with a new access token. The swap happens before anything is
 * awaited, so the same refresh token sent twice at once renews the grant once and ends it the second time.
 */
export async function renew(grant: Grant): Promise<Issued> {
  const issued = hand(grant, true);
  grant.lastUsedAt = new Date().toISOString();
  touchClient(grant.clientId);
  await save();
  return issued;
}

/** The grant an access token belongs to, while the token lasts. */
export function grantByAccess(token: string): Grant | null {
  const found = byAccess.get(sha256(token));
  if (!found || found.expiresAt <= Date.now()) return null;
  // Coarse on purpose, as for API tokens: a busy app should not rewrite the file on every request.
  if (!recently(found.grant.lastUsedAt)) {
    found.grant.lastUsedAt = new Date().toISOString();
    saveLater("when an app was last used");
  }
  return found.grant;
}

// Every change below is made, and the lookups rebuilt by save(), before anything is awaited.

/** Ends a grant: its refresh token and every access token it handed out stop working at once. */
export async function endGrant(grant: Grant): Promise<void> {
  state.grants = state.grants.filter((entry) => entry !== grant);
  await save();
}

/** Takes back one access token and leaves the rest of its grant. */
export async function dropAccess(token: string): Promise<void> {
  const hash = sha256(token);
  const found = byAccess.get(hash);
  if (!found) return;
  found.grant.access = found.grant.access.filter((entry) => entry.hash !== hash);
  await save();
}

/** The grant behind an access token, whether or not it still works, so that revoking one can check whose it is. */
export const grantOfAccess = (token: string) => byAccess.get(sha256(token))?.grant ?? null;

export const grantsOf = (userId: string) => state.grants.filter((grant) => grant.userId === userId);

/** Ends every grant of an account, for an account that is deleted or whose address went to somebody else. */
export async function endGrantsOf(userId: string): Promise<void> {
  if (!state.grants.some((grant) => grant.userId === userId) && !state.codes.some((code) => code.userId === userId)) return;
  state.grants = state.grants.filter((grant) => grant.userId !== userId);
  state.codes = state.codes.filter((code) => code.userId !== userId);
  await save();
}
