// A project's screenshots as devices with nothing behind them: transparent PNGs for a website, a README or a deck.
// The previews are iframes of the page the renderer screenshots, so the device on screen is the one in the PNG.

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Detail, detailQuery, type DeviceStyle, errorText, fetchFile, label, type Meta, type MockupItem, type Mockups, mockupsQuery, plural, put, saveFile, type Shot, slugify } from "./api.ts";
import { DEVICE_LOOKS, ids, Slider, STATUS_BARS, TimeInput } from "./editor.tsx";
import { languageName, LanguageSwitch } from "./languages.tsx";
import { dropTarget, shotsKey, Stage, ViewSwitch } from "./project.tsx";
import { CopyBlock, Field, Icon, NumberInput, Select, toast } from "./ui.tsx";

const DOWNLOAD = "M8 2.6v7.8M4.9 7.5L8 10.6l3.1-3.1M2.8 10.4v2.8h10.4v-2.8";
const COPY = "M5.6 5.6V3h7.4v7.4h-2.6M3 5.6h7.4V13H3z";

const TILE_HEIGHT = 420;

/** What the previews stand on. It is only there to look at: the PNG has nothing behind the device. */
const BACKDROPS = { checker: "Transparent", light: "Light", dark: "Dark" };
type Backdrop = keyof typeof BACKDROPS;

type MockupDevice = NonNullable<Mockups["device"]>;

export function MockupsPage({ meta, initial }: { meta: Meta; initial: Detail }) {
  const id = initial.project.id;
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Mockups>(initial.project.mockups);
  /** What the server last accepted. The previews show this, not the draft. */
  const [savedText, setSavedText] = useState(() => JSON.stringify(initial.project.mockups));
  const [dirty, setDirty] = useState(false);
  const [chosenLocale, setLocale] = useState(initial.project.locales[0]!);
  const [status, setStatusState] = useState({ text: "", error: false });
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

  // Timers and requests outlive renders, so they read the draft from here.
  const latest = useRef(draft);
  const saved = useRef(savedText);
  const stamp = useRef(initial.project.updatedAt);
  const saveTimer = useRef<number | null>(null);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const statusTimer = useRef<number | undefined>(undefined);

  const setStatus = useCallback((text: string, error = false) => {
    clearTimeout(statusTimer.current);
    setStatusState({ text, error });
    if (text && !error && text !== "Saving…") statusTimer.current = window.setTimeout(() => setStatusState({ text: "", error: false }), 1500);
  }, []);

  const isDirty = () => saveTimer.current !== null || JSON.stringify(latest.current) !== saved.current;

  const save = useCallback(
    (init?: RequestInit) => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      inflight.current = inflight.current.then(async () => {
        const body = JSON.stringify(latest.current);
        try {
          if (body === saved.current) return setStatus("");
          const fresh = await api<Detail>("PUT", `/projects/${id}`, { mockups: JSON.parse(body) }, init);
          saved.current = body;
          stamp.current = fresh.project.updatedAt;
          setSavedText(body);
          queryClient.setQueryData(detailQuery(id).queryKey, fresh);
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

  /** Changes the settings and saves them once the changes pause, so dragging a slider is one save. */
  const change = useCallback(
    (recipe: (settings: Mockups) => void) => {
      const next = structuredClone(latest.current);
      recipe(next);
      if (next.device && Object.keys(next.device).length === 0) delete next.device;
      latest.current = next;
      setDraft(next);
      setDirty(true);
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void save(), 200);
      setStatus("Saving…");
    },
    [save, setStatus],
  );

  // Leaving the page sends what is still waiting.
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

  // Picks up changes made elsewhere while the page is open: an agent setting the device, or the CLI uploading a capture.
  const live = useQuery({ ...detailQuery(id), refetchInterval: dirty ? false : 3000 });
  const { project, shots } = live.data ?? initial;
  useEffect(() => {
    const fresh = live.data?.project;
    if (!fresh || fresh.updatedAt <= stamp.current || isDirty()) return;
    stamp.current = fresh.updatedAt;
    latest.current = fresh.mockups;
    saved.current = JSON.stringify(fresh.mockups);
    setDraft(fresh.mockups);
    setSavedText(saved.current);
  }, [live.dataUpdatedAt]);

  useEffect(() => {
    document.title = `${project.name} mockups · appShots Studio`;
    return () => void (document.title = "appShots Studio");
  }, [project.name]);

  const first = project.locales[0]!;
  const locale = project.locales.includes(chosenLocale) ? chosenLocale : first;
  // Asked for again whenever the settings are saved or a screenshot changes, since both decide how large a mockup is.
  const list = useQuery({ ...mockupsQuery(id, locale, `${savedText}|${shotsKey(shots)}`), placeholderData: keepPreviousData });
  const order = meta.devices.map((entry) => entry.id);
  const items = [...(list.data?.items ?? [])].sort((a, b) => order.indexOf(a.device) - order.indexOf(b.device));
  const drawnWith = JSON.stringify(list.data?.settings ?? {});

  const upload = useCallback(
    async (files: File[]) => {
      const pictures = files.filter((file) => file.type.startsWith("image/"));
      if (pictures.length === 0) return toast("Those are not images.", "error");
      setStatus(`Uploading ${pictures.length}…`);
      const language = locale === first ? "" : `?locale=${encodeURIComponent(locale)}`;
      for (const file of pictures) {
        try {
          await api<Shot>("PUT", `/projects/${id}/shots/${slugify(file.name.replace(/\.[^.]+$/, ""))}${language}`, file);
        } catch (error) {
          toast(`${file.name}: ${errorText(error)}`, "error");
        }
      }
      setStatus("");
      await queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
    },
    [id, queryClient, setStatus, locale, first],
  );
  useEffect(() => {
    dropTarget.upload = (files) => void upload(files);
    return () => void (dropTarget.upload = null);
  }, [upload]);

  /** Draws a file with the settings as they stand and saves it. A mockup is drawn when it is asked for, which can take a moment. */
  const download = async (key: string, url: string, name: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await save();
      saveFile(await fetchFile(url), name);
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
      await navigator.clipboard.write([new ClipboardItem({ "image/png": save().then(() => fetchFile(item.png)) })]);
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

  const picker = (
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
  );

  return (
    <div className="main">
      <header className="bar">
        <span className="crumb">{project.name}</span>
        <ViewSwitch id={id} view="mockups" />
        <span className="spacer" />
        <span className={`status${status.error ? " error" : ""}`} role="status">
          {status.text}
        </span>
        <button className="btn primary export" type="button" disabled={busy != null || shots.length === 0} onClick={() => void download("zip", `/api/projects/${id}/mockups.zip`, `${id}-mockups.zip`)}>
          {busy === "zip" ? "Drawing…" : "Download all"}
        </button>
      </header>

      <div className="content">
        <div className="workspace">
          <div className="page-head">
            <h1 className="page-title">Mockups</h1>
            <div className="page-meta">Each screenshot in its device with nothing behind it, as a transparent PNG for a website, a README or a deck.</div>
          </div>

          <section>
            <div className="section-head wrap">
              <h2>{shots.length ? plural(items.length, "mockup") : "No screenshots yet"}</h2>
              <span className="hint">{items.length ? "A PNG is cut to the device and its shadow." : ""}</span>
              <div className="head-actions">
                {project.locales.length > 1 ? <LanguageSwitch locales={project.locales} value={locale} onChange={setLocale} /> : null}
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
                {picker}
              </div>
            </div>

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
              <div className={`mockups ${backdrop}`}>
                {items.map((item) => {
                  const scale = TILE_HEIGHT / item.stage.height;
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
          <div className="panel-fields">
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
              <div className="group-head">
                <span className="label">From the terminal</span>
              </div>
              <p className="hint">Saves every mockup into a folder, drawn with the settings above. An agent does the same with the render_mockups tool.</p>
              <CopyBlock text={`appshots mockups ${id}`} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
