import { copyFile, link, stat } from "node:fs/promises";
import path from "node:path";
import { isTargetId, orderTargets, PLACEMENTS, type TargetId, TARGETS } from "../sizes.ts";
import { withProjectLock } from "../storage/mutex.ts";
import { exportStage } from "../storage/outputs.ts";
import { projectKey } from "../storage/paths.ts";
import { creativeDir, type CreativeOutput, getProject, InputError, listOutputs, type OutputSet, outDir, projectDir, type Space } from "../store.ts";
import { type ZipEntry, zipSize } from "../zip.ts";
import { creativeOutputs } from "./projects.ts";

/** The note at the top of the ZIP: which folder goes onto which screenshot slot of App Store Connect. */
export function exportNotes(name: string, outputs: OutputSet[], creatives: CreativeOutput[]): string {
  const lines = [
    `${name}: App Store screenshots`,
    "",
    "Where each folder goes in App Store Connect",
    "Open your app, then the version, then Previews and Screenshots. Pick the language at the top right,",
    "open the display named below, and drag all files of that folder onto it. The numbers keep them in order.",
    "A display you leave empty shows the screenshots of a larger one, scaled down by Apple.",
  ];
  for (const locale of [...new Set([...outputs.map((set) => set.locale), ...creatives.map((output) => output.locale)])]) {
    lines.push("", `${locale}/`);
    const sets = outputs.filter((set) => set.locale === locale && isTargetId(set.target));
    const rows = [
      ...orderTargets(sets.map((set) => set.target as TargetId)).map((id) => [`${id}/`, `${TARGETS[id].width} x ${TARGETS[id].height}`, TARGETS[id].slot]),
      ...creatives
        .filter((output) => output.locale === locale)
        .map((output) => {
          const placement = PLACEMENTS[output.placement];
          return [`${creativeDir(output.placement)}/${output.placement}.png`, `${placement.width} x ${placement.height}`, placement.kind === "banner" ? `Banner: ${placement.label}` : `Header and Search Results tab: ${placement.label}`];
        }),
    ];
    const pad = [0, 1].map((column) => Math.max(...rows.map((row) => row[column]!.length)));
    for (const row of rows) lines.push(`  ${row[0]!.padEnd(pad[0]!)}  ${row[1]!.padEnd(pad[1]!)}  ${row[2]}`);
  }
  lines.push(
    "",
    "Every file is a PNG without transparency at the exact pixel size of its display.",
    "",
    "The appshots command can do the upload: appshots store push <project> --app <bundle id> --dry-run",
    "It runs on your Mac with an App Store Connect API key of your own, and submits nothing for review.",
    "",
  );
  return lines.join("\n");
}

export interface Export {
  /** What the archive holds, the README first, each entry with its size. */
  entries: ZipEntry[];
  /** The archive's length in bytes, sent as its Content-Length. */
  size: number;
  /** Lets the files go once the archive is sent or has failed. */
  release(): Promise<void>;
}

/**
 * The project's rendered files as they are at one moment, ready to be sent as a ZIP. They are listed and linked aside
 * under the project's lock, the one a render puts its pictures in place under: a render that finishes while the
 * archive goes out replaces what out/ holds, not what the archive is made of, so a download never mixes two runs or
 * misses a file it listed.
 */
export async function takeExport(space: Space, id: string): Promise<Export> {
  const project = await getProject(space, id);
  const dir = projectDir(space, id);
  const stage = await exportStage(dir);
  try {
    const { outputs, creatives, files } = await withProjectLock(projectKey(space, id), async () => {
      const [outputs, creatives] = await Promise.all([listOutputs(space, id), creativeOutputs(space, id)]);
      const listed = [...outputs.flatMap((set) => set.files.map((file) => path.join(set.locale, set.target, file))), ...creatives.map((output) => output.path)];
      const files = await Promise.all(
        listed.map(async (relative, i) => {
          const from = path.join(outDir(space, id), relative);
          const kept = path.join(stage.dir, String(i));
          // A link costs nothing and keeps the file as it is now. A disk that has no links gets a copy.
          await link(from, kept).catch(() => copyFile(from, kept));
          return { name: relative.split(path.sep).join("/"), file: kept, size: (await stat(kept)).size };
        }),
      );
      return { outputs, creatives, files };
    });
    if (files.length === 0) throw new InputError("Nothing has been rendered yet. Render the project first, or add ?render=1.");
    const readme = Buffer.from(exportNotes(project.name, outputs, creatives));
    const entries: ZipEntry[] = [{ name: "README.txt", data: readme, size: readme.length }, ...files];
    return { entries, size: zipSize(entries.map(({ name, size }) => ({ name, size: size! }))), release: stage.release };
  } catch (error) {
    await stage.release();
    throw error;
  }
}
