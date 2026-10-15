import assert from "node:assert/strict";
import { after, test } from "node:test";
import { tmpData } from "../helpers/tmp-data.ts";

// The settings that are checked at startup. src/config.ts reads the environment when it is first imported and keeps
// its signing key in DATA_DIR, so it is imported only once the environment points at a throwaway directory.

const data = await tmpData("config");
after(() => data.remove());
for (const name of Object.keys(process.env)) if (/^(GOOGLE_|UMAMI_|USER_)|^(ADMIN_EMAIL|PUBLIC_URL|ALLOWED_HOSTS|TRUST_PROXY|HOST|PORT)$/.test(name)) delete process.env[name];
process.env.DATA_DIR = data.dir;
const { readSettings } = await import("../../src/config.ts");

test("unset and empty settings keep today's defaults", () => {
  for (const env of [{}, { PORT: "", HOST: "", PUBLIC_URL: "", ALLOWED_HOSTS: "", TRUST_PROXY: "", USER_MAX_PROJECTS: "", USER_MAX_SHOTS: " ", USER_RENDER_CREDITS: "" }]) {
    const settings = readSettings(env);
    assert.equal(settings.PORT, 3000);
    assert.equal(settings.HOST, undefined);
    assert.equal(settings.PUBLIC_URL, undefined);
    assert.equal(settings.ALLOWED_HOSTS, undefined);
    assert.equal(settings.TRUST_PROXY, "loopback, linklocal, uniquelocal");
    assert.deepEqual([settings.USER_MAX_PROJECTS, settings.USER_MAX_SHOTS, settings.USER_RENDER_CREDITS], [20, 40, 10]);
  }
});

test("a limit of 0 is a limit, not the default (srv-19)", () => {
  const settings = readSettings({ USER_RENDER_CREDITS: "0", USER_MAX_PROJECTS: "0" });
  assert.equal(settings.USER_RENDER_CREDITS, 0);
  assert.equal(settings.USER_MAX_PROJECTS, 0);
});

test("a value that cannot be right stops the server with its name (srv-19)", () => {
  const refused: Record<string, string>[] = [
    { PORT: "abc" },
    { PORT: "0" },
    { PORT: "70000" },
    { HOST: "192.168.1.20" },
    { HOST: "localhost" },
    { PUBLIC_URL: "appshots.example.com" },
    { PUBLIC_URL: "https://appshots.example.com/studio" },
    { PUBLIC_URL: "ftp://appshots.example.com" },
    { ALLOWED_HOSTS: "appshots.lan, https://studio.example.com" },
    { TRUST_PROXY: "somewhere" },
    { USER_MAX_SHOTS: "-1" },
    { USER_RENDER_CREDITS: "2.5" },
  ];
  for (const env of refused) {
    const [name] = Object.keys(env);
    assert.throws(() => readSettings(env), new RegExp(`^Error: ${name} has to be`), JSON.stringify(env));
  }
});

test("PUBLIC_URL is kept as an origin", () => {
  assert.equal(readSettings({ PUBLIC_URL: "https://Appshots.Example.com/" }).PUBLIC_URL, "https://appshots.example.com");
  assert.equal(readSettings({ PUBLIC_URL: "http://localhost:3000" }).PUBLIC_URL, "http://localhost:3000");
});

test("ALLOWED_HOSTS takes names separated by commas or spaces, with or without a port", () => {
  assert.deepEqual(readSettings({ ALLOWED_HOSTS: "Appshots.lan, studio.example.com:8443 mac-mini" }).ALLOWED_HOSTS, ["appshots.lan", "studio.example.com", "mac-mini"]);
});

test("TRUST_PROXY takes what Express takes (srv-18)", () => {
  assert.equal(readSettings({ TRUST_PROXY: "false" }).TRUST_PROXY, false);
  assert.equal(readSettings({ TRUST_PROXY: "true" }).TRUST_PROXY, true);
  assert.equal(readSettings({ TRUST_PROXY: "1" }).TRUST_PROXY, 1);
  assert.equal(readSettings({ TRUST_PROXY: "loopback,10.0.0.0/8, fd00::/8" }).TRUST_PROXY, "loopback, 10.0.0.0/8, fd00::/8");
});
