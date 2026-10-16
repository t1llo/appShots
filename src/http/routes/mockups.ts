import express, { type Router } from "express";
import { mockupName, mockupShots, mockupStage } from "../../mockup.ts";
import { renderMockup } from "../../render.ts";
import { mockupLocale, previewSettings as mockupSettings } from "../../services/mockups.ts";
import { getProject, InputError, listShots, NotFoundError } from "../../store.ts";
import { writeZip } from "../../zip.ts";
import { spaceOf } from "../auth.ts";

// The settings a mockup is drawn with, and its language, are the services' (src/services/mockups.ts), as for the MCP tool.
export { mockupSettings };

/** Device mockups of a project's screenshots: the list, one as PNG, and all of them as a ZIP. */
export function mockupRoutes(): Router {
  const api = express.Router();

  api.get("/projects/:id/mockups", async (req, res) => {
    const space = spaceOf(res);
    const project = await getProject(space, req.params.id);
    const locale = mockupLocale(project, req.query.locale);
    const settings = mockupSettings(project, req.query);
    const items = mockupShots(project, await listShots(space, project.id, project.locales), locale).map((shot) => {
      const stage = mockupStage(shot, settings);
      const file = encodeURIComponent(shot.file);
      return {
        file: shot.file,
        name: shot.name,
        device: shot.device,
        ...(shot.locale ? { locale: shot.locale } : {}),
        version: shot.version,
        saveAs: mockupName(shot),
        // The page is larger than the PNG: the PNG is cut down to the device and its shadow.
        stage: { width: stage.width, height: stage.height },
        page: `/render/${project.id}/mockup/${file}`,
        png: `/api/projects/${project.id}/mockups/${file}`,
      };
    });
    res.json({ settings: project.mockups, locale, items });
  });

  api.get("/projects/:id/mockups.zip", async (req, res) => {
    const space = spaceOf(res);
    const project = await getProject(space, req.params.id);
    const shots = await listShots(space, project.id, project.locales);
    if (shots.length === 0) throw new InputError("This project has no screenshots yet, so there is nothing to make mockups of.");
    const settings = mockupSettings(project, req.query);
    const one = req.query.locale == null || req.query.locale === "" ? undefined : mockupLocale(project, req.query.locale);
    // One language: its mockups, flat. Every language: the first one's flat, and a folder per other language for the screenshots it has of its own.
    const wanted = one
      ? mockupShots(project, shots, one).map((shot) => ({ shot, name: mockupName(shot) }))
      : [
          ...mockupShots(project, shots).map((shot) => ({ shot, name: mockupName(shot) })),
          ...project.locales.slice(1).flatMap((locale) =>
            mockupShots(project, shots, locale)
              .filter((shot) => shot.locale?.toLowerCase() === locale.toLowerCase())
              .map((shot) => ({ shot, name: `${locale}/${mockupName(shot)}` })),
          ),
        ];
    // Drawn before the first byte goes out, so a failure is still an error and not half a file.
    const entries = [];
    for (const { shot, name } of wanted) entries.push({ name, data: (await renderMockup(space, project, shot, settings)).png });
    res.type("zip").set("Content-Disposition", `attachment; filename="${project.id}-mockups.zip"`);
    await writeZip(res, entries);
    res.end();
  });

  api.get("/projects/:id/mockups/:file", async (req, res) => {
    const space = spaceOf(res);
    const project = await getProject(space, req.params.id);
    const shot = (await listShots(space, project.id, project.locales)).find((each) => each.file === req.params.file);
    if (!shot) throw new NotFoundError(`This project has no screenshot file "${req.params.file}"`);
    const mockup = await renderMockup(space, project, shot, mockupSettings(project, req.query));
    res
      .type("png")
      .set("Cache-Control", "private, no-cache")
      .set("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${mockupName(shot)}"`)
      .send(mockup.png);
  });

  return api;
}
