import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

/**
 * A home folder of its own for the CLI, so a test never reads or writes the real config or skill. The CLI reads
 * these when its modules load, so a test sets them before it imports any.
 * @param {string} label
 */
export async function cliHome(label) {
  const home = await mkdtemp(path.join(tmpdir(), `appshots-cli-${label}-`));
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  delete process.env.APPSHOTS_URL;
  delete process.env.APPSHOTS_TOKEN;
  return { home, remove: () => rm(home, { recursive: true, force: true }) };
}

/**
 * A stand-in for the server on a free port. `answer` gets each request with its body read, and returns
 * [status, body] or [status, body, headers], or a promise of one.
 * @param {(request: { method: string, url: string, headers: import("node:http").IncomingHttpHeaders, body: Buffer }) => [number, unknown, Record<string, string>?] | Promise<[number, unknown, Record<string, string>?]>} answer
 */
export async function stubServer(answer) {
  /** @type {Array<{ method: string, url: string, headers: import("node:http").IncomingHttpHeaders, body: Buffer }>} */
  const requests = [];
  const server = createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = { method: incoming.method ?? "GET", url: incoming.url ?? "/", headers: incoming.headers, body: Buffer.concat(chunks) };
    requests.push(request);
    const [status, body, headers = {}] = await answer(request);
    const text = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    response.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
    response.end(text);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

/**
 * A runner for proc.mjs that answers from a script instead of starting programs, and keeps every call.
 * `answer` returns what the program would have: { status, stdout, stderr, timedOut }, all optional.
 * @typedef {{ status?: number, stdout?: string, stderr?: string, timedOut?: boolean }} Answer
 * @param {(command: string, args: string[]) => Answer | Promise<Answer>} answer
 */
export function scriptedRunner(answer) {
  /** @type {string[]} */
  const calls = [];
  /** @type {import("../../cli/src/proc.mjs").Runner} */
  const runner = async (command, args) => {
    calls.push([command, ...args].join(" "));
    const { status = 0, stdout = "", stderr = "", timedOut = false } = (await answer(command, args)) ?? {};
    return timedOut ? { status: null, signal: "SIGTERM", stdout: "", stderr: "", timedOut } : { status, signal: null, stdout, stderr, timedOut };
  };
  return { runner, calls };
}

/**
 * Runs work with what the CLI prints kept back, and returns that. The test runner reports through the same stdout,
 * in binary, so only text is kept back and only for the length of the work.
 * @param {() => Promise<unknown>} work
 */
export async function quietly(work) {
  const printed = [];
  const write = process.stdout.write;
  const log = console.log;
  process.stdout.write = /** @type {any} */ ((chunk, ...rest) => (typeof chunk === "string" ? printed.push(chunk) > 0 : write.call(process.stdout, chunk, ...rest)));
  console.log = (...parts) => printed.push(`${parts.join(" ")}\n`);
  try {
    await work();
  } finally {
    process.stdout.write = write;
    console.log = log;
  }
  return printed.join("");
}

/** A 1x1 PNG, for a screenshot whose content does not matter. */
export const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/**
 * A PNG as simctl writes one, its rows stored with each of the five filters in turn so that undoing them is tested.
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => [number, number, number]} paint
 */
export function png(width, height, paint) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  let above = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x++) row.set([...paint(x, y), 255], x * 4);
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = above[i];
      const corner = i >= 4 ? above[i - 4] : 0;
      const guess = left + up - corner;
      const paeth = Math.abs(guess - left) <= Math.abs(guess - up) && Math.abs(guess - left) <= Math.abs(guess - corner) ? left : Math.abs(guess - up) <= Math.abs(guess - corner) ? up : corner;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter];
      raw[y * (stride + 1) + 1 + i] = (row[i] - predicted) & 255;
    }
    above = row;
  }
  const chunk = (kind, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(kind, "latin1"), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
