// One project: its screenshots, slides and store assets as live previews, with the editor beside them.
// The previews are iframes of the very pages the renderer screenshots, so what is on screen is what gets exported.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type Creative,
  type Detail,
  detailQuery,
  type DeviceKind,
  drawnSize,
  errorText,
  exportSizes,
  label,
  type Meta,
  type PlacedImage,
  type PlacementId,
  plural,
  type Project,
  projectsQuery,
  type RenderResponse,
  type Shot,
  shotIn,
  slugify,
  type StoredImage,
  type TargetId,
} from "./api.ts";
import { openProject, useOpenDialog } from "./dialogs.tsx";
import { type Change, CreativeEditor, PLACED_SPOTS, ProjectEditor, Scope, SlideEditor } from "./editor.tsx";
import { languageName, LanguageSwitch } from "./languages.tsx";
import { Icon, toast } from "./ui.tsx";

const PENCIL = "M10.6 2.6l2.8 2.8M2.5 13.5l.6-3.1 7.9-7.9 2.5 2.5-7.9 7.9z";
const TRASH = "M2.8 4.2h10.4M6.3 4.2V2.6h3.4v1.6M4.1 4.2l.6 9.2h6.6l.6-9.2M6.7 6.8v4.2M9.3 6.8v4.2";
const UPLOAD = "M8 10.6V2.8M4.9 5.7L8 2.6l3.1 3.1M2.8 10.4v2.8h10.4v-2.8";

const SLIDE_HEIGHT = 440;
const ASSET_HEIGHT = 190;
/** From this window width on, the selected slide is also shown large beside its fields. */
const FOCUS_FROM = 1360;

type Selection = { kind: "slide"; index: number } | { kind: "creative"; placement: PlacementId } | null;

/** The part of a project the Studio edits and sends back. */
type Saved = Pick<Project, "name" | "locales" | "theme" | "slides" | "creatives"> & { targets: TargetId[] | null };

const snapshot = (project: Project) =>
  JSON.stringify({ name: project.name, locales: project.locales, targets: project.targets ?? null, theme: project.theme, slides: project.slides, creatives: project.creatives } satisfies Saved);
const shotsKey = (shots: (Shot | StoredImage)[]) => shots.map((shot) => `${shot.file}:${shot.version}`).join(",");

/** The file drop anywhere in the window goes to whichever project is open, as screenshots or as logos and images. */
export const dropTarget: { upload: ((files: File[], kind: "shot" | "image") => void) | null } = { upload: null };

// ---------------------------------------------------------------- previews

/** Loads the new preview underneath and swaps once it has laid itself out, so edits never flash blank. */
function Stage({ src, frameKey, width, height, scale }: { src: string | null; frameKey: string; width: number; height: number; scale: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = ref.current!;
    if (src == null || stage.dataset.key === frameKey) return;
    stage.dataset.key = frameKey;
    const frame = document.createElement("iframe");
    frame.className = "incoming";
    frame.src = `${src}&t=${Date.now()}`;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = `width:${width}px;height:${height}px;transform:scale(${scale})`;
    frame.addEventListener("load", () => {
      const started = performance.now();
      const reveal = () => {
        let ready = true;
        try {
          ready = frame.contentDocument?.body?.dataset.ready === "1";
        } catch {}
        if (!ready && performance.now() - started < 4000) return void setTimeout(reveal, 60);
        if (stage.dataset.key !== frameKey) return frame.remove();
        frame.classList.remove("incoming");
        // The old preview stays underneath until the new one has faded in and been painted.
        for (const old of stage.querySelectorAll("iframe")) if (old !== frame) setTimeout(() => old.remove(), 400);
      };
      reveal();
    });
    stage.append(frame);
  }, [src, frameKey, width, height, scale]);
  return <div className="stage" ref={ref} style={{ width: Math.round(width * scale), height: Math.round(height * scale) }} />;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Lies over the large preview with one handle per placed image, so an image is moved by dragging it. The preview
 * itself only changes once the move is saved, so a handle shows its image for as long as the two differ.
 */
function PlacedHandles(props: { placed: PlacedImage[]; shown: PlacedImage[]; images: StoredImage[]; projectId: string; onMove: (index: number, x: number, y: number) => void }) {
  const { placed, shown, images, projectId, onMove } = props;
  const box = useRef<HTMLDivElement>(null);
  const grip = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ index: number; x: number; y: number } | null>(null);
  return (
    <div className="handles" ref={box}>
      {placed.map((item, index) => {
        const image = images.find((entry) => entry.name === item.image);
        if (!image) return null;
        const dragging = drag?.index === index;
        const x = dragging ? drag.x : (item.x ?? 50);
        const y = dragging ? drag.y : (item.y ?? 50);
        const waiting = shown[index]?.x !== item.x || shown[index]?.y !== item.y;
        return (
          <div
            key={index}
            className={`handle${dragging ? " dragging" : ""}`}
            title={`Drag to move ${item.image}`}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: `${item.size ?? 30}%`,
              aspectRatio: `${image.width} / ${image.height}`,
              transform: `translate(-50%, -50%) rotate(${item.rotate ?? 0}deg)${item.flip ? " scaleX(-1)" : ""}`,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              grip.current = { pointerX: event.clientX, pointerY: event.clientY, x, y };
              setDrag({ index, x, y });
            }}
            onPointerMove={(event) => {
              const from = grip.current;
              if (!from || !dragging) return;
              const frame = box.current!.getBoundingClientRect();
              setDrag({
                index,
                x: clamp(Math.round(from.x + ((event.clientX - from.pointerX) / frame.width) * 100), -30, 130),
                y: clamp(Math.round(from.y + ((event.clientY - from.pointerY) / frame.height) * 100), -30, 130),
              });
            }}
            onPointerUp={() => {
              if (dragging && (drag.x !== (item.x ?? 50) || drag.y !== (item.y ?? 50))) onMove(index, drag.x, drag.y);
              grip.current = null;
              setDrag(null);
            }}
            onPointerCancel={() => {
              grip.current = null;
              setDrag(null);
            }}
          >
            {dragging || waiting ? <img src={`/files/${projectId}/images/${image.file}?v=${image.version}`} alt="" draggable={false} style={{ opacity: item.opacity ?? 1 }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function useViewport() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const read = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

// ---------------------------------------------------------------- page

export function ProjectPage({ meta, initial, openConnect }: { meta: Meta; initial: Detail; openConnect: () => void }) {
  const id = initial.project.id;
  const queryClient = useQueryClient();
  const openDialog = useOpenDialog();
  const titleField = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState(initial.project);
  /** What the server last accepted. The previews show this, not the draft. */
  const [saved, setSaved] = useState<Saved>(() => JSON.parse(snapshot(initial.project)));
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection>(initial.project.slides.length ? { kind: "slide", index: 0 } : null);
  const [tab, setTab] = useState<"item" | "project">("item");
  const [target, setTarget] = useState<TargetId>(() => drawnSize(meta, initial.defaultTargets[0]!));
  const [chosenLocale, setLocale] = useState(initial.project.locales[0]!);
  const [status, setStatusState] = useState({ text: "", error: false });
  const [title, setTitle] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const viewport = useViewport();
  const [guides, setGuidesState] = useState(() => {
    try {
      return localStorage.getItem("appshots.guides") === "1";
    } catch {
      return false;
    }
  });
  const setGuides = (on: boolean) => {
    setGuidesState(on);
    try {
      localStorage.setItem("appshots.guides", on ? "1" : "0");
    } catch {}
  };

  // Timers and requests outlive renders, so they read the draft from here.
  const latest = useRef(draft);
  const savedText = useRef(snapshot(initial.project));
  const saveTimer = useRef<number | null>(null);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const deleted = useRef(false);
  const lastEdit = useRef(0);
  const statusTimer = useRef<number | undefined>(undefined);

  const setStatus = useCallback((text: string, error = false) => {
    clearTimeout(statusTimer.current);
    setStatusState({ text, error });
    if (text && !error && text !== "Saving…") statusTimer.current = window.setTimeout(() => setStatusState({ text: "", error: false }), 1500);
  }, []);

  const isDirty = () => saveTimer.current !== null || snapshot(latest.current) !== savedText.current;

  const save = useCallback(
    (init?: RequestInit) => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      inflight.current = inflight.current.then(async () => {
        if (deleted.current) return;
        const body = snapshot(latest.current);
        try {
          if (body === savedText.current) return setStatus("");
          const fresh = await api<Detail>("PUT", `/projects/${id}`, JSON.parse(body), init);
          savedText.current = body;
          setSaved(JSON.parse(body));
          latest.current = { ...latest.current, updatedAt: fresh.project.updatedAt };
          setDraft(latest.current);
          queryClient.setQueryData(detailQuery(id).queryKey, fresh);
          queryClient.setQueryData(projectsQuery.queryKey, (list) => list?.map((entry) => (entry.id === id ? { ...entry, name: fresh.project.name } : entry)));
          setStatus("Saved");
        } catch (error) {
          setStatus(`Not saved: ${errorText(error)}`, true);
        } finally {
          setDirty(isDirty());
        }
      });
      return inflight.current;
    },
    [id, queryClient, setStatus],
  );

  /**
   * Changes the draft and saves it. A single edit saves at once, so picking a layout shows right away; edits in quick
   * succession, which is typing, wait for a pause. `now` skips the wait for the steps that add, move or remove things.
   */
  const update = useCallback(
    (recipe: (project: Project) => void, now = false) => {
      const next = structuredClone(latest.current);
      recipe(next);
      latest.current = next;
      setDraft(next);
      setDirty(true);
      const typing = performance.now() - lastEdit.current < 600;
      lastEdit.current = performance.now();
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void save(), typing && !now ? 350 : 0);
      setStatus("Saving…");
    },
    [save, setStatus],
  );

  // Leaving the project or the page sends what is still waiting.
  useEffect(() => {
    const onUnload = () => {
      if (saveTimer.current !== null) void save({ keepalive: true });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (saveTimer.current !== null) void save();
    };
  }, [save]);

  // Picks up changes made elsewhere while the Studio is open: an agent editing through MCP, or the CLI uploading a capture.
  const live = useQuery({ ...detailQuery(id), refetchInterval: dirty ? false : 3000 });
  const detail = live.data ?? initial;
  const { shots, images } = detail;
  useEffect(() => {
    const fresh = live.data?.project;
    if (!fresh || fresh.updatedAt <= latest.current.updatedAt || isDirty()) return;
    latest.current = fresh;
    savedText.current = snapshot(fresh);
    setDraft(fresh);
    setSaved(JSON.parse(savedText.current));
    setSelection((current) => {
      if (current?.kind === "creative" && fresh.creatives[current.placement]) return current;
      if (fresh.slides.length === 0) return null;
      return { kind: "slide", index: current?.kind === "slide" ? Math.min(current.index, fresh.slides.length - 1) : 0 };
    });
  }, [live.dataUpdatedAt]);

  // The first screenshots decide whether the set opens as an iPhone or an iPad one.
  const hadShots = useRef(initial.shots.length > 0);
  useEffect(() => {
    if (hadShots.current || shots.length === 0) return;
    hadShots.current = true;
    setTarget(drawnSize(meta, detail.defaultTargets[0]!));
  }, [shots.length]);

  useEffect(() => {
    document.title = `${draft.name} · appShots Studio`;
    return () => void (document.title = "appShots Studio");
  }, [draft.name]);

  /** The first language is the one whose texts and screenshots the others show until they have their own. */
  const first = draft.locales[0]!;
  const locale = draft.locales.includes(chosenLocale) ? chosenLocale : first;
  const addLanguage = (code: string) => {
    update((project) => void project.locales.push(code), true);
    setLocale(code);
    toast(`${languageName(code)} added. It shows the ${languageName(first)} texts and screenshots until it has its own.`, "", 7000);
  };
  /** Whether a screenshot was made for the language shown. Those without a language are the first language's. */
  const own = (shot: Shot) => (shot.locale ?? first).toLowerCase() === locale.toLowerCase();
  const slideIndex = selection?.kind === "slide" && selection.index < draft.slides.length ? selection.index : null;
  const placement = selection?.kind === "creative" && draft.creatives[selection.placement] ? selection.placement : null;
  const placements = Object.keys(meta.placements) as PlacementId[];
  const shotNames = [...new Set(shots.map((shot) => shot.name))];

  // ---------------------------------------------------------------- screenshots

  const reload = async () => {
    await save();
    await queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
  };

  const assignShot = (shot: Shot) => {
    if (slideIndex != null) {
      return update((project) => {
        const slide = project.slides[slideIndex]!;
        // A layout with several devices takes the screenshot in its first free place.
        const keys = (["screenshot", "screenshot2", "screenshot3"] as const).slice(0, Math.max(1, meta.layoutShots[slide.layout ?? "device-bottom"] ?? 1));
        if (keys.some((key) => slide[key] === shot.name)) return;
        slide[keys.find((key) => !slide[key]) ?? keys[0]!] = shot.name;
      }, true);
    }
    if (placement == null) return toast("Select a slide or an asset first, then click a screenshot to use it there.");
    if ((draft.creatives[placement]!.screenshots?.length ?? 0) >= 6) return toast("An asset takes up to six screenshots.");
    update((project) => {
      const creative = project.creatives[placement]!;
      creative.screenshots = [...(creative.screenshots ?? []), shot.name];
    }, true);
  };

  /** Files a screenshot under another device, for one whose size did not give it away. */
  const moveShot = async (shot: Shot, device: DeviceKind) => {
    const label = meta.devices.find((entry) => entry.id === device)!.label;
    if (shots.some((other) => other.name === shot.name && other.device === device && other.locale === shot.locale) && !confirm(`"${shot.name}" already has a screenshot for the ${label}. Replace it?`)) return;
    try {
      await api("PATCH", `/projects/${id}/shots/${shot.file}`, { device });
      await reload();
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  const removeShot = async (shot: Shot) => {
    const others = shots.some((other) => other !== shot && other.name === shot.name && other.device === shot.device);
    if (!confirm(shot.locale && others ? `Delete the ${languageName(shot.locale)} screenshot "${shot.name}"? ${languageName(shot.locale)} then shows the ${languageName(first)} one again.` : `Delete the screenshot "${shot.name}"?`)) return;
    try {
      await api("DELETE", `/projects/${id}/shots/${shot.file}`);
      await reload();
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  const upload = useCallback(
    async (files: File[], kind: "shot" | "image" = "shot", as?: string) => {
      const pictures = files.filter((file) => file.type.startsWith("image/"));
      if (pictures.length === 0) return toast("Those are not images.", "error");
      setStatus(`Uploading ${pictures.length}…`);
      if (kind === "image") {
        for (const file of pictures) {
          try {
            await api<StoredImage>("PUT", `/projects/${id}/images/${slugify(file.name.replace(/\.[^.]+$/, ""))}`, file);
          } catch (error) {
            toast(`${file.name}: ${errorText(error)}`, "error");
          }
        }
        setStatus("");
        await save();
        return void (await queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey }));
      }
      // A language added a moment ago has to be the project's before a screenshot can be filed under it.
      await save();
      const known = new Set(shots.map((shot) => shot.name));
      const language = locale === first ? "" : `?locale=${encodeURIComponent(locale)}`;
      const uploaded: Shot[] = [];
      for (const file of pictures) {
        try {
          uploaded.push(await api<Shot>("PUT", `/projects/${id}/shots/${as ?? slugify(file.name.replace(/\.[^.]+$/, ""))}${language}`, file));
        } catch (error) {
          toast(`${file.name}: ${errorText(error)}`, "error");
        }
      }
      // In another language, a screenshot takes the place of the first language's only under the same name.
      const fresh = [...new Set(uploaded.filter((shot) => shot.locale && !known.has(shot.name)).map((shot) => `"${shot.name}"`))];
      if (fresh.length && known.size) {
        toast(
          `${fresh.join(", ")} ${fresh.length === 1 ? "is a new name" : "are new names"}, so every language shows ${fresh.length === 1 ? "it" : "them"}. To give ${languageName(locale)} its own version of a screenshot, name the file like it, or use the arrow on that screenshot.`,
          "warn",
          10000,
        );
      }
      // Fresh uploads fill slides that are still waiting for a screenshot, so a new project comes alive on the first drop.
      const { slides } = latest.current;
      const used = new Set(slides.flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3]));
      const waiting = slides.flatMap((slide, index) => (slide.screenshot ? [] : [index]));
      const fills = uploaded.filter((shot) => !used.has(shot.name) && used.add(shot.name)).slice(0, waiting.length);
      if (fills.length) update((project) => fills.forEach((shot, at) => void (project.slides[waiting[at]!]!.screenshot = shot.name)), true);
      setStatus("");
      await save();
      await queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
    },
    [id, queryClient, save, setStatus, update, shots, locale, first],
  );
  useEffect(() => {
    dropTarget.upload = (files, kind) => void upload(files, kind);
    return () => void (dropTarget.upload = null);
  }, [upload]);

  // ---------------------------------------------------------------- logos and images

  /** A click puts an image on the selected slide, each new one in another spot, or makes it the logo of the selected asset. */
  const placeImage = (image: StoredImage) => {
    if (placement != null) return update((project) => void (project.creatives[placement]!.logo = { ...project.creatives[placement]!.logo, image: image.name }), true);
    if (slideIndex == null) return toast("Select a slide first, then click an image to place it there.");
    const count = draft.slides[slideIndex]!.images?.length ?? 0;
    if (count >= 10) return toast("A slide takes up to ten images.");
    const [x, y, rotate] = PLACED_SPOTS.scattered![count % PLACED_SPOTS.scattered!.length]!;
    update((project) => {
      const slide = project.slides[slideIndex]!;
      slide.images = [...(slide.images ?? []), { image: image.name, x, y, size: 24, rotate }];
    }, true);
  };

  const removeImage = async (image: StoredImage) => {
    if (!confirm(`Delete the image "${image.name}"? Slides that show it will leave it out.`)) return;
    try {
      await api("DELETE", `/projects/${id}/images/${image.file}`);
      await reload();
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  // ---------------------------------------------------------------- slides and assets

  const select = (next: Selection) => {
    setSelection(next);
    setTab("item");
  };

  // Moving through the set with the arrows keeps the selected card in view.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) document.querySelector(".workspace .card.selected")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    opened.current = true;
  }, [slideIndex, placement]);

  const addSlide = () => {
    const used = new Set(draft.slides.map((slide) => slide.screenshot));
    const unused = shotNames.find((name) => !used.has(name));
    const at = slideIndex == null ? draft.slides.length : slideIndex + 1;
    update((project) => void project.slides.splice(at, 0, { layout: "device-bottom", headline: "Your headline", ...(unused ? { screenshot: unused } : {}) }), true);
    select({ kind: "slide", index: at });
  };

  const slideActions = (index: number) => ({
    move: (delta: number) => {
      const to = index + delta;
      if (to < 0 || to >= draft.slides.length) return;
      update(({ slides }) => void ([slides[index], slides[to]] = [slides[to]!, slides[index]!]), true);
      setSelection({ kind: "slide", index: to });
    },
    duplicate: () => {
      update(({ slides }) => void slides.splice(index + 1, 0, structuredClone(slides[index]!)), true);
      setSelection({ kind: "slide", index: index + 1 });
    },
    remove: () => {
      if (!confirm(`Delete slide ${index + 1}?`)) return;
      update(({ slides }) => void slides.splice(index, 1), true);
      setSelection(draft.slides.length > 1 ? { kind: "slide", index: Math.min(index, draft.slides.length - 2) } : null);
    },
  });

  /** A new asset starts as a copy of one the project already has, or from the slides: their first headline and screenshots. */
  const addCreative = (where: PlacementId) => {
    const existing = placements.map((other) => draft.creatives[other]).find(Boolean);
    const fromSlides = draft.slides.map((slide) => slide.screenshot).filter((name): name is string => name != null && shotNames.includes(name));
    const screenshots = [...new Set([...fromSlides, ...shotNames])].slice(0, 3);
    const headline = draft.slides.find((slide) => slide.headline)?.headline ?? draft.name;
    const seed: Creative = existing ? structuredClone(existing) : { layout: "fan", headline, ...(screenshots.length ? { screenshots } : {}) };
    update((project) => void (project.creatives[where] = seed), true);
    select({ kind: "creative", placement: where });
  };

  const removeCreative = (where: PlacementId) => {
    if (!confirm(`Remove the ${meta.placements[where].label.toLowerCase()} asset?`)) return;
    update((project) => void delete project.creatives[where], true);
    setSelection(draft.slides.length ? { kind: "slide", index: 0 } : null);
  };

  // ---------------------------------------------------------------- project

  const rename = (name: string) => {
    update((project) => void (project.name = name));
    queryClient.setQueryData(projectsQuery.queryKey, (list) => list?.map((entry) => (entry.id === id ? { ...entry, name } : entry)));
  };

  // The rename and delete dialogs reach the open project through here, whichever button opened them.
  useEffect(() => {
    openProject.id = id;
    openProject.rename = rename;
    openProject.quiesce = async () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await inflight.current;
      deleted.current = true;
      return () => void (deleted.current = false);
    };
    return () => void (openProject.id = null);
  });

  const deleteProject = () => openDialog({ remove: { id, name: draft.name } });

  const exportZip = async () => {
    setExporting(true);
    try {
      await save();
      // Every size of the project: one design per device, and each display of App Store Connect gets its own folder.
      const result = await api<RenderResponse>("POST", `/projects/${id}/render`, {});
      queryClient.setQueryData(detailQuery(id).queryKey, (current) => current && { ...current, outputs: result.outputs, creativeOutputs: result.creativeOutputs });
      if (result.warnings.length) toast(result.warnings.join("\n"), "warn", 9000);
      const assets = result.creatives.length ? ` and ${plural(result.creatives.length, "header and search results asset")}` : "";
      const sizes = new Set(result.files.map((file) => file.target)).size;
      toast(`Rendered ${plural(result.files.length, "screenshot")}${sizes > 1 ? ` in ${sizes} sizes` : ""}${assets}. The download starts now.`);
      const link = document.createElement("a");
      link.href = `/api/projects/${id}/export.zip`;
      link.download = "";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      toast(errorText(error), "error", 8000);
    } finally {
      setExporting(false);
    }
  };

  // ---------------------------------------------------------------- render

  const size = meta.targets[target];
  const device = size.device;
  const sizes = exportSizes(meta, draft, shots);
  /** The shapes of one device the export holds. Each is drawn on its own, so each has a preview; the other sizes are these scaled. */
  const shapesOf = (kind: DeviceKind) => {
    const drawn = [...new Set(sizes.filter((key) => meta.targets[key].device === kind).map((key) => drawnSize(meta, key)))];
    return drawn.length ? drawn : [(Object.keys(meta.targets) as TargetId[]).find((key) => meta.targets[key].device === kind)!];
  };
  const shapes = shapesOf(device).includes(target) ? shapesOf(device) : [target, ...shapesOf(device)];
  const deviceOrder = meta.devices.map((entry) => entry.id);
  // One tile per name and device: what the language shown has there, which is the first language's until it gets its own.
  const shownShots = deviceOrder.flatMap((kind) => shotNames.flatMap((name) => shotIn(shots.filter((shot) => shot.device === kind && shot.name === name), locale) ?? []));
  const mixed = new Set(shots.map((shot) => shot.device)).size > 1;
  const slideScale = SLIDE_HEIGHT / size.height;
  const used = new Set([...draft.slides.flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3]), ...placements.flatMap((where) => draft.creatives[where]?.screenshots ?? [])]);
  const usedImages = new Set([
    ...draft.slides.flatMap((slide) => [slide.logo?.image, ...(slide.images ?? []).map((placed) => placed.image)]),
    ...placements.map((where) => draft.creatives[where]?.logo?.image),
  ]);
  const look = [saved.theme, saved.locales[0], locale, shotsKey(shots), shotsKey(images)];
  const changeSlide: Change<Project["slides"][number]> = (recipe) => update((project) => recipe(project.slides[slideIndex!]!));
  const changeCreative: Change<Creative> = (recipe) => update((project) => recipe(project.creatives[placement!]!));

  // The large preview of the selected slide: as tall as the panel allows, within a column that leaves the gallery two cards.
  const focused = slideIndex != null && slideIndex < saved.slides.length && viewport.width >= FOCUS_FROM;
  const focusScale = Math.min(Math.min(380, Math.max(260, viewport.width * 0.2)) / size.width, (viewport.height - 150) / size.height);

  const itemTab = placement ? meta.placements[placement].label : slideIndex != null ? `Slide ${slideIndex + 1}` : "Slide";

  return (
    <div className="main">
      <header className="bar">
        <span className="crumb">{draft.name}</span>
        <span className="spacer" />
        <span className={`status${status.error ? " error" : ""}`} role="status">
          {status.text}
        </span>
        <button className="btn primary" type="button" disabled={exporting} onClick={() => void exportZip()}>
          {exporting ? "Rendering…" : "Export ZIP"}
        </button>
      </header>

      <div className="content">
        <div className="workspace">
          <div className="page-head">
            <div className="title-row">
              <input
                className="title"
                ref={titleField}
                type="text"
                maxLength={80}
                placeholder="Untitled"
                aria-label="Project name"
                title="Click to rename"
                spellCheck={false}
                value={title ?? draft.name}
                onChange={(event) => {
                  setTitle(event.target.value);
                  const name = event.target.value.trim();
                  if (name) rename(name);
                }}
                onKeyDown={(event) => (event.key === "Enter" || event.key === "Escape") && event.currentTarget.blur()}
                onBlur={() => setTitle(null)}
              />
              <button
                className="btn small quiet"
                type="button"
                onClick={() => {
                  titleField.current?.focus();
                  titleField.current?.select();
                }}
              >
                <Icon path={PENCIL} />
                Rename
              </button>
              <button className="btn small quiet danger" type="button" onClick={deleteProject}>
                <Icon path={TRASH} />
                Delete
              </button>
            </div>
            <div className="page-meta">{[plural(draft.slides.length, "slide"), plural(shots.length, "screenshot"), draft.locales.join(", ")].join(" · ")}</div>
          </div>

          <section>
            <div className="section-head wrap">
              <h2>Screenshots</h2>
              <span className="hint">
                {!shots.length
                  ? ""
                  : locale === first
                    ? "Click one to put it in the selected slide or asset."
                    : `The dimmed ones are ${languageName(first)}. Upload the ${languageName(locale)} ones under the same names.`}
              </span>
              <div className="head-actions">
                {draft.locales.length > 1 ? <LanguageSwitch locales={draft.locales} value={locale} onChange={setLocale} /> : null}
                <label className="btn small">
                  Upload
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(event) => {
                      void upload([...(event.target.files ?? [])]);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="shots">
              {shownShots.map((shot) => (
                <div
                  key={shot.file}
                  className={`shot${used.has(shot.name) ? " used" : ""}${own(shot) ? "" : " borrowed"}`}
                  role="button"
                  tabIndex={0}
                  title={`${shot.name} · ${shot.width}×${shot.height}${own(shot) ? "" : ` · the ${languageName(shot.locale ?? first)} one, until ${languageName(locale)} has its own`}`}
                  onClick={() => assignShot(shot)}
                  onKeyDown={(event) => event.key === "Enter" && event.target === event.currentTarget && assignShot(shot)}
                >
                  <img src={`/files/${id}/shots/${shot.file}?v=${shot.version}`} alt="" loading="lazy" />
                  {mixed || shot.device !== "iphone" ? (
                    <select
                      className="tag"
                      aria-label={`Device of ${shot.name}`}
                      title="The device this screenshot is from. Change it when it was told wrong."
                      value={shot.device}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(event) => void moveShot(shot, event.target.value as DeviceKind)}
                    >
                      {meta.devices.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label.replace("iPhone ", "")}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {own(shot) ? (
                    <button
                      className="remove"
                      type="button"
                      title="Delete screenshot"
                      aria-label={`Delete ${shot.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void removeShot(shot);
                      }}
                    >
                      ×
                    </button>
                  ) : (
                    <>
                      <span className="tag from">{shot.locale ?? first}</span>
                      <label className="remove add" title={`Upload the ${languageName(locale)} screenshot of "${shot.name}"`} onClick={(event) => event.stopPropagation()}>
                        <Icon path={UPLOAD} />
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          hidden
                          aria-label={`Upload the ${languageName(locale)} screenshot of ${shot.name}`}
                          onChange={(event) => {
                            void upload([...(event.target.files ?? [])].slice(0, 1), "shot", shot.name);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </>
                  )}
                  <span className="name">{shot.name}</span>
                </div>
              ))}
              <div className="dropzone">
                {shots.length ? (
                  <div>{locale === first ? "Drop more screenshots here" : `Drop the ${languageName(locale)} screenshots here`}</div>
                ) : (
                  <div>
                    Drop screenshots here, or capture one from your Mac:
                    <br />
                    <code>appshots capture --name home --project {id}</code>
                    <br />
                    <button className="btn small quiet" type="button" onClick={openConnect}>
                      How to set that up
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="block">
            <div className="section-head">
              <h2>Logos and images</h2>
              <span className="hint">{images.length ? "Click one to place it on the selected slide. A slide's logo is picked in its settings." : ""}</span>
              <span className="spacer" />
              <label className="btn small">
                Upload
                <input
                  type="file"
                  multiple
                  accept="image/png,image/svg+xml,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    void upload([...(event.target.files ?? [])], "image");
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <div className="shots art" data-drop="images">
              {images.map((image) => (
                <div
                  key={image.file}
                  className={`shot${usedImages.has(image.name) ? " used" : ""}`}
                  role="button"
                  tabIndex={0}
                  title={`${image.name} · ${image.width}×${image.height}`}
                  onClick={() => placeImage(image)}
                  onKeyDown={(event) => event.key === "Enter" && event.target === event.currentTarget && placeImage(image)}
                >
                  <img src={`/files/${id}/images/${image.file}?v=${image.version}`} alt="" loading="lazy" />
                  <button
                    className="remove"
                    type="button"
                    title="Delete image"
                    aria-label={`Delete ${image.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeImage(image);
                    }}
                  >
                    ×
                  </button>
                  <span className="name">{image.name}</span>
                </div>
              ))}
              <div className="dropzone">
                <div>{images.length ? "Drop more here" : "Drop your logo, app icon, stickers or characters here. A PNG or SVG with a transparent background works best."}</div>
              </div>
            </div>
          </section>

          <section className="block">
            <div className="section-head wrap">
              <h2>Slides</h2>
              <span className="hint">{draft.locales.length > 1 ? "One design per device, exported at every size and in every language." : "One design per device, exported at every size."}</span>
              <LanguageSwitch locales={draft.locales} value={locale} onChange={setLocale} onAdd={addLanguage} />
              <div className="device-pick">
                <div className="segmented" role="radiogroup" aria-label="Device the slides are shown for">
                  {meta.devices.map((entry) => (
                    <button
                      key={entry.id}
                      className={device === entry.id ? "on" : ""}
                      type="button"
                      role="radio"
                      aria-checked={device === entry.id}
                      title={shots.some((shot) => shot.device === entry.id) ? `Show the slides for the ${entry.label}` : `Show the slides for the ${entry.label}. It has no screenshots of its own yet, so another device's stand in.`}
                      onClick={() => setTarget(shapesOf(entry.id)[0]!)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                {shapes.length > 1 ? (
                  <select aria-label="Size shown" title="These sizes have a shape of their own, so each is drawn separately." value={target} onChange={(event) => setTarget(event.target.value as TargetId)}>
                    {shapes.map((key) => (
                      <option key={key} value={key}>
                        {meta.targets[key].label} · {meta.targets[key].width}×{meta.targets[key].height}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="dim">
                    {size.width}×{size.height}
                  </span>
                )}
              </div>
            </div>
            <div className="slides">
              {draft.slides.map((slide, index) => {
                const on = slideIndex === index;
                const layout = label(slide.layout ?? "device-bottom");
                return (
                  <button key={index} className={`card${on ? " selected" : ""}`} type="button" aria-pressed={on} aria-label={`Slide ${index + 1}, ${layout}`} onClick={() => select({ kind: "slide", index })}>
                    <Stage
                      // A slide added a moment ago has no page on the server until the save lands.
                      src={index < saved.slides.length ? `/render/${id}/${index}?${new URLSearchParams({ target, locale })}` : null}
                      frameKey={JSON.stringify([saved.slides[index], target, ...look])}
                      width={size.width}
                      height={size.height}
                      scale={slideScale}
                    />
                    <div className="caption">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <span>{layout}</span>
                    </div>
                  </button>
                );
              })}
              {draft.slides.length < 10 ? (
                <button className="card add" type="button" onClick={addSlide}>
                  <div className="stage" style={{ width: Math.round(size.width * slideScale), height: SLIDE_HEIGHT }}>
                    + Add slide
                  </div>
                  <div className="caption">&nbsp;</div>
                </button>
              ) : null}
            </div>
          </section>

          <section className="block">
            <div className="section-head wrap">
              <h2>Header and search results</h2>
              <span className="hint">Optional images for the Header and Search Results tab in App Store Connect.</span>
              {placements.some((where) => draft.creatives[where]) ? (
                <label className="check" title="Draws the part every device shows as a dashed frame. It is a guide in this preview only and never part of the exported image.">
                  <input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} />
                  Show safe area
                </label>
              ) : null}
            </div>
            <div className="slides">
              {placements.map((where) => {
                const spec = meta.placements[where];
                const scale = ASSET_HEIGHT / spec.height;
                const caption = (
                  <div className="caption">
                    <span>{spec.label}</span>
                    <span>
                      {spec.ratio} · {spec.width}×{spec.height}
                    </span>
                  </div>
                );
                if (!draft.creatives[where]) {
                  return (
                    <button key={where} className="card add" type="button" aria-label={`Add the ${spec.label.toLowerCase()} asset`} onClick={() => addCreative(where)}>
                      <div className="stage" style={{ width: Math.round(spec.width * scale), height: ASSET_HEIGHT }}>
                        + Add
                      </div>
                      {caption}
                    </button>
                  );
                }
                const on = placement === where;
                return (
                  <button key={where} className={`card${on ? " selected" : ""}`} type="button" aria-pressed={on} aria-label={`${spec.label} asset`} onClick={() => select({ kind: "creative", placement: where })}>
                    <Stage
                      src={saved.creatives[where] ? `/render/${id}/creative/${where}?${new URLSearchParams(guides ? { locale, guides: "1" } : { locale })}` : null}
                      frameKey={JSON.stringify([saved.creatives[where], guides, ...look])}
                      width={spec.width}
                      height={spec.height}
                      scale={scale}
                    />
                    {caption}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <aside className={`panel${focused ? " with-focus" : ""}`}>
          <div className="tabs">
            <button className={`tab${tab === "item" ? " on" : ""}`} type="button" onClick={() => setTab("item")}>
              {itemTab}
            </button>
            <button className={`tab${tab === "project" ? " on" : ""}`} type="button" onClick={() => setTab("project")}>
              Project
            </button>
          </div>
          <div className="panel-body">
            {focused ? (
              <div className="focus">
                <div className="focus-stage">
                  <Stage
                    src={`/render/${id}/${slideIndex}?${new URLSearchParams({ target, locale })}`}
                    frameKey={JSON.stringify([slideIndex, saved.slides[slideIndex], target, focusScale.toFixed(3), ...look])}
                    width={size.width}
                    height={size.height}
                    scale={focusScale}
                  />
                  {tab === "item" && draft.slides[slideIndex]?.images?.length ? (
                    <PlacedHandles
                      placed={draft.slides[slideIndex]!.images!}
                      shown={saved.slides[slideIndex]?.images ?? []}
                      images={images}
                      projectId={id}
                      onMove={(at, x, y) =>
                        changeSlide((slide) => {
                          const placed = slide.images?.[at];
                          if (placed) Object.assign(placed, { x, y });
                        })
                      }
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="panel-fields">
              <Scope.Provider value={{ meta, projectId: id, shots, images, target, locale, primary: draft.locales[0]!, guides, dragging: focused }}>
                {tab === "project" ? (
                  <ProjectEditor project={draft} change={update} rename={rename} remove={deleteProject} />
                ) : placement ? (
                  <CreativeEditor key={placement} project={draft} placement={placement} change={changeCreative} remove={() => removeCreative(placement)} />
                ) : slideIndex != null ? (
                  <SlideEditor key={slideIndex} project={draft} index={slideIndex} change={changeSlide} actions={slideActions(slideIndex)} />
                ) : (
                  <p className="muted pad">Select a slide to edit it, or add one.</p>
                )}
              </Scope.Provider>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
