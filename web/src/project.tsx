// One project: its screenshots, slides and store assets as live previews, with the editor beside them.
// The previews are iframes of the very pages the renderer screenshots, so what is on screen is what gets exported.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Creative, type Detail, detailQuery, errorText, label, type Meta, type PlacementId, plural, type Project, projectsQuery, type RenderResponse, type Shot, slugify, type TargetId } from "./api.ts";
import { type Change, CreativeEditor, ProjectEditor, Scope, SlideEditor } from "./editor.tsx";
import { toast } from "./ui.tsx";

const SLIDE_HEIGHT = 440;
const ASSET_HEIGHT = 190;
/** From this window width on, the selected slide is also shown large beside its fields. */
const FOCUS_FROM = 1360;

type Selection = { kind: "slide"; index: number } | { kind: "creative"; placement: PlacementId } | null;

/** The part of a project the Studio edits and sends back. */
type Saved = Pick<Project, "name" | "locales" | "theme" | "slides" | "creatives">;

const snapshot = (project: Project) => JSON.stringify({ name: project.name, locales: project.locales, theme: project.theme, slides: project.slides, creatives: project.creatives } satisfies Saved);
const shotsKey = (shots: Shot[]) => shots.map((shot) => `${shot.file}:${shot.version}`).join(",");

/** The file drop anywhere in the window goes to whichever project is open. */
export const dropTarget: { upload: ((files: File[]) => void) | null } = { upload: null };

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
  const navigate = useNavigate();

  const [draft, setDraft] = useState(initial.project);
  /** What the server last accepted. The previews show this, not the draft. */
  const [saved, setSaved] = useState<Saved>(() => JSON.parse(snapshot(initial.project)));
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection>(initial.project.slides.length ? { kind: "slide", index: 0 } : null);
  const [tab, setTab] = useState<"item" | "project">("item");
  const [target, setTarget] = useState<TargetId>(initial.defaultTargets[0]!);
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
  const { shots } = detail;
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
    setTarget(detail.defaultTargets[0]!);
  }, [shots.length]);

  useEffect(() => {
    document.title = `${draft.name} · appShots Studio`;
    return () => void (document.title = "appShots Studio");
  }, [draft.name]);

  const locale = draft.locales.includes(chosenLocale) ? chosenLocale : draft.locales[0]!;
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

  const removeShot = async (shot: Shot) => {
    if (!confirm(`Delete the screenshot "${shot.name}"?`)) return;
    try {
      await api("DELETE", `/projects/${id}/shots/${shot.file}`);
      await reload();
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return toast("Those are not images.", "error");
      setStatus(`Uploading ${images.length}…`);
      const uploaded: Shot[] = [];
      for (const file of images) {
        try {
          uploaded.push(await api<Shot>("PUT", `/projects/${id}/shots/${slugify(file.name.replace(/\.[^.]+$/, ""))}`, file));
        } catch (error) {
          toast(`${file.name}: ${errorText(error)}`, "error");
        }
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
    [id, queryClient, save, setStatus, update],
  );
  useEffect(() => {
    dropTarget.upload = (files) => void upload(files);
    return () => void (dropTarget.upload = null);
  }, [upload]);

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

  const deleteProject = async () => {
    if (!confirm(`Delete "${draft.name}" with its screenshots and renders? This cannot be undone.`)) return;
    try {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await inflight.current;
      await api("DELETE", `/projects/${id}`);
      deleted.current = true;
      await queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey });
      await navigate({ to: "/" });
      queryClient.removeQueries({ queryKey: detailQuery(id).queryKey });
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  const exportZip = async () => {
    setExporting(true);
    try {
      await save();
      // The standard sizes, and the one picked for the previews when it is another.
      const targets = [...new Set([...detail.defaultTargets, target])];
      const result = await api<RenderResponse>("POST", `/projects/${id}/render`, { targets });
      queryClient.setQueryData(detailQuery(id).queryKey, (current) => current && { ...current, outputs: result.outputs, creativeOutputs: result.creativeOutputs });
      if (result.warnings.length) toast(result.warnings.join("\n"), "warn", 9000);
      const assets = result.creatives.length ? ` and ${plural(result.creatives.length, "header and search results asset")}` : "";
      toast(`Rendered ${plural(result.files.length, "screenshot")}${assets}. The download starts now.`);
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
  const slideScale = SLIDE_HEIGHT / size.height;
  const used = new Set([...draft.slides.flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3]), ...placements.flatMap((where) => draft.creatives[where]?.screenshots ?? [])]);
  const look = [saved.theme, saved.locales[0], locale, shotsKey(shots)];
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
        {draft.locales.length > 1 ? (
          <select className="ghost" aria-label="Preview language" title="Preview language" value={locale} onChange={(event) => setLocale(event.target.value)}>
            {draft.locales.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        ) : null}
        <button className="btn primary" type="button" disabled={exporting} onClick={() => void exportZip()}>
          {exporting ? "Rendering…" : "Export ZIP"}
        </button>
      </header>

      <div className="content">
        <div className="workspace">
          <div className="page-head">
            <input
              className="title"
              type="text"
              maxLength={80}
              placeholder="Untitled"
              aria-label="Project name"
              spellCheck={false}
              value={title ?? draft.name}
              onChange={(event) => {
                setTitle(event.target.value);
                const name = event.target.value.trim();
                if (name) rename(name);
              }}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              onBlur={() => setTitle(null)}
            />
            <div className="page-meta">{[plural(draft.slides.length, "slide"), plural(shots.length, "screenshot"), draft.locales.join(", ")].join(" · ")}</div>
          </div>

          <section>
            <div className="section-head">
              <h2>Screenshots</h2>
              <span className="hint">{shots.length ? "Click one to put it in the selected slide or asset." : ""}</span>
              <span className="spacer" />
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
            <div className="shots">
              {shots.map((shot) => (
                <div
                  key={shot.file}
                  className={`shot${used.has(shot.name) ? " used" : ""}`}
                  role="button"
                  tabIndex={0}
                  title={`${shot.name} · ${shot.width}×${shot.height}`}
                  onClick={() => assignShot(shot)}
                  onKeyDown={(event) => event.key === "Enter" && event.target === event.currentTarget && assignShot(shot)}
                >
                  <img src={`/files/${id}/shots/${shot.file}?v=${shot.version}`} alt="" loading="lazy" />
                  {shot.device === "ipad" ? <span className="tag">iPad</span> : null}
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
                  <span className="name">{shot.name}</span>
                </div>
              ))}
              <div className="dropzone">
                {shots.length ? (
                  <div>Drop more screenshots here</div>
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
            <div className="section-head wrap">
              <h2>Slides</h2>
              <span className="hint">Live previews at the exact export size. Up to 10 per set.</span>
              <label className="device-pick" title="The device the slides are shown for. Export ZIP holds this size along with the standard ones.">
                Device
                <select value={target} onChange={(event) => setTarget(event.target.value as TargetId)}>
                  {(Object.keys(meta.targets) as TargetId[]).map((key) => (
                    <option key={key} value={key}>
                      {meta.targets[key].label} · {meta.targets[key].width}×{meta.targets[key].height}
                    </option>
                  ))}
                </select>
              </label>
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
                <Stage
                  src={`/render/${id}/${slideIndex}?${new URLSearchParams({ target, locale })}`}
                  frameKey={JSON.stringify([slideIndex, saved.slides[slideIndex], target, focusScale.toFixed(3), ...look])}
                  width={size.width}
                  height={size.height}
                  scale={focusScale}
                />
              </div>
            ) : null}
            <div className="panel-fields">
              <Scope.Provider value={{ meta, projectId: id, shots, target, locale, primary: draft.locales[0]!, guides }}>
                {tab === "project" ? (
                  <ProjectEditor project={draft} change={update} remove={() => void deleteProject()} />
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
