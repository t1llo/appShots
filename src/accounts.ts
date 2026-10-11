import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.ts";
import { InputError, NotFoundError, type Space } from "./store.ts";

// Everybody signs in with Google. The admin is the address in ADMIN_EMAIL and works in the server's own space,
// directly under the data directory. Everyone else is an account in accounts.json with a private directory
// under users/<id>, and gets in only while their address is on the list or sign-in is open to anyone.

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
}

interface State {
  signup: SignupMode;
  /** The addresses that may sign in while `signup` is "list". The admin is not on it and does not need to be. */
  allowed: string[];
  users: User[];
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
const saved = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as Partial<State>;
const state: State = {
  // Anything but an explicit "open" is the list, including the invite-only mode of earlier versions.
  signup: saved.signup === "open" ? "open" : "list",
  allowed: Array.isArray(saved.allowed) ? saved.allowed : [],
  users: Array.isArray(saved.users) ? saved.users : [],
};
// Passwords are gone; their hashes have no business staying in the file.
for (const user of state.users) delete (user as { password?: string }).password;

let writing: Promise<void> = Promise.resolve();
function save(): Promise<void> {
  writing = writing
    .catch(() => {})
    .then(async () => {
      await mkdir(config.dataDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(tmp, file);
    });
  return writing;
}

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

/** Takes an address off the list and removes the account behind it, with everything it owns. */
export async function removePerson(input: unknown): Promise<void> {
  const email = normalizeEmail(input);
  if (email === config.adminEmail) throw new InputError(ADMIN_STAYS);
  state.allowed = state.allowed.filter((entry) => entry !== email);
  const user = byEmail(email);
  if (user) await deleteUser(user.id);
  else await save();
}

// ---------------------------------------------------------------- spaces

/** The server's own space: the admin's, and everybody's while sign-in is off. */
export const mainSpace: Space = { id: "main", root: config.dataDir };

const userRoot = (id: string) => path.join(config.dataDir, "users", id);
export const spaceOfUser = (user: User): Space => (isAdmin(user) ? mainSpace : { id: user.id, root: userRoot(user.id), limits: config.limits });

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
    // passwords, or an address that went to somebody new. Whoever held it before loses their sessions and tokens.
    sameAddress.googleSub = profile.sub;
    sameAddress.tokens = [];
    sameAddress.epoch++;
    await save();
    return sameAddress;
  }
  const user: User = { id: randomId("u"), email, name: cleanName(profile.name, email), googleSub: profile.sub, createdAt: new Date().toISOString(), epoch: 1, tokens: [] };
  state.users.push(user);
  await save();
  return user;
}

/** Removes the account with every project, screenshot and render it owns. */
export async function deleteUser(id: string): Promise<void> {
  const user = state.users.find((entry) => entry.id === id);
  if (!user) throw new NotFoundError("No such account");
  // The admin's projects are the server's own space, which no button should be able to wipe.
  if (isAdmin(user)) throw new InputError(ADMIN_STAYS);
  state.users = state.users.filter((entry) => entry !== user);
  await save();
  await rm(userRoot(user.id), { recursive: true, force: true });
}

export async function confirmDelete(user: User, confirmation: unknown): Promise<void> {
  if (confirmation !== user.email) throw new InputError("Type your email address to confirm.");
  await deleteUser(user.id);
}

export const listUsers = () => state.users;

// ---------------------------------------------------------------- API tokens

export function userByToken(token: string): User | null {
  if (!token.startsWith("appshots_")) return null;
  const hash = sha256(token);
  for (const user of state.users) {
    const entry = user.tokens.find((candidate) => candidate.hash === hash);
    if (!entry) continue;
    if (!hasAccess(user)) return null;
    // Coarse on purpose: a busy token should not rewrite the accounts file on every request.
    if (!entry.lastUsedAt || Date.now() - Date.parse(entry.lastUsedAt) > 3600_000) {
      entry.lastUsedAt = new Date().toISOString();
      void save();
    }
    return user;
  }
  return null;
}

export const describeToken = ({ id, name, hint, createdAt, lastUsedAt }: ApiToken) => ({ id, name, hint, createdAt, lastUsedAt });

export async function createToken(user: User, nameInput: unknown): Promise<{ token: string; entry: ApiToken }> {
  if (user.tokens.length >= 20) throw new InputError("This account already has 20 tokens. Revoke one first.");
  const name = typeof nameInput === "string" && nameInput.trim() ? nameInput.trim().slice(0, 60) : "Token";
  const token = `appshots_${randomBytes(24).toString("base64url")}`;
  const entry: ApiToken = { id: randomId("t"), name, hash: sha256(token), hint: token.slice(-4), createdAt: new Date().toISOString() };
  user.tokens.push(entry);
  await save();
  return { token, entry };
}

export async function revokeToken(user: User, id: string): Promise<void> {
  user.tokens = user.tokens.filter((entry) => entry.id !== id);
  await save();
}
