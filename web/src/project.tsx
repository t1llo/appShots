// One project: its slides, store assets and banners as live previews with the editor beside them, and its screenshots
// and images on a page of their own. The previews are iframes of the very pages the renderer screenshots, so what is
// on screen is what gets exported.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
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
  type Shot,
  shotIn,
  type Slide,
  slugify,
  type StoredImage,
  type TargetId,
} from "./api.ts";
import { openProject, useOpenDialog } from "./dialogs.tsx";
import { type Change, CreativeEditor, ProjectEditor, Scope, SlideEditor } from "./editor.tsx";
import { languageName, LanguageSwitch } from "./languages.tsx";
import { rendersQuery, startRender, working } from "./renders.tsx";
import { Icon, Menu, toast } from "./ui.tsx";

export const UPLOAD = "M8 10.6V2.8M4.9 5.7L8 2.6l3.1 3.1M2.8 10.4v2.8h10.4v-2.8";

/** How large the previews are drawn: the height of a slide, the width a landscape one may take at most, and the height of an asset. */
const ZOOMS = {
  s: { name: "Small", slide: 320, wide: 380, asset: 150 },
  m: { name: "Medium", slide: 440, wide: 520, asset: 200 },
  l: { name: "Large", slide: 620, wide: 760, asset: 280 },
} as const;
type Zoom = keyof typeof ZOOMS;

type Selection = { kind: "slide"; index: number } | { kind: "creative"; placement: PlacementId } | null;

/** The part of a project the Studio edits and sends back. */
type Saved = Pick<Project, "name" | "locales" | "theme" | "slides" | "deviceSlides" | "creatives"> & { targets: TargetId[] | null };

const snapshot = (project: Project) =>
  JSON.stringify({
    name: project.name,
    locales: project.locales,
    targets: project.targets ?? null,
    theme: project.theme,
    slides: project.slides,
    deviceSlides: project.deviceSlides ?? {},
    creatives: project.creatives,
  } satisfies Saved);
export const shotsKey = (shots: (Shot | StoredImage)[]) => shots.map((shot) => `${shot.file}:${shot.version}`).join(",");

type Sets = Pick<Project, "slides" | "deviceSlides">;
/** The slides a device shows: its own set, or the one the devices share. */
const setOf = (project: Sets, device: DeviceKind): Slide[] => project.deviceSlides?.[device] ?? project.slides;
const everySlide = (project: Sets): Slide[] => [...project.slides, ...Object.values(project.deviceSlides ?? {}).flatMap((set) => set ?? [])];

/** The file drop anywhere in the window goes to whichever project is open, as screenshots or as logos and images. */
export const dropTarget: { upload: ((files: File[], kind: "shot" | "image") => void) | null } = { upload: null };

const remembered = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

// ---------------------------------------------------------------- previews

/** Loads the new preview underneath and swaps once it has laid itself out, so edits never flash blank. */
export function Stage({ src, frameKey, width, height, scale }: { src: string | null; frameKey: string; width: number; height: number; scale: number }) {
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
 * Lies over the preview of the selected slide with one handle per placed image, so an image is moved by dragging it.
 * The preview itself only changes once the move is saved, so a handle shows its image for as long as the two differ.
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

export type ProjectView = "slides" | "assets" | "mockups";

/** The parts of a project: what it makes for the store, what it is made of, and the devices alone. */
export function ViewSwitch({ id, view }: { id: string; view: ProjectView }) {
  const params = { projectId: id };
  const current = (name: ProjectView) => ({ className: view === name ? "on" : "", "aria-current": view === name ? ("page" as const) : undefined });
  return (
    <nav className="view-tabs" aria-label="Parts of this project">
      <Link {...current("slides")} to="/$projectId" params={params} search={{}} title="The slides, the store's header images and the banners">
        Slides
      </Link>
      <Link {...current("assets")} to="/$projectId" params={params} search={{ view: "assets" }} title="The screenshots, logos and images the project is made of">
        Assets
      </Link>
      <Link {...current("mockups")} to="/$projectId/mockups" params={params} title="The devices alone, on a transparent background">
        Mockups
      </Link>
    </nav>
  );
}

/** The bar over every page of a project: its name, its parts, and on the right what the page puts there. */
export function ProjectBar(props: { id: string; name: string; view: ProjectView; onRename?: (name: string) => void; field?: RefObject<HTMLInputElement | null>; children?: ReactNode }) {
  const { id, name, view, onRename, field, children } = props;
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? name;
  return (
    <header className="bar">
      {onRename ? (
        <input
          className="bar-title"
          ref={field}
          type="text"
          maxLength={80}
          placeholder="Untitled"
          aria-label="Project name"
          title="Click to rename"
          spellCheck={false}
          style={{ width: `${Math.min(30, Math.max(5, shown.length + 2))}ch` }}
          value={shown}
          onChange={(event) => {
            setTyped(event.target.value);
            const next = event.target.value.trim();
            if (next) onRename(next);
          }}
          onKeyDown={(event) => (event.key === "Enter" || event.key === "Escape") && event.currentTarget.blur()}
          onBlur={() => setTyped(null)}
        />
      ) : (
        <span className="bar-title still">{name}</span>
      )}
      <ViewSwitch id={id} view={view} />
      <span className="spacer" />
      {children}
    </header>
  );
}

// ---------------------------------------------------------------- page

export function ProjectPage({ meta, initial, view, openConnect }: { meta: Meta; initial: Detail; view: "slides" | "assets"; openConnect: () => void }) {
  const id = initial.project.id;
  const queryClient = useQueryClient();
  const openDialog = useOpenDialog();
  const titleField = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState(initial.project);
  /** What the server last accepted. The previews show this, not the draft. */
  const [saved, setSaved] = useState<Saved>(() => JSON.parse(snapshot(initial.project)));
  const [dirty, setDirty] = useState(false);
  const [target, setTarget] = useState<TargetId>(() => drawnSize(meta, initial.defaultTargets[0]!));
  const [selection, setSelection] = useState<Selection>(() => (setOf(initial.project, meta.targets[drawnSize(meta, initial.defaultTargets[0]!)].device).length ? { kind: "slide", index: 0 } : null));
  const [tab, setTab] = useState<"item" | "project">("item");
  const [chosenLocale, setLocale] = useState(initial.project.locales[0]!);
  const [status, setStatusState] = useState({ text: "", error: false });
  const [exporting, setExporting] = useState(false);
  const [guides, setGuidesState] = useState(() => remembered("appshots.guides") === "1");
  const setGuides = (on: boolean) => {
    setGuidesState(on);
    remember("appshots.guides", on ? "1" : "0");
  };
  const [zoom, setZoomState] = useState<Zoom>(() => {
    const kept = remembered("appshots.zoom");
    return kept === "s" || kept === "l" ? kept : "m";
  });
  const setZoom = (next: Zoom) => {
    setZoomState(next);
    remember("appshots.zoom", next);
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
          queryClient.setQueryData(projectsQuery.queryKey, (list) =>
            list?.map((entry) => (entry.id === id ? { ...entry, name: fresh.project.name, slides: fresh.project.slides.length, locales: fresh.project.locales, updatedAt: fresh.project.updatedAt } : entry)),
          );
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

  // The device whose slides are shown. Each device has the shared set, or one of its own.
  const size = meta.targets[target];
  const device = size.device;
  const deviceLabel = meta.devices.find((entry) => entry.id === device)!.label;
  const shownDevice = useRef(device);
  shownDevice.current = device;
  const slides = setOf(draft, device);
  const savedSlides = setOf(saved, device);
  const ownSet = draft.deviceSlides?.[device] != null;

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
      const count = setOf(fresh, shownDevice.current).length;
      if (count === 0) return null;
      return { kind: "slide", index: current?.kind === "slide" ? Math.min(current.index, count - 1) : 0 };
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
  const slideIndex = selection?.kind === "slide" && selection.index < slides.length ? selection.index : null;
  const placement = selection?.kind === "creative" && draft.creatives[selection.placement] ? selection.placement : null;
  const placements = Object.keys(meta.placements) as PlacementId[];
  const shotNames = [...new Set(shots.map((shot) => shot.name))];

  // ---------------------------------------------------------------- screenshots

  const reload = async () => {
    await save();
    await queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
  };

  /** Files a screenshot under another device, for one whose size did not give it away. */
  const moveShot = async (shot: Shot, to: DeviceKind) => {
    const name = meta.devices.find((entry) => entry.id === to)!.label;
    if (shots.some((other) => other.name === shot.name && other.device === to && other.locale === shot.locale) && !confirm(`"${shot.name}" already has a screenshot for the ${name}. Replace it?`)) return;
    try {
      await api("PATCH", `/projects/${id}/shots/${shot.file}`, { device: to });
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
      const { slides: shared } = latest.current;
      const taken = new Set(shared.flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3]));
      const waiting = shared.flatMap((slide, index) => (slide.screenshot || meta.layoutShots[slide.layout ?? "device-bottom"] === 0 ? [] : [index]));
      const fills = uploaded.filter((shot) => !taken.has(shot.name) && taken.add(shot.name)).slice(0, waiting.length);
      if (fills.length) update((project) => fills.forEach((shot, at) => void (project.slides[waiting[at]!]!.screenshot = shot.name)), true);
      setStatus("");
      await save();
      await queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
    },
    [id, queryClient, save, setStatus, update, shots, locale, first, meta],
  );
  useEffect(() => {
    dropTarget.upload = (files, kind) => void upload(files, kind);
    return () => void (dropTarget.upload = null);
  }, [upload]);

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

  // Moving a slide with the arrows keeps its card in view.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) document.querySelector(".workspace .card.selected")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    opened.current = true;
  }, [slideIndex, placement]);

  const sizes = exportSizes(meta, draft, shots);
  /** The shapes of one device the export holds. Each is drawn on its own, so each has a preview; the other sizes are these scaled. */
  const shapesOf = (kind: DeviceKind) => {
    const drawn = [...new Set(sizes.filter((key) => meta.targets[key].device === kind).map((key) => drawnSize(meta, key)))];
    return drawn.length ? drawn : [(Object.keys(meta.targets) as TargetId[]).find((key) => meta.targets[key].device === kind)!];
  };
  const shapes = shapesOf(device).includes(target) ? shapesOf(device) : [target, ...shapesOf(device)];

  const showDevice = (kind: DeviceKind) => {
    setTarget(shapesOf(kind)[0]!);
    const count = setOf(draft, kind).length;
    setSelection((current) => (current?.kind !== "slide" ? current : count ? { kind: "slide", index: Math.min(current.index, count - 1) } : null));
  };

  /** Changes the set shown: the device's own, or the one the devices share. */
  const editSlides = (recipe: (set: Slide[]) => void, now = false) => update((project) => recipe(setOf(project, device)), now);

  /** From here on the device has slides of its own. They start as a copy of the shared ones. */
  const splitSet = () => {
    update((project) => {
      const start: Slide[] = project.slides.length ? structuredClone(project.slides) : [{ layout: "device-bottom", headline: "Your headline" }];
      project.deviceSlides = { ...project.deviceSlides, [device]: start };
    }, true);
    if (slideIndex == null) setSelection({ kind: "slide", index: 0 });
    toast(`The ${deviceLabel} has its own slides now. What you change here no longer reaches the other devices.`, "", 7000);
  };

  const joinSet = () => {
    if (!confirm(`Delete the ${deviceLabel}'s own ${slides.length === 1 ? "slide" : `${slides.length} slides`}? The ${deviceLabel} then shows the shared slides again.`)) return;
    update((project) => {
      const sets = { ...project.deviceSlides };
      delete sets[device];
      project.deviceSlides = sets;
    }, true);
    setSelection((current) => (current?.kind !== "slide" ? current : draft.slides.length ? { kind: "slide", index: Math.min(current.index, draft.slides.length - 1) } : null));
  };

  const addSlide = () => {
    const taken = new Set(slides.map((slide) => slide.screenshot));
    // The device's own screenshots first: a name it has no picture of would show another device's.
    const names = [...new Set([...shots.filter((shot) => shot.device === device).map((shot) => shot.name), ...shotNames])];
    const unused = names.find((name) => !taken.has(name));
    const at = slideIndex == null ? slides.length : slideIndex + 1;
    editSlides((set) => void set.splice(at, 0, { layout: "device-bottom", headline: "Your headline", ...(unused ? { screenshot: unused } : {}) }), true);
    select({ kind: "slide", index: at });
  };

  const slideActions = (index: number) => ({
    move: (delta: number) => {
      const to = index + delta;
      if (to < 0 || to >= slides.length) return;
      editSlides((set) => void ([set[index], set[to]] = [set[to]!, set[index]!]), true);
      setSelection({ kind: "slide", index: to });
    },
    duplicate: () => {
      editSlides((set) => void set.splice(index + 1, 0, structuredClone(set[index]!)), true);
      setSelection({ kind: "slide", index: index + 1 });
    },
    remove: () => {
      // A device's own set holds at least one slide, so its last one takes the set with it.
      if (ownSet && slides.length === 1) return joinSet();
      if (!confirm(`Delete slide ${index + 1}?`)) return;
      editSlides((set) => void set.splice(index, 1), true);
      setSelection(slides.length > 1 ? { kind: "slide", index: Math.min(index, slides.length - 2) } : null);
    },
  });

  /** A new asset starts as a copy of one of its kind the project already has, or from the slides: their first headline and screenshots. */
  const addCreative = (where: PlacementId) => {
    const banner = meta.placements[where].kind === "banner";
    const existing = placements.filter((other) => meta.placements[other].kind === meta.placements[where].kind).map((other) => draft.creatives[other]).find(Boolean);
    const fromSlides = slides.map((slide) => slide.screenshot).filter((name): name is string => name != null && shotNames.includes(name));
    const screenshots = [...new Set([...fromSlides, ...shotNames])].slice(0, 3);
    const headline = slides.find((slide) => slide.headline)?.headline ?? draft.name;
    // A banner is left to its own layout, the one with the copy on the left.
    const seed: Creative = existing ? structuredClone(existing) : { ...(banner ? {} : { layout: "fan" as const }), headline, ...(screenshots.length ? { screenshots } : {}) };
    update((project) => void (project.creatives[where] = seed), true);
    select({ kind: "creative", placement: where });
  };

  const removeCreative = (where: PlacementId) => {
    if (!confirm(`Remove the ${meta.placements[where].label.toLowerCase()}${meta.placements[where].kind === "store" ? " asset" : ""}?`)) return;
    update((project) => void delete project.creatives[where], true);
    setSelection(slides.length ? { kind: "slide", index: 0 } : null);
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

  // The render of this project that is waiting or under way, wherever it was started.
  const rendering = useQuery(rendersQuery).data?.jobs.find((job) => job.project === id && working(job));

  /**
   * Renders every size of the project on the server: each device from its own slides, and each display of App Store
   * Connect gets its own folder. The run works in the background, the sidebar follows it, and the ZIP downloads when it is done.
   */
  const exportZip = async () => {
    setExporting(true);
    try {
      await save();
      await startRender(queryClient, id);
      toast("Rendering in the background. Keep working: the ZIP downloads when it is done.", "", 6000);
    } catch (error) {
      toast(errorText(error), "error", 8000);
    } finally {
      setExporting(false);
    }
  };

  // ---------------------------------------------------------------- render

  const deviceOrder = meta.devices.map((entry) => entry.id);
  // One tile per name and device: what the language shown has there, which is the first language's until it gets its own.
  const shownShots = deviceOrder.flatMap((kind) => shotNames.flatMap((name) => shotIn(shots.filter((shot) => shot.device === kind && shot.name === name), locale) ?? []));
  const scales = ZOOMS[zoom];
  const slideScale = Math.min(scales.slide / size.height, scales.wide / size.width);
  const all = everySlide(draft);
  const used = new Set([
    ...all.flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3, ...(slide.features ?? []).map((feature) => feature.screenshot)]),
    ...placements.flatMap((where) => draft.creatives[where]?.screenshots ?? []),
  ]);
  const usedImages = new Set([
    ...all.flatMap((slide) => [slide.logo?.image, ...(slide.images ?? []).map((placed) => placed.image), ...(slide.features ?? []).map((feature) => feature.image)]),
    ...placements.map((where) => draft.creatives[where]?.logo?.image),
  ]);
  const look = [saved.theme, saved.locales[0], locale, shotsKey(shots), shotsKey(images)];
  const changeSlide: Change<Slide> = (recipe) => editSlides((set) => recipe(set[slideIndex!]!));
  const changeCreative: Change<Creative> = (recipe) => update((project) => recipe(project.creatives[placement!]!));
  const itemTab = placement ? meta.placements[placement].label : slideIndex != null ? `Slide ${slideIndex + 1}` : "Slide";
  const splitDevices = meta.devices.filter((entry) => draft.deviceSlides?.[entry.id] != null);

  const picker = (kind: "shot" | "image", text: string) => (
    <label className="btn small">
      <Icon path={UPLOAD} />
      {text}
      <input
        type="file"
        multiple
        accept={kind === "shot" ? "image/png,image/jpeg,image/webp" : "image/png,image/svg+xml,image/jpeg,image/webp"}
        hidden
        onChange={(event) => {
          void upload([...(event.target.files ?? [])], kind);
          event.target.value = "";
        }}
      />
    </label>
  );

  const canvas = (
    <div className="workspace">
      {shots.length === 0 ? (
        <div className="callout">
          <div className="callout-text">
            <b>Start with your app's screens.</b>
            <span>Drop screenshots anywhere in this window, or capture one from your Mac:</span>
            <code>appshots capture --name home --project {id}</code>
          </div>
          <div className="callout-actions">
            {picker("shot", "Upload screenshots")}
            <button className="btn small quiet" type="button" onClick={openConnect}>
              How to set that up
            </button>
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Device the slides are shown for">
          {meta.devices.map((entry) => {
            const split = draft.deviceSlides?.[entry.id] != null;
            const has = shots.some((shot) => shot.device === entry.id);
            return (
              <button
                key={entry.id}
                className={device === entry.id ? "on" : ""}
                type="button"
                role="radio"
                aria-checked={device === entry.id}
                title={`${split ? `The ${entry.label} has slides of its own.` : `The ${entry.label} shows the shared slides.`}${has ? "" : " It has no screenshots of its own yet, so another device's stand in."}`}
                onClick={() => showDevice(entry.id)}
              >
                {entry.label}
                {split ? <span className="dot" /> : null}
              </button>
            );
          })}
        </div>
        {shapes.length > 1 ? (
          <select className="ghost" aria-label="Size shown" title="These sizes have a shape of their own, so each is drawn separately." value={target} onChange={(event) => setTarget(event.target.value as TargetId)}>
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
        <span className="spacer" />
        <LanguageSwitch locales={draft.locales} value={locale} onChange={setLocale} onAdd={addLanguage} />
        <div className="segmented" role="radiogroup" aria-label="Preview size">
          {(Object.keys(ZOOMS) as Zoom[]).map((key) => (
            <button key={key} className={zoom === key ? "on" : ""} type="button" role="radio" aria-checked={zoom === key} title={`${ZOOMS[key].name} previews`} aria-label={`${ZOOMS[key].name} previews`} onClick={() => setZoom(key)}>
              {key.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="set-line">
        <span>
          <b>{plural(slides.length, "slide")}</b>
          {ownSet ? ` for the ${deviceLabel} alone` : splitDevices.length ? `, shared by every device but the ${splitDevices.map((entry) => entry.label).join(" and the ")}` : ", shared by every device"}
        </span>
        {ownSet ? (
          <button className="link" type="button" onClick={joinSet}>
            Use the shared slides again
          </button>
        ) : (
          <button className="link" type="button" title="They start as a copy of these. From then on the two sets are changed separately." onClick={splitSet}>
            Give the {deviceLabel} its own slides
          </button>
        )}
      </div>

      <div className="slides">
        {slides.map((slide, index) => {
          const on = slideIndex === index;
          const layout = label(slide.layout ?? "device-bottom");
          return (
            <div
              key={index}
              className={`card${on ? " selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`Slide ${index + 1}, ${layout}`}
              onClick={() => select({ kind: "slide", index })}
              onKeyDown={(event) => {
                if ((event.key !== "Enter" && event.key !== " ") || event.target !== event.currentTarget) return;
                event.preventDefault();
                select({ kind: "slide", index });
              }}
            >
              <div className="stage-box">
                <Stage
                  // A slide added a moment ago has no page on the server until the save lands.
                  src={index < savedSlides.length ? `/render/${id}/${index}?${new URLSearchParams({ target, locale })}` : null}
                  frameKey={JSON.stringify([savedSlides[index], target, ...look])}
                  width={size.width}
                  height={size.height}
                  scale={slideScale}
                />
                {on && tab === "item" && slide.images?.length ? (
                  <PlacedHandles
                    placed={slide.images}
                    shown={savedSlides[index]?.images ?? []}
                    images={images}
                    projectId={id}
                    onMove={(at, x, y) =>
                      changeSlide((item) => {
                        const placed = item.images?.[at];
                        if (placed) Object.assign(placed, { x, y });
                      })
                    }
                  />
                ) : null}
              </div>
              <div className="caption">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{layout}</span>
              </div>
            </div>
          );
        })}
        {slides.length < 10 ? (
          <button className="card add" type="button" onClick={addSlide}>
            <div className="stage" style={{ width: Math.round(size.width * slideScale), height: Math.round(size.height * slideScale) }}>
              + Add slide
            </div>
            <div className="caption">&nbsp;</div>
          </button>
        ) : null}
      </div>

      {(["store", "banner"] as const).map((kind) => {
        const group = placements.filter((where) => meta.placements[where].kind === kind);
        const store = kind === "store";
        return (
          <section className="block" key={kind}>
            <div className="section-head">
              <h2>{store ? "Header and search results" : "Banners"}</h2>
              <span className="hint">{store ? "Optional images for the Header and Search Results tab in App Store Connect." : "Wide pictures for outside the store: the top of a README, the preview of a link, a post."}</span>
              <span className="spacer" />
              {store && group.some((where) => draft.creatives[where]) ? (
                <label className="check" title="Draws the part every device shows as a dashed frame. It is a guide in this preview only and never part of the exported image.">
                  <input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} />
                  Show safe area
                </label>
              ) : null}
            </div>
            <div className="slides">
              {group.map((where) => {
                const spec = meta.placements[where];
                const scale = Math.min(scales.asset / spec.height, scales.wide / spec.width);
                const marked = store && guides;
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
                    <button key={where} className="card add" type="button" aria-label={`Add the ${spec.label.toLowerCase()}${store ? " asset" : ""}`} onClick={() => addCreative(where)}>
                      <div className="stage" style={{ width: Math.round(spec.width * scale), height: Math.round(spec.height * scale) }}>
                        + Add
                      </div>
                      {caption}
                    </button>
                  );
                }
                const on = placement === where;
                return (
                  <button key={where} className={`card${on ? " selected" : ""}`} type="button" aria-pressed={on} aria-label={store ? `${spec.label} asset` : spec.label} onClick={() => select({ kind: "creative", placement: where })}>
                    <Stage
                      src={saved.creatives[where] ? `/render/${id}/creative/${where}?${new URLSearchParams(marked ? { locale, guides: "1" } : { locale })}` : null}
                      frameKey={JSON.stringify([saved.creatives[where], marked, scale.toFixed(4), ...look])}
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
        );
      })}
    </div>
  );

  const assets = (
    <div className="workspace wide">
      <section>
        <div className="section-head">
          <h2>Screenshots</h2>
          <span className="count">{shownShots.length}</span>
          <span className="hint">
            {!shots.length
              ? "The raw screens of your app. The slides put them into devices."
              : locale === first
                ? "A slide names a screenshot, and each device shows its own picture of that name."
                : `The dimmed ones are ${languageName(first)}. Upload the ${languageName(locale)} ones under the same names.`}
          </span>
          <span className="spacer" />
          {draft.locales.length > 1 ? <LanguageSwitch locales={draft.locales} value={locale} onChange={setLocale} /> : null}
          {picker("shot", "Upload")}
        </div>
        {deviceOrder
          .filter((kind) => shownShots.some((shot) => shot.device === kind))
          .map((kind) => (
            <div className="asset-group" key={kind}>
              <h3>
                {meta.devices.find((entry) => entry.id === kind)!.label}
                <span className="count">{shownShots.filter((shot) => shot.device === kind).length}</span>
              </h3>
              <div className="shots">
                {shownShots
                  .filter((shot) => shot.device === kind)
                  .map((shot) => (
                    <div
                      key={shot.file}
                      className={`shot${used.has(shot.name) ? " used" : ""}${own(shot) ? "" : " borrowed"}`}
                      title={`${shot.name} · ${shot.width}×${shot.height}${used.has(shot.name) ? "" : " · not on any slide yet"}${own(shot) ? "" : ` · the ${languageName(shot.locale ?? first)} one, until ${languageName(locale)} has its own`}`}
                    >
                      <img src={`/files/${id}/shots/${shot.file}?v=${shot.version}`} alt="" loading="lazy" />
                      <select
                        className="tag"
                        aria-label={`Device of ${shot.name}`}
                        title="The device this screenshot is from. Change it when it was told wrong."
                        value={shot.device}
                        onChange={(event) => void moveShot(shot, event.target.value as DeviceKind)}
                      >
                        {meta.devices.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label.replace("iPhone ", "")}
                          </option>
                        ))}
                      </select>
                      {own(shot) ? (
                        <button className="remove" type="button" title="Delete screenshot" aria-label={`Delete ${shot.name}`} onClick={() => void removeShot(shot)}>
                          ×
                        </button>
                      ) : (
                        <>
                          <span className="tag from">{shot.locale ?? first}</span>
                          <label className="remove add" title={`Upload the ${languageName(locale)} screenshot of "${shot.name}"`}>
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
              </div>
            </div>
          ))}
        <div className={`dropzone${shots.length ? "" : " empty"}`}>
          {shots.length ? (
            <div>{locale === first ? "Drop more screenshots anywhere in this window" : `Drop the ${languageName(locale)} screenshots anywhere in this window`}</div>
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
      </section>

      <section className="block">
        <div className="section-head">
          <h2>Logos and images</h2>
          <span className="count">{images.length}</span>
          <span className="hint">Your logo, app icon, stickers and characters. A slide picks them under Your logo and Images.</span>
          <span className="spacer" />
          {picker("image", "Upload")}
        </div>
        <div className="shots art" data-drop="images">
          {images.map((image) => (
            <div key={image.file} className={`shot${usedImages.has(image.name) ? " used" : ""}`} title={`${image.name} · ${image.width}×${image.height}${usedImages.has(image.name) ? "" : " · not on any slide yet"}`}>
              <img src={`/files/${id}/images/${image.file}?v=${image.version}`} alt="" loading="lazy" />
              <button className="remove" type="button" title="Delete image" aria-label={`Delete ${image.name}`} onClick={() => void removeImage(image)}>
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
    </div>
  );

  return (
    <div className="main">
      <ProjectBar id={id} name={draft.name} view={view} onRename={rename} field={titleField}>
        <span className={`status${status.error ? " error" : ""}`} role="status">
          {status.text}
        </span>
        <Menu
          label={`Actions for ${draft.name}`}
          items={[
            {
              text: "Rename",
              run: () => {
                titleField.current?.focus();
                titleField.current?.select();
              },
            },
            { text: "Delete project…", danger: true, run: deleteProject },
          ]}
        />
        <button className="btn primary" type="button" disabled={exporting || rendering != null} onClick={() => void exportZip()}>
          {rendering ? (rendering.state === "running" && rendering.total ? `Rendering ${rendering.done} of ${rendering.total}` : "Rendering…") : exporting ? "Starting…" : "Export ZIP"}
        </button>
      </ProjectBar>

      <div className="content">
        {view === "assets" ? assets : canvas}
        {view === "assets" ? null : (
          <aside className="panel">
            <div className="tabs">
              <button className={`tab${tab === "item" ? " on" : ""}`} type="button" onClick={() => setTab("item")}>
                {itemTab}
              </button>
              <button className={`tab${tab === "project" ? " on" : ""}`} type="button" onClick={() => setTab("project")}>
                Project
              </button>
            </div>
            <div className="panel-body">
              <Scope.Provider value={{ meta, projectId: id, shots, images, target, locale, primary: draft.locales[0]!, guides, dragging: slideIndex != null }}>
                {tab === "project" ? (
                  <ProjectEditor project={draft} change={update} rename={rename} remove={deleteProject} />
                ) : placement ? (
                  <CreativeEditor key={placement} project={draft} placement={placement} change={changeCreative} remove={() => removeCreative(placement)} />
                ) : slideIndex != null ? (
                  <SlideEditor key={`${device}:${slideIndex}`} project={draft} slides={slides} index={slideIndex} change={changeSlide} actions={slideActions(slideIndex)} />
                ) : (
                  <p className="muted pad">Select a slide to edit it, or add one.</p>
                )}
              </Scope.Provider>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
