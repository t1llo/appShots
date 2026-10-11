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

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  /** The owner's token for the web UI, the REST API and the MCP endpoint. Empty disables auth and accounts. */
  token: process.env.APPSHOTS_TOKEN ?? "",
  /** Public origin used in links handed to MCP clients and in the Google redirect. Falls back to the request's host. */
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
  /** Lets the in-process renderer fetch slide pages without anyone's token. */
  internalSecret: randomBytes(24).toString("hex"),
  sessionSecret: persistentSecret(),
  /** Sign in with Google is offered once both values are set. */
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    // Overridable so the flow can be exercised against a stand-in provider.
    authUrl: process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token",
  },
  /** Caps for accounts other than the owner. */
  limits: {
    projects: positive(process.env.USER_MAX_PROJECTS, 20),
    shots: positive(process.env.USER_MAX_SHOTS, 40),
  },
};
