import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.ts";
import { endGrantsOf } from "./oauth/store.ts";
import { writeFileAtomic } from "./storage/atomic.ts";
import { InputError, NotFoundError, type Space } from "./store.ts";

// Everybody signs in with Google. The admin is the address in ADMIN_EMAIL and works in the server's own space,
// directly under the data directory. Everyone else is an account in accounts.json with a private directory
// under users/<id>. Anyone with a Google account gets in, unless the admin has narrowed sign-in to a list.

export type SignupMode = "list" | "open";

export interface ApiToken {
  id: string;
  name: string;
  /** SHA-256 of the token; the token itself is shown once and never stored. */
  hash: string;
  hint: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  /** Google's lasting id for the account. Missing only on accounts from before sign-in became Google only. */
  googleSub?: string;
  createdAt: string;
  /** Bumped to end every session. */
  epoch: number;
  tokens: ApiToken[];
  /** Renders this account has made. */
  renders?: number;
  /** How many it may make in all, once the admin has set that for this account. Otherwise USER_RENDER_CREDITS. */
  renderAllowance?: number;
}

/** What is kept of a deleted account, so deleting it and signing in again does not hand out the renders anew. */
interface Spent {
  renders: number;
  renderAllowance?: number;
}

interface State {
  signup: SignupMode;
  /** True once the admin has picked `signup` on the Admin page. */
  signupChosen: boolean;
  /** The addresses that may sign in while `signup` is "list". The admin is not on it and does not need to be. */
  allowed: string[];
  users: User[];
  /** By the SHA-256 of the Google id an account was signed in with. Nothing else of the account stays. */
  spent: Record<string, Spent>;
}

/** A sign-in that is refused; `code` names the case for the home page. */
export class AuthError extends Error {
  code: string;
  constructor(message: string, code = "denied") {
    super(message);
    this.code = code;
  }
}

const file = path.join(config.dataDir, "accounts.json");

const REFUSED = "The server does not start without its accounts, because the first sign-in would save an empty list over them.";

/**
 * The accounts as they were last saved. Only a missing file means a server nobody has signed in to yet. A file that
 * cannot be read or understood stops the start instead: running on with no accounts, the first sign-in would save
 * that empty list over everybody's accounts, tokens and renders.
 */
async function load(): Promise<Partial<State>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read ${file}: ${(error as Error).message}. ${REFUSED} Fix the file or its permissions and start again.`);
  }
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {}
  if (saved === null || typeof saved !== "object" || Array.isArray(saved)) {
    throw new Error(`${file} is not a valid accounts file. ${REFUSED} Restore it from a backup, or remove it to start with no accounts.`);
  }
  return saved as Partial<State>;
}

const saved = await load();
// Open unless the admin narrowed it. Earlier versions wrote their own default into the file ("invite", then "list"),
// so a list counts only when the admin picked it or put somebody on it.
const signupChosen = saved.signupChosen === true;
const listInUse = signupChosen || (Array.isArray(saved.allowed) && saved.allowed.length > 0);
const state: State = {
  signup: saved.signup === "list" && listInUse ? "list" : "open",
  signupChosen,
  allowed: Array.isArray(saved.allowed) ? saved.allowed : [],
  users: Array.isArray(saved.users) ? saved.users : [],
  spent: saved.spent && typeof saved.spent === "object" ? saved.spent : {},
};
// Passwords are gone; their hashes have no business staying in the file.
for (const user of state.users) delete (user as { password?: string }).password;

/** Every token by its hash, so a request with a token finds its account at once rather than walking all of them. */
let tokenIndex = new Map<string, { user: User; entry: ApiToken }>();
/** Builds the index again. Called after anything that adds, removes or takes away tokens or accounts. */
function indexTokens(): void {
  tokenIndex = new Map(state.users.flatMap((user) => user.tokens.map((entry) => [entry.hash, { user, entry }] as const)));
}
indexTokens();

let writing: Promise<void> = Promise.resolve();
function save(): Promise<void> {
  writing = writing
    .catch(() => {})
    .then(async () => {
      await mkdir(config.dataDir, { recursive: true });
      await writeFileAtomic(file, JSON.stringify(state, null, 2), { mode: 0o600 });
    });
  return writing;
}

/** Resolves once every change made so far is in the file, for a server about to stop. */
export const accountsSaved = () => writing.catch(() => {});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const randomId = (prefix: string) => `${prefix}${randomBytes(9).toString("hex")}`;

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("Enter a valid email address.");
  return email;
}

const cleanName = (value: unknown, email: string) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : email.split("@")[0]!);

// ---------------------------------------------------------------- who gets in

export const isAdmin = (user: User) => config.adminEmail !== "" && user.email === config.adminEmail;

const admitted = (email: string) => email === config.adminEmail || state.signup === "open" || state.allowed.includes(email);

/** Whether the account can be used right now. Taking an address off the list locks its sessions and tokens at once. */
export const hasAccess = (user: User) => admitted(user.email);

export const signupMode = () => state.signup;

export async function setSignupMode(mode: SignupMode): Promise<void> {
  state.signup = mode;
  state.signupChosen = true;
  await save();
}

export const listAllowed = () => state.allowed;

export async function allowEmail(input: unknown): Promise<void> {
  const email = normalizeEmail(input);
  if (email === config.adminEmail || state.allowed.includes(email)) return;
  if (state.allowed.length >= 2000) throw new InputError("The list is full. Remove someone first.");
  state.allowed.push(email);
  await save();
}

const ADMIN_STAYS = "The admin is set with ADMIN_EMAIL on the server and cannot be removed here.";

/** Takes an address off the list and removes the account behind it, with everything it owns. `stop` is as for deleteUser. */
export async function removePerson(input: unknown, stop?: Stop): Promise<void> {
  const email = normalizeEmail(input);
  if (email === config.adminEmail) throw new InputError(ADMIN_STAYS);
  state.allowed = state.allowed.filter((entry) => entry !== email);
  const user = byEmail(email);
  if (user) await deleteUser(user.id, stop);
  else await save();
}

// ---------------------------------------------------------------- spaces

/** The server's own space: the admin's, and everybody's while sign-in is off. */
export const mainSpace: Space = { id: "main", root: config.dataDir };

const userRoot = (id: string) => path.join(config.dataDir, "users", id);
export const spaceOfUser = (user: User): Space => (isAdmin(user) ? mainSpace : { id: user.id, root: userRoot(user.id), limits: config.limits });

/**
 * The folder an account has of its own, by its address. The admin's too, which holds what the admin made before
 * ADMIN_EMAIL named them and which the admin does not work in. Null for an address nobody has signed in with.
 */
export function ownSpaceOf(input: unknown): Space | null {
  const user = byEmail(normalizeEmail(input));
  return user ? { id: user.id, root: userRoot(user.id), limits: config.limits } : null;
}

/** Resolves the id the renderer passes along with its internal secret. */
export function spaceById(id: string | undefined): Space | null {
  if (id === mainSpace.id) return mainSpace;
  const user = state.users.find((entry) => entry.id === id);
  return user ? spaceOfUser(user) : null;
}

// ---------------------------------------------------------------- signed values (sessions, OAuth state)

const sign = (payload: string) => createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");

/** Packs `data` into a tamper-proof string that stops being valid after `ttlMs`. */
export function seal(purpose: string, data: Record<string, unknown>, ttlMs: number): string {
  const payload = Buffer.from(JSON.stringify({ ...data, _p: purpose, _e: Date.now() + ttlMs })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function unseal<T>(purpose: string, value: string | undefined): T | null {
  const [payload, signature] = (value ?? "").split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data._p === purpose && typeof data._e === "number" && data._e > Date.now() ? (data as T) : null;
  } catch {
    return null;
  }
}

export const SESSION_TTL = 30 * 24 * 3600 * 1000;

export const userSession = (user: User) => seal("session", { u: user.id, k: user.epoch }, SESSION_TTL);

/**
 * A session lasts 30 days from the last visit, not from the sign-in. Returns the cookie to replace a good one
 * with once it is more than a day old, so somebody who keeps coming back is never signed out.
 */
export function renewedSession(cookie: string | undefined): string | null {
  const session = unseal<{ _e: number }>("session", cookie);
  if (!session || session._e - Date.now() > SESSION_TTL - 24 * 3600 * 1000) return null;
  const holder = sessionHolder(cookie);
  return holder && userSession(holder);
}

/**
 * Signs the account out of every browser. A copied session cookie would otherwise stay good for 30 days after the
 * sign-out. API tokens are not sessions and keep working; they are revoked one by one.
 */
export async function endSessions(user: User): Promise<void> {
  user.epoch++;
  await save();
}

/** Who a session cookie belongs to, if it is still good. */
export function sessionHolder(cookie: string | undefined): User | null {
  const session = unseal<{ u: string; k: number }>("session", cookie);
  const user = session && state.users.find((entry) => entry.id === session.u);
  return user && user.epoch === session.k && hasAccess(user) ? user : null;
}

// ---------------------------------------------------------------- throttling

const attempts = new Map<string, { count: number; resetAt: number }>();

/** Counts one attempt for `key` and reports whether it is still within `limit` per window. */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (attempts.size > 5000) for (const [entry, value] of attempts) if (value.resetAt <= now) attempts.delete(entry);
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count++;
  return current.count <= limit;
}

// ---------------------------------------------------------------- accounts

const byEmail = (email: string) => state.users.find((user) => user.email === email);

/** The account with this id, for what refers to one by its id: an app's grant. */
export const userById = (id: string) => state.users.find((user) => user.id === id);

/**
 * Signs in a Google identity whose address Google has verified, creating the account on first use.
 * The address decides who somebody is here: it is what the admin put on the list.
 */
export async function logInWithGoogle(profile: { sub: string; email: string; name?: string }): Promise<User> {
  const email = normalizeEmail(profile.email);
  if (!admitted(email)) throw new AuthError("This Google account is not on the list of people who can sign in.", "not_allowed");
  const known = state.users.find((user) => user.googleSub === profile.sub);
  if (known) {
    // Google addresses can be renamed. Follow the rename, or the list would keep judging the old address.
    if (known.email !== email && !byEmail(email)) {
      known.email = email;
      await save();
    }
    return known;
  }
  const sameAddress = byEmail(email);
  if (sameAddress) {
    // The address now signs in as a Google identity this account has not seen: an account from the days of
    // passwords, or an address that went to somebody new. Whoever held it before loses their sessions and tokens,
    // and the apps they connected.
    sameAddress.googleSub = profile.sub;
    sameAddress.tokens = [];
    sameAddress.epoch++;
    indexTokens();
    await save();
    await endGrantsOf(sameAddress.id);
    return sameAddress;
  }
  const user: User = { id: randomId("u"), email, name: cleanName(profile.name, email), googleSub: profile.sub, createdAt: new Date().toISOString(), epoch: 1, tokens: [] };
  // Somebody who deleted their account comes back to the renders they had left, not to a fresh set.
  const before = state.spent[sha256(profile.sub)];
  if (before) {
    user.renders = before.renders;
    if (before.renderAllowance != null) user.renderAllowance = before.renderAllowance;
    delete state.spent[sha256(profile.sub)];
  }
  state.users.push(user);
  await save();
  return user;
}

/** Ends what still works for an account's space, such as its renders, once nobody can sign in as it any more. */
type Stop = (space: Space) => Promise<void>;

/**
 * Removes the account with every project, screenshot and render it owns. `stop` ends what is still under way for
 * it before its folder goes.
 */
export async function deleteUser(id: string, stop?: Stop): Promise<void> {
  const user = state.users.find((entry) => entry.id === id);
  if (!user) throw new NotFoundError("No such account");
  // The admin's projects are the server's own space, which no button should be able to wipe.
  if (isAdmin(user)) throw new InputError(ADMIN_STAYS);
  state.users = state.users.filter((entry) => entry !== user);
  indexTokens();
  if (user.googleSub && (user.renders || user.renderAllowance != null)) {
    state.spent[sha256(user.googleSub)] = { renders: user.renders ?? 0, ...(user.renderAllowance != null ? { renderAllowance: user.renderAllowance } : {}) };
  }
  await save();
  await endGrantsOf(user.id);
  await stop?.(spaceOfUser(user));
  await rm(userRoot(user.id), { recursive: true, force: true });
}

export async function confirmDelete(user: User, confirmation: unknown, stop?: Stop): Promise<void> {
  // Addresses are kept in lower case. What is typed may differ in case, or carry a space from a paste.
  if (typeof confirmation !== "string" || confirmation.trim().toLowerCase() !== user.email) throw new InputError("Type your email address to confirm.");
  await deleteUser(user.id, stop);
}

export const listUsers = () => state.users;

/**
 * The folder of projects the admin made with an ordinary account, before ADMIN_EMAIL named them. The admin works
 * in the server's own space, so these stay on disk but out of sight. Null when there are none.
 */
export async function hiddenAdminProjects(): Promise<string | null> {
  const admin = config.auth && config.adminEmail ? byEmail(config.adminEmail) : undefined;
  if (!admin) return null;
  const dir = path.join(userRoot(admin.id), "projects");
  const entries = await readdir(dir).catch(() => []);
  return entries.some((name) => !name.startsWith(".")) ? dir : null;
}

// ---------------------------------------------------------------- render credits

// Every account but the admin's gets a number of renders. One run of the renderer uses one, whatever it draws.
// A run that fails or is cancelled uses none.

/** Renders set aside for runs that are waiting or under way, by account. */
const held = new Map<string, number>();

const allowanceOf = (user: User) => user.renderAllowance ?? config.limits.renders;

/** The account whose renders are counted in a space. The admin's are not, and neither is anybody's while sign-in is off. */
const counted = (spaceId: string) => (config.auth ? state.users.find((user) => user.id === spaceId && !isAdmin(user)) : undefined);

/** How many renders a space has left. Null where they are not counted. */
export function rendersLeft(spaceId: string): number | null {
  const user = counted(spaceId);
  return user ? Math.max(0, allowanceOf(user) - (user.renders ?? 0) - (held.get(user.id) ?? 0)) : null;
}

/** The same for one account, with how many it has made. */
export const rendersOf = (user: User) => ({ made: user.renders ?? 0, left: rendersLeft(user.id) });

/** Why a space cannot start a render now, in the words a render is refused with. Undefined while it can. */
export function outOfRenders(spaceId: string): string | undefined {
  const user = counted(spaceId);
  if (!user || rendersLeft(spaceId) !== 0) return undefined;
  const ask = config.operator.email ? `Write to ${config.operator.email} to get more.` : "The person who runs this server can give it more.";
  return `This account has used all of its ${plural(allowanceOf(user))}. ${ask}`;
}

/**
 * Sets one render aside for a run that is about to be queued, and refuses when none is left. Call what it returns
 * when the run has ended: with true the render is used up, with false it goes back.
 */
export function holdRender(spaceId: string): (used: boolean) => Promise<void> {
  const user = counted(spaceId);
  if (!user) return async () => {};
  const refused = outOfRenders(spaceId);
  if (refused) throw new InputError(refused);
  held.set(user.id, (held.get(user.id) ?? 0) + 1);
  return async (used) => {
    const still = (held.get(user.id) ?? 1) - 1;
    if (still > 0) held.set(user.id, still);
    else held.delete(user.id);
    if (!used) return;
    user.renders = (user.renders ?? 0) + 1;
    await save();
  };
}

const plural = (count: number) => `${count} ${count === 1 ? "render" : "renders"}`;

/** The admin gives an account a number of renders to go, on top of the ones it has made and the ones it is making. */
export async function setRendersLeft(input: unknown, left: number): Promise<void> {
  const email = normalizeEmail(input);
  const user = byEmail(email);
  if (!user) throw new NotFoundError("Nobody has signed in with that address yet.");
  if (isAdmin(user)) throw new InputError("The admin's renders are not counted.");
  // Renders under way are set aside already: leaving them out would give the account fewer than the admin said.
  user.renderAllowance = (user.renders ?? 0) + (held.get(user.id) ?? 0) + left;
  await save();
}

// ---------------------------------------------------------------- API tokens

export function userByToken(token: string): User | null {
  if (!token.startsWith("appshots_")) return null;
  const found = tokenIndex.get(sha256(token));
  if (!found) return null;
  const { user, entry } = found;
  if (!hasAccess(user)) return null;
  // Coarse on purpose: a busy token should not rewrite the accounts file on every request.
  if (!entry.lastUsedAt || Date.now() - Date.parse(entry.lastUsedAt) > 3600_000) {
    entry.lastUsedAt = new Date().toISOString();
    // Nobody waits for this save. If the disk refuses it, the request still goes through and the date is saved
    // with the next change; left uncaught, the failure would stop the whole server.
    save().catch((error: unknown) => console.error("Could not save when a token was last used:", error));
  }
  return user;
}

export const describeToken = ({ id, name, hint, createdAt, lastUsedAt }: ApiToken) => ({ id, name, hint, createdAt, lastUsedAt });

export async function createToken(user: User, nameInput: unknown): Promise<{ token: string; entry: ApiToken }> {
  if (user.tokens.length >= 20) throw new InputError("This account already has 20 tokens. Revoke one first.");
  const name = typeof nameInput === "string" && nameInput.trim() ? nameInput.trim().slice(0, 60) : "Token";
  const token = `appshots_${randomBytes(24).toString("base64url")}`;
  const entry: ApiToken = { id: randomId("t"), name, hash: sha256(token), hint: token.slice(-4), createdAt: new Date().toISOString() };
  user.tokens.push(entry);
  indexTokens();
  await save();
  return { token, entry };
}

export async function revokeToken(user: User, id: string): Promise<void> {
  user.tokens = user.tokens.filter((entry) => entry.id !== id);
  indexTokens();
  await save();
}
