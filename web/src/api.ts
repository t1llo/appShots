import { queryOptions } from "@tanstack/react-query";
import type { CreativeLayoutId } from "../../src/design.ts";
import { findShot } from "../../src/domain/standins.ts";
import type { Mockups, Project, Text } from "../../src/schema.ts";
import type { DeviceKind, Placement, PlacementId, Target, TargetId } from "../../src/sizes.ts";
import { sequenced } from "./state/sequence.ts";

export type { Background, Badge, Creative, DeviceStyle, Feature, FeatureCards, IconRow, Logo, Mockups, PlacedImage, Project, Slide, Text, Theme } from "../../src/schema.ts";
export type { CreativeLayoutId, DeviceKind, Placement, PlacementId, Target, TargetId };

export interface Meta {
  targets: Record<TargetId, Target>;
  /** The device families a set is designed for, in the order they are offered. */
  devices: { id: DeviceKind; label: string }[];
  layouts: Record<string, string>;
  /** How many screenshots each slide layout shows. */
  layoutShots: Record<string, number>;
  placements: Record<PlacementId, Placement>;
  creativeLayouts: Record<CreativeLayoutId, { note: string; screenshots: number }>;
  fonts: string[];
  /** The same fonts with their names, under the headings the picker shows them under. */
  fontList: { id: string; family: string; group: string; note: string; weight: number }[];
  logoShapes: Record<string, string>;
  logoSizes: string[];
  backgrounds: string[];
  deviceColors: string[];
  /** How a device is drawn, each with a line on what it looks like. */
  deviceStyles: Record<string, string>;
  statusBars: Record<string, string>;
  /** The angle between the devices of the layouts that show several, where the slide sets none. */
  layoutSpread: Record<string, number>;
  badgeTypes: Record<string, string>;
  badgeTones: Record<string, string>;
  featureStyles: Record<string, string>;
  pointStyles: Record<string, string>;
  /** The layouts that make their whole picture of the slide's features, so these take cards, figures or steps. */
  featureLayouts: string[];
  cardLooks: Record<string, string>;
  cardIcons: Record<string, string>;
  /** How the words between asterisks in a headline are marked. */
  emphasis: Record<string, string>;
  /** How many badges a slide draws with its copy, and how many reviews the reviews layout puts on its wall. */
  badgesShown: number;
  reviewsShown: number;
  iconRowStyles: Record<string, string>;
  iconRowTones: Record<string, string>;
  iconRowSizes: string[];
  icons: string[];
  /** The same icons under the headings the picker shows them under. */
  iconGroups: Record<string, string[]>;
  authEnabled: boolean;
  /** Who is signed in. Null only while the server runs without sign-in. */
  account: { email: string; name: string; admin: boolean } | null;
  /** How many renders the account has left. Null where they are not counted. */
  rendersLeft: number | null;
}

export interface ProjectEntry {
  id: string;
  name: string;
  /** How many slides the devices share. */
  slides: number;
  /** The devices that have slides of their own instead. */
  ownSets?: DeviceKind[];
  locales: string[];
  updatedAt: string;
  /** Set on a project whose stored file cannot be read: what is wrong with it. Its history can bring it back. */
  damaged?: string;
}

/** One version of a project as its history keeps it. */
export interface Revision {
  revision: number;
  /** When it was written. */
  time: string;
  /** Who wrote it: studio, mcp or api, and unknown for one written before the history was kept. */
  actor: string;
  /** Bytes. */
  size: number;
}

export interface Revisions {
  /** The revision that is current, or null for a project whose stored file cannot be read. */
  revision: number | null;
  /** Newest first: every change is one, the last 50 of them. */
  revisions: Revision[];
}

export interface Shot {
  name: string;
  device: DeviceKind;
  /** The language it was made for. Without one it is the first language's, which every other language shows until it has its own. */
  locale?: string;
  file: string;
  width: number;
  height: number;
  bytes: number;
  version: number;
  /** Set on a capture of a Mac window: the radius of its see-through corners in pixels. */
  corner?: number;
}

/** A logo or other artwork that slides place by its name. */
export interface StoredImage {
  name: string;
  file: string;
  width: number;
  height: number;
  bytes: number;
  version: number;
}

export interface Detail {
  project: Project;
  /** How many writes the project has seen, from a server that counts them. It sends the same number as the ETag. */
  revision?: number;
  shots: Shot[];
  images: StoredImage[];
  outputs: { locale: string; target: string; files: string[]; version: number }[];
  creativeOutputs: { locale: string; placement: PlacementId; path: string; version: number }[];
  defaultTargets: TargetId[];
}

/** One screenshot as a mockup: the page that previews it, and the PNG it is saved as. */
export interface MockupItem {
  file: string;
  name: string;
  device: DeviceKind;
  locale?: string;
  version: number;
  saveAs: string;
  /** The size of the preview page. The PNG is cut down to the device and its shadow, so it is smaller. */
  stage: { width: number; height: number };
  page: string;
  png: string;
}

export interface MockupList {
  settings: Mockups;
  locale: string;
  items: MockupItem[];
}

/** The size a target is drawn at: itself, or the one it is a scaled copy of. Only those have a preview of their own. */
export const drawnSize = (meta: Meta, id: TargetId): TargetId => (meta.targets[id].from as TargetId | undefined) ?? id;

/** The sizes a project exports: its own choice, or the standard sizes of every device it has screenshots of. */
export function exportSizes(meta: Meta, project: Pick<Project, "targets">, shots: Shot[]): TargetId[] {
  const ids = Object.keys(meta.targets) as TargetId[];
  if (project.targets?.length) return ids.filter((id) => project.targets!.includes(id));
  const devices = new Set<DeviceKind>(shots.length ? shots.map((shot) => shot.device) : ["iphone"]);
  return ids.filter((id) => meta.targets[id].standard && devices.has(meta.targets[id].device));
}

/** One run of the renderer, as the server reports it while it works and for an hour after. */
export interface RenderJob {
  id: string;
  /** The project's id and its name. */
  project: string;
  name: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  /** Pictures drawn so far, and how many the run draws. */
  done: number;
  total: number;
  createdAt: string;
  finishedAt?: string;
  /** What a finished run wrote. */
  files?: number;
  warnings?: string[];
  error?: string;
}

export interface Renders {
  jobs: RenderJob[];
  /** Null where renders are not counted. */
  rendersLeft: number | null;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** An answer that did not go well: the server's message, its status, and the body it came in. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Whether a request failed because what it asked for is not there, such as a project deleted elsewhere. */
export const isGone = (error: unknown) => error instanceof ApiError && error.status === 404;

/** Sent with every change, so the project's history can say it was made in the Studio. */
const CLIENT = { "x-appshots-client": "studio" };

export async function api<T = unknown>(method: string, route: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = method === "GET" ? {} : { ...CLIENT };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    payload = body;
    headers["content-type"] = "application/octet-stream";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const response = await answered(await fetch(`/api${route}`, { ...init, method, headers, body: payload }));
  return (response.status === 204 ? null : await response.json()) as T;
}

/** A response that went well. Any other is thrown as the error the server gave for it. */
async function answered(response: Response): Promise<Response> {
  if (response.status === 401) {
    location.href = "/login";
    throw new ApiError("Signed out", 401, null);
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {}
    const message = (body as { error?: unknown } | null)?.error;
    throw new ApiError(typeof message === "string" ? message : response.statusText, response.status, body);
  }
  return response;
}

/** The revision a server that counts them sent with a project, in the body or as the ETag. Null from one that does not. */
export function revisionOf(detail: Detail): number | null {
  const stored = (detail.project as { revision?: unknown }).revision;
  return typeof detail.revision === "number" ? detail.revision : typeof stored === "number" ? stored : null;
}

/** A project's detail, with the revision of its ETag where the body has none. */
async function withRevision(response: Response): Promise<Detail> {
  const detail = (await response.json()) as Detail;
  const tag = /^(?:W\/)?"(\d+)"$/.exec(response.headers.get("etag") ?? "");
  if (detail.revision == null && tag) detail.revision = Number(tag[1]);
  return detail;
}

/**
 * Saves changes to a project. Sent with the revision they were made on, they are refused with a 409 when someone
 * else wrote since, and that ApiError's body carries the project as the server has it now.
 */
export async function saveProject(id: string, changes: object, revision: number | null, keepalive = false): Promise<Detail> {
  const headers: Record<string, string> = { "content-type": "application/json", ...CLIENT };
  if (revision != null) headers["if-match"] = `"${revision}"`;
  return withRevision(await answered(await fetch(`/api/projects/${id}`, { method: "PUT", headers, body: JSON.stringify(changes), keepalive })));
}

/** Makes an earlier revision of a project current again, as a new revision, and answers with the project as it is then. */
export async function restoreProject(id: string, revision: number): Promise<Detail> {
  const headers = { "content-type": "application/json", ...CLIENT };
  return withRevision(await answered(await fetch(`/api/projects/${id}/restore`, { method: "POST", headers, body: JSON.stringify({ revision }) })));
}

/** A file the server makes on request, such as a mockup, by the address the server gave for it. */
export const fetchFile = async (url: string): Promise<Blob> => (await answered(await fetch(url))).blob();

/** Hands a file to the browser to save under a name. */
export function saveFile(file: Blob, name: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export const metaQuery = queryOptions({ queryKey: ["meta"], queryFn: () => api<Meta>("GET", "/meta"), staleTime: Infinity });
export const projectsQuery = queryOptions({ queryKey: ["projects"], queryFn: sequenced((signal) => api<ProjectEntry[]>("GET", "/projects", undefined, { signal })) });
// Fresh for a moment, so the page that opens right after the route has loaded a project does not fetch it twice.
export const detailQuery = (id: string) =>
  queryOptions({ queryKey: ["project", id], queryFn: sequenced(async (signal) => withRevision(await answered(await fetch(`/api/projects/${id}`, { signal })))), staleTime: 2000 });

export const revisionsQuery = (id: string) =>
  queryOptions({ queryKey: ["project", id, "revisions"], queryFn: ({ signal }) => api<Revisions>("GET", `/projects/${id}/revisions`, undefined, { signal }) });

/** The mockups of a project in one language. `drawn` names what they were drawn from, so a change there fetches them again. */
export const mockupsQuery = (id: string, locale: string, drawn: string) =>
  queryOptions({ queryKey: ["project", id, "mockups", locale, drawn], queryFn: () => api<MockupList>("GET", `/projects/${id}/mockups?locale=${encodeURIComponent(locale)}`) });

// ---------------------------------------------------------------- small helpers

export const LOCALE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
export const label = (id: string) => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Of the screenshots of one name, the one a language shows, picked as the renderer picks it: its own, else the first language's. */
export const shotIn = (shots: Shot[], locale: string): Shot | undefined =>
  shots.find((shot) => shot.locale?.toLowerCase() === locale.toLowerCase()) ?? shots.find((shot) => !shot.locale) ?? shots[0];

/** The screenshot a device shows under a name in a language, picked as the renderer picks it. Another device's stands in when it has none. */
export const shotFor = (shots: Shot[], name: string, device: DeviceKind, locale: string): Shot | undefined => findShot(shots, name, device, locale);

export function readText(value: Text | undefined, locale: string): string {
  if (value == null) return "";
  return typeof value === "string" ? value : (value[locale] ?? "");
}

/** A plain string serves every language; it only becomes a per-language map once a translation is typed. */
export function withText(current: Text | undefined, text: string, locale: string, primary: string): Text | undefined {
  if (current == null || typeof current === "string") {
    if (locale === primary) return text || undefined;
    const map: Record<string, string> = current ? { [primary]: current } : {};
    if (text) map[locale] = text;
    return Object.keys(map).length ? map : undefined;
  }
  const map = { ...current };
  if (text) map[locale] = text;
  else delete map[locale];
  return Object.keys(map).length ? map : undefined;
}

/** Sets a field, or removes it when the value is empty, so stored projects carry no blank overrides. */
export function put<T extends object>(owner: T, key: keyof T, value: unknown): void {
  if (value === "" || value == null) delete owner[key];
  else (owner as Record<keyof T, unknown>)[key] = value;
}
