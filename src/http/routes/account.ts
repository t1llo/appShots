import express, { type Response, type Router } from "express";
import { confirmDelete, createToken, describeToken, revokeToken } from "../../accounts.ts";
import { endGrant, grantsOf } from "../../oauth/store.ts";
import { identityOf, requireSession, SESSION_COOKIE } from "../auth.ts";

const userOf = (res: Response) => identityOf(res).user!;

/** The signed-in person's own tokens, connected apps and account, under /api/account. */
export function accountRoutes(): Router {
  const account = express.Router();
  account.use(requireSession, (_req, res, next) => (identityOf(res).user ? next() : void res.status(400).json({ error: "There are no accounts while sign-in is off." })));

  account.get("/tokens", (_req, res) => {
    res.json(userOf(res).tokens.map(describeToken));
  });
  account.post("/tokens", async (req, res) => {
    const { token, entry } = await createToken(userOf(res), req.body?.name);
    res.status(201).json({ token, ...describeToken(entry) });
  });
  account.delete("/tokens/:id", async (req, res) => {
    await revokeToken(userOf(res), req.params.id);
    res.status(204).end();
  });
  // The apps connected over OAuth, such as claude.ai or ChatGPT, one entry each time somebody let one in.
  account.get("/apps", (_req, res) => {
    res.json(grantsOf(userOf(res).id).map(({ id, clientName, redirectHost, createdAt, lastUsedAt }) => ({ id, name: clientName, redirectHost, createdAt, lastUsedAt })));
  });
  account.delete("/apps/:id", async (req, res) => {
    const grant = grantsOf(userOf(res).id).find((entry) => entry.id === req.params.id);
    if (grant) await endGrant(grant);
    res.status(204).end();
  });
  account.delete("/", async (req, res) => {
    await confirmDelete(userOf(res), req.body?.confirm);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  return account;
}
