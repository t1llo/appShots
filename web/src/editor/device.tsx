// Where a slide's device stands, as sliders.

import { type DeviceStyle, put, type Slide, type Theme } from "../api.ts";
import { Field, Select } from "../ui/index.ts";
import { atBase, rangeThrough } from "../ui/range.ts";
import { type Change, useScope } from "./scope.ts";
import { Section } from "./section.tsx";

/** What a layout does to its device before the slide's own settings. */
const LAYOUT_DEVICE: Record<string, { rotate?: number; offsetX?: number }> = { tilted: { rotate: -8, offsetX: 5 } };

/**
 * One device setting as a slider. `base` is where it stands when the slide does not set it. A double click goes
 * back there, as do Delete and Backspace, and so does moving it there with the arrow keys.
 */
export function Slider(props: { label: string; value: number | undefined; base: number; min: number; max: number; step: number; show: (value: number) => string; onChange: (value: number | null) => void }) {
  const { value, base, step, onChange } = props;
  const { min, max } = rangeThrough(base, props.min, props.max, step);
  return (
    <label className={`slider${value == null ? "" : " set"}`} title="Double-click or press Delete to reset">
      <span className="label">{props.label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? base}
        aria-keyshortcuts="Delete"
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(atBase(next, base, step) ? null : next);
        }}
        onDoubleClick={() => onChange(null)}
        onKeyDown={(event) => {
          if (event.key !== "Delete" && event.key !== "Backspace") return;
          event.preventDefault();
          onChange(null);
        }}
      />
      <output>{props.show(value ?? base)}</output>
    </label>
  );
}

/** Where a slide's device stands and how large it is, on top of what the layout and the project say. */
export function DeviceEditor({ slide, theme, change, single }: { slide: Slide; theme: Theme; change: Change<Slide>; single: boolean }) {
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
  const moved = keys.some((key) => device[key] != null);
  return (
    <Section
      id="device"
      title={single ? "Device" : "Devices"}
      hint={single ? "Its size and place on this slide." : "Their size and place on this slide, and how they stand to each other."}
      open={moved}
      actions={
        moved ? (
          <button className="btn small quiet" type="button" onClick={() => setDevice((next) => keys.forEach((key) => delete next[key]))}>
            Reset
          </button>
        ) : null
      }
    >
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
    </Section>
  );
}
