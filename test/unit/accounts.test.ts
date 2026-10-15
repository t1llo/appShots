import assert from "node:assert/strict";
import { after, test } from "node:test";
import { tmpData } from "../helpers/tmp-data.ts";

// The accounts module with sign-in on. It reads its settings and accounts.json when it is first imported, so it is
// imported only once the environment points at a throwaway directory. The addresses are made up, and nothing here
// reaches Google: logInWithGoogle is what the sign-in calls once Google has answered.

const data = await tmpData("accounts");
after(() => data.remove());
for (const name of Object.keys(process.env)) if (/^(GOOGLE_|UMAMI_|USER_)|^(ADMIN_EMAIL|PUBLIC_URL|ALLOWED_HOSTS|TRUST_PROXY|HOST|PORT)$/.test(name)) delete process.env[name];
Object.assign(process.env, { DATA_DIR: data.dir, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", ADMIN_EMAIL: "admin@example.com" });
const accounts = await import("../../src/accounts.ts");

test("a token finds its account until it is revoked, taken away or its account is gone", async () => {
  const user = await accounts.logInWithGoogle({ sub: "google-1", email: "one@example.com", name: "One" });
  const first = await accounts.createToken(user, "First");
  const second = await accounts.createToken(user, "Second");
  assert.equal(accounts.userByToken(first.token), user);
  assert.equal(accounts.userByToken(second.token), user);
  assert.equal(accounts.userByToken(`${first.token}x`), null);

  await accounts.revokeToken(user, first.entry.id);
  assert.equal(accounts.userByToken(first.token), null);
  assert.equal(accounts.userByToken(second.token), user);

  // The address signs in as another Google identity: whoever held it before loses their tokens.
  await accounts.logInWithGoogle({ sub: "google-1-new", email: "one@example.com" });
  assert.equal(accounts.userByToken(second.token), null);

  const other = await accounts.logInWithGoogle({ sub: "google-2", email: "two@example.com" });
  const third = await accounts.createToken(other, "Third");
  assert.equal(accounts.userByToken(third.token), other);
  await accounts.deleteUser(other.id);
  assert.equal(accounts.userByToken(third.token), null);
});

test("deleting an account takes the address in any case and with spaces around it (srv-20)", async () => {
  const user = await accounts.logInWithGoogle({ sub: "google-3", email: "three@example.com" });
  await assert.rejects(accounts.confirmDelete(user, "someone@example.com"), /Type your email address/);
  await assert.rejects(accounts.confirmDelete(user, undefined), /Type your email address/);
  await accounts.confirmDelete(user, "  Three@Example.COM \n");
  assert.equal(accounts.listUsers().includes(user), false);
});

test("renders the admin gives are on top of the ones under way (srv-21)", async () => {
  const user = await accounts.logInWithGoogle({ sub: "google-4", email: "four@example.com" });
  const done = accounts.holdRender(user.id);
  assert.equal(accounts.rendersLeft(user.id), 9);
  await accounts.setRendersLeft("four@example.com", 5);
  assert.equal(accounts.rendersLeft(user.id), 5);
  // The render under way finishes and uses the render set aside for it, not one of the five.
  await done(true);
  assert.equal(accounts.rendersLeft(user.id), 5);
  assert.deepEqual(accounts.rendersOf(user), { made: 1, left: 5 });
});
