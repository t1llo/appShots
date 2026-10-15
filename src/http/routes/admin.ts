import express, { type Router } from "express";
import { z } from "zod";
import { allowEmail, hasAccess, isAdmin, listAllowed, listUsers, mainSpace, removePerson, rendersOf, setRendersLeft, setSignupMode, signupMode, spaceOfUser } from "../../accounts.ts";
import { config } from "../../config.ts";
import { countProjects, usageOf } from "../../store.ts";
import { identityOf, requireSession } from "../auth.ts";

/** Who may sign in, and the server in numbers, under /api/admin. */
export function adminRoutes(): Router {
  const admin = express.Router();
  admin.use(requireSession, (_req, res, next) => {
    const { user } = identityOf(res);
    if (user && isAdmin(user)) return next();
    res.status(403).json({ error: "Only the admin of this server can manage people." });
  });

  /** Everybody the admin should know about: the admin, the accounts, and the addresses on the list that have not signed in yet. */
  admin.get("/people", async (_req, res) => {
    const listed = new Set(listAllowed());
    const users = listUsers();
    const accounts = await Promise.all(
      users.map(async (user) => ({
        email: user.email,
        name: user.name,
        admin: isAdmin(user),
        joinedAt: user.createdAt,
        projects: await countProjects(spaceOfUser(user)),
        bytes: (await usageOf(spaceOfUser(user))).bytes,
        access: hasAccess(user),
        renders: rendersOf(user),
      })),
    );
    const known = new Set(users.map((user) => user.email));
    const waiting = [config.adminEmail, ...listed].filter((email) => !known.has(email)).map((email) => ({ email, admin: email === config.adminEmail, access: true }));
    res.json({ signup: signupMode(), people: [...accounts, ...waiting].sort((a, b) => Number(b.admin) - Number(a.admin) || a.email.localeCompare(b.email)) });
  });

  /**
   * The server in numbers, for the admin's overview. Counts and bytes only: the admin sees how much everybody keeps,
   * never what it is.
   */
  admin.get("/overview", async (_req, res) => {
    const users = listUsers();
    const spaces = [mainSpace, ...users.filter((user) => !isAdmin(user)).map(spaceOfUser)];
    const usages = await Promise.all(spaces.map(usageOf));
    const total = { projects: 0, slides: 0, shots: 0, images: 0, bytes: 0 };
    for (const usage of usages) for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += usage[key];
    const known = new Set(users.map((user) => user.email));
    res.json({
      ...total,
      accounts: users.length,
      waiting: [config.adminEmail, ...listAllowed()].filter((email) => !known.has(email)).length,
      locked: users.filter((user) => !hasAccess(user)).length,
      renders: users.reduce((sum, user) => sum + (user.renders ?? 0), 0),
      signup: signupMode(),
      renderAllowance: config.limits.renders,
    });
  });
  admin.put("/signup", async (req, res) => {
    await setSignupMode(z.enum(["list", "open"]).parse(req.body?.mode));
    res.status(204).end();
  });
  admin.post("/people", async (req, res) => {
    await allowEmail(req.body?.email);
    res.status(204).end();
  });
  admin.put("/renders", async (req, res) => {
    const { email, left } = z.object({ email: z.string(), left: z.number().int().min(0).max(100_000) }).parse(req.body);
    await setRendersLeft(email, left);
    res.status(204).end();
  });
  // The address travels in the body, like everything else here, so it stays out of access logs.
  admin.delete("/people", async (req, res) => {
    await removePerson(req.body?.email);
    res.status(204).end();
  });

  return admin;
}
