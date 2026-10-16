import { type ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { format } from "node:util";
import type { AppDeps } from "../../src/app.ts";
import { type TmpData, tmpData } from "./tmp-data.ts";

// A test talks to the server over HTTP, on a free port and with a data directory of its own. By default the server
// runs as its own process, started the way the container starts it, so every test can give it settings of its own.
// With `inProcess` the app is built with createApp() inside the test's process instead: quicker, and a debugger or
// a stack trace reaches into the routes. The settings are read once per process, so that works for one server per
// test file. Tests use only what TestServer offers, whichever way it runs.

export interface TestServer {
  /** Such as http://127.0.0.1:49152, without a slash at the end. */
  url: string;
  dataDir: string;
  /** fetch() relative to the server. */
  fetch(route: string, init?: RequestInit): Promise<Response>;
  /** What the server has printed so far, both streams. */
  output(): string;
  /** Stops the server and removes the data directory if startServer made it. */
  stop(): Promise<void>;
}

export interface ServerOptions {
  /** A data directory to use and keep. Without it, a fresh one is made and removed again on stop(). */
  dataDir?: string;
  /** Settings on top of a clean environment. Sign-in stays off unless these turn it on. */
  env?: Record<string, string>;
  /** How long to wait for /healthz. */
  timeoutMs?: number;
  /** Builds the app in this process rather than starting src/server.ts. One such server per test file. */
  inProcess?: boolean;
  /** What the app is built with in place of the real thing, such as a stand-in for the web. Needs `inProcess`. */
  deps?: Omit<AppDeps, "log">;
}

const root = path.resolve(import.meta.dirname, "..", "..");

/** Settings the server reads, which the environment the tests run in must not hand it. */
const SERVER_SETTINGS = /^(GOOGLE_|UMAMI_|USER_|RENDER_)|^(ADMIN_EMAIL|PUBLIC_URL|ALLOWED_HOSTS|TRUST_PROXY|HOST|CLIENT_IP_HEADER|CONTACT_EMAIL|OPERATOR_NAME|DATA_DIR|PORT|NODE_TEST_CONTEXT)$/;

/** The test's environment without any of the server's settings: what a server process starts from. */
export const cleanEnv = (): Record<string, string | undefined> => Object.fromEntries(Object.entries(process.env).filter(([name]) => !SERVER_SETTINGS.test(name)));

/** A port nobody listens on, picked by the system. */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const running = new Set<ChildProcess>();
// A test file that crashes or is stopped must not leave servers behind.
const killAll = () => {
  for (const child of running) child.kill("SIGKILL");
};
process.once("exit", killAll);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    killAll();
    // Then stop as the signal would have without this listener.
    process.kill(process.pid, signal);
  });
}

/** Starts the server with sign-in off and resolves once /healthz answers. Rejects with its output if it stops first. */
export async function startServer(options: ServerOptions = {}): Promise<TestServer> {
  if (options.inProcess) return startInProcess(options);
  if (options.deps) throw new Error("Only a server built in this process can be given deps.");
  const made = options.dataDir ? undefined : await tmpData("server");
  const dataDir = options.dataDir ?? made!.dir;
  // A free port can be taken again before the server binds it, by another test's server or by an outgoing
  // connection. The server then stops at once, and another port is tried.
  for (let attempt = 1; ; attempt++) {
    try {
      return await launch(dataDir, options, made);
    } catch (error) {
      if (!(error instanceof PortTaken) || attempt === 3) {
        await made?.remove();
        throw error;
      }
    }
  }
}

class PortTaken extends Error {}

async function launch(dataDir: string, options: ServerOptions, made: TmpData | undefined): Promise<TestServer> {
  const port = await freePort();
  const env = cleanEnv();
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: root,
    // The browser starts with the first render: most test servers never draw, and would each start one for nothing.
    env: { ...env, RENDER_PREWARM: "off", ...options.env, DATA_DIR: dataDir, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.add(child);
  let output = "";
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  exited.then(() => running.delete(child));

  const url = `http://127.0.0.1:${port}`;
  const halt = async () => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill("SIGTERM");
      const done = await Promise.race([exited.then(() => true), sleep(5000, false, { ref: false })]);
      if (!done) child.kill("SIGKILL");
      await exited;
    }
  };

  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let gone = false;
  exited.then(() => (gone = true));
  while (true) {
    if (gone) {
      if (/port \d+ is in use/.test(output)) throw new PortTaken(`Port ${port} was taken before the server could have it:\n${output}`);
      throw new Error(`The server stopped before it was ready (exit code ${child.exitCode}):\n${output}`);
    }
    if (Date.now() > deadline) {
      await halt();
      throw new Error(`The server did not answer /healthz in time:\n${output}`);
    }
    // Only once it says it listens: until then an answer could come from somebody else who took the port meanwhile.
    if (output.includes("appShots listening")) {
      const healthy = await fetch(`${url}/healthz`).then(
        (response) => response.ok,
        () => false,
      );
      if (healthy) break;
    }
    await sleep(50);
  }

  return {
    url,
    dataDir,
    fetch: (route, init) => fetch(`${url}${route}`, init),
    output: () => output,
    stop: async () => {
      await halt();
      await made?.remove();
    },
  };
}

let builtHere = false;

/** The app from createApp(), listening on 127.0.0.1 in this process. */
async function startInProcess(options: ServerOptions): Promise<TestServer> {
  // The settings are read when src/config.ts is first imported, and they stay for the life of the process.
  if (builtHere) throw new Error("This process has built its server already. Start another one with inProcess off, as a process of its own.");
  builtHere = true;
  const made = options.dataDir ? undefined : await tmpData("server");
  const dataDir = options.dataDir ?? made!.dir;
  let output = "";
  const write =
    (stream: NodeJS.WriteStream) =>
    (...args: unknown[]) => {
      const line = `${format(...args)}\n`;
      output += line;
      stream.write(line);
    };
  const log = { log: write(process.stdout), warn: write(process.stderr), error: write(process.stderr) };

  // Listen first: the renderer reaches the server at 127.0.0.1 on PORT, which has to be known before the app loads.
  let handle: http.RequestListener = (_req, res) => void res.writeHead(503).end();
  const server = http.createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  for (const name of Object.keys(process.env)) if (SERVER_SETTINGS.test(name) && name !== "NODE_TEST_CONTEXT") delete process.env[name];
  Object.assign(process.env, options.env, { DATA_DIR: dataDir, PORT: String(port) });
  try {
    const { createApp } = await import("../../src/app.ts");
    handle = await createApp({ ...options.deps, log });
  } catch (error) {
    server.close();
    await made?.remove();
    throw error;
  }

  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    dataDir,
    fetch: (route, init) => fetch(`${url}${route}`, init),
    output: () => output,
    stop: async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
      const { closeBrowser } = await import("../../src/render.ts");
      await closeBrowser();
      await made?.remove();
    },
  };
}
