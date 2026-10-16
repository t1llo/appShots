import path from "node:path";
import { InputError } from "../domain/errors.ts";
import { SLUG } from "../schema.ts";
import type { DeviceKind } from "../sizes.ts";

/**
 * One account's private storage. Every lookup below takes one, so a request can only ever
 * reach the files of the account it was authenticated as.
 */
export interface Space {
  id: string;
  root: string;
  /** Caps for accounts other than the admin. */
  limits?: {
    projects: number;
    shots: number;
    /** Bytes of screenshots and images the account may keep, across its projects. None: as many as the disk holds. */
    bytes?: number;
  };
}

export const projectsDir = (space: Space) => path.join(space.root, "projects");

export function assertSlug(value: string, what: string): void {
  if (!SLUG.test(value)) throw new InputError(`Invalid ${what} "${value}": use lowercase letters, digits, - and _`);
}

export function projectDir(space: Space, id: string): string {
  assertSlug(id, "project id");
  return path.join(projectsDir(space), id);
}

export const projectFile = (space: Space, id: string) => path.join(projectDir(space, id), "project.json");
export const shotsDir = (space: Space, id: string) => path.join(projectDir(space, id), "shots");
export const imagesDir = (space: Space, id: string) => path.join(projectDir(space, id), "images");
export const outDir = (space: Space, id: string) => path.join(projectDir(space, id), "out");
/** Earlier versions of project.json. Derived: deleting the folder loses the undo, never the project. */
export const historyDir = (space: Space, id: string) => path.join(projectDir(space, id), ".history");

/** A screenshot's file: its name, the device it is for and, unless it is the first language's, its language. */
export const SHOT_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.(iphone|duo|ipad|mac)(?:\.([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*))?\.png$/;
export const shotFile = (name: string, device: DeviceKind, locale?: string) => `${name}.${device}${locale ? `.${locale}` : ""}.png`;
/** An uploaded image's file: a logo, a sticker, a character. */
export const IMAGE_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.png$/;

/** The key of the project lock (storage/mutex.ts): every read-modify-write of one project holds it. */
export const projectKey = (space: Space, id: string) => `${space.id}/${id}`;

/** Resolves a file inside a project subdirectory, refusing anything that would escape it. */
export function safeJoin(root: string, relative: string): string {
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) throw new InputError("Invalid path");
  return full;
}
