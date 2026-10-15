import path from "node:path";
import express, { type Router } from "express";
import { renderProject } from "../../render.ts";
import { isTargetId, orderTargets, PLACEMENTS, type TargetId, TARGETS } from "../../sizes.ts";
import { creativeDir, type CreativeOutput, getProject, InputError, listOutputs, type OutputSet, outDir } from "../../store.ts";
import { writeZip } from "../../zip.ts";
import { spaceOf } from "../auth.ts";
import { creativeOutputs } from "./projects.ts";

/** The note at the top of the ZIP: which folder goes onto which screenshot slot of App Store Connect. */
function exportNotes(name: string, outputs: OutputSet[], creatives: CreativeOutput[]): string {
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

/** The finished set as one ZIP. */
export function exportRoutes(): Router {
  const api = express.Router();
  api.get("/projects/:id/export.zip", async (req, res) => {
    const space = spaceOf(res);
    const { id } = req.params;
    const project = await getProject(space, id);
    if (req.query.render === "1") await renderProject(space, id);
    const [outputs, creatives] = await Promise.all([listOutputs(space, id), creativeOutputs(space, id)]);
    if (outputs.length === 0 && creatives.length === 0) throw new InputError("Nothing has been rendered yet. Render the project first, or add ?render=1.");
    const entries = [
      { name: "README.txt", data: Buffer.from(exportNotes(project.name, outputs, creatives)) },
      ...outputs.flatMap((set) => set.files.map((file) => ({ name: `${set.locale}/${set.target}/${file}`, file: path.join(outDir(space, id), set.locale, set.target, file) }))),
      ...creatives.map((output) => ({ name: output.path.split(path.sep).join("/"), file: path.join(outDir(space, id), output.path) })),
    ];
    res.type("zip").set("Content-Disposition", `attachment; filename="${id}-screenshots.zip"`);
    await writeZip(res, entries);
    res.end();
  });
  return api;
}
