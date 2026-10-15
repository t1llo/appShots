// The icon picker of badges, features and the icon row.

import { Fragment, useState } from "react";
import { label } from "../api.ts";
import { useScope } from "./scope.ts";

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
export const iconName = (id: string) => ICON_NAMES[id] ?? label(id);

export function Glyph({ id }: { id: string }) {
  // The sprite is cached for a day; the count in its address fetches a new one when icons are added.
  const { meta } = useScope();
  return (
    <svg className="glyph" viewBox="0 0 256 256" aria-hidden="true">
      <use href={`/icons.svg?n=${meta.icons.length}#${id}`} />
    </svg>
  );
}

/** A button showing the chosen icon. It opens a searchable grid of all of them underneath. */
export function IconPicker({ label: text, value, onChange }: { label: string; value: string | undefined; onChange: (next: string | undefined) => void }) {
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
