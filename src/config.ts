import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { z } from "zod";

const dataDir = path.resolve(process.env.DATA_DIR ?? "data");

// ---------------------------------------------------------------- checked settings

/** An empty variable counts as unset, as `NAME=` in a .env file or `${NAME:-}` in a compose file leave it. */
const blank = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/** A whole number from 0 up. 0 is a real value: USER_RENDER_CREDITS=0 hands out no renders until the admin gives some. */
const count = (fallback: number) => z.preprocess(blank, z.coerce.number().int().min(0).default(fallback));

const HOST_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** The subnets Express knows by name. */
const PROXY_NAMES = new Set(["loopback", "linklocal", "uniquelocal"]);

const settingsSchema = z.object({
  PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65535).default(3000)),
  // The renderer reaches the server at 127.0.0.1, so only addresses that include it are offered.
  HOST: z.preprocess(blank, z.enum(["127.0.0.1", "0.0.0.0", "::"]).optional()),
  PUBLIC_URL: z.preprocess(
    blank,
    z
      .string()
      .transform((value, ctx) => {
        const url = URL.parse(value.trim().replace(/\/+$/, ""));
        if (url && /^https?:$/.test(url.protocol) && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password) return url.origin;
        ctx.addIssue({ code: "custom", message: "not an origin" });
        return z.NEVER;
      })
      .optional(),
  ),
  ALLOWED_HOSTS: z.preprocess(
    blank,
    z
      .string()
      .transform((value, ctx) => {
        const names = value
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((name) => name.toLowerCase().replace(/:\d+$/, ""));
        if (names.every((name) => HOST_NAME.test(name))) return names;
        ctx.addIssue({ code: "custom", message: "not a host name" });
        return z.NEVER;
      })
      .optional(),
  ),
  // Private-network addresses are the reverse proxy of a container or of the same machine. A client on the open
  // internet that sends X-Forwarded-For itself is not believed.
  TRUST_PROXY: z.preprocess(
    blank,
    z
      .string()
      .default("loopback, linklocal, uniquelocal")
      .transform((value, ctx): boolean | number | string => {
        const text = value.trim().toLowerCase();
        if (text === "true" || text === "false") return text === "true";
        if (/^\d+$/.test(text)) return Number(text);
        const entries = text.split(",").map((entry) => entry.trim());
        const known = (entry: string) => {
          const [address = "", bits, ...rest] = entry.split("/");
          return PROXY_NAMES.has(entry) || (rest.length === 0 && isIP(address) !== 0 && (bits === undefined || /^\d{1,3}$/.test(bits)));
        };
        if (entries.every(known)) return entries.join(", ");
        ctx.addIssue({ code: "custom", message: "not a proxy setting" });
        return z.NEVER;
      }),
  ),
  USER_MAX_PROJECTS: count(20),
  USER_MAX_SHOTS: count(40),
  USER_RENDER_CREDITS: count(10),
});

/** What each checked setting has to be, for the sentence that stops the server. */
const HAS_TO_BE: Record<keyof z.input<typeof settingsSchema>, string> = {
  PORT: "a port number from 1 to 65535",
  HOST: "127.0.0.1 for this machine only, or 0.0.0.0 or :: for every address; the renderer reaches the server at 127.0.0.1",
  PUBLIC_URL: "the address people open, such as https://appshots.example.com: http or https, with no path",
  ALLOWED_HOSTS: "host names separated by commas, such as appshots.lan,studio.example.com",
  TRUST_PROXY: "true, false, a number of proxies, or addresses and subnets separated by commas, such as loopback, 10.0.0.0/8",
  USER_MAX_PROJECTS: "a whole number from 0 up",
  USER_MAX_SHOTS: "a whole number from 0 up",
  USER_RENDER_CREDITS: "a whole number from 0 up",
};

/**
 * The settings that are checked rather than guessed at. A value that cannot be right stops the server with a
 * sentence that names it, instead of turning up later as a redirect Google refuses or a port nobody expected.
 */
export function readSettings(env: Record<string, string | undefined>) {
  const parsed = settingsSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))] as (keyof typeof HAS_TO_BE)[];
  throw new Error(names.map((name) => `${name} has to be ${HAS_TO_BE[name]}, not "${env[name]}".`).join(" "));
}

const settings = readSettings(process.env);

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

/**
 * Page analytics with Umami: the address of the Umami server and the id this site has on it. Neither is a secret,
 * both end up in the page. The pages load nothing unless both are set, and a value that cannot be right turns
 * analytics off rather than stopping the server. The recorder, which replays visits, is a setting of its own.
 */
function analytics() {
  const url = (process.env.UMAMI_URL ?? "").trim().replace(/\/+$/, "");
  const website = (process.env.UMAMI_WEBSITE_ID ?? "").trim().toLowerCase();
  if (!url && !website) return null;
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~-]+)*$/i.test(url) || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(website)) {
    console.warn("Analytics are off: UMAMI_URL has to be the https address of an Umami server and UMAMI_WEBSITE_ID the id of a website on it. Set both.");
    return null;
  }
  return { url, website, recorder: /^(on|true|yes|1)$/i.test((process.env.UMAMI_RECORDER ?? "").trim()) };
}

/** Who runs this server, as the privacy policy and the terms name them. Both are optional. */
function operator() {
  const name = (process.env.OPERATOR_NAME ?? "").trim().slice(0, 120);
  let email = (process.env.CONTACT_EMAIL ?? "").trim();
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    console.warn("CONTACT_EMAIL is not an email address, so the privacy policy shows no contact.");
    email = "";
  }
  return { name, email };
}

/**
 * The request header that carries the visitor's address, for a server with a CDN or a second proxy in front of
 * its reverse proxy: there the reverse proxy reports that service's address, not the visitor's.
 */
function visitorHeader(): string | null {
  const name = (process.env.CLIENT_IP_HEADER ?? "").trim().toLowerCase();
  if (!name) return null;
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.warn("CLIENT_IP_HEADER is not the name of a header, so the address the reverse proxy reports is used.");
    return null;
  }
  return name;
}

export const config = {
  port: settings.PORT,
  /** The address to listen on. Unset, every address of the machine, which a container needs. */
  host: settings.HOST,
  dataDir,
  /** Whether people sign in. Off means no sign-in at all: whoever reaches the port works in the server's own space. */
  auth: enabled,
  /** The Google address that runs this server: it is always allowed in and decides who else is. */
  adminEmail: values.ADMIN_EMAIL,
  /** Public origin used in links handed to MCP clients and in the Google redirect. Falls back to the request's host. */
  publicUrl: settings.PUBLIC_URL ?? "",
  /** Names besides PUBLIC_URL's and the loopback ones that the API answers to. See src/http/security.ts. */
  allowedHosts: settings.ALLOWED_HOSTS ?? [],
  /** Which proxies in front are believed about the visitor's address and about HTTPS, as Express's "trust proxy" takes it. */
  trustProxy: settings.TRUST_PROXY,
  /** Set only when every request comes through the service that sets this header: anyone else could send it themselves. */
  clientIpHeader: visitorHeader(),
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
  umami: analytics(),
  operator: operator(),
  /** Caps for accounts other than the admin. */
  limits: {
    projects: settings.USER_MAX_PROJECTS,
    shots: settings.USER_MAX_SHOTS,
    /** Renders an account gets. The admin can give one account more on the Admin page. */
    renders: settings.USER_RENDER_CREDITS,
  },
};
