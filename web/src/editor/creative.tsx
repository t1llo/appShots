// The editor of a header or search results asset, or of a banner.

import { type Creative, type CreativeLayoutId, type PlacementId, type Project, put } from "../api.ts";
import { Field, Select } from "../ui/index.ts";
import { BadgesEditor } from "./badges.tsx";
import { LogoEditor } from "./images.tsx";
import { JsonSection } from "./json.tsx";
import { ShotGrid } from "./pickers.tsx";
import { type Change, ids, useScope } from "./scope.ts";
import { Section } from "./section.tsx";
import { TextInput } from "./text.tsx";
import { StyleFields } from "./theme.tsx";

export function CreativeEditor({ project, placement, change, remove }: { project: Project; placement: PlacementId; change: Change<Creative>; remove: () => void }) {
  const { meta, locale, guides } = useScope();
  const creative = project.creatives[placement]!;
  const spec = meta.placements[placement];
  const banner = spec.kind === "banner";
  // As the renderer draws it: a banner is a split unless it says otherwise, and a store asset never is one.
  const wanted: CreativeLayoutId = creative.layout ?? (banner ? "split" : "fan");
  const layout: CreativeLayoutId = wanted === "split" && !banner ? "sides" : wanted;
  const layouts = Object.keys(meta.creativeLayouts).filter((id) => banner || id !== "split");
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
        {spec.width}×{spec.height} ({spec.ratio}). {spec.note}{" "}
        {banner ? "It is shown whole wherever it goes, so nothing of it is cropped." : "The store crops it differently on each device, so the copy is kept inside the safe area, the part every device shows."}
      </span>
      <Section id="layout" title="Layout" open>
        <Field label="Layout" hint={meta.creativeLayouts[layout].note}>
          <Select options={ids(layouts)} value={layout} onChange={(value) => change((item) => put(item, "layout", value))} />
        </Field>
      </Section>
      <Section id="shots" title="Screenshots" count={picked.length} open>
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
      </Section>
      <Section id="text" title="Text" open>
        <Field label="Eyebrow">
          <TextInput value={creative.eyebrow} onChange={(value) => change((item) => put(item, "eyebrow", value))} placeholder="Small line above the headline" />
        </Field>
        <Field label="Headline" hint={banner ? "A short phrase, or nothing at all. *Asterisks* mark words." : "A short phrase, or nothing at all. No prices, web addresses or claims you cannot back up. *Asterisks* mark words."}>
          <TextInput value={creative.headline} onChange={(value) => change((item) => put(item, "headline", value))} rows={2} />
        </Field>
        <Field label="Subheadline">
          <TextInput value={creative.subheadline} onChange={(value) => change((item) => put(item, "subheadline", value))} rows={2} />
        </Field>
      </Section>
      <BadgesEditor owner={creative} change={change} max={3} hint={banner ? "Real figures only." : "Real figures only, and no Apple accolades such as App of the Day."} byDefault="below the copy" />
      <LogoEditor owner={creative} change={change} hint="Over the headline. Your app's own only: Apple allows no other company's here." />
      <Section id="style" title={banner ? "Style for this banner" : "Style for this asset"} hint="Whatever is left alone here follows the project's theme.">
        <StyleFields owner={creative} change={change} inherits asset />
      </Section>
      <JsonSection
        kind="creative"
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
