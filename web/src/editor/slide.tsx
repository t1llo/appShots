// The editor of one slide.

import { type Project, put, type Slide } from "../api.ts";
import { Field } from "../ui/index.ts";
import { BadgesEditor } from "./badges.tsx";
import { DeviceEditor } from "./device.tsx";
import { FeaturesEditor, IconRowEditor } from "./features.tsx";
import { ImagesEditor, LogoEditor } from "./images.tsx";
import { JsonSection } from "./json.tsx";
import { LayoutPicker, ShotGrid } from "./pickers.tsx";
import { type Change, useScope } from "./scope.ts";
import { Section } from "./section.tsx";
import { TextInput } from "./text.tsx";
import { StyleFields } from "./theme.tsx";

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

/** `slides` is the set the slide is in: the shared one, or the own one of the device shown. */
export function SlideEditor({ project, slides, index, change, actions }: { project: Project; slides: Slide[]; index: number; change: Change<Slide>; actions: SlideActions }) {
  const { meta, target, locale } = useScope();
  const slide = slides[index]!;
  const layout = slide.layout ?? "device-bottom";
  const places = meta.layoutShots[layout] ?? 1;
  const chosen = [slide.screenshot, slide.screenshot2, slide.screenshot3].slice(0, places).filter((name): name is string => Boolean(name));
  const query = new URLSearchParams({ target, locale });
  const reviews = layout === "reviews";

  return (
    <div className="form">
      <div className="actions">
        <button className="icon-btn plain" type="button" disabled={index === 0} title="Move earlier" aria-label="Move earlier" onClick={() => actions.move(-1)}>
          ←
        </button>
        <button className="icon-btn plain" type="button" disabled={index === slides.length - 1} title="Move later" aria-label="Move later" onClick={() => actions.move(1)}>
          →
        </button>
        <button className="btn small" type="button" disabled={slides.length >= 10} onClick={actions.duplicate}>
          Duplicate
        </button>
        <button className="btn small quiet danger" type="button" onClick={actions.remove}>
          Delete
        </button>
        <span className="spacer" />
        <a className="btn small quiet" href={`/render/${project.id}/${index}?${query}`} target="_blank" rel="noopener">
          Full size ↗
        </a>
      </div>
      <Section id="layout" title="Layout" open>
        <LayoutPicker value={layout} onChange={(value) => change((item) => put(item, "layout", value))} />
      </Section>
      {places === 0 ? null : (
        <Section id="shots" title={places === 1 ? "Screenshot" : "Screenshots"} open>
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
        </Section>
      )}
      <Section id="text" title="Text" open>
        <Field label="Eyebrow">
          <TextInput value={slide.eyebrow} onChange={(value) => change((item) => put(item, "eyebrow", value))} placeholder="Small line above the headline" />
        </Field>
        <Field label="Headline" hint="Wrap words in *asterisks* to mark them. Enter starts a new line.">
          <TextInput value={slide.headline} onChange={(value) => change((item) => put(item, "headline", value))} rows={2} />
        </Field>
        <Field label="Subheadline">
          <TextInput value={slide.subheadline} onChange={(value) => change((item) => put(item, "subheadline", value))} rows={2} />
        </Field>
      </Section>
      {chosen.length ? <DeviceEditor slide={slide} theme={project.theme} change={change} single={places === 1} /> : null}
      {layout === "statement" || reviews ? null : <FeaturesEditor slide={slide} change={change} />}
      <BadgesEditor
        owner={slide}
        change={change}
        max={reviews ? 10 : meta.badgesShown}
        reviews={reviews}
        hint={
          reviews
            ? `Badges of the style Review make the wall, up to ${meta.reviewsShown} of them. The other badges stand with the copy. Real reviews only: App Review rejects invented ones.`
            : "Real figures and reviews only: App Review rejects invented ones."
        }
        byDefault="by layout"
      />
      <IconRowEditor slide={slide} change={change} />
      <LogoEditor owner={slide} change={change} hint="Over the headline. The first slide is the place for it." />
      <ImagesEditor slide={slide} change={change} />
      <Section id="style" title="Style for this slide" hint="Whatever is left alone here follows the project's theme.">
        <StyleFields owner={slide} change={change} inherits placed />
      </Section>
      <JsonSection
        kind="slide"
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
