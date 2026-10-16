import { confirmDelete, removePerson, type User } from "../accounts.ts";
import { InputError } from "../domain/errors.ts";
import { cancelRenders, drain as drainRenders } from "../render.ts";
import type { Space } from "../storage/paths.ts";
import { projects } from "../storage/projects.ts";
import { usageChanged } from "../storage/usage.ts";
import { videoService } from "../video/service.ts";

// How projects and accounts end, and move, and how the server stops. Each first makes sure nothing works on what goes
// any more: from the first moment it is not found, so no change or upload starts on it, and what draws for it, its
// renders and the layers of its app previews, is cancelled and waited for, so none of it is still drawing for it, or
// holding a render of the account, when its folder goes.

/** Cancels the renders and the video layer runs of an account, or of one of its projects, and waits for them to stop. */
async function stopDrawing(space: Space, project?: string): Promise<void> {
  await Promise.all([cancelRenders(space, project), videoService.cancelRuns(space, project)]);
}

/** Deletes a project with everything in it, one that cannot be read included. */
export async function deleteProject(space: Space, id: string): Promise<void> {
  await projects.tombstone(space, id);
  await stopDrawing(space, id);
  await projects.remove(space, id);
  usageChanged(space);
}

/** Deletes the account of whoever confirms it with their address, with everything it owns. */
export const deleteAccount = (user: User, confirmation: unknown) => confirmDelete(user, confirmation, (space) => stopDrawing(space));

/** Takes an address off the list, and removes the account behind it with everything it owns. */
export const removeAccount = (email: unknown) => removePerson(email, (space) => stopDrawing(space));

/**
 * Moves a project, whole and as it is, from one space to another: for the admin, when the projects of a person are
 * in the wrong place, such as after ADMIN_EMAIL named somebody else. What draws for it is cancelled first. Returns
 * the id it has in the space it went to, which is its own unless that is taken there.
 */
export async function moveProject(from: Space, id: string, to: Space): Promise<string> {
  if (from.root === to.root) throw new InputError("The project is in that space already.");
  await projects.tombstone(from, id);
  await stopDrawing(from, id);
  const moved = await projects.move(from, id, to);
  usageChanged(from);
  usageChanged(to);
  return moved;
}

/**
 * Lets the renders and the video layer runs under way finish, for up to `timeoutMs`, and starts no more of either
 * meanwhile: they wait in the same queue. What still goes then is cancelled: it keeps nothing and uses no render.
 * Resolves true when everything finished in time.
 */
export async function drain(timeoutMs: number): Promise<boolean> {
  videoService.close();
  return drainRenders(timeoutMs, (wait) => videoService.cancelAll(wait));
}
