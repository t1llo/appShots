import { confirmDelete, removePerson, type User } from "../accounts.ts";
import { InputError } from "../domain/errors.ts";
import { cancelRenders } from "../render.ts";
import type { Space } from "../storage/paths.ts";
import { projects } from "../storage/projects.ts";
import { usageChanged } from "../storage/usage.ts";

// How projects and accounts end, and move. Each first makes sure nothing works on what goes any more: from the first
// moment it is not found, so no change or upload starts on it, and its renders are cancelled and waited for, so none
// of them is still drawing for it, or holding a render of the account, when its folder goes.

/** Deletes a project with everything in it, one that cannot be read included. */
export async function deleteProject(space: Space, id: string): Promise<void> {
  await projects.tombstone(space, id);
  await cancelRenders(space, id);
  await projects.remove(space, id);
  usageChanged(space);
}

/** Deletes the account of whoever confirms it with their address, with everything it owns. */
export const deleteAccount = (user: User, confirmation: unknown) => confirmDelete(user, confirmation, (space) => cancelRenders(space));

/** Takes an address off the list, and removes the account behind it with everything it owns. */
export const removeAccount = (email: unknown) => removePerson(email, (space) => cancelRenders(space));

/**
 * Moves a project, whole and as it is, from one space to another: for the admin, when the projects of a person are
 * in the wrong place, such as after ADMIN_EMAIL named somebody else. Its renders are cancelled first. Returns the id
 * it has in the space it went to, which is its own unless that is taken there.
 */
export async function moveProject(from: Space, id: string, to: Space): Promise<string> {
  if (from.root === to.root) throw new InputError("The project is in that space already.");
  await projects.tombstone(from, id);
  await cancelRenders(from, id);
  const moved = await projects.move(from, id, to);
  usageChanged(from);
  usageChanged(to);
  return moved;
}
