// The pickers of a slide's layout and of its screenshots.

import { Fragment, type ReactNode } from "react";
import { label, shotFor } from "../api.ts";
import { useScope } from "./scope.ts";

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
  statement: (
    <>
      <rect className="t" x={4} y={13} width={22} height={3.8} rx={1.9} />
      <rect className="t" x={4} y={19.5} width={18} height={3.8} rx={1.9} />
      <rect className="t" x={4} y={26} width={12} height={3.8} rx={1.9} />
    </>
  ),
  stat: (
    <>
      {copy()}
      <rect className="t" x={6} y={16} width={18} height={9} rx={2.4} />
      {line(27.5, 10)}
      {tile(3.5, 34, 6.5, 5)}
      {tile(11.75, 34, 6.5, 5)}
      {tile(20, 34, 6.5, 5)}
    </>
  ),
  steps: (
    <>
      {copy()}
      {[17, 25, 33].map((y) => (
        <Fragment key={y}>
          <circle className="d" cx={6.5} cy={y + 2} r={2.6} />
          <rect className="t" x={11.5} y={y + 0.2} width={14} height={1.8} rx={0.9} />
          <rect className="t" x={11.5} y={y + 3} width={9} height={1.4} rx={0.7} />
        </Fragment>
      ))}
    </>
  ),
  reviews: (
    <>
      {copy()}
      {tile(3.5, 15, 10.5, 8)}
      {tile(16, 15, 10.5, 11)}
      {tile(3.5, 25, 10.5, 11)}
      {tile(16, 28, 10.5, 8)}
    </>
  ),
};

export function LayoutPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { meta } = useScope();
  return (
    <div className="field">
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
export function ShotGrid({ chosen, capacity, max, hint, onChange }: { chosen: string[]; capacity: number; max: number; hint: string; onChange: (next: string[]) => void }) {
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
      {names.length ? (
        <div className={`shot-grid${device === "mac" ? " wide" : ""}`}>
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
      <span className="hint">{names.length ? hint : "No screenshots yet. Drop them anywhere in the window."}</span>
    </div>
  );
}
