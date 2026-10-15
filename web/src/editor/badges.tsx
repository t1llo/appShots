// Badges and reviews, on a slide or an asset.

import type { ReactNode } from "react";
import { type Badge, label, put } from "../api.ts";
import { NumberInput, type Option, Select } from "../ui/index.ts";
import { IconPicker } from "./icons.tsx";
import { type Change, ids, useScope } from "./scope.ts";
import { Section } from "./section.tsx";
import { TextInput } from "./text.tsx";

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

export function BadgesEditor({ owner, change, max, hint, byDefault, reviews = false }: { owner: Badged; change: Change<Badged>; max: number; hint: ReactNode; byDefault: string; reviews?: boolean }) {
  const { meta } = useScope();
  const badges = owner.badges ?? [];
  return (
    <Section id="badges" title={reviews ? "Reviews and badges" : "Badges"} hint={hint} count={badges.length} open={reviews || badges.length > 0}>
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
          <button className="btn small" type="button" onClick={() => change((item) => void (item.badges = [...(item.badges ?? []), { type: reviews ? "review" : "laurel" }]))}>
            {reviews ? "Add review" : "Add badge"}
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
    </Section>
  );
}
