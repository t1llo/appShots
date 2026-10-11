// The panel on the right: one editor each for a slide, a header or search results asset, and the project.

import { type ChangeEvent, createContext, Fragment, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import {
  type Background,
  type Badge,
  type Creative,
  type CreativeLayoutId,
  type DeviceStyle,
  errorText,
  exportSizes,
  type Feature,
  type IconRow,
  label,
  type Logo,
  type Meta,
  shotFor,
  type PlacedImage,
  type PlacementId,
  type Project,
  put,
  readText,
  type Shot,
  type Slide,
  type StoredImage,
  type TargetId,
  type Text,
  type Theme,
  withText,
} from "./api.ts";
import { LanguageList } from "./languages.tsx";
import { Field, NumberInput, type Option, Select, toast } from "./ui.tsx";

/** Applies a mutation to one part of a fresh copy of the project, which then becomes the draft. */
export type Change<T> = (recipe: (value: T) => void) => void;

export interface EditorScope {
  meta: Meta;
  projectId: string;
  shots: Shot[];
  /** The logos and other artwork uploaded to the project. */
  images: StoredImage[];
  target: TargetId;
  /** The language whose text the fields show, and the one a plain string belongs to. */
  locale: string;
  primary: string;
  /** Whether asset previews draw the safe area. */
  guides: boolean;
  /** Whether the large preview is on screen, where placed images can be dragged. */
  dragging: boolean;
}

export const Scope = createContext<EditorScope>(null as never);
const useScope = () => useContext(Scope);

const ids = (list: readonly string[]): Option[] => list.map((id) => [id, label(id)]);

// ---------------------------------------------------------------- fields

function TextInput(props: { value: Text | undefined; onChange: (next: Text | undefined) => void; rows?: number; placeholder?: string }) {
  const { value, onChange, rows, placeholder } = props;
  const { locale, primary } = useScope();
  const fallback = value && typeof value === "object" ? (value[primary] ?? "") : "";
  const shared = {
    value: readText(value, locale),
    placeholder: fallback || placeholder || "",
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(withText(value, event.target.value, locale, primary)),
  };
  return rows ? <textarea rows={rows} {...shared} /> : <input type="text" {...shared} />;
}

function BackgroundField({ value, onChange, inheritLabel }: { value: Background | undefined; onChange: (next: Background | undefined) => void; inheritLabel: string }) {
  const { meta } = useScope();
  const [picked, setPicked] = useState("#4f46e5");
  const custom = value != null && typeof value === "object";
  const hex = typeof value === "string" && value.startsWith("#") ? value : null;
  const colour = hex?.length === 7 ? hex : picked;
  const options: Option[] = [["", inheritLabel], ...meta.backgrounds.map((id): Option => [id, id === "auto" ? "Auto (from the screenshot)" : label(id)]), ["#", "Custom colour…"]];
  if (custom) options.push(["{}", "Custom gradient (see JSON)"]);
  return (
    <Field label="Background">
      <div className="row">
        <Select
          options={options}
          value={value == null ? "" : custom ? "{}" : hex ? "#" : (value as string)}
          onChange={(next) => {
            if (next !== "{}") onChange(next === "" ? undefined : next === "#" ? colour.toUpperCase() : next);
          }}
        />
        {hex ? (
          <input
            type="color"
            aria-label="Background colour"
            value={colour.toLowerCase()}
            onChange={(event) => {
              setPicked(event.target.value);
              onChange(event.target.value.toUpperCase());
            }}
          />
        ) : null}
      </div>
    </Field>
  );
}

function ColorField({ label: text, value, onChange }: { label: string; value: string | undefined; onChange: (next: string | undefined) => void }) {
  return (
    <Field label={text}>
      <div className="row">
        <input type="color" aria-label={text} value={value?.length === 7 ? value.toLowerCase() : "#000000"} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        <span className="swatch-value">{value ?? "Auto"}</span>
        <button className="btn small" type="button" onClick={() => onChange(undefined)}>
          Auto
        </button>
      </div>
    </Field>
  );
}

/**
 * Style controls shared by the project theme, per-slide overrides and assets. An asset has no alignment
 * or tilt: its copy is always centred and its layout places the devices.
 */
function StyleFields({ owner, change, inherits, asset = false, placed = false }: { owner: Theme; change: Change<Theme>; inherits: boolean; asset?: boolean; placed?: boolean }) {
  const { meta } = useScope();
  const base = inherits ? "Project default" : "Default";
  const set = (key: keyof Theme, value: unknown) => change((style) => put(style, key, value));
  const setDevice = (key: keyof DeviceStyle, value: unknown) =>
    change((style) => {
      const device = { ...style.device };
      put(device, key, value);
      if (Object.keys(device).length) style.device = device;
      else delete style.device;
    });
  const device = owner.device ?? {};

  const chosenFont = meta.fontList.find((entry) => entry.id === owner.font);
  const font = (
    <Field label="Font">
      <select value={owner.font ?? ""} title={chosenFont?.note} onChange={(event) => set("font", event.target.value)}>
        <option value="">{base}</option>
        {[...new Set(meta.fontList.map((entry) => entry.group))].map((group) => (
          <optgroup key={group} label={group}>
            {meta.fontList
              .filter((entry) => entry.group === group)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.family.replace(/ Variable$/, "")}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
  const size = (
    <Field label="Device size">
      <NumberInput value={device.scale} onChange={(value) => setDevice("scale", value)} min={0.4} max={1.6} step={0.05} placeholder="1" />
    </Field>
  );
  const headline = (
    <Field label="Headline size">
      <NumberInput value={owner.textScale} onChange={(value) => set("textScale", value)} min={0.5} max={1.5} step={0.05} placeholder="1" />
    </Field>
  );
  const shadow = (
    <Field label="Shadow">
      <Select options={[["", base], ["none", "None"], ["soft", "Soft"], ["strong", "Strong"]]} value={device.shadow ?? ""} onChange={(value) => setDevice("shadow", value)} />
    </Field>
  );
  const look = (
    <Field label="Device look">
      <select value={device.style ?? ""} title={meta.deviceStyles[device.style ?? "real"]} onChange={(event) => setDevice("style", event.target.value)}>
        <option value="">{base}</option>
        {Object.entries(meta.deviceStyles).map(([id, note]) => (
          <option key={id} value={id} title={note}>
            {DEVICE_LOOKS[id] ?? label(id)}
          </option>
        ))}
      </select>
    </Field>
  );
  const statusBar = (
    <Field label="Status bar">
      <select value={device.statusBar ?? ""} title={meta.statusBars[device.statusBar ?? "none"]} onChange={(event) => setDevice("statusBar", event.target.value)}>
        <option value="">{base}</option>
        {Object.entries(meta.statusBars).map(([id, note]) => (
          <option key={id} value={id} title={note}>
            {STATUS_BARS[id] ?? label(id)}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <>
      <BackgroundField value={owner.background} onChange={(value) => set("background", value)} inheritLabel={inherits ? "Project default" : "Default (midnight)"} />
      <div className="cols">
        {font}
        {asset ? (
          shadow
        ) : (
          <Field label="Alignment">
            <Select options={[["", base], ["center", "Centre"], ["left", "Left"]]} value={owner.align ?? ""} onChange={(value) => set("align", value)} />
          </Field>
        )}
      </div>
      <div className="cols">
        <ColorField label="Accent colour" value={owner.accentColor} onChange={(value) => set("accentColor", value)} />
        <ColorField label="Text colour" value={owner.textColor} onChange={(value) => set("textColor", value)} />
      </div>
      <div className="cols">
        <Field label="Device colour">
          <Select options={[["", base], ...ids(meta.deviceColors)]} value={device.color ?? ""} onChange={(value) => setDevice("color", value)} />
        </Field>
        <Field label="Frame">
          <Select
            options={[["", base], ["auto", "Match screenshot"], ["iphone", "iPhone"], ["duo", "iPhone Duo"], ["ipad", "iPad"], ["none", "No frame"]]}
            value={device.frame ?? ""}
            onChange={(value) => setDevice("frame", value)}
          />
        </Field>
      </div>
      <div className="cols">
        {look}
        {statusBar}
      </div>
      {/* The time and the colour of a drawn status bar. An asset takes them from the project. */}
      {!asset && (device.statusBar === "cover" || device.statusBar === "overlay") ? (
        <div className="cols">
          <Field label="Time shown">
            <TimeInput value={device.statusBarTime} onChange={(value) => setDevice("statusBarTime", value)} />
          </Field>
          <Field label="Time and icons">
            <Select options={[["", "Auto"], ["light", "White"], ["dark", "Black"]]} value={device.statusBarColor === "auto" ? "" : (device.statusBarColor ?? "")} onChange={(value) => setDevice("statusBarColor", value)} />
          </Field>
        </div>
      ) : null}
      {/* A slide sets these with the sliders of its Device group. */}
      {placed ? null : (
        <div className="cols">
          {size}
          {asset ? (
            headline
          ) : (
            <Field label="Tilt in degrees">
              <NumberInput value={device.rotate} onChange={(value) => setDevice("rotate", value)} min={-45} max={45} step={1} placeholder="0" />
            </Field>
          )}
        </div>
      )}
      {asset ? null : (
        <div className="cols">
          {headline}
          {shadow}
        </div>
      )}
    </>
  );
}

const DEVICE_LOOKS: Record<string, string> = { real: "Realistic", clay: "Clay", outline: "Outline", sketch: "Sketch" };
const STATUS_BARS: Record<string, string> = { none: "As in the screenshot", cover: "Clean, over the old one", overlay: "Clean, drawn on top" };

/** The time of a drawn status bar. What is typed counts once it reads as a time; until then the last good one stays. */
function TimeInput({ value, onChange }: { value: string | undefined; onChange: (value: string | undefined) => void }) {
  const [text, setText] = useState(value ?? "");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ?? "");
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={5}
      placeholder="9:41"
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(value ?? "");
      }}
      onChange={(event) => {
        const typed = event.target.value.trim();
        setText(event.target.value);
        if (typed === "" || /^\d{1,2}[:.]\d{2}$/.test(typed)) onChange(typed || undefined);
      }}
    />
  );
}

/** Names that plain capitalising gets wrong. */
const ICON_NAMES: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  github: "GitHub",
  wechat: "WeChat",
  soundcloud: "SoundCloud",
  paypal: "PayPal",
  openai: "OpenAI",
  teams: "Microsoft Teams",
  "apple-podcasts": "Apple Podcasts",
  "app-store": "App Store",
  "google-play": "Google Play",
  "google-drive": "Google Drive",
};
const iconName = (id: string) => ICON_NAMES[id] ?? label(id);

function Glyph({ id }: { id: string }) {
  // The sprite is cached for a day; the count in its address fetches a new one when icons are added.
  const { meta } = useScope();
  return (
    <svg className="glyph" viewBox="0 0 256 256" aria-hidden="true">
      <use href={`/icons.svg?n=${meta.icons.length}#${id}`} />
    </svg>
  );
}

/** A button showing the chosen icon. It opens a searchable grid of all of them underneath. */
function IconPicker({ label: text, value, onChange }: { label: string; value: string | undefined; onChange: (next: string | undefined) => void }) {
  const { meta } = useScope();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wanted = search.trim().toLowerCase();
  const groups = Object.entries(meta.iconGroups)
    .map(([group, list]) => [group, wanted && !group.toLowerCase().includes(wanted) ? list.filter((id) => id.includes(wanted)) : list] as const)
    .filter(([, list]) => list.length > 0);
  const pick = (id: string | undefined) => {
    onChange(id);
    setOpen(false);
    setSearch("");
  };
  return (
    <div className="icon-picker" onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
      <button className="icon-pick" type="button" aria-label={text} aria-expanded={open} onClick={() => setOpen(!open)}>
        {value ? <Glyph id={value} /> : null}
        <span>{value ? iconName(value) : "No icon"}</span>
      </button>
      {open ? (
        <div className="icon-panel">
          <input type="text" autoFocus spellCheck={false} placeholder="Search icons" aria-label="Search icons" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="icon-grid">
            {wanted ? null : (
              <button className={`icon-cell none${value ? "" : " on"}`} type="button" onClick={() => pick(undefined)}>
                No icon
              </button>
            )}
            {groups.map(([group, list]) => (
              <Fragment key={group}>
                <span className="icon-group">{group}</span>
                {list.map((id) => (
                  <button key={id} className={`icon-cell${id === value ? " on" : ""}`} type="button" title={iconName(id)} aria-label={iconName(id)} onClick={() => pick(id)}>
                    <Glyph id={id} />
                  </button>
                ))}
              </Fragment>
            ))}
            {groups.length === 0 ? <span className="hint">No icon by that name.</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Which sections are open survives switching between slides and assets. */
const openSections: Record<string, boolean> = {};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(openSections[id] ?? false);
  return (
    <details
      open={open}
      onToggle={(event) => {
        openSections[id] = event.currentTarget.open;
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>{title}</summary>
      <div className="stack">{children}</div>
    </details>
  );
}

function JsonSection({ value, onApply, hint }: { value: object; onApply: (parsed: object) => void; hint: string }) {
  const pretty = JSON.stringify(value, null, 2);
  const [text, setText] = useState(pretty);
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  // Follows the form, except while it is being typed in.
  useEffect(() => {
    if (document.activeElement === area.current) return;
    setText(pretty);
    setError("");
  }, [pretty]);
  const apply = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
      setError("");
      onApply(parsed);
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  return (
    <Section id="json" title="JSON">
      <span className="hint">{hint}</span>
      <textarea className="code" rows={14} spellCheck={false} ref={area} value={text} onChange={(event) => setText(event.target.value)} />
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="actions">
        <button className="btn small" type="button" onClick={apply}>
          Apply
        </button>
      </div>
    </Section>
  );
}

interface Badged {
  badges?: Badge[];
  badgePosition?: "top" | "bottom";
}

/** What the two lines of a badge hold, by badge style. */
const BADGE_PLACEHOLDERS: Record<string, [big: string, small: string]> = {
  laurel: ["Big line, e.g. 4.9", "Small line, e.g. App Store rating"],
  rating: ["The score, e.g. 4.9", "Small line, e.g. 12K ratings"],
  review: ["What they wrote, in a few words", "Who wrote it, e.g. Maya, App Store review"],
};

function BadgesEditor({ owner, change, max, hint, byDefault }: { owner: Badged; change: Change<Badged>; max: number; hint: string; byDefault: string }) {
  const { meta } = useScope();
  const badges = owner.badges ?? [];
  return (
    <>
      <div className="group-head">
        <span className="label">Badges</span>
        <span className="hint">{hint}</span>
      </div>
      {badges.map((badge, index) => {
        const edit: Change<Badge> = (recipe) => change((item) => recipe(item.badges![index]!));
        const type = badge.type ?? "laurel";
        const [big, small] = BADGE_PLACEHOLDERS[type] ?? BADGE_PLACEHOLDERS.laurel!;
        return (
          <div className="badge-edit" key={index}>
            <div className="top">
              <Select label="Badge style" options={ids(Object.keys(meta.badgeTypes))} value={type} onChange={(value) => edit((item) => put(item, "type", value))} />
              <Select
                label="Badge colour"
                options={Object.keys(meta.badgeTones).map((id): Option => [id, id === "plain" ? "Slide colours" : label(id)])}
                value={badge.tone ?? "plain"}
                onChange={(value) => edit((item) => put(item, "tone", value === "plain" ? undefined : value))}
              />
              <button
                className="icon-btn"
                type="button"
                title="Remove badge"
                aria-label="Remove badge"
                onClick={() =>
                  change((item) => {
                    item.badges!.splice(index, 1);
                    if (item.badges!.length === 0) delete item.badges;
                  })
                }
              >
                ×
              </button>
            </div>
            <div className="pair">
              <IconPicker label="Badge icon" value={badge.icon} onChange={(value) => edit((item) => put(item, "icon", value))} />
              <NumberInput label="Stars" value={badge.stars} onChange={(value) => edit((item) => put(item, "stars", value))} min={0} max={5} step={0.1} placeholder="★" />
            </div>
            <TextInput value={badge.title} onChange={(value) => edit((item) => put(item, "title", value))} placeholder={big} />
            <TextInput value={badge.subtitle} onChange={(value) => edit((item) => put(item, "subtitle", value))} placeholder={small} />
          </div>
        );
      })}
      <div className="row">
        {badges.length < max ? (
          <button className="btn small" type="button" onClick={() => change((item) => void (item.badges = [...(item.badges ?? []), { type: "laurel" }]))}>
            Add badge
          </button>
        ) : null}
        {badges.length > 0 ? (
          <Select
            label="Badge position"
            options={[["", `Position: ${byDefault}`], ["top", "Above the headline"], ["bottom", "Below the copy"]]}
            value={owner.badgePosition ?? ""}
            onChange={(value) => change((item) => put(item, "badgePosition", value))}
          />
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- slide

function FeaturesEditor({ slide, change, points }: { slide: Slide; change: Change<Slide>; points: boolean }) {
  const { meta } = useScope();
  const features = slide.features ?? [];
  // One field holds either kind of style; each kind reads the other's own ones as its plainest.
  const styles = points ? meta.pointStyles : meta.featureStyles;
  const style = slide.featureStyle && styles[slide.featureStyle] ? slide.featureStyle : points ? "list" : slide.featureStyle === "chips" ? "list" : "bento";
  const swap = (from: number, to: number) =>
    change((item) => {
      const list = item.features!;
      [list[from], list[to]] = [list[to]!, list[from]!];
    });
  return (
    <>
      <div className="group-head">
        <span className="label">{points ? "Feature points" : "Features"}</span>
        <span className="hint">{points ? "A short list with the copy, each with an icon. Two to four read best." : "Most important first. Each gets an icon, or a figure such as 24h in its place."}</span>
      </div>
      {points && features.length === 0 ? null : (
        <Field label={points ? "Point style" : "Card style"} hint={styles[style]}>
          <Select options={ids(Object.keys(styles))} value={style} onChange={(value) => change((item) => put(item, "featureStyle", value))} />
        </Field>
      )}
      {features.map((feature, index) => {
        const edit: Change<Feature> = (recipe) => change((item) => recipe(item.features![index]!));
        return (
          <div className="badge-edit" key={index}>
            <div className="top feature">
              <IconPicker label="Feature icon" value={feature.icon} onChange={(value) => edit((item) => put(item, "icon", value))} />
              <TextInput value={feature.value} onChange={(value) => edit((item) => put(item, "value", value))} placeholder="or 24h" />
              <button className="icon-btn plain" type="button" disabled={index === 0} title="Move up" aria-label="Move feature up" onClick={() => swap(index, index - 1)}>
                ↑
              </button>
              <button className="icon-btn plain" type="button" disabled={index === features.length - 1} title="Move down" aria-label="Move feature down" onClick={() => swap(index, index + 1)}>
                ↓
              </button>
              <button
                className="icon-btn"
                type="button"
                title="Remove feature"
                aria-label="Remove feature"
                onClick={() =>
                  change((item) => {
                    item.features!.splice(index, 1);
                    if (item.features!.length === 0) delete item.features;
                  })
                }
              >
                ×
              </button>
            </div>
            <TextInput value={feature.title} onChange={(value) => edit((item) => void (item.title = value ?? ""))} placeholder="The feature, e.g. Daily limits" />
            <TextInput value={feature.text} onChange={(value) => edit((item) => put(item, "text", value))} placeholder="One short line under it, or nothing" />
          </div>
        );
      })}
      {features.length < 8 ? (
        <div className="row">
          <button className="btn small" type="button" onClick={() => change((item) => void (item.features = [...(item.features ?? []), { icon: "sparkle", title: "" }]))}>
            {points ? "Add feature point" : "Add feature"}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** What a layout does to its device before the slide's own settings. */
const LAYOUT_DEVICE: Record<string, { rotate?: number; offsetX?: number }> = { tilted: { rotate: -8, offsetX: 5 } };

/** One device setting as a slider. `base` is where it stands when the slide does not set it; a double click goes back there. */
function Slider(props: { label: string; value: number | undefined; base: number; min: number; max: number; step: number; show: (value: number) => string; onChange: (value: number | null) => void }) {
  const { value, base, onChange } = props;
  return (
    <label className={`slider${value == null ? "" : " set"}`} title="Double-click to reset">
      <span className="label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={value ?? base}
        onChange={(event) => onChange(Number(event.target.value) === base ? null : Number(event.target.value))}
        onDoubleClick={() => onChange(null)}
      />
      <output>{props.show(value ?? base)}</output>
    </label>
  );
}

/** Where a slide's device stands and how large it is, on top of what the layout and the project say. */
function DeviceEditor({ slide, theme, change, single }: { slide: Slide; theme: Theme; change: Change<Slide>; single: boolean }) {
  const { meta } = useScope();
  const device = slide.device ?? {};
  const layout = slide.layout ?? "device-bottom";
  const base = { scale: 1, offsetX: 0, offsetY: 0, rotate: 0, gap: 0, spread: meta.layoutSpread[layout] ?? 0, ...LAYOUT_DEVICE[layout], ...theme.device };
  const keys = ["scale", "offsetX", "offsetY", "rotate", "perspective", "spread", "gap"] as const;
  const setDevice = (recipe: (device: DeviceStyle) => void) =>
    change((item) => {
      const next = { ...item.device };
      recipe(next);
      if (Object.keys(next).length) item.device = next;
      else delete item.device;
    });
  const set = (key: keyof DeviceStyle) => (value: unknown) => setDevice((next) => put(next, key, value));
  const signed = (value: number) => `${value > 0 ? "+" : ""}${value}%`;
  return (
    <>
      <div className="group-head">
        <span className="label">Device</span>
        <span className="hint">{single ? "Its size and place on this slide." : "Their size and place on this slide, and how they stand to each other."}</span>
        <span className="spacer" />
        {keys.some((key) => device[key] != null) ? (
          <button className="btn small quiet" type="button" onClick={() => setDevice((next) => keys.forEach((key) => delete next[key]))}>
            Reset
          </button>
        ) : null}
      </div>
      <div className="sliders">
        <Slider label="Size" value={device.scale} base={base.scale} min={0.4} max={1.6} step={0.02} show={(value) => `${Math.round(value * 100)}%`} onChange={set("scale")} />
        <Slider label="Left · right" value={device.offsetX} base={base.offsetX} min={-60} max={60} step={1} show={signed} onChange={set("offsetX")} />
        <Slider label="Up · down" value={device.offsetY} base={base.offsetY} min={-60} max={60} step={1} show={signed} onChange={set("offsetY")} />
        <Slider label={single ? "Tilt" : "Tilt, all"} value={device.rotate} base={base.rotate} min={-45} max={45} step={1} show={(value) => `${value}°`} onChange={set("rotate")} />
        {single ? null : (
          <>
            <Slider label="Angle between" value={device.spread} base={base.spread} min={0} max={60} step={1} show={(value) => `${value}°`} onChange={set("spread")} />
            <Slider label="Distance" value={device.gap} base={base.gap} min={-30} max={30} step={1} show={signed} onChange={set("gap")} />
          </>
        )}
      </div>
      {single ? (
        <Field label="Turn in 3D">
          <Select options={[["", "By layout"], ["none", "None"], ["left", "To the left"], ["right", "To the right"]]} value={device.perspective ?? ""} onChange={set("perspective")} />
        </Field>
      ) : null}
    </>
  );
}

const ROW_TONES: Record<string, string> = { brand: "Brand colours", accent: "Accent colour", text: "Text colour" };

/** The row of icons and brand logos a slide shows with its copy. */
function IconRowEditor({ slide, change }: { slide: Slide; change: Change<Slide> }) {
  const { meta } = useScope();
  const row = slide.iconRow;
  const icons: string[] = row?.icons ?? [];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wanted = search.trim().toLowerCase();
  // Logos are what the row is mostly used for, so they come first here.
  const groups = Object.entries(meta.iconGroups)
    .sort(([a], [b]) => Number(b === "Brands") - Number(a === "Brands"))
    .map(([group, list]) => [group, wanted && !group.toLowerCase().includes(wanted) ? list.filter((id) => id.includes(wanted)) : list] as const)
    .filter(([, list]) => list.length > 0);
  const full = icons.length >= 8;
  const setIcons = (next: string[]) =>
    change((item) => {
      if (next.length === 0) delete item.iconRow;
      else item.iconRow = { ...item.iconRow, icons: next as IconRow["icons"] };
    });
  const edit: Change<IconRow> = (recipe) => change((item) => recipe(item.iconRow!));
  const style = row?.style ?? "tiles";
  return (
    <>
      <div className="group-head">
        <span className="label">Icons and logos</span>
        <span className="hint">A row with the copy, such as the services the app works with.</span>
      </div>
      <div className="row-icons">
        {icons.map((id, index) => (
          <button key={`${id}-${index}`} className="row-icon" type="button" title={`Remove ${iconName(id)}`} aria-label={`Remove ${iconName(id)}`} onClick={() => setIcons(icons.filter((_, at) => at !== index))}>
            <Glyph id={id} />
          </button>
        ))}
        <button className="btn small" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Done" : icons.length ? "Add or remove" : "Add icons or logos"}
        </button>
      </div>
      {open ? (
        <div className="icon-panel inline" onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
          <input type="text" autoFocus spellCheck={false} placeholder="Search icons and logos" aria-label="Search icons and logos" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="icon-grid">
            {groups.map(([group, list]) => (
              <Fragment key={group}>
                <span className="icon-group">{group === "Brands" ? "Logos" : group}</span>
                {list.map((id) => {
                  const on = icons.includes(id);
                  return (
                    <button
                      key={id}
                      className={`icon-cell${on ? " on" : ""}`}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={full && !on}
                      title={iconName(id)}
                      aria-label={iconName(id)}
                      onClick={() => setIcons(on ? icons.filter((other) => other !== id) : [...icons, id])}
                    >
                      <Glyph id={id} />
                    </button>
                  );
                })}
              </Fragment>
            ))}
            {groups.length === 0 ? <span className="hint">Nothing by that name.</span> : null}
          </div>
          <span className="hint">
            {full ? "Eight is the most a row holds. " : ""}Show a logo only where the app really works with that service; it must not look like an endorsement.
          </span>
        </div>
      ) : null}
      {row ? (
        <div className="badge-edit">
          <TextInput value={row.label} onChange={(value) => edit((item) => put(item, "label", value))} placeholder="Line over the row, e.g. Works with" />
          <div className="quad">
            <Select label="Row style" options={ids(Object.keys(meta.iconRowStyles))} value={style} onChange={(value) => edit((item) => put(item, "style", value === "tiles" ? undefined : value))} />
            <Select
              label="Row colours"
              options={Object.keys(meta.iconRowTones).map((id): Option => [id, ROW_TONES[id] ?? label(id)])}
              value={row.tone ?? "brand"}
              onChange={(value) => edit((item) => put(item, "tone", value === "brand" ? undefined : value))}
            />
            <Select label="Row size" options={ids(meta.iconRowSizes)} value={row.size ?? "medium"} onChange={(value) => edit((item) => put(item, "size", value === "medium" ? undefined : value))} />
            <Select
              label="Row position"
              options={[["bottom", "Below the copy"], ["top", "Above the headline"]]}
              value={row.position ?? "bottom"}
              onChange={(value) => edit((item) => put(item, "position", value === "bottom" ? undefined : value))}
            />
          </div>
          <span className="hint">
            {meta.iconRowStyles[style]} {meta.iconRowTones[row.tone ?? "brand"]}
          </span>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- logo and placed images

function Art({ image }: { image: StoredImage }) {
  const { projectId } = useScope();
  return <img src={`/files/${projectId}/images/${image.file}?v=${image.version}`} alt="" loading="lazy" draggable={false} />;
}

const NO_IMAGES = 'Upload your logo, app icon or other artwork under "Logos and images" first, next to the screenshots.';

/** The uploaded image a slide or an asset shows over its headline. */
function LogoEditor({ owner, change, hint }: { owner: { logo?: Logo }; change: Change<{ logo?: Logo }>; hint: string }) {
  const { meta, images } = useScope();
  const logo = owner.logo;
  const shape = logo?.shape ?? "plain";
  const edit = (key: keyof Logo, value: unknown) => change((item) => put(item.logo!, key, value));
  return (
    <>
      <div className="group-head">
        <span className="label">Your logo</span>
        <span className="hint">{hint}</span>
      </div>
      {images.length === 0 && !logo ? (
        <span className="hint">{NO_IMAGES}</span>
      ) : (
        <div className="art-grid">
          <button className={`art-cell none${logo ? "" : " on"}`} type="button" aria-pressed={!logo} onClick={() => change((item) => void delete item.logo)}>
            None
          </button>
          {images.map((image) => (
            <button
              key={image.file}
              className={`art-cell${logo?.image === image.name ? " on" : ""}`}
              type="button"
              aria-pressed={logo?.image === image.name}
              title={image.name}
              aria-label={image.name}
              onClick={() => change((item) => void (item.logo = { ...item.logo, image: image.name }))}
            >
              <Art image={image} />
            </button>
          ))}
        </div>
      )}
      {logo && !images.some((image) => image.name === logo.image) ? <div className="inline-error">No image named "{logo.image}" is uploaded, so nothing is shown.</div> : null}
      {logo ? (
        <div className="cols">
          <Field label="Size">
            <Select options={ids(meta.logoSizes)} value={logo.size ?? "medium"} onChange={(value) => edit("size", value === "medium" ? undefined : value)} />
          </Field>
          <Field label="Shape" hint={meta.logoShapes[shape]}>
            <Select options={ids(Object.keys(meta.logoShapes))} value={shape} onChange={(value) => edit("shape", value === "plain" ? undefined : value)} />
          </Field>
        </div>
      ) : null}
    </>
  );
}

/** Ready-made arrangements: where the first, second, third… image goes, as x, y and rotation. */
export const PLACED_SPOTS: Record<string, [x: number, y: number, rotate: number][]> = {
  corners: [[12, 7, -12], [88, 7, 12], [88, 93, -8], [12, 93, 8], [50, 4, 0], [50, 96, 0], [5, 50, -10], [95, 50, 10]],
  sides: [[9, 48, -12], [91, 44, 12], [10, 72, 8], [90, 76, -8], [14, 92, -6], [86, 94, 6], [8, 30, 10], [92, 28, -10], [50, 97, 0], [50, 34, 0]],
  scattered: [[84, 17, 14], [14, 11, -14], [7, 57, 10], [93, 63, -12], [24, 91, -6], [77, 95, 8], [52, 5, 4], [6, 33, -18], [94, 38, 14], [50, 97, -3]],
};
const ARRANGEMENTS: Option[] = [["", "Arrange…"], ["corners", "In the corners"], ["sides", "Around the device"], ["scattered", "Scattered"], ["bottom", "Along the bottom"]];

/** Stickers, characters and shapes placed freely on a slide. */
function ImagesEditor({ slide, change }: { slide: Slide; change: Change<Slide> }) {
  const { images, dragging } = useScope();
  const placed = slide.images ?? [];
  const full = placed.length >= 10;
  const names: Option[] = images.map((image) => [image.name, image.name]);
  const swap = (from: number, to: number) =>
    change((item) => {
      const list = item.images!;
      [list[from], list[to]] = [list[to]!, list[from]!];
    });
  const arrange = (how: string) =>
    change((item) => {
      const list = item.images ?? [];
      list.forEach((entry, index) => {
        const [x, y, rotate] = how === "bottom" ? [Math.round(((index + 0.5) / list.length) * 100), 93, index % 2 ? 6 : -6] : PLACED_SPOTS[how]![index % PLACED_SPOTS[how]!.length]!;
        Object.assign(entry, { x, y });
        put(entry, "rotate", rotate || undefined);
      });
    });
  const percent = (value: number) => `${value}%`;
  return (
    <>
      <div className="group-head">
        <span className="label">Images</span>
        <span className="hint">Stickers, characters and shapes, placed freely.</span>
        <span className="spacer" />
        {placed.length ? (
          <button className="btn small quiet" type="button" onClick={() => change((item) => void delete item.images)}>
            Remove all
          </button>
        ) : null}
      </div>
      {images.length === 0 && placed.length === 0 ? <span className="hint">{NO_IMAGES}</span> : null}
      {placed.map((entry, index) => {
        const image = images.find((candidate) => candidate.name === entry.image);
        const edit = (key: keyof PlacedImage) => (value: unknown) => change((item) => put(item.images![index]!, key, value));
        return (
          <div className="badge-edit" key={index}>
            <div className="top placed">
              <span className="art-cell still">{image ? <Art image={image} /> : "?"}</span>
              <Select label="Image" options={image ? names : [[entry.image, `${entry.image} (not uploaded)`], ...names]} value={entry.image} onChange={(value) => change((item) => void (item.images![index]!.image = value))} />
              <button className="icon-btn plain" type="button" disabled={index === 0} title="Send backward" aria-label="Send image backward" onClick={() => swap(index, index - 1)}>
                ↑
              </button>
              <button className="icon-btn plain" type="button" disabled={index === placed.length - 1} title="Bring forward" aria-label="Bring image forward" onClick={() => swap(index, index + 1)}>
                ↓
              </button>
              <button
                className="icon-btn"
                type="button"
                title="Remove image"
                aria-label="Remove image"
                onClick={() =>
                  change((item) => {
                    item.images!.splice(index, 1);
                    if (item.images!.length === 0) delete item.images;
                  })
                }
              >
                ×
              </button>
            </div>
            <div className="sliders">
              <Slider label="Left · right" value={entry.x} base={50} min={-30} max={130} step={1} show={percent} onChange={edit("x")} />
              <Slider label="Up · down" value={entry.y} base={50} min={-30} max={130} step={1} show={percent} onChange={edit("y")} />
              <Slider label="Size" value={entry.size} base={30} min={2} max={200} step={1} show={percent} onChange={edit("size")} />
              <Slider label="Turn" value={entry.rotate} base={0} min={-180} max={180} step={1} show={(value) => `${value}°`} onChange={edit("rotate")} />
              <Slider label="Opacity" value={entry.opacity} base={1} min={0.05} max={1} step={0.05} show={(value) => `${Math.round(value * 100)}%`} onChange={edit("opacity")} />
            </div>
            <div className="trio">
              <Select label="Layer" options={[["front", "In front"], ["behind", "Behind everything"]]} value={entry.layer ?? "front"} onChange={(value) => edit("layer")(value === "front" ? undefined : value)} />
              <Select label="Shadow" options={[["none", "No shadow"], ["soft", "Soft shadow"], ["strong", "Strong shadow"]]} value={entry.shadow ?? "none"} onChange={(value) => edit("shadow")(value === "none" ? undefined : value)} />
              <label className="check">
                <input type="checkbox" checked={entry.flip ?? false} onChange={(event) => edit("flip")(event.target.checked || undefined)} />
                Mirror
              </label>
            </div>
          </div>
        );
      })}
      {images.length ? (
        <>
          <div className="art-grid">
            {images.map((image) => (
              <button
                key={image.file}
                className="art-cell add"
                type="button"
                disabled={full}
                title={`Add ${image.name}`}
                aria-label={`Add ${image.name}`}
                onClick={() =>
                  change((item) => {
                    const [x, y, rotate] = PLACED_SPOTS.scattered![placed.length % PLACED_SPOTS.scattered!.length]!;
                    item.images = [...(item.images ?? []), { image: image.name, x, y, size: 24, rotate }];
                  })
                }
              >
                <Art image={image} />
              </button>
            ))}
          </div>
          <div className="row">
            <span className="hint">
              {full ? "Ten is the most a slide holds." : "Click one to add it."}
              {placed.length && dragging ? " Drag it in the large preview to move it." : ""}
            </span>
            <span className="spacer" />
            {placed.length > 1 ? <Select label="Arrange the images" options={ARRANGEMENTS} value="" onChange={(value) => value && arrange(value)} /> : null}
          </div>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- layout and screenshot pickers

const line = (y: number, width = 16) => <rect className="t" x={(30 - width) / 2} y={y} width={width} height={2.2} rx={1.1} />;
const copy = (y = 5) => (
  <>
    {line(y)}
    {line(y + 4, 10)}
  </>
);
const phone = (x: number, y: number, width: number, height: number, rotate = 0, back = false) => (
  <rect className={back ? "d back" : "d"} x={x} y={y} width={width} height={height} rx={width * 0.2} transform={rotate ? `rotate(${rotate} ${x + width / 2} ${y + height / 2})` : undefined} />
);
const tile = (x: number, y: number, width: number, height: number) => <rect className="d" x={x} y={y} width={width} height={height} rx={2} />;

/** A sketch of each slide layout, drawn on a 30×44 canvas: bars for the copy, rounded shapes for devices and cards. */
const LAYOUT_ART: Record<string, ReactNode> = {
  "device-bottom": (
    <>
      {copy()}
      {phone(7, 15, 16, 34)}
    </>
  ),
  "device-top": (
    <>
      {phone(7, -5, 16, 34)}
      {copy(34)}
    </>
  ),
  "device-center": (
    <>
      {copy()}
      {phone(9, 15, 12, 25)}
    </>
  ),
  tilted: (
    <>
      {copy()}
      {phone(8, 17, 16, 34, -9)}
    </>
  ),
  closeup: (
    <>
      {copy()}
      {phone(2, 15, 26, 52)}
    </>
  ),
  floating: (
    <>
      {copy()}
      <g transform="translate(15 28) skewY(-9) rotate(4) translate(-15 -28)">{phone(9, 16, 12, 25)}</g>
    </>
  ),
  duo: (
    <>
      {copy()}
      {phone(4, 20, 13, 28, -6, true)}
      {phone(13, 16, 13, 28, 5)}
    </>
  ),
  "side-by-side": (
    <>
      {copy()}
      {phone(3, 16, 11, 23)}
      {phone(16, 20, 11, 23)}
    </>
  ),
  trio: (
    <>
      {copy()}
      {phone(2, 21, 11, 23, -7, true)}
      {phone(17, 21, 11, 23, 7, true)}
      {phone(9, 17, 12, 25)}
    </>
  ),
  "device-right": (
    <>
      <rect className="t" x={3} y={13} width={11} height={2.2} rx={1.1} />
      <rect className="t" x={3} y={17} width={8} height={2.2} rx={1.1} />
      {[23, 27, 31].map((y) => (
        <rect key={y} className="t" x={3} y={y} width={10} height={1.6} rx={0.8} />
      ))}
      {phone(17, 9, 15, 27)}
    </>
  ),
  "device-left": (
    <>
      {phone(-2, 9, 15, 27)}
      <rect className="t" x={16} y={13} width={11} height={2.2} rx={1.1} />
      <rect className="t" x={16} y={17} width={8} height={2.2} rx={1.1} />
      {[23, 27, 31].map((y) => (
        <rect key={y} className="t" x={16} y={y} width={10} height={1.6} rx={0.8} />
      ))}
    </>
  ),
  hero: (
    <>
      {tile(6, 4, 8, 4)}
      {tile(16, 4, 8, 4)}
      {copy(12)}
      {phone(7, 26, 16, 30)}
    </>
  ),
  features: (
    <>
      {copy()}
      {tile(4, 15, 22, 10)}
      {tile(4, 27, 10, 10)}
      {tile(16, 27, 10, 10)}
    </>
  ),
};

function LayoutPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { meta } = useScope();
  return (
    <div className="field">
      <span className="label">Layout</span>
      <div className="layout-grid" role="radiogroup" aria-label="Layout">
        {Object.keys(meta.layouts).map((id) => (
          <button key={id} className={`layout-cell${id === value ? " on" : ""}`} type="button" role="radio" aria-checked={id === value} aria-label={label(id)} title={label(id)} onClick={() => onChange(id)}>
            <svg viewBox="0 0 30 44" aria-hidden="true">
              {LAYOUT_ART[id] ?? LAYOUT_ART["device-bottom"]}
            </svg>
          </button>
        ))}
      </div>
      <span className="hint">
        <b>{label(value)}.</b> {meta.layouts[value]}
      </span>
    </div>
  );
}

/**
 * The project's screenshots as thumbnails. A click puts one in the next free place or takes it out again;
 * with a single place it swaps the one that is there. The numbers are the order the layout fills its devices in.
 */
function ShotGrid({ chosen, capacity, max, hint, onChange }: { chosen: string[]; capacity: number; max: number; hint: string; onChange: (next: string[]) => void }) {
  const { shots, projectId, meta, target, locale } = useScope();
  const device = meta.targets[target].device;
  const names = [...new Set([...shots.map((shot) => shot.name), ...chosen])];
  const fileOf = (name: string) => shotFor(shots, name, device, locale);
  const toggle = (name: string) => {
    if (chosen.includes(name)) return onChange(chosen.filter((other) => other !== name));
    onChange(chosen.length < max ? [...chosen, name] : [...chosen.slice(0, max - 1), name]);
  };
  return (
    <div className="field">
      <span className="label">{max === 1 ? "Screenshot" : "Screenshots"}</span>
      {names.length ? (
        <div className="shot-grid">
          {names.map((name) => {
            const shot = fileOf(name);
            const at = chosen.indexOf(name);
            return (
              <button
                key={name}
                className={`shot-cell${at >= 0 ? " on" : ""}${at >= capacity ? " over" : ""}`}
                type="button"
                aria-pressed={at >= 0}
                aria-label={at >= 0 ? `${name}, in place ${at + 1}` : name}
                title={shot ? name : `${name} (not uploaded)`}
                onClick={() => toggle(name)}
              >
                {shot ? <img src={`/files/${projectId}/shots/${shot.file}?v=${shot.version}`} alt="" loading="lazy" /> : <span className="shot-missing">?</span>}
                {at >= 0 && max > 1 ? <span className="shot-order">{at + 1}</span> : null}
                <span className="shot-name">{name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <span className="hint">{names.length ? hint : "Upload screenshots first, or drop them anywhere in the window."}</span>
    </div>
  );
}

const SHOT_HINTS: Record<string, string> = {
  duo: "Pick two: 1 is in front, 2 behind it. Click one again to take it out.",
  "side-by-side": "Pick two: 1 is on the left, 2 on the right. Click one again to take it out.",
  trio: "Pick three: 1 is in front, 2 and 3 behind it left and right. Click one again to take it out.",
  hero: "Optional. Without one, the slide is the copy and its badges alone.",
};

export interface SlideActions {
  move: (delta: number) => void;
  duplicate: () => void;
  remove: () => void;
}

export function SlideEditor({ project, index, change, actions }: { project: Project; index: number; change: Change<Slide>; actions: SlideActions }) {
  const { meta, target, locale } = useScope();
  const slide = project.slides[index]!;
  const layout = slide.layout ?? "device-bottom";
  const places = meta.layoutShots[layout] ?? 1;
  const chosen = [slide.screenshot, slide.screenshot2, slide.screenshot3].slice(0, places).filter((name): name is string => Boolean(name));
  const query = new URLSearchParams({ target, locale });

  return (
    <div className="form">
      <div className="actions">
        <button className="btn small" type="button" disabled={index === 0} title="Move earlier" aria-label="Move earlier" onClick={() => actions.move(-1)}>
          ←
        </button>
        <button className="btn small" type="button" disabled={index === project.slides.length - 1} title="Move later" aria-label="Move later" onClick={() => actions.move(1)}>
          →
        </button>
        <button className="btn small" type="button" disabled={project.slides.length >= 10} onClick={actions.duplicate}>
          Duplicate
        </button>
        <button className="btn small danger" type="button" onClick={actions.remove}>
          Delete
        </button>
        <span className="spacer" />
        <a className="btn small quiet" href={`/render/${project.id}/${index}?${query}`} target="_blank" rel="noopener">
          Full size ↗
        </a>
      </div>
      <LayoutPicker value={layout} onChange={(value) => change((item) => put(item, "layout", value))} />
      {places === 0 ? null : (
        <ShotGrid
          chosen={chosen}
          capacity={places}
          max={places}
          hint={SHOT_HINTS[layout] ?? "Click a screenshot to show it on this slide."}
          onChange={(next) =>
            change((item) => {
              put(item, "screenshot", next[0]);
              if (places > 1) put(item, "screenshot2", next[1]);
              if (places > 2) put(item, "screenshot3", next[2]);
            })
          }
        />
      )}
      <Field label="Eyebrow">
        <TextInput value={slide.eyebrow} onChange={(value) => change((item) => put(item, "eyebrow", value))} placeholder="Small line above the headline" />
      </Field>
      <Field label="Headline" hint="Wrap words in *asterisks* to tint them. Enter starts a new line.">
        <TextInput value={slide.headline} onChange={(value) => change((item) => put(item, "headline", value))} rows={2} />
      </Field>
      <Field label="Subheadline">
        <TextInput value={slide.subheadline} onChange={(value) => change((item) => put(item, "subheadline", value))} rows={2} />
      </Field>
      {chosen.length ? <DeviceEditor slide={slide} theme={project.theme} change={change} single={places === 1} /> : null}
      <FeaturesEditor slide={slide} change={change} points={layout !== "features"} />
      <BadgesEditor owner={slide} change={change} max={4} hint="Real figures and reviews only; App Review rejects invented ones." byDefault="by layout" />
      <IconRowEditor slide={slide} change={change} />
      <LogoEditor owner={slide} change={change} hint="Over the headline. The first slide is the place for it." />
      <ImagesEditor slide={slide} change={change} />
      <Section id="style" title="Style for this slide">
        <StyleFields owner={slide} change={change} inherits placed />
      </Section>
      <JsonSection
        value={slide}
        hint="Everything an agent can set on this slide, including custom gradients and device offsets."
        onApply={(parsed) =>
          change((item) => {
            for (const key of Object.keys(item)) delete (item as Record<string, unknown>)[key];
            Object.assign(item, parsed);
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- header and search results assets

export function CreativeEditor({ project, placement, change, remove }: { project: Project; placement: PlacementId; change: Change<Creative>; remove: () => void }) {
  const { meta, locale, guides } = useScope();
  const creative = project.creatives[placement]!;
  const spec = meta.placements[placement];
  const layout: CreativeLayoutId = creative.layout ?? "fan";
  const capacity = meta.creativeLayouts[layout].screenshots;
  const picked = creative.screenshots ?? [];
  const query = new URLSearchParams(guides ? { locale, guides: "1" } : { locale });

  return (
    <div className="form">
      <div className="actions">
        <button className="btn small danger" type="button" onClick={remove}>
          Remove
        </button>
        <span className="spacer" />
        <a className="btn small quiet" href={`/render/${project.id}/creative/${placement}?${query}`} target="_blank" rel="noopener">
          Full size ↗
        </a>
      </div>
      <span className="hint">
        {spec.width}×{spec.height} ({spec.ratio}). {spec.note} The store crops it differently on each device, so the copy is kept inside the safe area, the part every device shows.
      </span>
      <Field label="Layout" hint={meta.creativeLayouts[layout].note}>
        <Select options={ids(Object.keys(meta.creativeLayouts))} value={layout} onChange={(value) => change((item) => put(item, "layout", value))} />
      </Field>
      <ShotGrid
        chosen={picked}
        capacity={capacity}
        max={6}
        hint={
          picked.length > capacity
            ? `The ${layout} layout shows ${capacity}; the dimmed ones are left out.`
            : `The ${layout} layout shows up to ${capacity}, in the order of the numbers; 1 gets the most prominent spot. Without any, the asset is copy on the background.`
        }
        onChange={(next) => change((item) => put(item, "screenshots", next.length ? next : undefined))}
      />
      <Field label="Eyebrow">
        <TextInput value={creative.eyebrow} onChange={(value) => change((item) => put(item, "eyebrow", value))} placeholder="Small line above the headline" />
      </Field>
      <Field label="Headline" hint="A short phrase, or nothing at all. No prices, web addresses or claims you cannot back up. *Asterisks* tint words.">
        <TextInput value={creative.headline} onChange={(value) => change((item) => put(item, "headline", value))} rows={2} />
      </Field>
      <Field label="Subheadline">
        <TextInput value={creative.subheadline} onChange={(value) => change((item) => put(item, "subheadline", value))} rows={2} />
      </Field>
      <BadgesEditor owner={creative} change={change} max={3} hint="Real figures only, and no Apple accolades such as App of the Day." byDefault="below the copy" />
      <LogoEditor owner={creative} change={change} hint="Over the headline. Your app's own only: Apple allows no other company's here." />
      <Section id="style" title="Style for this asset">
        <StyleFields owner={creative} change={change} inherits asset />
      </Section>
      <JsonSection
        value={creative}
        hint="Everything an agent can set on this asset, including custom gradients."
        onApply={(parsed) =>
          change((item) => {
            for (const key of Object.keys(item)) delete (item as Record<string, unknown>)[key];
            Object.assign(item, parsed);
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- project

export function ProjectEditor({ project, change, rename, remove }: { project: Project; change: Change<Project>; rename: (name: string) => void; remove: () => void }) {
  const { meta, shots } = useScope();
  const sizes = exportSizes(meta, project, shots);
  // Nothing picked is the standard sizes again, which follow the screenshots.
  const pickSizes = (next: TargetId[]) =>
    change((item) => {
      if (next.length) item.targets = (Object.keys(meta.targets) as TargetId[]).filter((key) => next.includes(key));
      else delete item.targets;
    });
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="form">
      <Field label="Name">
        <input
          type="text"
          maxLength={80}
          spellCheck={false}
          value={name ?? project.name}
          onChange={(event) => {
            setName(event.target.value);
            if (event.target.value.trim()) rename(event.target.value.trim());
          }}
          onBlur={() => setName(null)}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
      </Field>
      <div className="group-head">
        <span className="label">Languages</span>
        <span className="hint">The set is exported once for each.</span>
      </div>
      <LanguageList locales={project.locales} onChange={(next) => change((item) => void (item.locales = next))} />
      <span className="hint">
        A language shows the first one's texts and screenshots until it has its own. Switch language beside the slides, then type its texts and upload its screenshots. A language you remove keeps what it had and
        has it again when you add it back.
      </span>
      <div className="group-head">
        <span className="label">Export sizes</span>
        <span className="hint">
{project.targets?.length ? "Your own choice." : "The standard sizes for your screenshots."} One folder each in the ZIP.
        </span>
      </div>
      <div className="sizes">
        {meta.devices.map((device) => (
          <fieldset key={device.id}>
            <legend>{device.label}</legend>
            {(Object.keys(meta.targets) as TargetId[])
              .filter((key) => meta.targets[key].device === device.id)
              .map((key) => (
                <label key={key} title={`For "${meta.targets[key].slot}" in App Store Connect`}>
                  <input type="checkbox" checked={sizes.includes(key)} onChange={(event) => pickSizes(event.target.checked ? [...sizes, key] : sizes.filter((other) => other !== key))} />
                  <span>{meta.targets[key].label}</span>
                  <span className="dim">
                    {meta.targets[key].width}×{meta.targets[key].height}
                  </span>
                </label>
              ))}
          </fieldset>
        ))}
      </div>
      {project.targets?.length ? (
        <div>
          <button className="btn small quiet" type="button" onClick={() => pickSizes([])}>
            Back to the standard sizes
          </button>
        </div>
      ) : null}
      <div className="group-head">
        <span className="label">Theme</span>
        <span className="hint">Used by every slide and asset that does not override it.</span>
      </div>
      <StyleFields owner={project.theme} change={(recipe) => change((item) => recipe(item.theme))} inherits={false} />
      <div className="group-head">
        <span className="label">Delete</span>
        <span className="hint">Removes the project with its screenshots, images and renders.</span>
      </div>
      <div>
        <button className="btn small danger" type="button" onClick={remove}>
          Delete this project…
        </button>
      </div>
    </div>
  );
}
