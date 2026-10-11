import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR ?? "data");

/** Signs sessions. It lives on the data volume so sign-ins survive a restart or a redeploy. */
function persistentSecret(): string {
  const file = path.join(dataDir, "secret.key");
  try {
    const saved = readFileSync(file, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {}
  const secret = randomBytes(32).toString("hex");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function positive(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/**
 * Sign-in is Google only and needs all three values. A partly filled set is refused rather than
 * ignored: a typo in one name would otherwise leave a deployed server open to everybody.
 */
function signIn() {
  const values = {
    GOOGLE_CLIENT_ID: (process.env.GOOGLE_CLIENT_ID ?? "").trim(),
    GOOGLE_CLIENT_SECRET: (process.env.GOOGLE_CLIENT_SECRET ?? "").trim(),
    ADMIN_EMAIL: (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase(),
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0 && missing.length < 3) {
    throw new Error(`Sign-in is only partly configured: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing. Set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ADMIN_EMAIL, or none of them.`);
  }
  if (values.ADMIN_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.ADMIN_EMAIL)) throw new Error("ADMIN_EMAIL is not an email address.");
  return { enabled: missing.length === 0, values };
}

const { enabled, values } = signIn();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  /** Whether people sign in. Off means no sign-in at all: whoever reaches the port works in the server's own space. */
  auth: enabled,
  /** The Google address that runs this server: it is always allowed in and decides who else is. */
  adminEmail: values.ADMIN_EMAIL,
  /** Public origin used in links handed to MCP clients and in the Google redirect. Falls back to the request's host. */
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
  /** Lets the in-process renderer fetch slide pages without anyone's token. */
  internalSecret: randomBytes(24).toString("hex"),
  sessionSecret: persistentSecret(),
  google: {
    clientId: values.GOOGLE_CLIENT_ID,
    clientSecret: values.GOOGLE_CLIENT_SECRET,
    // Overridable so the flow can be exercised against a stand-in provider.
    authUrl: process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token",
  },
  /** Caps for accounts other than the admin. */
  limits: {
    projects: positive(process.env.USER_MAX_PROJECTS, 20),
    shots: positive(process.env.USER_MAX_SHOTS, 40),
  },
};
