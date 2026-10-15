import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type TmpData, tmpData } from "./tmp-data.ts";

// src/server.ts listens as soon as it is imported, so a test runs it as its own process, on a free port and with a
// data directory of its own, and talks to it over HTTP. Tests use only what TestServer offers: once the app can be
// built without listening (createApp), startServer can build it in-process instead and no test has to change.

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
}

const root = path.resolve(import.meta.dirname, "..", "..");

/** Settings the server reads, which the environment the tests run in must not hand it. */
const SERVER_SETTINGS = /^(GOOGLE_|UMAMI_|USER_)|^(ADMIN_EMAIL|PUBLIC_URL|CLIENT_IP_HEADER|CONTACT_EMAIL|OPERATOR_NAME|DATA_DIR|PORT|NODE_TEST_CONTEXT)$/;

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
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !SERVER_SETTINGS.test(name)));
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: root,
    env: { ...env, ...options.env, DATA_DIR: dataDir, PORT: String(port) },
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
      // It says it listens even when the port was taken, and then has nothing left to do.
      if (child.exitCode === 0 && output.includes("appShots listening")) throw new PortTaken(`Port ${port} was taken before the server could have it:\n${output}`);
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
      // A server that could not have the port says so too, and then stops: give it that moment.
      if (healthy && !(await Promise.race([exited.then(() => true), sleep(50, false, { ref: false })]))) break;
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
