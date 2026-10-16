import dns, { type LookupAddress } from "node:dns";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// An app may name itself by the address of a JSON document about it (a client ID metadata document), and the server
// fetches that document. The address comes from whoever opens the authorization page, so the fetch must not become
// a way to reach what only the server can reach: the machine itself, the container network, a cloud's metadata
// service. Each address a name resolves to is checked by the lookup the connection itself uses, so a name cannot
// resolve to a public address for the check and to a private one for the connection.

/** Addresses that are not on the public internet: loopback, private networks, link-local, documentation and the like. */
const privateRanges = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  privateRanges.addSubnet(network, bits, "ipv4");
}
for (const [network, bits] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  privateRanges.addSubnet(network, bits, "ipv6");
}

/** Whether an address is outside the public internet. BlockList judges an IPv4 address written as IPv6 as IPv4. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  return family === 0 || privateRanges.check(address, family === 4 ? "ipv4" : "ipv6");
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup that fails for a name with any private address among its answers. */
function publicLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      const refused: NodeJS.ErrnoException = new Error(`${hostname} points at an address that is not on the public internet`);
      refused.code = "EPRIVATE";
      return callback(refused, []);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

/** A document that could not be fetched, with a sentence that says why. */
export class FetchError extends Error {}

const MAX_BYTES = 5 * 1024;
const TIMEOUT = 5000;

/**
 * GETs a small JSON document over HTTPS from a public address. No redirects are followed, nothing over 5 KB is read,
 * and the whole fetch has 5 seconds. Resolves with the parsed body and how long it may be kept, from Cache-Control's
 * max-age.
 */
export function fetchJson(address: string): Promise<{ body: unknown; maxAge: number | null }> {
  let deadline: NodeJS.Timeout | undefined;
  return new Promise<{ body: unknown; maxAge: number | null }>((resolve, reject) => {
    const url = URL.parse(address);
    if (!url || url.protocol !== "https:") return reject(new FetchError("the address is not https"));
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) return reject(new FetchError("the address is an IP address, not a name"));
    const request = https.get(url, { lookup: publicLookup as never, headers: { Accept: "application/json", "User-Agent": "appShots" } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new FetchError(`it answered with status ${response.statusCode}`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          request.destroy();
          return reject(new FetchError("the document is larger than 5 KB"));
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return reject(new FetchError("the document is not JSON"));
        }
        const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers["cache-control"] ?? "")?.[1];
        const uncached = /no-store|no-cache/i.test(response.headers["cache-control"] ?? "");
        resolve({ body, maxAge: uncached ? 0 : maxAge != null ? Number(maxAge) : null });
      });
      response.on("error", (error) => reject(new FetchError(error.message)));
    });
    // A request's own timeout only limits how long the connection may stay idle, which a server sending a byte now
    // and then never lets it be, so the deadline counts from the start.
    deadline = setTimeout(() => {
      const late = new FetchError("it did not answer within 5 seconds");
      reject(late);
      request.destroy(late);
    }, TIMEOUT);
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof FetchError) return reject(error);
      reject(new FetchError(error.code === "EPRIVATE" ? error.message : error.code === "ENOTFOUND" ? `${url.hostname} was not found` : `it could not be reached (${error.code ?? error.message})`));
    });
  }).finally(() => clearTimeout(deadline));
}
