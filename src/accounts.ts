import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.ts";
import { InputError, NotFoundError, type Space } from "./store.ts";

// The owner signs in with SHOTS_TOKEN and keeps the projects directly under the data directory.
// Everyone else is an account in accounts.json with a private directory under users/<id>.

export type SignupMode = "invite" | "open";

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
  /** scrypt hash. Absent for accounts that sign in with Google. */
  password?: string;
  googleSub?: string;
  createdAt: string;
  /** Bumped to end every session, e.g. after a password change. */
  epoch: number;
  tokens: ApiToken[];
}

interface Link {
  id: string;
  hash: string;
  kind: "invite" | "reset";
  userId?: string;
  createdAt: string;
  expiresAt: string;
}

interface State {
  signup: SignupMode;
  users: User[];
  links: Link[];
}

/** Thrown for wrong credentials and expired links; the server answers 401 without saying which part was wrong. */
export class AuthError extends Error {}

const file = path.join(config.dataDir, "accounts.json");
const state: State = { signup: "invite", users: [], links: [] };
Object.assign(state, JSON.parse(await readFile(file, "utf8").catch(() => "{}")));

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

// ---------------------------------------------------------------- spaces

export const ownerSpace: Space = { id: "owner", root: config.dataDir };

const userRoot = (id: string) => path.join(config.dataDir, "users", id);
export const spaceOfUser = (user: User): Space => ({ id: user.id, root: userRoot(user.id), limits: config.limits });

/** Resolves the id the renderer passes along with its internal secret. */
export function spaceById(id: string | undefined): Space | null {
  if (id === ownerSpace.id) return ownerSpace;
  const user = state.users.find((entry) => entry.id === id);
  return user ? spaceOfUser(user) : null;
}

// ---------------------------------------------------------------- passwords

// OWASP's scrypt setting for a 32 MB memory cost.
const SCRYPT = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize("NFKC"), salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))));
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

async function checkPassword(password: string, stored: string | undefined): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? "").split("$");
  // An unknown email still costs one derivation, so the answer takes as long either way.
  if (scheme !== "scrypt" || !salt || !hash) return derive(password, Buffer.alloc(16)).then(() => false);
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < 8) throw new InputError("Use a password of at least 8 characters.");
  if (password.length > 200) throw new InputError("That password is too long.");
}

function normalizeEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("Enter a valid email address.");
  return email;
}

const cleanName = (value: unknown, email: string) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : email.split("@")[0]!);

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
// Changing SHOTS_TOKEN signs the owner out everywhere.
const ownerEpoch = sha256(`owner:${config.token}`).slice(0, 16);

export const ownerSession = () => seal("session", { u: ownerSpace.id, k: ownerEpoch }, SESSION_TTL);
export const userSession = (user: User) => seal("session", { u: user.id, k: user.epoch }, SESSION_TTL);

/** Who a session cookie belongs to: "owner", a user, or nobody. */
export function sessionHolder(cookie: string | undefined): "owner" | User | null {
  const session = unseal<{ u: string; k: string | number }>("session", cookie);
  if (!session) return null;
  if (session.u === ownerSpace.id) return config.token && session.k === ownerEpoch ? "owner" : null;
  const user = state.users.find((entry) => entry.id === session.u);
  return user && user.epoch === session.k ? user : null;
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

export const signupMode = () => state.signup;

export async function setSignupMode(mode: SignupMode): Promise<void> {
  state.signup = mode;
  await save();
}

const byEmail = (email: string) => state.users.find((user) => user.email === email);

function findLink(kind: Link["kind"], code: unknown): Link | undefined {
  if (typeof code !== "string" || !code) return undefined;
  const hash = sha256(code);
  return state.links.find((link) => link.kind === kind && link.hash === hash && Date.parse(link.expiresAt) > Date.now());
}

export const inviteValid = (code: unknown) => Boolean(findLink("invite", code));
export const resetValid = (code: unknown) => Boolean(findLink("reset", code));

/** New accounts need an invite unless the owner has opened sign-ups. The invite is used up here. */
function admit(invite: unknown): void {
  if (!config.token) throw new InputError("Accounts are off because this server runs without SHOTS_TOKEN.");
  if (state.signup === "open") return;
  const link = findLink("invite", invite);
  if (!link) throw new AuthError("Signing up needs an invite link from the person who runs this server. This one is missing, used or expired.");
  state.links = state.links.filter((entry) => entry !== link);
}

async function addUser(fields: Pick<User, "email" | "name" | "password" | "googleSub">): Promise<User> {
  const user: User = { id: randomId("u"), ...fields, createdAt: new Date().toISOString(), epoch: 1, tokens: [] };
  state.users.push(user);
  await save();
  return user;
}

export async function signUp(input: { email: unknown; password: unknown; name?: unknown; invite?: unknown }): Promise<User> {
  const email = normalizeEmail(input.email);
  assertPassword(input.password);
  if (byEmail(email)) throw new InputError("There is already an account with this email. Sign in instead.");
  const password = await hashPassword(input.password);
  // Checked again after the slow hash, so two sign-ups racing for one email cannot both win.
  if (byEmail(email)) throw new InputError("There is already an account with this email. Sign in instead.");
  admit(input.invite);
  return addUser({ email, name: cleanName(input.name, email), password });
}

export async function logIn(emailInput: unknown, password: unknown): Promise<User> {
  const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
  const user = byEmail(email);
  const ok = await checkPassword(typeof password === "string" ? password : "", user?.password);
  if (!user || !ok) throw new AuthError("That email and password do not match an account.");
  return user;
}

/**
 * Signs in a Google identity, creating the account on first use. An email that already has a
 * password account is never linked automatically: nobody verified that address when it signed up,
 * so linking would hand the account to whoever registered it first.
 */
export async function logInWithGoogle(profile: { sub: string; email: string; name?: string }, invite?: unknown): Promise<User> {
  const known = state.users.find((user) => user.googleSub === profile.sub);
  if (known) return known;
  const email = normalizeEmail(profile.email);
  if (byEmail(email)) throw new AuthError("This email already has an account with a password. Sign in with the password instead.");
  admit(invite);
  return addUser({ email, name: cleanName(profile.name, email), googleSub: profile.sub });
}

export async function changePassword(user: User, current: unknown, next: unknown): Promise<void> {
  if (!user.password) throw new InputError("This account signs in with Google and has no password.");
  if (!(await checkPassword(typeof current === "string" ? current : "", user.password))) throw new AuthError("The current password is not correct.");
  assertPassword(next);
  user.password = await hashPassword(next);
  user.epoch++;
  await save();
}

/** Removes the account with every project, screenshot and render it owns. */
export async function deleteUser(id: string): Promise<void> {
  const user = state.users.find((entry) => entry.id === id);
  if (!user) throw new NotFoundError("No such account");
  state.users = state.users.filter((entry) => entry !== user);
  state.links = state.links.filter((link) => link.userId !== id);
  await save();
  await rm(userRoot(user.id), { recursive: true, force: true });
}

export async function confirmDelete(user: User, confirmation: unknown): Promise<void> {
  const ok = user.password ? await checkPassword(typeof confirmation === "string" ? confirmation : "", user.password) : confirmation === user.email;
  if (!ok) throw new AuthError(user.password ? "The password is not correct." : "Type your email address to confirm.");
  await deleteUser(user.id);
}

export const listUsers = () => state.users;

// ---------------------------------------------------------------- API tokens

export function userByToken(token: string): User | null {
  if (!token.startsWith("shots_")) return null;
  const hash = sha256(token);
  for (const user of state.users) {
    const entry = user.tokens.find((candidate) => candidate.hash === hash);
    if (!entry) continue;
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
  const token = `shots_${randomBytes(24).toString("base64url")}`;
  const entry: ApiToken = { id: randomId("t"), name, hash: sha256(token), hint: token.slice(-4), createdAt: new Date().toISOString() };
  user.tokens.push(entry);
  await save();
  return { token, entry };
}

export async function revokeToken(user: User, id: string): Promise<void> {
  user.tokens = user.tokens.filter((entry) => entry.id !== id);
  await save();
}

// ---------------------------------------------------------------- invite and reset links

const INVITE_TTL = 14 * 24 * 3600 * 1000;
const RESET_TTL = 24 * 3600 * 1000;

async function createLink(kind: Link["kind"], ttlMs: number, userId?: string): Promise<{ code: string; link: Link }> {
  const now = Date.now();
  state.links = state.links.filter((link) => Date.parse(link.expiresAt) > now);
  const code = randomBytes(24).toString("base64url");
  const link: Link = { id: randomId("l"), hash: sha256(code), kind, userId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
  state.links.push(link);
  await save();
  return { code, link };
}

export const createInvite = () => createLink("invite", INVITE_TTL);

export function listInvites() {
  return state.links
    .filter((link) => link.kind === "invite" && Date.parse(link.expiresAt) > Date.now())
    .map(({ id, createdAt, expiresAt }) => ({ id, createdAt, expiresAt }));
}

export async function revokeInvite(id: string): Promise<void> {
  state.links = state.links.filter((link) => !(link.kind === "invite" && link.id === id));
  await save();
}

export async function createReset(userId: string): Promise<string> {
  const user = state.users.find((entry) => entry.id === userId);
  if (!user) throw new NotFoundError("No such account");
  if (!user.password) throw new InputError("This account signs in with Google, so there is no password to reset.");
  state.links = state.links.filter((link) => !(link.kind === "reset" && link.userId === userId));
  return (await createLink("reset", RESET_TTL, userId)).code;
}

/** Sets a new password from a reset link and drops every session and token the account had. */
export async function resetPassword(code: unknown, password: unknown): Promise<User> {
  assertPassword(password);
  const link = findLink("reset", code);
  const user = link && state.users.find((entry) => entry.id === link.userId);
  if (!link || !user) throw new AuthError("This reset link is no longer valid. Ask for a new one.");
  user.password = await hashPassword(password);
  user.epoch++;
  user.tokens = [];
  state.links = state.links.filter((entry) => entry !== link);
  await save();
  return user;
}
