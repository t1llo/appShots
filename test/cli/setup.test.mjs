import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import { cliHome, quietly, stubServer } from "./helpers.mjs";

// A server that wants a sign-in, and a run of the command with nobody at a terminal to type the token.
const home = await cliHome("setup");
after(() => home.remove());
const server = await stubServer(({ url, headers }) => {
  if (url === "/auth/config") return [200, { signIn: true }];
  if (url === "/api/projects") return headers.authorization === "Bearer good-token" ? [200, { projects: [] }] : [401, { error: "Sign in first" }];
  return [404, "not found"];
});
after(() => server.close());

const { login, setup } = await import("../../cli/src/setup.mjs");
const { CONFIG_FILE } = await import("../../cli/src/config.mjs");
const { Failure } = await import("../../cli/src/fail.mjs");

test("without a terminal, setup says how to pass the token instead of waiting for one", { skip: process.stdin.isTTY && "stdin is a terminal" }, async () => {
  const started = Date.now();
  await assert.rejects(quietly(() => setup(server.url, { agent: "other" })), (error) => error instanceof Failure && /APPSHOTS_TOKEN=<token> or --token <token>/.test(error.message));
  assert.ok(Date.now() - started < 5000);
  assert.equal(existsSync(CONFIG_FILE), false);
});

test("a token that is refused is said so, and nothing is saved", async () => {
  await assert.rejects(quietly(() => login(server.url, { token: "old-token" })), Failure);
  assert.equal(existsSync(CONFIG_FILE), false);
});

test("login with --token saves the server and the token", async () => {
  await quietly(() => login(`${server.url}/`, { token: "good-token" }));
  assert.equal(existsSync(CONFIG_FILE), true);
});
