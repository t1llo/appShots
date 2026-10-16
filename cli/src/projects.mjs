import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * Xcode workspaces or projects in the first of these folders that has any. A workspace goes before a
 * project: it wraps the project together with what it depends on, such as CocoaPods.
 * @param {string[]} dirs
 */
export function xcodeProjects(dirs) {
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(dir).sort();
    } catch {}
    for (const extension of [".xcworkspace", ".xcodeproj"]) {
      const found = names.filter((name) => name.endsWith(extension) && !name.startsWith("."));
      if (found.length > 0) return found.map((name) => path.join(dir, name));
    }
  }
  return [];
}

// This folder (or another one given), or where a toolkit keeps the Xcode project it wraps: ./ios for React Native
// and Flutter, ./ios/App for Capacitor, ./iosApp for Kotlin Multiplatform.
export const projectDirs = (base = process.cwd()) => [".", "ios", "ios/App", "iosApp"].map((dir) => path.join(base, dir));

/** @param {string} file */
export const fromHere = (file) => path.relative(process.cwd(), file) || ".";
