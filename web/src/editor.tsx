// The panel on the right: one editor each for a slide, a header or search results asset, and the project.

import { type ChangeEvent, createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import {
  type Background,
  type Badge,
  type Creative,
  type CreativeLayoutId,
  type DeviceStyle,
  errorText,
  label,
  type Meta,
  parseLocales,
  type PlacementId,
  type Project,
  put,
  readText,
  type Shot,
  type Slide,
  type TargetId,
  type Text,
  type Theme,
  withText,
} from "./api.ts";
import { Field, NumberInput, type Option, Select, toast } from "./ui.tsx";

/** Applies a mutation to one part of a fresh copy of the project, which then becomes the draft. */
export type Change<T> = (recipe: (value: T) => void) => void;

export interface EditorScope {
  meta: Meta;
  projectId: string;
  shots: Shot[];
  target: TargetId;
  /** The language whose text the fields show, and the one a plain string belongs to. */
  locale: string;
  primary: string;
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
function StyleFields({ owner, change, inherits, asset = false }: { owner: Theme; change: Change<Theme>; inherits: boolean; asset?: boolean }) {
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

  const font = <Field label="Font">{<Select options={[["", base], ...ids(meta.fonts)]} value={owner.font ?? ""} onChange={(value) => set("font", value)} />}</Field>;
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
            options={[["", base], ["auto", "Match screenshot"], ["iphone", "iPhone"], ["ipad", "iPad"], ["none", "No frame"]]}
            value={device.frame ?? ""}
            onChange={(value) => setDevice("frame", value)}
          />
        </Field>
      </div>
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
      {asset ? null : (
        <div className="cols">
          {headline}
          {shadow}
        </div>
      )}
    </>
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
        return (
          <div className="badge-edit" key={index}>
            <div className="top">
              <Select label="Badge style" options={ids(Object.keys(meta.badgeTypes))} value={badge.type ?? "laurel"} onChange={(value) => edit((item) => put(item, "type", value))} />
              <Select label="Badge icon" options={[["", "No icon"], ...ids(meta.icons)]} value={badge.icon ?? ""} onChange={(value) => edit((item) => put(item, "icon", value))} />
              <NumberInput label="Stars" value={badge.stars} onChange={(value) => edit((item) => put(item, "stars", value))} min={0} max={5} step={0.1} placeholder="★" />
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
            <TextInput value={badge.title} onChange={(value) => edit((item) => put(item, "title", value))} placeholder="Big line, e.g. 4.9" />
            <TextInput value={badge.subtitle} onChange={(value) => edit((item) => put(item, "subtitle", value))} placeholder="Small line, e.g. App Store rating" />
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

export interface SlideActions {
  move: (delta: number) => void;
  duplicate: () => void;
  remove: () => void;
}

export function SlideEditor({ project, index, change, actions }: { project: Project; index: number; change: Change<Slide>; actions: SlideActions }) {
  const { meta, shots, target, locale } = useScope();
  const slide = project.slides[index]!;
  const layout = slide.layout ?? "device-bottom";
  const names = [...new Set(shots.map((shot) => shot.name))];
  const shotOptions = (current: string | undefined): Option[] => [["", "None"], ...names.map((name): Option => [name, name]), ...(current && !names.includes(current) ? [[current, `${current} (not uploaded)`] as const] : [])];
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
      <Field label="Layout" hint={meta.layouts[layout]}>
        <Select options={ids(Object.keys(meta.layouts))} value={layout} onChange={(value) => change((item) => put(item, "layout", value))} />
      </Field>
      <div className={layout === "duo" ? "cols" : ""}>
        <Field label="Screenshot">
          <Select options={shotOptions(slide.screenshot)} value={slide.screenshot ?? ""} onChange={(value) => change((item) => put(item, "screenshot", value))} />
        </Field>
        {layout === "duo" ? (
          <Field label="Behind it">
            <Select options={shotOptions(slide.screenshot2)} value={slide.screenshot2 ?? ""} onChange={(value) => change((item) => put(item, "screenshot2", value))} />
          </Field>
        ) : null}
      </div>
      <Field label="Eyebrow">
        <TextInput value={slide.eyebrow} onChange={(value) => change((item) => put(item, "eyebrow", value))} placeholder="Small line above the headline" />
      </Field>
      <Field label="Headline" hint="Wrap words in *asterisks* to tint them. Enter starts a new line.">
        <TextInput value={slide.headline} onChange={(value) => change((item) => put(item, "headline", value))} rows={2} />
      </Field>
      <Field label="Subheadline">
        <TextInput value={slide.subheadline} onChange={(value) => change((item) => put(item, "subheadline", value))} rows={2} />
      </Field>
      <BadgesEditor owner={slide} change={change} max={4} hint="Real figures only; App Review rejects invented ones." byDefault="by layout" />
      <Section id="style" title="Style for this slide">
        <StyleFields owner={slide} change={change} inherits />
      </Section>
      <JsonSection
        value={slide}
        hint="Everything Claude can set on this slide, including custom gradients and device offsets."
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

function ShotPicker({ chosen, capacity, layout, onChange }: { chosen: string[]; capacity: number; layout: string; onChange: (next: string[]) => void }) {
  const { shots, projectId } = useScope();
  const names = [...new Set(shots.map((shot) => shot.name))];
  const fileOf = (name: string) => shots.find((shot) => shot.name === name && shot.device === "iphone") ?? shots.find((shot) => shot.name === name);
  const swap = (from: number, to: number) => {
    const next = [...chosen];
    [next[from], next[to]] = [next[to]!, next[from]!];
    onChange(next);
  };
  return (
    <div className="field">
      <span className="label">Screenshots</span>
      {chosen.length > 0 ? (
        <div className="picks">
          {chosen.map((name, index) => {
            const shot = fileOf(name);
            return (
              <div className={`pick${index >= capacity ? " over" : ""}`} key={index}>
                {shot ? <img src={`/files/${projectId}/shots/${shot.file}?v=${shot.version}`} alt="" /> : <span className="pick-missing" />}
                <span className="pick-name">{shot ? name : `${name} (not uploaded)`}</span>
                <button className="icon-btn plain" type="button" disabled={index === 0} title="Move up" aria-label={`Move ${name} up`} onClick={() => swap(index, index - 1)}>
                  ↑
                </button>
                <button className="icon-btn plain" type="button" disabled={index === chosen.length - 1} title="Move down" aria-label={`Move ${name} down`} onClick={() => swap(index, index + 1)}>
                  ↓
                </button>
                <button className="icon-btn" type="button" title="Remove" aria-label={`Remove ${name}`} onClick={() => onChange(chosen.filter((_, at) => at !== index))}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {chosen.length < 6 && names.length > 0 ? (
        <Select
          label="Add a screenshot"
          options={[["", chosen.length ? "Add another…" : "Add a screenshot…"], ...names.map((name): Option => [name, name])]}
          value=""
          onChange={(name) => name && onChange([...chosen, name])}
        />
      ) : null}
      <span className="hint">
        {names.length === 0
          ? "Upload screenshots first. Without any, the asset is copy on the background."
          : chosen.length > capacity
            ? `The ${layout} layout shows ${capacity}; the dimmed ones are left out.`
            : `The ${layout} layout shows up to ${capacity}. The first one gets the most prominent spot.`}
      </span>
    </div>
  );
}

export function CreativeEditor({ project, placement, change, remove }: { project: Project; placement: PlacementId; change: Change<Creative>; remove: () => void }) {
  const { meta, locale } = useScope();
  const creative = project.creatives[placement]!;
  const spec = meta.placements[placement];
  const layout: CreativeLayoutId = creative.layout ?? "fan";
  const query = new URLSearchParams({ locale, guides: "1" });

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
        {spec.width}×{spec.height} ({spec.ratio}). {spec.note} The store crops it differently on each device, so the copy stays inside the dashed safe area, which is not exported.
      </span>
      <Field label="Layout" hint={meta.creativeLayouts[layout].note}>
        <Select options={ids(Object.keys(meta.creativeLayouts))} value={layout} onChange={(value) => change((item) => put(item, "layout", value))} />
      </Field>
      <ShotPicker chosen={creative.screenshots ?? []} capacity={meta.creativeLayouts[layout].screenshots} layout={layout} onChange={(next) => change((item) => put(item, "screenshots", next.length ? next : undefined))} />
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
      <Section id="style" title="Style for this asset">
        <StyleFields owner={creative} change={change} inherits asset />
      </Section>
      <JsonSection
        value={creative}
        hint="Everything Claude can set on this asset, including custom gradients."
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

export function ProjectEditor({ project, change, remove }: { project: Project; change: Change<Project>; remove: () => void }) {
  const joined = project.locales.join(", ");
  const [locales, setLocales] = useState(joined);
  useEffect(() => setLocales(joined), [joined]);
  const commit = () => {
    if (locales === joined) return;
    try {
      const list = parseLocales(locales);
      change((item) => void (item.locales = list));
    } catch (failure) {
      toast(errorText(failure), "error");
      setLocales(joined);
    }
  };
  return (
    <div className="form">
      <Field label="Languages" hint="The first is the fallback. Pick a language in the top bar, then type its translations into the slide fields.">
        <input type="text" spellCheck={false} value={locales} onChange={(event) => setLocales(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} />
      </Field>
      <div className="group-head">
        <span className="label">Theme</span>
        <span className="hint">Used by every slide and asset that does not override it.</span>
      </div>
      <StyleFields owner={project.theme} change={(recipe) => change((item) => recipe(item.theme))} inherits={false} />
      <details>
        <summary>Delete</summary>
        <div className="stack">
          <div>
            <button className="btn small danger" type="button" onClick={remove}>
              Delete this project
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
