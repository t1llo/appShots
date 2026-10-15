// What a slide shows beside its copy: features, figures or steps, and a row of icons.

import { Fragment, useState } from "react";
import { type Feature, type FeatureCards, type IconRow, label, put, type Slide } from "../api.ts";
import { Field, type Option, Select } from "../ui/index.ts";
import { Glyph, iconName, IconPicker } from "./icons.tsx";
import { type Change, ids, useScope } from "./scope.ts";
import { Section } from "./section.tsx";
import { TextInput } from "./text.tsx";

/** What a slide's features are, by the layout that draws them. */
const FEATURE_MODES = {
  cards: { title: "Features", one: "feature", hint: "Most important first. Each gets an icon, a figure such as 24h, or a small picture.", value: "or 24h", name: "The feature, e.g. Daily limits", text: "One short line under it, or nothing" },
  figures: { title: "Figures", one: "figure", hint: "The first is the large one, the next stand in a row under it. Real numbers only.", value: "2M", name: "What it counts, e.g. budgets made", text: "One short line under it, or nothing" },
  steps: { title: "Steps", one: "step", hint: "In order. Each is numbered by itself, and can show a small screenshot.", value: "1", name: "The step, e.g. Add your accounts", text: "One short line under it, or nothing" },
  points: { title: "Feature points", one: "feature point", hint: "A short list with the copy, each with an icon. Two to four read best.", value: "or 24h", name: "The feature, e.g. Daily limits", text: "One short line under it, or nothing" },
} as const;

const CARD_LOOKS: Record<string, string> = { glass: "Glass", tint: "Tinted", solid: "Solid colour", outline: "Outline" };
const CARD_ICONS: Record<string, string> = { gradient: "Shaded", badge: "On a square", plain: "Plain" };

export function FeaturesEditor({ slide, change }: { slide: Slide; change: Change<Slide> }) {
  const { meta, shots, images } = useScope();
  const layout = slide.layout ?? "device-bottom";
  const mode = layout === "features" ? "cards" : layout === "stat" ? "figures" : layout === "steps" ? "steps" : "points";
  const words = FEATURE_MODES[mode];
  const features = slide.features ?? [];
  // One field holds either kind of style; each kind reads the other's own ones as its plainest.
  const styles = mode === "cards" ? meta.featureStyles : mode === "points" ? meta.pointStyles : null;
  const style = styles ? (slide.featureStyle && styles[slide.featureStyle] ? slide.featureStyle : mode === "points" ? "list" : slide.featureStyle === "chips" ? "list" : "bento") : "";
  const cards = slide.featureCards ?? {};
  const setCards = (key: keyof FeatureCards, value: unknown) =>
    change((item) => {
      const next = { ...item.featureCards };
      put(next, key, value);
      if (Object.keys(next).length) item.featureCards = next;
      else delete item.featureCards;
    });
  const swap = (from: number, to: number) =>
    change((item) => {
      const list = item.features!;
      [list[from], list[to]] = [list[to]!, list[from]!];
    });
  const shotNames: Option[] = [["", "No screenshot"], ...[...new Set(shots.map((shot) => shot.name))].map((name): Option => [name, name])];
  const imageNames: Option[] = [["", "No image"], ...images.map((image): Option => [image.name, image.name])];
  return (
    <Section id="features" title={words.title} hint={words.hint} count={features.length} open={mode !== "points" || features.length > 0}>
      {styles && (mode === "cards" || features.length > 0) ? (
        <Field label={mode === "points" ? "Point style" : "Card style"} hint={styles[style]}>
          <Select options={ids(Object.keys(styles))} value={style} onChange={(value) => change((item) => put(item, "featureStyle", value))} />
        </Field>
      ) : null}
      {mode === "cards" ? (
        <div className="trio">
          <Field label="Cards">
            <select value={cards.look ?? "glass"} title={meta.cardLooks[cards.look ?? "glass"]} onChange={(event) => setCards("look", event.target.value === "glass" ? undefined : event.target.value)}>
              {Object.entries(meta.cardLooks).map(([id, note]) => (
                <option key={id} value={id} title={note}>
                  {CARD_LOOKS[id] ?? label(id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Icons">
            <select value={cards.icons ?? "gradient"} title={meta.cardIcons[cards.icons ?? "gradient"]} onChange={(event) => setCards("icons", event.target.value === "gradient" ? undefined : event.target.value)}>
              {Object.entries(meta.cardIcons).map(([id, note]) => (
                <option key={id} value={id} title={note}>
                  {CARD_ICONS[id] ?? label(id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Across">
            <Select
              options={[["", "Auto"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]]}
              value={style === "bento" ? "" : String(cards.columns ?? "")}
              onChange={(value) => setCards("columns", value ? Number(value) : undefined)}
            />
          </Field>
        </div>
      ) : null}
      {features.map((feature, index) => {
        const edit: Change<Feature> = (recipe) => change((item) => recipe(item.features![index]!));
        return (
          <div className="badge-edit" key={index}>
            <div className={`top feature${mode === "steps" ? " plain" : ""}`}>
              {mode === "steps" ? <span className="step-no">{index + 1}</span> : <IconPicker label={`Icon of this ${words.one}`} value={feature.icon} onChange={(value) => edit((item) => put(item, "icon", value))} />}
              <TextInput value={feature.value} onChange={(value) => edit((item) => put(item, "value", value))} placeholder={mode === "steps" ? "Its number" : words.value} />
              <button className="icon-btn plain" type="button" disabled={index === 0} title="Move up" aria-label={`Move ${words.one} up`} onClick={() => swap(index, index - 1)}>
                ↑
              </button>
              <button className="icon-btn plain" type="button" disabled={index === features.length - 1} title="Move down" aria-label={`Move ${words.one} down`} onClick={() => swap(index, index + 1)}>
                ↓
              </button>
              <button
                className="icon-btn"
                type="button"
                title={`Remove ${words.one}`}
                aria-label={`Remove ${words.one}`}
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
            <TextInput value={feature.title} onChange={(value) => edit((item) => void (item.title = value ?? ""))} placeholder={words.name} />
            <TextInput value={feature.text} onChange={(value) => edit((item) => put(item, "text", value))} placeholder={words.text} />
            {mode === "points" ? null : (
              <div className="feature-extra">
                <label className="tone" title={`A colour of its own for this ${words.one}. Without one, the accent colour.`}>
                  <input type="color" aria-label={`Colour of this ${words.one}`} value={feature.color?.length === 7 ? feature.color.toLowerCase() : "#888888"} onChange={(event) => edit((item) => void (item.color = event.target.value.toUpperCase()))} />
                  {feature.color ? (
                    <button className="link" type="button" onClick={() => edit((item) => void delete item.color)}>
                      Accent
                    </button>
                  ) : (
                    <span className="dim">Accent</span>
                  )}
                </label>
                {mode === "cards" && images.length ? <Select label="Image in place of the icon" options={imageNames} value={feature.image ?? ""} onChange={(value) => edit((item) => put(item, "image", value))} /> : null}
                {mode !== "figures" && shots.length ? <Select label="Small screenshot" options={shotNames} value={feature.screenshot ?? ""} onChange={(value) => edit((item) => put(item, "screenshot", value))} /> : null}
              </div>
            )}
          </div>
        );
      })}
      {features.length < 8 ? (
        <div className="row">
          <button
            className="btn small"
            type="button"
            onClick={() => change((item) => void (item.features = [...(item.features ?? []), mode === "figures" || mode === "steps" ? { title: "" } : { icon: "sparkle", title: "" }]))}
          >
            Add {words.one}
          </button>
        </div>
      ) : null}
    </Section>
  );
}

const ROW_TONES: Record<string, string> = { brand: "Brand colours", accent: "Accent colour", text: "Text colour" };

/** The row of icons and brand logos a slide shows with its copy. */
export function IconRowEditor({ slide, change }: { slide: Slide; change: Change<Slide> }) {
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
    <Section id="icons" title="Icons and logos" hint="A row with the copy, such as the services the app works with." count={icons.length} open={icons.length > 0}>
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
    </Section>
  );
}
