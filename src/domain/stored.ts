import { z } from "zod";
import { type Project, projectSchema } from "../schema.ts";

// How a stored project.json is read. Input from a client is checked strictly and refused when it is wrong; a file
// on disk was valid when it was written and is read as kindly as possible, because refusing it would lock its owner
// out of their own work. A value a newer or older build no longer accepts, such as a font that has since been
// removed, is left out on its own, and the rest of the project opens.

/** A project as read from disk, and the fields that had to be left out to read it. */
export interface Salvaged {
  project: Project;
  /** Paths of the values left out, such as `theme.font` or `slides[2]`. */
  dropped: string[];
}

const DROP = Symbol("drop");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The value as the schema takes it, with what fails left out piece by piece, or DROP when nothing of it can stay. */
function salvage(schema: z.ZodType, value: unknown, at: string, dropped: string[]): unknown {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) return salvage(schema.unwrap() as z.ZodType, value, at, dropped);
  // What is left out inside counts only if the whole stays; otherwise the whole is what was left out.
  const inside: string[] = [];
  if (schema instanceof z.ZodObject && isRecord(value)) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const kept: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      if (!Object.hasOwn(shape, key)) continue;
      const result = salvage(shape[key]!, field, at ? `${at}.${key}` : key, inside);
      if (result !== DROP) kept[key] = result;
    }
    const again = schema.safeParse(kept);
    if (again.success) {
      dropped.push(...inside);
      return again.data;
    }
  } else if (schema instanceof z.ZodArray && Array.isArray(value)) {
    const items = value.map((item, i) => salvage(schema.element as z.ZodType, item, `${at}[${i}]`, inside)).filter((item) => item !== DROP);
    // Too many of them: the first ones stay, as many as fit.
    for (let count = items.length; count >= 0; count--) {
      const again = schema.safeParse(items.slice(0, count));
      if (!again.success) continue;
      dropped.push(...inside, ...(count < items.length ? [`${at}[${count}…]`] : []));
      return again.data;
    }
  }
  dropped.push(at);
  return DROP;
}

/** Each language once, the first of its spellings kept: a project saved before that was checked may have one twice. */
function onceEach(locales: unknown, dropped: string[]): unknown {
  if (!Array.isArray(locales)) return locales;
  const seen = new Set<string>();
  return locales.filter((code, i) => {
    const key = typeof code === "string" ? code.toLowerCase() : `${i}`;
    if (seen.has(key)) {
      dropped.push(`locales[${i}]`);
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Reads a project.json that has been parsed and migrated. The folder it lies in names it, whatever the file says.
 * `time` stands in for a missing or broken date. Throws only for something that is no object at all.
 */
export function readStored(raw: unknown, id: string, time: string): Salvaged {
  if (!isRecord(raw)) throw new TypeError("A stored project is a JSON object");
  const dropped: string[] = [];
  const input: Record<string, unknown> = { ...raw, id, locales: onceEach(raw.locales, dropped) };
  const parsed = projectSchema.safeParse(input);
  let project: Project;
  if (parsed.success) project = parsed.data;
  else {
    const shape = projectSchema.shape as Record<string, z.ZodType>;
    const kept: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(shape)) {
      if (!Object.hasOwn(input, key)) continue;
      const result = salvage(field, input[key], key, dropped);
      if (result !== DROP) kept[key] = result;
    }
    // What a project cannot be without.
    project = projectSchema.parse({ name: id, createdAt: time, updatedAt: time, locales: ["en"], theme: {}, slides: [], ...kept });
  }
  return { project: withUnknownKeys(raw, project), dropped };
}

/**
 * Puts back the top-level keys of `source` that this build does not know, such as a field a newer one added, so a
 * write by this one does not throw them away. Inside slides and the theme they are not kept: clients replace those
 * whole, so they would not survive the next edit anyway.
 */
export function withUnknownKeys(source: object, project: Project): Project {
  const shape = projectSchema.shape;
  const extra = Object.entries(source).filter(([key, value]) => !Object.hasOwn(shape, key) && value !== undefined);
  return extra.length ? { ...project, ...Object.fromEntries(extra) } : project;
}
