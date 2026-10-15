// A project's screenshots as devices with nothing behind them: transparent PNGs for a website, a README or a deck.
// The previews are iframes of the page the renderer screenshots, so the device on screen is the one in the PNG.
// The settings are part of the project's draft, the same one its slides page edits.

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { type Detail, type DeviceStyle, errorText, fetchFile, label, type Meta, type MockupItem, type Mockups, mockupsQuery, plural, put, saveFile, type Shot, type StoredImage } from "./api.ts";
import { DEVICE_LOOKS, ids, Slider, STATUS_BARS, TimeInput } from "./editor/index.ts";
import { languageName, LanguageSwitch } from "./languages.tsx";
import { Picker, useUpload } from "./project/Assets.tsx";
import { ConflictBar, ProjectBar, SaveStatus, UndoButtons } from "./project/ProjectBar.tsx";
import { Stage, useWidth } from "./project/Previews.tsx";
import { change as changeDoc, projectDraft, remoteOf, renamed, useDraft, useOpenProject, useUndoKeys } from "./state/useDraft.ts";
import { track } from "./track.ts";
import { CopyBlock, Field, Icon, NumberInput, Select, toast } from "./ui/index.ts";

const DOWNLOAD = "M8 2.6v7.8M4.9 7.5L8 10.6l3.1-3.1M2.8 10.4v2.8h10.4v-2.8";
const COPY = "M5.6 5.6V3h7.4v7.4h-2.6M3 5.6h7.4V13H3z";
const RETRY = "M13 8a5 5 0 1 1-1.5-3.6M13 2.6v2.8h-2.8";

const TILE_HEIGHT = 420;

/** What the previews stand on. It is only there to look at: the PNG has nothing behind the device. */
const BACKDROPS = { checker: "Transparent", light: "Light", dark: "Dark" };
type Backdrop = keyof typeof BACKDROPS;

type MockupDevice = NonNullable<Mockups["device"]>;

export const shotsKey = (shots: (Shot | StoredImage)[]) => shots.map((shot) => `${shot.file}:${shot.version}`).join(",");

const NOT_SAVED = "Your latest changes are not saved yet, so the mockup would leave them out. Try again once they are saved.";

export function MockupsPage({ meta, detail }: { meta: Meta; detail: Detail }) {
  const id = detail.project.id;
  const queryClient = useQueryClient();
  const store = projectDraft(queryClient, detail);
  useEffect(() => store.receive(remoteOf(detail)), [store, detail]);
  const project = useDraft(store, (state) => state.draft);
  const draft = project.mockups;
  /** The settings the server has, which the previews are drawn with. */
  const saved = useDraft(store, (state) => state.base.doc.mockups);
  useUndoKeys(store);
  useOpenProject(store, id, (name) => {
    changeDoc(store, (doc) => void (doc.name = name));
    renamed(queryClient, { id, name });
  });
  const { shots } = detail;

  const [chosenLocale, setLocale] = useState(project.locales[0]!);
  /** The file being drawn for a download or a copy, so one click does not start it twice. */
  const [busy, setBusy] = useState<string | null>(null);
  const [backdrop, setBackdropState] = useState<Backdrop>(() => {
    try {
      const kept = localStorage.getItem("appshots.backdrop");
      return kept && kept in BACKDROPS ? (kept as Backdrop) : "checker";
    } catch {
      return "checker";
    }
  });
  const setBackdrop = (next: Backdrop) => {
    setBackdropState(next);
    try {
      localStorage.setItem("appshots.backdrop", next);
    } catch {}
  };

  /** Changes the settings. Edits close together, such as dragging a slider, are saved and undone as one. */
  const change = (recipe: (settings: Mockups) => void) =>
    changeDoc(store, (doc) => {
      recipe(doc.mockups);
      if (doc.mockups.device && Object.keys(doc.mockups.device).length === 0) delete doc.mockups.device;
    });

  useEffect(() => {
    document.title = `${project.name} mockups · appShots Studio`;
    return () => void (document.title = "appShots Studio");
  }, [project.name]);

  const first = project.locales[0]!;
  const locale = project.locales.includes(chosenLocale) ? chosenLocale : first;
  const { upload, task } = useUpload({ store, detail, locale });
  // Asked for again whenever the settings are saved or a screenshot changes, since both decide how large a mockup is.
  const list = useQuery({ ...mockupsQuery(id, locale, `${JSON.stringify(saved)}|${shotsKey(shots)}`), placeholderData: keepPreviousData });
  const order = meta.devices.map((entry) => entry.id);
  const items = [...(list.data?.items ?? [])].sort((a, b) => order.indexOf(a.device) - order.indexOf(b.device));
  const drawnWith = JSON.stringify(list.data?.settings ?? {});
  // Tiles from before that could not be fetched again, or that wait for the new ones, show what was.
  const stale = list.isError || list.isPlaceholderData;

  // A tile is as tall as the others, unless that makes it wider than the page has room for.
  const [room, grid] = useWidth();
  const scaleOf = (item: MockupItem) => Math.min(TILE_HEIGHT / item.stage.height, room > 0 ? room / item.stage.width : Infinity);

  /** Draws a file with the settings as they stand and saves it. A mockup is drawn when it is asked for, which can take a moment. */
  const download = async (key: string, url: string, name: string) => {
    if (busy) return;
    setBusy(key);
    try {
      if (!(await store.flush())) return toast(NOT_SAVED, "error", 8000);
      saveFile(await fetchFile(url), name);
      track("export", { kind: key === "zip" ? "mockups" : "mockup" });
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (item: MockupItem) => {
    if (busy) return;
    setBusy(`copy:${item.file}`);
    try {
      // Handed over as a promise: a browser only lets a click write to the clipboard, and the picture is not drawn yet.
      const picture = store.flush().then((ok) => (ok ? fetchFile(item.png) : Promise.reject(new Error(NOT_SAVED))));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": picture })]);
      toast(`"${item.name}" is on the clipboard.`);
    } catch (error) {
      toast(`Not copied: ${errorText(error)}`, "error");
    } finally {
      setBusy(null);
    }
  };
  const canCopy = typeof ClipboardItem !== "undefined" && navigator.clipboard?.write != null;

  const device: MockupDevice = draft.device ?? {};
  const set = (key: keyof MockupDevice, standard?: string) => (value: unknown) =>
    change((settings) => {
      const next: DeviceStyle = { ...settings.device };
      put(next, key, value === standard ? undefined : value);
      settings.device = next;
    });
  const drawsBar = device.statusBar === "cover" || device.statusBar === "overlay";
  const changed = draft.width != null || Object.keys(device).length > 0;
  const pick = (files: File[]) => void upload(files, "shot");

  return (
    <div className="main">
      <ProjectBar id={id} name={project.name} view="mockups">
        <SaveStatus store={store} task={task} />
        <UndoButtons store={store} />
        <button className="btn primary" type="button" disabled={busy != null || shots.length === 0} onClick={() => void download("zip", `/api/projects/${id}/mockups.zip`, `${id}-mockups.zip`)}>
          {busy === "zip" ? "Drawing…" : "Download all"}
        </button>
      </ProjectBar>
      <ConflictBar store={store} />

      <div className="content">
        <div className="workspace">
          <section>
            <div className="toolbar">
              {shots.length ? (
                <div className="segmented" role="radiogroup" aria-label="What the previews stand on">
                  {(Object.keys(BACKDROPS) as Backdrop[]).map((key) => (
                    <button
                      key={key}
                      className={backdrop === key ? "on" : ""}
                      type="button"
                      role="radio"
                      aria-checked={backdrop === key}
                      title={key === "checker" ? "Show what is transparent as a chequered pattern" : `See the mockups on a ${key} page. The PNG stays transparent.`}
                      onClick={() => setBackdrop(key)}
                    >
                      {BACKDROPS[key]}
                    </button>
                  ))}
                </div>
              ) : null}
              <span className="spacer" />
              {project.locales.length > 1 ? <LanguageSwitch locales={project.locales} value={locale} onChange={setLocale} /> : null}
              <Picker kind="shot" text="Upload" upload={pick} />
            </div>
            <div className="set-line">
              <span>
                <b>{shots.length ? plural(items.length, "mockup") : "No screenshots yet"}</b>
                {items.length ? ". Each screenshot in its device with nothing behind it: a transparent PNG, cut to the device and its shadow." : ""}
              </span>
            </div>
            {list.isError ? (
              <div className="callout list-error" role="alert">
                <div className="callout-text">
                  <b>The mockups could not be loaded.</b>
                  <span>
                    {errorText(list.error)}
                    {items.length ? " The ones shown are from before." : ""}
                  </span>
                </div>
                <div className="callout-actions">
                  <button className="btn small" type="button" onClick={() => void list.refetch()}>
                    <Icon path={RETRY} />
                    Try again
                  </button>
                </div>
              </div>
            ) : null}

            {shots.length === 0 ? (
              <div className="dropzone mockups-empty">
                <div>
                  Drop your app's screenshots here to see them in their devices,
                  <br />
                  or capture one from your Mac:
                  <br />
                  <code>appshots capture --name home --project {id}</code>
                </div>
              </div>
            ) : (
              <div className={`mockups ${backdrop}${stale ? " stale" : ""}`} ref={grid} aria-busy={list.isFetching}>
                {items.map((item) => {
                  const scale = scaleOf(item);
                  const from = item.locale ?? first;
                  const borrowed = from.toLowerCase() !== locale.toLowerCase();
                  return (
                    <figure key={`${item.name}.${item.device}`} className="mockup" style={{ width: Math.round(item.stage.width * scale) }}>
                      <Stage src={`${item.page}?v=${item.version}`} frameKey={JSON.stringify([item.file, item.version, item.stage, drawnWith])} width={item.stage.width} height={item.stage.height} scale={scale} />
                      <figcaption>
                        <div className="caption">
                          <span title={item.saveAs}>{item.name}</span>
                          <span>{meta.devices.find((entry) => entry.id === item.device)?.label ?? label(item.device)}</span>
                          {borrowed ? <span title={`The ${languageName(from)} screenshot, until ${languageName(locale)} has its own`}>{from}</span> : null}
                        </div>
                        <div className="mockup-actions">
                          <button className="btn small" type="button" disabled={busy != null} title={`Save ${item.saveAs}`} onClick={() => void download(item.file, `${item.png}?download=1`, item.saveAs)}>
                            <Icon path={DOWNLOAD} />
                            {busy === item.file ? "Drawing…" : "PNG"}
                          </button>
                          {canCopy ? (
                            <button className="btn small quiet" type="button" disabled={busy != null} title="Copy the PNG, to paste it into a design or a document" onClick={() => void copy(item)}>
                              <Icon path={COPY} />
                              {busy === `copy:${item.file}` ? "Drawing…" : "Copy"}
                            </button>
                          ) : null}
                        </div>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="panel">
          <div className="tabs">
            <span className="tab on">Device</span>
            <span className="spacer" />
            {changed ? (
              <button className="btn small quiet" type="button" title="Back to the plain device at the screenshot's own size" onClick={() => change((settings) => (delete settings.device, delete settings.width))}>
                Reset
              </button>
            ) : null}
          </div>
          <div className="panel-body">
            <div className="form">
              <div className="cols">
                <Field label="Device look">
                  <select value={device.style ?? "real"} title={meta.deviceStyles[device.style ?? "real"]} onChange={(event) => set("style", "real")(event.target.value)}>
                    {Object.entries(meta.deviceStyles).map(([key, note]) => (
                      <option key={key} value={key} title={note}>
                        {DEVICE_LOOKS[key] ?? label(key)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Device colour">
                  <Select options={[["", "Default"], ...ids(meta.deviceColors)]} value={device.color ?? ""} onChange={set("color")} />
                </Field>
              </div>
              <div className="cols">
                <Field label="Frame">
                  <Select
                    options={[["auto", "Match screenshot"], ["iphone", "iPhone"], ["duo", "iPhone Duo"], ["ipad", "iPad"], ["mac", "MacBook"], ["none", "No frame"]]}
                    value={device.frame ?? "auto"}
                    onChange={set("frame", "auto")}
                  />
                </Field>
                <Field label="Shadow">
                  <Select options={[["none", "None"], ["soft", "Soft"], ["strong", "Strong"]]} value={device.shadow ?? "none"} onChange={set("shadow", "none")} />
                </Field>
              </div>
              <div className="cols">
                <Field label="Status bar">
                  <select value={device.statusBar ?? "none"} title={meta.statusBars[device.statusBar ?? "none"]} onChange={(event) => set("statusBar", "none")(event.target.value)}>
                    {Object.entries(meta.statusBars).map(([key, note]) => (
                      <option key={key} value={key} title={note}>
                        {STATUS_BARS[key] ?? label(key)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Turn in 3D">
                  <Select options={[["none", "None"], ["left", "To the left"], ["right", "To the right"]]} value={device.perspective ?? "none"} onChange={set("perspective", "none")} />
                </Field>
              </div>
              {drawsBar ? (
                <div className="cols">
                  <Field label="Time shown">
                    <TimeInput value={device.statusBarTime} onChange={set("statusBarTime")} />
                  </Field>
                  <Field label="Time and icons">
                    <Select options={[["auto", "Auto"], ["light", "White"], ["dark", "Black"]]} value={device.statusBarColor ?? "auto"} onChange={set("statusBarColor", "auto")} />
                  </Field>
                </div>
              ) : null}
              <div className="sliders">
                <Slider label="Tilt" value={device.rotate} base={0} min={-45} max={45} step={1} show={(value) => `${value}°`} onChange={set("rotate")} />
              </div>
              <Field label="Width in pixels" hint="Left empty, the screenshot is shown pixel for pixel, which is the sharpest a mockup gets.">
                <NumberInput
                  value={draft.width}
                  onChange={(value) =>
                    change((settings) => {
                      if (value == null) delete settings.width;
                      else settings.width = Math.round(value);
                    })
                  }
                  min={200}
                  max={4000}
                  step={50}
                  placeholder="Actual size"
                />
              </Field>
              <div className="field">
                <span className="label">From the terminal</span>
                <CopyBlock text={`appshots mockups ${id}`} />
                <span className="hint">Saves every mockup into a folder, drawn with the settings above. An agent does the same with the render_mockups tool.</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
