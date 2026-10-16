import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoute, request } from "../api.mjs";
import { loadConfig } from "../config.mjs";
import { fail } from "../fail.mjs";
import { projectDirs, xcodeProjects } from "../projects.mjs";
import { listFlag } from "../store/push.mjs";
import { toolkits } from "../toolkits.mjs";
import { PLAN_FILE, PREVIEW_DISPLAYS, WORK_FOLDER, resolvePlan, validatePlan } from "./plan.mjs";

/** What git leaves out of the work folder: everything large. The plan beside it is what is meant to be committed. */
export const GITIGNORE = `# Recordings, layers and previews are large and made again from appshots.video.json, which is what to commit.
raw/
work/
layers/
out/
remotion/node_modules/
remotion/out/
remotion/public/
`;

/** A preview runs 15 to 30 seconds, which holds three or four moments of about six seconds with the cards. */
const MOST_SCENES = 4;

/**
 * @typedef {{ id: string, name: string, locales: string[], slides: Array<Record<string, any>> }} Project
 * @typedef {{ name: string, device?: string }} Shot
 */

/**
 * The plan `video init` writes for a project: the first slide's headline on the intro card, one scene for each
 * of the next slides that show a screen, up to four, each with its slide's headline as its caption. How the app
 * gets through each moment is left for the agent to fill in with the user.
 * @param {Project} project
 * @param {Shot[]} shots
 * @param {{ displays?: string[] | null, locales?: string[] | null, platform?: "ios" | "mac" | "web", url?: string | null }} [choice]
 */
export function planFromProject(project, shots, { displays, locales, platform, url } = {}) {
  const has = new Set(shots.map((shot) => shot.device ?? "iphone"));
  const shown = displays ?? ["iphone", "ipad", "mac"].filter((key) => has.has(key) || (key === "iphone" && has.has("duo")));
  const keys = shown.length > 0 ? shown : ["iphone"];
  // One plan is one kind of app; a Mac version's previews need a plan of their own.
  const kind = platform ?? (keys.every((key) => key === "mac") ? "mac" : "ios");
  const fitting = kind === "web" ? keys : keys.filter((key) => PREVIEW_DISPLAYS[key] === kind);

  const slides = project.slides;
  const first = slides[0];
  const usable = (slide) => typeof slide.headline === "string" ? slide.headline.trim() !== "" : Boolean(slide.headline && Object.keys(slide.headline).length);
  // The first slide is usually the app's promise, which suits the intro card better than one moment of it.
  const rest = slides.length > 1 ? slides.slice(1) : slides;
  const moments = rest.map((slide) => ({ slide, number: slides.indexOf(slide) + 1 })).filter(({ slide }) => usable(slide));
  const withScreen = moments.filter(({ slide }) => typeof slide.screenshot === "string");
  const chosen = (withScreen.length > 0 ? withScreen : moments).slice(0, MOST_SCENES);

  const ids = new Set();
  const idOf = (slide, number) => {
    const base = String(slide.screenshot ?? `scene-${number}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || `scene-${number}`;
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  const scenes = chosen.length > 0 ? chosen.map(({ slide, number }) => ({ id: idOf(slide, number), caption: { slide: number } })) : [{ id: "app" }];

  return {
    version: 1,
    project: project.id,
    app: kind === "web" && url ? { platform: kind, url } : { platform: kind },
    displays: fitting.length > 0 ? fitting : [kind === "mac" ? "mac" : "iphone"],
    locales: locales ?? project.locales,
    ...(slides.length > 1 && first && usable(first) ? { intro: { headline: { slide: 1 } } } : {}),
    outro: { logo: true },
    scenes,
  };
}

/**
 * `appshots video init [project]`: writes appshots.video.json and appshots-video/.gitignore from the project's
 * slides. It writes over a plan only with --again, since a plan holds work.
 * @param {string | undefined} given
 * @param {Record<string, string | true>} flags
 */
export async function initPlan(given, flags) {
  if (flags.plan === true) fail("--plan needs a file name, such as --plan appshots.video.json.");
  const file = path.resolve(typeof flags.plan === "string" ? flags.plan : PLAN_FILE);
  if (existsSync(file) && !flags.again) fail(`${path.basename(file)} is there already. Change it by hand, or write it anew from the slides with 'appshots video init --again', which loses what was changed in it.`);
  const config = loadConfig();
  const id = given ?? (await onlyProject(config));
  const { project, shots } = await (await request(config, "GET", projectRoute(id))).json();

  const displays = listFlag(flags, "display", "iphone,ipad");
  for (const key of displays ?? []) if (!Object.hasOwn(PREVIEW_DISPLAYS, key)) fail(`--display ${key}: previews are made for ${Object.keys(PREVIEW_DISPLAYS).join(", ")}.`);
  const asked = listFlag(flags, "lang", project.locales.slice(0, 2).join(","));
  // Each language must be one the project has, written as the project writes it.
  const locales = asked ? resolvePlan({ locales: asked }, project).locales : null;

  // A web app is told by the plan's folder: a dev server and nothing that runs in a simulator or a window.
  const kits = toolkits(path.dirname(file));
  const web = xcodeProjects(projectDirs(path.dirname(file))).length === 0 && kits.length > 0 && kits.every((kit) => kit.web && !kit.simulator && !kit.window) ? kits.find((kit) => kit.web)?.web : null;
  const plan = planFromProject(project, shots ?? [], { displays, locales, platform: web ? "web" : undefined, url: web?.address ?? null });
  const dropped = (displays ?? []).filter((key) => !plan.displays.includes(key));
  if (dropped.length > 0) console.error(`appshots: ${dropped.join(", ")} ${dropped.length === 1 ? "is" : "are"} not a display of this kind of app, so the plan leaves ${dropped.length === 1 ? "it" : "them"} out. A Mac app's previews need a plan of their own: --plan appshots.mac.video.json --display mac.`);
  const { problems } = validatePlan(plan);
  if (problems.length > 0) fail(`The plan made from project ${id} does not hold up:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);

  writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
  const ignore = path.join(path.dirname(file), WORK_FOLDER, ".gitignore");
  if (!existsSync(ignore)) {
    mkdirSync(path.dirname(ignore), { recursive: true });
    writeFileSync(ignore, GITIGNORE);
  }
  const scenes = plan.scenes.length;
  console.log(`Wrote ${path.relative(process.cwd(), file) || file}: ${scenes} scene${scenes === 1 ? "" : "s"} from the slides of ${project.name ?? id}, for ${plan.displays.join(", ")} in ${plan.locales.join(", ")}.`);
  console.log("Next: give each scene its drive (how the app gets through that moment), then run 'appshots video plan'.");
}

/**
 * The account's only project, for a command run without one.
 * @param {import("../config.mjs").Config} config
 */
async function onlyProject(config) {
  /** @type {Array<{ id: string, name: string }>} */
  const projects = await (await request(config, "GET", "/api/projects")).json();
  if (projects.length === 1) return projects[0].id;
  if (projects.length === 0) fail("There is no project yet. Make the screenshots first: the previews take their captions, fonts and background from the project.");
  fail(`Name the project: appshots video init <project>. The projects are:\n${projects.map((p) => `  ${p.id}  ${p.name}`).join("\n")}`);
}
