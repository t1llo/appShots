// The editor of the project as a whole: its name, languages, export sizes and theme.

import { useState } from "react";
import { exportSizes, type Project, type TargetId } from "../api.ts";
import { LanguageList } from "../languages.tsx";
import { Field } from "../ui/index.ts";
import { type Change, useScope } from "./scope.ts";
import { Section } from "./section.tsx";
import { StyleFields } from "./theme.tsx";

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
      <Section id="languages" title="Languages" hint="The set is exported once for each." count={project.locales.length} open>
        <LanguageList locales={project.locales} onChange={(next) => change((item) => void (item.locales = next))} />
        <span className="hint">
          A language shows the first one's texts and screenshots until it has its own. Switch language above the slides, then type its texts and upload its screenshots. A language you remove keeps what it had and
          has it again when you add it back.
        </span>
      </Section>
      <Section id="sizes" title="Export sizes" hint={`${project.targets?.length ? "Your own choice." : "The standard sizes for your screenshots."} One folder each in the ZIP.`} open>
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
      </Section>
      <Section id="theme" title="Theme" hint="Used by every slide, asset and banner that does not override it." open>
        <StyleFields owner={project.theme} change={(recipe) => change((item) => recipe(item.theme))} inherits={false} />
      </Section>
      <Section id="delete" title="Delete" hint="Removes the project with its screenshots, images and renders.">
        <div>
          <button className="btn small danger" type="button" onClick={remove}>
            Delete this project…
          </button>
        </div>
      </Section>
    </div>
  );
}
