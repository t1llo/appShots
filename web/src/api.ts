import { queryOptions } from "@tanstack/react-query";
import type { CreativeLayoutId } from "../../src/design.ts";
import type { Project, Text } from "../../src/schema.ts";
import type { DeviceKind, Placement, PlacementId, Target, TargetId } from "../../src/sizes.ts";

export type { Background, Badge, Creative, DeviceStyle, Feature, IconRow, Logo, PlacedImage, Project, Slide, Text, Theme } from "../../src/schema.ts";
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
  badgeTypes: Record<string, string>;
  badgeTones: Record<string, string>;
  featureStyles: Record<string, string>;
  pointStyles: Record<string, string>;
  iconRowStyles: Record<string, string>;
  iconRowTones: Record<string, string>;
  iconRowSizes: string[];
  icons: string[];
  /** The same icons under the headings the picker shows them under. */
  iconGroups: Record<string, string[]>;
  authEnabled: boolean;
  /** Who is signed in. Null only while the server runs without sign-in. */
  account: { email: string; name: string; admin: boolean } | null;
}

export interface ProjectEntry {
  id: string;
  name: string;
  slides: number;
  locales: string[];
  updatedAt: string;
}

export interface Shot {
  name: string;
  device: DeviceKind;
  file: string;
  width: number;
  height: number;
  bytes: number;
  version: number;
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
  shots: Shot[];
  images: StoredImage[];
  outputs: { locale: string; target: string; files: string[]; version: number }[];
  creativeOutputs: { locale: string; placement: PlacementId; path: string; version: number }[];
  defaultTargets: TargetId[];
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

export interface RenderResponse extends Pick<Detail, "outputs" | "creativeOutputs"> {
  files: { target: TargetId }[];
  creatives: unknown[];
  warnings: string[];
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function api<T = unknown>(method: string, route: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    payload = body;
    headers["content-type"] = "application/octet-stream";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`/api${route}`, { ...init, method, headers, body: payload });
  if (response.status === 401) {
    location.href = "/login";
    throw new Error("Signed out");
  }
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = (await response.json()).error ?? message;
    } catch {}
    throw new Error(message);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

export const metaQuery = queryOptions({ queryKey: ["meta"], queryFn: () => api<Meta>("GET", "/meta"), staleTime: Infinity });
export const projectsQuery = queryOptions({ queryKey: ["projects"], queryFn: () => api<ProjectEntry[]>("GET", "/projects") });
// Fresh for a moment, so the page that opens right after the route has loaded a project does not fetch it twice.
export const detailQuery = (id: string) => queryOptions({ queryKey: ["project", id], queryFn: () => api<Detail>("GET", `/projects/${id}`), staleTime: 2000 });

// ---------------------------------------------------------------- small helpers

export const LOCALE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
export const label = (id: string) => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

export const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "shot";

export function parseLocales(value: string): string[] {
  const list = [...new Set(value.split(/[\s,]+/).filter(Boolean))];
  if (list.length === 0 || list.some((code) => !LOCALE.test(code))) throw new Error("Languages are codes like en-US or de-DE, separated by commas.");
  return list;
}

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
