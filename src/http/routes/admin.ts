import express, { type Router } from "express";
import { z } from "zod";
import { allowEmail, hasAccess, isAdmin, listAllowed, listUsers, mainSpace, ownSpaceOf, rendersOf, setRendersLeft, setSignupMode, signupMode, spaceOfUser } from "../../accounts.ts";
import { config } from "../../config.ts";
import { mockupCache, renderHealth } from "../../render.ts";
import { moveProject, removeAccount } from "../../services/lifecycle.ts";
import { projects } from "../../storage/projects.ts";
import { usageCache } from "../../storage/usage.ts";
import { NotFoundError, type Space, usageOf } from "../../store.ts";
import { identityOf, requireSession } from "../auth.ts";

/** A space as the admin names it: "main" for the server's own, or an address for the folder that account has of its own. */
function spaceNamed(name: string): Space {
  if (name === "main") return mainSpace;
  const space = ownSpaceOf(name);
  if (!space) throw new NotFoundError(`Nobody has signed in as ${name}.`);
  return space;
}

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
    // Every account's folders are walked side by side, and the overview asked for with this list reuses the numbers.
    const accounts = await Promise.all(
      users.map(async (user) => {
        const usage = await usageOf(spaceOfUser(user));
        return {
          email: user.email,
          name: user.name,
          admin: isAdmin(user),
          joinedAt: user.createdAt,
          projects: usage.projects,
          bytes: usage.bytes,
          access: hasAccess(user),
          renders: rendersOf(user),
        };
      }),
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
    await removeAccount(req.body?.email);
    res.status(204).end();
  });

  /**
   * Moves a project from one space to another, such as when ADMIN_EMAIL now names somebody else: the projects of the
   * one who was admin are in the server's space, and those of the new admin in a folder of their own the Studio does
   * not show. The admin's own address names that folder. Answers with the id the project has where it went.
   */
  admin.post("/projects/move", async (req, res) => {
    const { project, from, to } = z.object({ project: z.string(), from: z.string(), to: z.string() }).parse(req.body);
    res.json({ project: await moveProject(spaceNamed(from), project, spaceNamed(to)) });
  });

  /**
   * How the server is doing: the browser, the render queue, what is kept in memory, and the projects that cannot be
   * read. Of the server's own space those are named; of the accounts' only counted, as everything else here.
   */
  admin.get("/health", async (_req, res) => {
    const spaces = [mainSpace, ...listUsers().filter((user) => !isAdmin(user)).map(spaceOfUser)];
    const damaged = [];
    for (const space of spaces) {
      const found = (await projects.list(space)).filter((entry) => "damaged" in entry);
      if (found.length) damaged.push({ space: space.id, count: found.length, ...(space === mainSpace ? { projects: found.map((entry) => entry.id) } : {}) });
    }
    res.set("Cache-Control", "private, no-store").json({ ...renderHealth(), damaged, caches: { mockups: mockupCache(), usage: usageCache() } });
  });

  return admin;
}
