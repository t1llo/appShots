// What every editor of the panel works in: the project's assets, the language shown, and how a change is made.

import { createContext, useContext } from "react";
import { label, type Meta, type Shot, type StoredImage, type TargetId } from "../api.ts";
import type { Option } from "../ui/index.ts";

/** Applies a mutation to one part of a fresh copy of the project, which then becomes the draft. */
export type Change<T> = (recipe: (value: T) => void) => void;

export interface EditorScope {
  meta: Meta;
  projectId: string;
  shots: Shot[];
  /** The logos and other artwork uploaded to the project. */
  images: StoredImage[];
  target: TargetId;
  /** The language whose text the fields show, and the one a plain string belongs to. */
  locale: string;
  primary: string;
  /** Whether asset previews draw the safe area. */
  guides: boolean;
  /** Whether a slide is selected whose preview is on screen, where placed images can be dragged. */
  dragging: boolean;
}

export const Scope = createContext<EditorScope>(null as never);
export const useScope = () => useContext(Scope);

export const ids = (list: readonly string[]): Option[] => list.map((id) => [id, label(id)]);
