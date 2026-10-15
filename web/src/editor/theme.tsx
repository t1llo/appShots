// The look of a slide, an asset or the whole project: background, colours, font and device.

import { useEffect, useRef, useState } from "react";
import { type Background, type DeviceStyle, label, put, type Theme } from "../api.ts";
import { Field, NumberInput, type Option, Select } from "../ui/index.ts";
import { type Change, ids, useScope } from "./scope.ts";

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
export function StyleFields({ owner, change, inherits, asset = false, placed = false }: { owner: Theme; change: Change<Theme>; inherits: boolean; asset?: boolean; placed?: boolean }) {
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
      <Field label="Words between *asterisks*" hint={meta.emphasis[owner.emphasis ?? "tint"]}>
        <Select options={[["", base], ...Object.keys(meta.emphasis).map((id): Option => [id, EMPHASIS[id] ?? label(id)])]} value={owner.emphasis ?? ""} onChange={(value) => set("emphasis", value)} />
      </Field>
      <div className="cols">
        <Field label="Device colour">
          <Select options={[["", base], ...ids(meta.deviceColors)]} value={device.color ?? ""} onChange={(value) => setDevice("color", value)} />
        </Field>
        <Field label="Frame">
          <Select
            options={[["", base], ["auto", "Match screenshot"], ["iphone", "iPhone"], ["duo", "iPhone Duo"], ["ipad", "iPad"], ["mac", "MacBook"], ["none", "No frame"]]}
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

const EMPHASIS: Record<string, string> = { tint: "Tinted", marker: "Marker behind them", underline: "Underlined" };
export const DEVICE_LOOKS: Record<string, string> = { real: "Realistic", clay: "Clay", outline: "Outline", sketch: "Sketch" };
export const STATUS_BARS: Record<string, string> = { none: "As in the screenshot", cover: "Clean, over the old one", overlay: "Clean, drawn on top" };

/** The time of a drawn status bar. What is typed counts once it reads as a time; until then the last good one stays. */
export function TimeInput({ value, onChange }: { value: string | undefined; onChange: (value: string | undefined) => void }) {
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
