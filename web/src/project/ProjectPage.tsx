// One project: its slides, store assets and banners as live previews with the editor beside them, and its screenshots
// and images on a page of their own. Edits go into the project's draft (state/draft.ts), which saves them and merges
// in what changes elsewhere. The previews show what the server has, since they are the server's own pages.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Creative, type Detail, detailQuery, type DeviceKind, drawnSize, exportSizes, type Meta, type PlacementId, plural, type Project, type Slide, type TargetId } from "../api.ts";
import { useOpenDialog } from "../dialogs.tsx";
import { type Change, CreativeEditor, ProjectEditor, Scope, SlideEditor } from "../editor/index.ts";
import { languageName, LanguageSwitch } from "../languages.tsx";
import { change, projectDraft, type ProjectDoc, remoteOf, renamed, useDraft, useOpenProject, useUndoKeys } from "../state/useDraft.ts";
import { ask, Menu, Segmented, tabId, Tabs, toast } from "../ui/index.ts";
import { AssetsView, Picker, useUpload } from "./Assets.tsx";
import { ExportButton } from "./ExportButton.tsx";
import { HistoryButton } from "./History.tsx";
import { ConflictBar, ProjectBar, SaveStatus, UndoButtons } from "./ProjectBar.tsx";
import { CreativeCard, creativeKey, SlideCard, slideKey, useWidth } from "./Previews.tsx";
import { appIcon, setOf } from "./sets.ts";
import { StorePreview } from "./StorePreview.tsx";

/** How large the previews are drawn: the height of a slide, the width a landscape one may take at most, and the height of an asset. */
const ZOOMS = {
  s: { name: "Small", slide: 320, wide: 380, asset: 150 },
  m: { name: "Medium", slide: 440, wide: 520, asset: 200 },
  l: { name: "Large", slide: 620, wide: 760, asset: 280 },
} as const;
type Zoom = keyof typeof ZOOMS;

type Selection = { kind: "slide"; index: number } | { kind: "creative"; placement: PlacementId } | null;
type Tab = "item" | "project";

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

export function ProjectPage({ meta, detail, view, openConnect }: { meta: Meta; detail: Detail; view: "slides" | "assets" | "store"; openConnect: () => void }) {
  const id = detail.project.id;
  const queryClient = useQueryClient();
  const openDialog = useOpenDialog();
  const titleField = useRef<HTMLInputElement>(null);

  const store = projectDraft(queryClient, detail);
  // Every copy of the project that comes in, from the poll or from a save on another page, is merged into the draft.
  useEffect(() => store.receive(remoteOf(detail)), [store, detail]);
  const draft = useDraft(store, (state) => state.draft);
  /** What the server last confirmed. The previews show this, not the draft. */
  const base = useDraft(store, (state) => state.base.doc);
  const saveKind = useDraft(store, (state) => state.save.kind);
  useUndoKeys(store);
  const { shots, images } = detail;

  const update = useCallback((recipe: (doc: ProjectDoc) => void, now = false) => change(store, recipe, now), [store]);
  const rename = useCallback(
    (name: string) => {
      update((doc) => void (doc.name = name));
      renamed(queryClient, { id, name });
    },
    [update, queryClient, id],
  );
  useOpenProject(store, id, rename);

  // A save that finds the project gone has the route ask for it again, which then says it was deleted.
  useEffect(() => {
    if (saveKind === "gone") void queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
  }, [saveKind]);

  const [target, setTarget] = useState<TargetId>(() => drawnSize(meta, detail.defaultTargets[0]!));
  const [selection, setSelection] = useState<Selection>(() => (setOf(draft, meta.targets[drawnSize(meta, detail.defaultTargets[0]!)].device).length ? { kind: "slide", index: 0 } : null));
  const [tab, setTab] = useState<Tab>("item");
  const [chosenLocale, setLocale] = useState(draft.locales[0]!);
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

  // The device whose slides are shown. Each device has the shared set, or one of its own.
  const size = meta.targets[target];
  const device = size.device;
  const deviceLabel = meta.devices.find((entry) => entry.id === device)!.label;
  const shownDevice = useRef(device);
  shownDevice.current = device;
  const slides = setOf(draft, device);
  const shownSlides = setOf(base, device);
  const ownSet = draft.deviceSlides?.[device] != null;

  // The first screenshots decide whether the set opens as an iPhone or an iPad one.
  const hadShots = useRef(shots.length > 0);
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
    update((doc) => void doc.locales.push(code), true);
    setLocale(code);
    toast(`${languageName(code)} added. It shows the ${languageName(first)} texts and screenshots until it has its own.`, "", 7000);
  };
  // What is selected stays in range when slides go, here or elsewhere.
  const slideIndex = selection?.kind === "slide" && slides.length ? Math.min(selection.index, slides.length - 1) : null;
  const placement = selection?.kind === "creative" && draft.creatives[selection.placement] ? selection.placement : null;
  const placements = Object.keys(meta.placements) as PlacementId[];
  const shotNames = [...new Set(shots.map((shot) => shot.name))];

  const { upload, task } = useUpload({ store, detail, locale, fill: { device, meta } });

  // ---------------------------------------------------------------- slides and assets

  const select = useCallback((next: Selection) => {
    setSelection(next);
    setTab("item");
  }, []);
  const selectSlide = useCallback((index: number) => select({ kind: "slide", index }), [select]);
  const selectCreative = useCallback((where: PlacementId) => select({ kind: "creative", placement: where }), [select]);

  // Moving a slide with the arrows keeps its card in view.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) document.querySelector(".workspace .card.selected")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    opened.current = true;
  }, [slideIndex, placement]);

  const sizes = exportSizes(meta, { targets: draft.targets ?? undefined }, shots);
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
  const editSlides = (recipe: (set: Slide[]) => void, now = false) => update((doc) => recipe(setOf(doc, device)), now);
  const moveImage = useCallback(
    (index: number, at: number, x: number, y: number) =>
      update((doc) => {
        const placed = setOf(doc, shownDevice.current)[index]?.images?.[at];
        if (placed) Object.assign(placed, { x, y });
      }),
    [update],
  );

  /** From here on the device has slides of its own. They start as a copy of the shared ones. */
  const splitSet = () => {
    update((doc) => {
      const start: Slide[] = doc.slides.length ? structuredClone(doc.slides) : [{ layout: "device-bottom", headline: "Your headline" }];
      doc.deviceSlides = { ...doc.deviceSlides, [device]: start };
    }, true);
    if (slideIndex == null) setSelection({ kind: "slide", index: 0 });
    toast(`The ${deviceLabel} has its own slides now. What you change here no longer reaches the other devices.`, "", 7000);
  };

  const joinSet = () =>
    ask({
      title: `Delete the ${deviceLabel}'s own ${slides.length === 1 ? "slide" : `${slides.length} slides`}?`,
      text: `The ${deviceLabel} then shows the shared slides again. Undo brings its own back.`,
      action: slides.length === 1 ? "Delete slide" : "Delete slides",
      running: "Deleting…",
      danger: true,
      run: () => {
        update((doc) => {
          const sets = { ...doc.deviceSlides };
          delete sets[device];
          doc.deviceSlides = sets;
        }, true);
        const shared = store.getState().draft.slides.length;
        setSelection((current) => (current?.kind !== "slide" ? current : shared ? { kind: "slide", index: Math.min(current.index, shared - 1) } : null));
      },
    });

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
      ask({
        title: `Delete slide ${index + 1}?`,
        text: "Undo brings it back.",
        action: "Delete slide",
        running: "Deleting…",
        danger: true,
        run: () => {
          editSlides((set) => void set.splice(index, 1), true);
          setSelection(slides.length > 1 ? { kind: "slide", index: Math.min(index, slides.length - 2) } : null);
        },
      });
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
    update((doc) => void (doc.creatives[where] = seed), true);
    select({ kind: "creative", placement: where });
  };

  const removeCreative = (where: PlacementId) =>
    ask({
      title: `Remove the ${meta.placements[where].label.toLowerCase()}${meta.placements[where].kind === "store" ? " asset" : ""}?`,
      text: "Undo brings it back.",
      action: "Remove",
      running: "Removing…",
      danger: true,
      run: () => {
        update((doc) => void delete doc.creatives[where], true);
        setSelection(slides.length ? { kind: "slide", index: 0 } : null);
      },
    });

  const deleteProject = () => openDialog({ remove: { id, name: draft.name } });

  // ---------------------------------------------------------------- render

  // The previews fit the room the page has, down to a phone's width.
  const [room, row] = useWidth();
  const fits = (width: number) => (room > 0 ? room / width : Infinity);
  const scales = ZOOMS[zoom];
  const slideScale = Math.min(scales.slide / size.height, scales.wide / size.width, fits(size.width));

  // A preview's key is what its page is drawn from, so it loads again only when that changed.
  const primary = base.locales[0]!;
  const slideKeys = useMemo(
    () => shownSlides.map((slide) => slideKey(slide, { theme: base.theme, primary, locale, target, device, shots, images })),
    [shownSlides, base.theme, primary, locale, target, device, shots, images],
  );
  const query = new URLSearchParams({ target, locale }).toString();

  // The editors take a whole project. Its draft is the part that changes; the rest is the project as it was opened.
  const project = useMemo<Project>(() => ({ ...detail.project, ...draft, targets: draft.targets ?? undefined }), [detail.project, draft]);
  const changeProject: Change<Project> = (recipe) => update((doc) => recipe(doc as unknown as Project));
  const changeSlide: Change<Slide> = (recipe) => editSlides((set) => recipe(set[slideIndex!]!));
  const changeCreative: Change<Creative> = (recipe) => update((doc) => recipe(doc.creatives[placement!]!));
  const itemTab = placement ? meta.placements[placement].label : slideIndex != null ? `Slide ${slideIndex + 1}` : "Slide";
  const splitDevices = meta.devices.filter((entry) => draft.deviceSlides?.[entry.id] != null);
  const pick = (files: File[], kind: "shot" | "image") => void upload(files, kind);

  /** Which device's slides are shown. The slides page and the store's both have it. */
  const deviceSwitch = (
    <Segmented
      label="Device the slides are shown for"
      choices={meta.devices.map((entry) => {
        const split = draft.deviceSlides?.[entry.id] != null;
        const has = shots.some((shot) => shot.device === entry.id);
        return {
          id: entry.id,
          text: (
            <>
              {entry.label}
              {split ? <span className="dot" /> : null}
            </>
          ),
          title: `${split ? `The ${entry.label} has slides of its own.` : `The ${entry.label} shows the shared slides.`}${has ? "" : " It has no screenshots of its own yet, so another device's stand in."}`,
        };
      })}
      value={device}
      onChange={showDevice}
    />
  );
  const languageSwitch = <LanguageSwitch locales={draft.locales} value={locale} onChange={setLocale} onAdd={addLanguage} />;

  const icon = useMemo(() => appIcon(images, shownSlides), [images, shownSlides]);

  const canvas = (
    <div className="workspace" hidden={view !== "slides"}>
      {shots.length === 0 ? (
        <div className="callout">
          <div className="callout-text">
            <b>Start with your app's screens.</b>
            <span>Drop screenshots anywhere in this window, or capture one from your Mac:</span>
            <code>appshots capture --name home --project {id}</code>
          </div>
          <div className="callout-actions">
            <Picker kind="shot" text="Upload screenshots" upload={pick} />
            <button className="btn small quiet" type="button" onClick={openConnect}>
              How to set that up
            </button>
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        {deviceSwitch}
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
        {languageSwitch}
        <Segmented
          label="Preview size"
          choices={(Object.keys(ZOOMS) as Zoom[]).map((key) => ({ id: key, text: key.toUpperCase(), title: `${ZOOMS[key].name} previews`, label: `${ZOOMS[key].name} previews` }))}
          value={zoom}
          onChange={setZoom}
        />
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

      <div className="slides" ref={row}>
        {slides.map((slide, index) => (
          <SlideCard
            key={index}
            projectId={id}
            index={index}
            slide={slide}
            shown={shownSlides[index]}
            // A slide added a moment ago has no page on the server until the save lands.
            src={index < shownSlides.length ? `/render/${id}/${index}?${query}` : null}
            frameKey={slideKeys[index] ?? ""}
            width={size.width}
            height={size.height}
            scale={slideScale}
            on={slideIndex === index}
            handles={slideIndex === index && tab === "item"}
            images={images}
            select={selectSlide}
            move={moveImage}
          />
        ))}
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
        const forStore = kind === "store";
        return (
          <section className="block" key={kind}>
            <div className="section-head">
              <h2>{forStore ? "Header and search results" : "Banners"}</h2>
              <span className="hint">{forStore ? "Optional images for the Header and Search Results tab in App Store Connect." : "Wide pictures for outside the store: the top of a README, the preview of a link, a post."}</span>
              <span className="spacer" />
              {forStore && group.some((where) => draft.creatives[where]) ? (
                <label className="check" title="Draws the part every device shows as a dashed frame. It is a guide in this preview only and never part of the exported image.">
                  <input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} />
                  Show safe area
                </label>
              ) : null}
            </div>
            <div className="slides">
              {group.map((where) => {
                const spec = meta.placements[where];
                const scale = Math.min(scales.asset / spec.height, scales.wide / spec.width, fits(spec.width));
                const marked = forStore && guides;
                const name = `${spec.label}${forStore ? " asset" : ""}`;
                if (!draft.creatives[where]) {
                  return (
                    <button key={where} className="card add" type="button" aria-label={`Add the ${name.toLowerCase()}`} onClick={() => addCreative(where)}>
                      <div className="stage" style={{ width: Math.round(spec.width * scale), height: Math.round(spec.height * scale) }}>
                        + Add
                      </div>
                      <div className="caption">
                        <span>{spec.label}</span>
                        <span>
                          {spec.ratio} · {spec.width}×{spec.height}
                        </span>
                      </div>
                    </button>
                  );
                }
                return (
                  <CreativeCard
                    key={where}
                    where={where}
                    name={name}
                    title={spec.label}
                    size={`${spec.ratio} · ${spec.width}×${spec.height}`}
                    on={placement === where}
                    select={selectCreative}
                    src={base.creatives[where] ? `/render/${id}/creative/${where}?${new URLSearchParams(marked ? { locale, guides: "1" } : { locale })}` : null}
                    frameKey={creativeKey(base.creatives[where], { theme: base.theme, primary, locale, guides: marked, shots, images })}
                    width={spec.width}
                    height={spec.height}
                    scale={scale}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );

  return (
    <div className="main">
      <ProjectBar id={id} name={draft.name} view={view} onRename={rename} field={titleField}>
        <SaveStatus store={store} task={task} />
        <UndoButtons store={store} />
        <HistoryButton id={id} store={store} />
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
        <ExportButton id={id} store={store} />
      </ProjectBar>
      <ConflictBar store={store} />

      <div className="content">
        {/* The slides stay laid out under the assets and the store, so coming back to them does not load every preview again. */}
        {canvas}
        {view === "assets" ? <AssetsView meta={meta} detail={detail} draft={draft} locale={locale} setLocale={setLocale} upload={upload} openConnect={openConnect} /> : null}
        {/* The store's slides are the slides page's own previews, so their headlines are edited beside them. */}
        {view === "store" ? (
          <StorePreview
            name={draft.name}
            device={device}
            deviceLabel={deviceLabel}
            size={size}
            slides={shownSlides.map((slide, index) => ({ slide, src: `/render/${id}/${index}?${query}`, frameKey: slideKeys[index] ?? "" }))}
            theme={base.theme}
            icon={icon}
            projectId={id}
            selected={slideIndex}
            select={selectSlide}
            controls={
              <>
                {deviceSwitch}
                {languageSwitch}
              </>
            }
          />
        ) : null}
        {view === "assets" ? null : (
          <aside className="panel">
            <Tabs
              label="What the editor shows"
              panel="editor-panel"
              choices={[
                { id: "item", text: itemTab },
                { id: "project", text: "Project" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <div className="panel-body" id="editor-panel" role="tabpanel" aria-labelledby={tabId("editor-panel", tab)}>
              <Scope.Provider value={{ meta, projectId: id, shots, images, target, locale, primary: draft.locales[0]!, guides, dragging: slideIndex != null }}>
                {tab === "project" ? (
                  <ProjectEditor project={project} change={changeProject} rename={rename} remove={deleteProject} />
                ) : placement ? (
                  <CreativeEditor key={placement} project={project} placement={placement} change={changeCreative} remove={() => removeCreative(placement)} />
                ) : slideIndex != null ? (
                  <SlideEditor key={`${device}:${slideIndex}`} project={project} slides={slides} index={slideIndex} change={changeSlide} actions={slideActions(slideIndex)} />
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
