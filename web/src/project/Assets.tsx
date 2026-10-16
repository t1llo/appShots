// What a project is made of: its screenshots, one per name, device and language, and its logos and images. Files
// dropped anywhere in the window come here, and fresh screenshots fill the slides that wait for one.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api, type Detail, detailQuery, type DeviceKind, errorText, type Meta, type Shot, shotIn, type StoredImage } from "../api.ts";
import { languageName, LanguageSwitch } from "../languages.tsx";
import type { ProjectDoc, ProjectStore } from "../state/useDraft.ts";
import { ask, Icon, type Question, toast } from "../ui/index.ts";
import { UPLOAD } from "./ProjectBar.tsx";
import { setOf, usedNames } from "./sets.ts";
import { batchNames, inParallel } from "./upload.ts";

/** The file drop anywhere in the window goes to whichever project is open, as screenshots or as logos and images. */
export const dropTarget: { upload: ((files: File[], kind: "shot" | "image") => void) | null } = { upload: null };

/** How many files go up at once. */
const AT_ONCE = 3;

const quoted = (names: string[]) => names.map((name) => `"${name}"`).join(", ");

/**
 * Uploads files into the project, three at a time, with a note on how far it got that stays up until the last one
 * is in. On the slides page, `fill` names the device shown: fresh screenshots fill its slides that still wait for one.
 */
export function useUpload(props: { store: ProjectStore; detail: Detail; locale: string; fill?: { device: DeviceKind; meta: Meta } }) {
  const { store, detail, locale, fill } = props;
  const id = detail.project.id;
  const queryClient = useQueryClient();
  const [task, setTask] = useState("");

  const upload = useCallback(
    async (files: File[], kind: "shot" | "image" = "shot", as?: string) => {
      const pictures = files.filter((file) => file.type.startsWith("image/"));
      if (pictures.length === 0) return toast("Those are not images.", "error");
      const { draft, base } = store.getState();
      const first = draft.locales[0]!;
      const language = kind === "image" || locale === first ? "" : `?locale=${encodeURIComponent(locale)}`;
      // A language added a moment ago has to be the project's before a screenshot can be filed under it.
      if (language && !base.doc.locales.includes(locale) && !(await store.flush())) {
        return toast(`${languageName(locale)} is not saved yet, so its screenshots cannot be filed under it. Try again once it is.`, "error", 8000);
      }

      const names = as ? [as] : batchNames(pictures.map((file) => file.name), kind);
      let done = 0;
      const progress = () => setTask(pictures.length === 1 ? "Uploading…" : `Uploading ${done} of ${pictures.length}…`);
      progress();
      const results = await inParallel(pictures, AT_ONCE, async (file, index) => {
        const sent = await api<Shot | StoredImage>("PUT", `/projects/${id}/${kind === "shot" ? "shots" : "images"}/${names[index]}${language}`, file);
        done++;
        progress();
        return sent;
      });
      setTask("");
      results.forEach((result, index) => result.status === "rejected" && toast(`${pictures[index]!.name}: ${errorText(result.reason)}`, "error", 8000));
      const uploaded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      void queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
      if (uploaded.length === 0) return;

      if (kind === "image") {
        const replaced = uploaded.filter((image) => detail.images.some((other) => other.name === image.name)).map((image) => image.name);
        if (replaced.length) toast(`Replaced ${quoted(replaced)}.`);
        return;
      }
      const shots = uploaded as Shot[];
      const same = (a: Shot, b: Shot) => a.name === b.name && a.device === b.device && (a.locale ?? "") === (b.locale ?? "");
      const replaced = [...new Set(shots.filter((shot) => detail.shots.some((other) => same(other, shot))).map((shot) => shot.name))];
      if (replaced.length && !as) toast(`Replaced ${quoted(replaced)}.`);
      // In another language, a screenshot takes the place of the first language's only under the same name.
      const known = new Set(detail.shots.map((shot) => shot.name));
      const fresh = [...new Set(shots.filter((shot) => shot.locale && !known.has(shot.name)).map((shot) => shot.name))];
      if (fresh.length && known.size) {
        toast(
          `${quoted(fresh)} ${fresh.length === 1 ? "is a new name" : "are new names"}, so every language shows ${fresh.length === 1 ? "it" : "them"}. To give ${languageName(locale)} its own version of a screenshot, name the file like it, or use the arrow on that screenshot.`,
          "warn",
          10000,
        );
      }
      if (!fill) return;
      // Fresh uploads fill the slides of the set shown that still wait for a screenshot, so a new project comes alive on the first drop.
      const set = setOf(store.getState().draft, fill.device);
      const taken = new Set(set.flatMap((slide) => [slide.screenshot, slide.screenshot2, slide.screenshot3]));
      const waiting = set.flatMap((slide, index) => (slide.screenshot || fill.meta.layoutShots[slide.layout ?? "device-bottom"] === 0 ? [] : [index]));
      const fills = shots.filter((shot) => !taken.has(shot.name) && taken.add(shot.name)).slice(0, waiting.length);
      if (fills.length) store.edit((doc) => fills.forEach((shot, at) => void (setOf(doc, fill.device)[waiting[at]!]!.screenshot = shot.name)), true);
    },
    [store, detail, locale, fill?.device, fill?.meta, id, queryClient],
  );

  useEffect(() => {
    dropTarget.upload = (files, kind) => void upload(files, kind);
    return () => void (dropTarget.upload = null);
  }, [upload]);

  return { upload, task };
}

/** The button that picks files to upload. */
export function Picker({ kind, text, upload }: { kind: "shot" | "image"; text: string; upload: (files: File[], kind: "shot" | "image") => void }) {
  return (
    <label className="btn small">
      <Icon path={UPLOAD} />
      {text}
      <input
        type="file"
        multiple
        accept={kind === "shot" ? "image/png,image/jpeg,image/webp" : "image/png,image/svg+xml,image/jpeg,image/webp"}
        hidden
        onChange={(event) => {
          upload([...(event.target.files ?? [])], kind);
          event.target.value = "";
        }}
      />
    </label>
  );
}

/** The screenshots and the images of a project. Moving or deleting one only asks for the project again: the draft is not touched. */
export function AssetsView(props: {
  meta: Meta;
  detail: Detail;
  draft: ProjectDoc;
  locale: string;
  setLocale: (locale: string) => void;
  upload: (files: File[], kind?: "shot" | "image", as?: string) => Promise<void>;
  openConnect: () => void;
}) {
  const { meta, detail, draft, locale, setLocale, upload, openConnect } = props;
  const id = detail.project.id;
  const { shots, images } = detail;
  const queryClient = useQueryClient();
  const first = draft.locales[0]!;
  const used = usedNames(draft);
  const pick = (files: File[], kind: "shot" | "image") => void upload(files, kind);

  /** Whether a screenshot was made for the language shown. Those without a language are the first language's. */
  const own = (shot: Shot) => (shot.locale ?? first).toLowerCase() === locale.toLowerCase();
  const deviceOrder = meta.devices.map((entry) => entry.id);
  const shotNames = [...new Set(shots.map((shot) => shot.name))];
  // One tile per name and device: what the language shown has there, which is the first language's until it gets its own.
  const shownShots = deviceOrder.flatMap((kind) => shotNames.flatMap((name) => shotIn(shots.filter((shot) => shot.device === kind && shot.name === name), locale) ?? []));

  const act = async (request: Promise<unknown>) => {
    try {
      await request;
    } catch (error) {
      toast(errorText(error), "error");
    }
    await queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
  };

  /** Asks first. A request that fails on yes says so in the dialog, where it can be tried again. */
  const askFirst = (question: Omit<Question, "run">, request: () => Promise<unknown>) =>
    ask({
      ...question,
      run: async () => {
        try {
          await request();
        } finally {
          void queryClient.invalidateQueries({ queryKey: detailQuery(id).queryKey });
        }
      },
    });

  /** Files a screenshot under another device, for one whose size did not give it away. */
  const moveShot = (shot: Shot, to: DeviceKind) => {
    const name = meta.devices.find((entry) => entry.id === to)!.label;
    const request = () => api("PATCH", `/projects/${id}/shots/${shot.file}`, { device: to });
    if (!shots.some((other) => other.name === shot.name && other.device === to && other.locale === shot.locale)) return void act(request());
    askFirst({ title: `Replace the ${name}'s "${shot.name}"?`, text: `"${shot.name}" already has a screenshot for the ${name}. This one takes its place.`, action: "Replace", running: "Replacing…", danger: true }, request);
  };

  const removeShot = (shot: Shot) => {
    const others = shots.some((other) => other !== shot && other.name === shot.name && other.device === shot.device);
    const language = shot.locale && others ? languageName(shot.locale) : null;
    askFirst(
      {
        title: language ? `Delete the ${language} screenshot "${shot.name}"?` : `Delete the screenshot "${shot.name}"?`,
        text: language ? `${language} then shows the ${languageName(first)} one again.` : "This cannot be undone.",
        action: "Delete screenshot",
        running: "Deleting…",
        danger: true,
      },
      () => api("DELETE", `/projects/${id}/shots/${shot.file}`),
    );
  };

  const removeImage = (image: StoredImage) =>
    askFirst(
      { title: `Delete the image "${image.name}"?`, text: "Slides that show it will leave it out. This cannot be undone.", action: "Delete image", running: "Deleting…", danger: true },
      () => api("DELETE", `/projects/${id}/images/${image.file}`),
    );

  return (
    <div className="workspace wide">
      <section>
        <div className="section-head">
          <h2>Screenshots</h2>
          <span className="count">{shownShots.length}</span>
          <span className="hint">
            {!shots.length
              ? "The raw screens of your app. The slides put them into devices."
              : locale === first
                ? "A slide names a screenshot, and each device shows its own picture of that name."
                : `The dimmed ones are ${languageName(first)}. Upload the ${languageName(locale)} ones under the same names.`}
          </span>
          <span className="spacer" />
          {draft.locales.length > 1 ? <LanguageSwitch locales={draft.locales} value={locale} onChange={setLocale} /> : null}
          <Picker kind="shot" text="Upload" upload={pick} />
        </div>
        {deviceOrder
          .filter((kind) => shownShots.some((shot) => shot.device === kind))
          .map((kind) => (
            <div className="asset-group" key={kind}>
              <h3>
                {meta.devices.find((entry) => entry.id === kind)!.label}
                <span className="count">{shownShots.filter((shot) => shot.device === kind).length}</span>
              </h3>
              <div className="shots">
                {shownShots
                  .filter((shot) => shot.device === kind)
                  .map((shot) => (
                    <div
                      key={shot.file}
                      className={`shot${used.shots.has(shot.name) ? " used" : ""}${own(shot) ? "" : " borrowed"}`}
                      title={`${shot.name} · ${shot.width}×${shot.height}${used.shots.has(shot.name) ? "" : " · not on any slide yet"}${own(shot) ? "" : ` · the ${languageName(shot.locale ?? first)} one, until ${languageName(locale)} has its own`}`}
                    >
                      <img src={`/files/${id}/shots/${shot.file}?v=${shot.version}`} alt="" loading="lazy" />
                      <select
                        className="tag"
                        aria-label={`Device of ${shot.name}`}
                        title="The device this screenshot is from. Change it when it was told wrong."
                        value={shot.device}
                        onChange={(event) => moveShot(shot, event.target.value as DeviceKind)}
                      >
                        {meta.devices.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label.replace("iPhone ", "")}
                          </option>
                        ))}
                      </select>
                      {own(shot) ? (
                        <button className="remove" type="button" title="Delete screenshot" aria-label={`Delete ${shot.name}`} onClick={() => removeShot(shot)}>
                          ×
                        </button>
                      ) : (
                        <>
                          <span className="tag from">{shot.locale ?? first}</span>
                          <label className="remove add" title={`Upload the ${languageName(locale)} screenshot of "${shot.name}"`}>
                            <Icon path={UPLOAD} />
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              hidden
                              aria-label={`Upload the ${languageName(locale)} screenshot of ${shot.name}`}
                              onChange={(event) => {
                                void upload([...(event.target.files ?? [])].slice(0, 1), "shot", shot.name);
                                event.target.value = "";
                              }}
                            />
                          </label>
                        </>
                      )}
                      <span className="name">{shot.name}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        <div className={`dropzone${shots.length ? "" : " empty"}`}>
          {shots.length ? (
            <div>{locale === first ? "Drop more screenshots anywhere in this window" : `Drop the ${languageName(locale)} screenshots anywhere in this window`}</div>
          ) : (
            <div>
              Drop screenshots here, or capture one from your Mac:
              <br />
              <code>appshots capture --name home --project {id}</code>
              <br />
              <button className="btn small quiet" type="button" onClick={openConnect}>
                How to set that up
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="block">
        <div className="section-head">
          <h2>Logos and images</h2>
          <span className="count">{images.length}</span>
          <span className="hint">Your logo, app icon, stickers and characters. A slide picks them under Your logo and Images.</span>
          <span className="spacer" />
          <Picker kind="image" text="Upload" upload={pick} />
        </div>
        <div className="shots art" data-drop="images">
          {images.map((image) => (
            <div key={image.file} className={`shot${used.images.has(image.name) ? " used" : ""}`} title={`${image.name} · ${image.width}×${image.height}${used.images.has(image.name) ? "" : " · not on any slide yet"}`}>
              <img src={`/files/${id}/images/${image.file}?v=${image.version}`} alt="" loading="lazy" />
              <button className="remove" type="button" title="Delete image" aria-label={`Delete ${image.name}`} onClick={() => removeImage(image)}>
                ×
              </button>
              <span className="name">{image.name}</span>
            </div>
          ))}
          <div className="dropzone">
            <div>{images.length ? "Drop more here" : "Drop your logo, app icon, stickers or characters here. A PNG or SVG with a transparent background works best."}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
