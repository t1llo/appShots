import assert from "node:assert/strict";
import { after, test } from "node:test";
import { tmpData } from "../helpers/tmp-data.ts";

// The settings that are checked at startup. src/config.ts reads the environment when it is first imported and keeps
// its signing key in DATA_DIR, so it is imported only once the environment points at a throwaway directory.

const data = await tmpData("config");
after(() => data.remove());
for (const name of Object.keys(process.env)) if (/^(GOOGLE_|UMAMI_|USER_)|^(ADMIN_EMAIL|PUBLIC_URL|ALLOWED_HOSTS|TRUST_PROXY|HOST|PORT)$/.test(name)) delete process.env[name];
process.env.DATA_DIR = data.dir;
const { hostName, listenHost, readSettings } = await import("../../src/config.ts");

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

test("what docker-compose.yaml and the Dockerfile pass when only the sign-in is set is accepted as before", () => {
  const settings = readSettings({ PORT: "3000", PUBLIC_URL: "", CLIENT_IP_HEADER: "", USER_MAX_PROJECTS: "20", USER_MAX_SHOTS: "40", USER_RENDER_CREDITS: "10" });
  assert.equal(settings.PORT, 3000);
  assert.equal(settings.HOST, undefined);
  assert.equal(settings.PUBLIC_URL, undefined);
  assert.deepEqual([settings.USER_MAX_PROJECTS, settings.USER_MAX_SHOTS, settings.USER_RENDER_CREDITS], [20, 40, 10]);
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
    { PUBLIC_URL: "appshots.example.com" },
    { PUBLIC_URL: "https://appshots.example.com/studio" },
    { PUBLIC_URL: "ftp://appshots.example.com" },
    { ALLOWED_HOSTS: "appshots.lan, https://studio.example.com" },
    { ALLOWED_HOSTS: "studio.example.com/studio" },
    { ALLOWED_HOSTS: "*.example.com" },
    { TRUST_PROXY: "somewhere" },
    { USER_MAX_SHOTS: "-1" },
    { USER_RENDER_CREDITS: "2.5" },
  ];
  for (const env of refused) {
    const [name] = Object.keys(env);
    assert.throws(() => readSettings(env), new RegExp(`^Error: ${name} has to be`), JSON.stringify(env));
  }
});

test("HOST names an address that includes 127.0.0.1, and any other value is passed over with a warning", () => {
  for (const host of ["127.0.0.1", "0.0.0.0", "::"]) assert.equal(listenHost(readSettings({ HOST: ` ${host} ` }).HOST), host);
  // Shells and tools set HOST for themselves, and a start with it set has to work as it did before HOST was read.
  for (const host of ["my-macbook.local", "localhost", "192.168.1.20"]) {
    const warnings: string[] = [];
    assert.equal(listenHost(readSettings({ HOST: host }).HOST, (message) => warnings.push(message)), undefined, host);
    assert.equal(warnings.length, 1, host);
    assert.match(warnings[0]!, new RegExp(`^HOST "${host}" is passed over, and the server listens on every address\\. HOST has to be `));
  }
  assert.equal(listenHost(readSettings({ HOST: "" }).HOST, () => assert.fail("an empty HOST is unset")), undefined);
});

test("PUBLIC_URL is kept as an origin", () => {
  assert.equal(readSettings({ PUBLIC_URL: "https://Appshots.Example.com/" }).PUBLIC_URL, "https://appshots.example.com");
  assert.equal(readSettings({ PUBLIC_URL: "http://localhost:3000" }).PUBLIC_URL, "http://localhost:3000");
});

test("ALLOWED_HOSTS takes names separated by commas or spaces, with or without a port", () => {
  assert.deepEqual(readSettings({ ALLOWED_HOSTS: "Appshots.lan, studio.example.com:8443 mac-mini" }).ALLOWED_HOSTS, ["appshots.lan", "studio.example.com", "mac-mini"]);
});

test("ALLOWED_HOSTS takes every name a request can arrive with, as the Host header check reads it", () => {
  // Container and service names may hold an underscore, and a name may end in the dot of the DNS root.
  assert.deepEqual(readSettings({ ALLOWED_HOSTS: "app_shots, appshots_web_1:3000, Studio.Example.com." }).ALLOWED_HOSTS, ["app_shots", "appshots_web_1", "studio.example.com"]);
  assert.equal(hostName("app_shots:3000"), "app_shots");
  assert.equal(hostName("Studio.Example.com.:8443"), "studio.example.com");
  assert.equal(hostName("[::1]:3000"), "::1");
  for (const host of ["", ":3000", "evil.test/x", "someone@evil.test", "evil.test?x"]) assert.equal(hostName(host), null, host);
});

test("TRUST_PROXY takes what Express takes (srv-18)", () => {
  assert.equal(readSettings({ TRUST_PROXY: "false" }).TRUST_PROXY, false);
  assert.equal(readSettings({ TRUST_PROXY: "true" }).TRUST_PROXY, true);
  assert.equal(readSettings({ TRUST_PROXY: "1" }).TRUST_PROXY, 1);
  assert.equal(readSettings({ TRUST_PROXY: "loopback,10.0.0.0/8, fd00::/8" }).TRUST_PROXY, "loopback, 10.0.0.0/8, fd00::/8");
});
