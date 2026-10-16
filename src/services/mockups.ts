import { InputError } from "../domain/errors.ts";
import { mockupShots } from "../mockup.ts";
import { type Mockups, mockupsSchema, type Project } from "../schema.ts";
import { projects } from "../storage/projects.ts";
import { listShots, type Shot, shotLocale } from "../store.ts";
import { type Ctx, writeOptions } from "./context.ts";

/** A project with no screenshot at all. The MCP tool adds how to upload one. */
export class NothingToDraw extends InputError {
  constructor() {
    super("This project has no screenshots yet, so there is nothing to make mockups of.");
  }
}

/** A change to the saved mockup settings. */
export interface MockupsChange {
  /** Laid over the device the project had. `{}` goes back to the defaults. */
  device?: Mockups["device"];
  /** null goes back to showing the screenshot pixel for pixel. */
  width?: number | null;
}

/** The settings `change` makes of `current`, checked. */
export function mergeSettings(current: Mockups, change: MockupsChange): Mockups {
  const next: Mockups = { ...current };
  if (change.device !== undefined) {
    if (Object.keys(change.device).length === 0) delete next.device;
    else next.device = { ...current.device, ...change.device };
  }
  if (change.width === null) delete next.width;
  else if (change.width !== undefined) next.width = change.width;
  return mockupsSchema.parse(next);
}

const changes = (change: MockupsChange) => change.device !== undefined || change.width !== undefined;

/** Saves a change to the mockup settings, laid over the settings as they are when it gets its turn. */
export async function updateSettings(ctx: Ctx, id: string, change: MockupsChange): Promise<Project> {
  // Checked on what is saved now first, so a change that cannot be made is refused before the lock is taken.
  mergeSettings((await projects.get(ctx.space, id)).project.mockups, change);
  const { project } = await projects.mutate(ctx.space, id, (current) => ({ ...current, mockups: mergeSettings(current.mockups, change) }), writeOptions(ctx));
  return project;
}

/** The settings a preview is drawn with: the project's own, with what the request sets laid over them. */
export function previewSettings(project: Project, query: Record<string, unknown>): Mockups {
  if (typeof query.settings === "string") {
    let given: unknown;
    try {
      given = JSON.parse(query.settings);
    } catch {
      throw new InputError("`settings` has to be JSON, such as {\"device\":{\"style\":\"clay\"}}.");
    }
    return mockupsSchema.parse(given);
  }
  if (query.width == null) return project.mockups;
  return mockupsSchema.parse({ ...project.mockups, width: Number(query.width) });
}

/** The language a mockup request asks for: one of the project's, the first when it names none. */
export function mockupLocale(project: Project, wanted: unknown): string {
  if (wanted == null || wanted === "") return project.locales[0]!;
  return shotLocale(project, String(wanted)) ?? project.locales[0]!;
}

export interface MockupsRequest extends MockupsChange {
  /** Screenshot names to draw. Left out or empty, every one. */
  screenshots?: string[];
  locale?: string;
}

/**
 * What a request for mockups draws: the screenshots, in the language asked for, with the settings it gives. All of
 * it is checked before the settings are saved, so a request that is refused changes nothing.
 */
export async function prepare(ctx: Ctx, id: string, request: MockupsRequest): Promise<{ project: Project; language: string; wanted: Shot[] }> {
  const stored = await projects.get(ctx.space, id);
  const shots = await listShots(ctx.space, id, stored.project.locales);
  if (shots.length === 0) throw new NothingToDraw();
  const language = mockupLocale(stored.project, request.locale);
  const unknown = (request.screenshots ?? []).filter((name) => !shots.some((shot) => shot.name === name));
  if (unknown.length) throw new InputError(`No screenshot is uploaded under ${unknown.map((name) => `"${name}"`).join(", ")}. The project has: ${[...new Set(shots.map((shot) => shot.name))].join(", ")}.`);
  const project = changes(request) ? await updateSettings(ctx, id, request) : stored.project;
  const wanted = mockupShots(project, shots, language).filter((shot) => !request.screenshots?.length || request.screenshots.includes(shot.name));
  return { project, language, wanted };
}
