// The logo over the copy and the images placed freely on a slide.

import { type Logo, type PlacedImage, put, type Slide, type StoredImage } from "../api.ts";
import { Field, type Option, Select } from "../ui/index.ts";
import { Slider } from "./device.tsx";
import { type Change, ids, useScope } from "./scope.ts";
import { Section } from "./section.tsx";

function Art({ image }: { image: StoredImage }) {
  const { projectId } = useScope();
  return <img src={`/files/${projectId}/images/${image.file}?v=${image.version}`} alt="" loading="lazy" draggable={false} />;
}

const NO_IMAGES = "Upload your logo, app icon or other artwork first: open Assets at the top of the project, or drop the file there.";

/** The uploaded image a slide or an asset shows over its headline. */
export function LogoEditor({ owner, change, hint }: { owner: { logo?: Logo }; change: Change<{ logo?: Logo }>; hint: string }) {
  const { meta, images } = useScope();
  const logo = owner.logo;
  const shape = logo?.shape ?? "plain";
  const edit = (key: keyof Logo, value: unknown) => change((item) => put(item.logo!, key, value));
  return (
    <Section id="logo" title="Your logo" hint={hint} open={logo != null}>
      {images.length === 0 && !logo ? (
        <span className="hint">{NO_IMAGES}</span>
      ) : (
        <div className="art-grid">
          <button className={`art-cell none${logo ? "" : " on"}`} type="button" aria-pressed={!logo} onClick={() => change((item) => void delete item.logo)}>
            None
          </button>
          {images.map((image) => (
            <button
              key={image.file}
              className={`art-cell${logo?.image === image.name ? " on" : ""}`}
              type="button"
              aria-pressed={logo?.image === image.name}
              title={image.name}
              aria-label={image.name}
              onClick={() => change((item) => void (item.logo = { ...item.logo, image: image.name }))}
            >
              <Art image={image} />
            </button>
          ))}
        </div>
      )}
      {logo && !images.some((image) => image.name === logo.image) ? <div className="inline-error">No image named "{logo.image}" is uploaded, so nothing is shown.</div> : null}
      {logo ? (
        <div className="cols">
          <Field label="Size">
            <Select options={ids(meta.logoSizes)} value={logo.size ?? "medium"} onChange={(value) => edit("size", value === "medium" ? undefined : value)} />
          </Field>
          <Field label="Shape" hint={meta.logoShapes[shape]}>
            <Select options={ids(Object.keys(meta.logoShapes))} value={shape} onChange={(value) => edit("shape", value === "plain" ? undefined : value)} />
          </Field>
        </div>
      ) : null}
    </Section>
  );
}

/** Ready-made arrangements: where the first, second, third… image goes, as x, y and rotation. */
export const PLACED_SPOTS: Record<string, [x: number, y: number, rotate: number][]> = {
  corners: [[12, 7, -12], [88, 7, 12], [88, 93, -8], [12, 93, 8], [50, 4, 0], [50, 96, 0], [5, 50, -10], [95, 50, 10]],
  sides: [[9, 48, -12], [91, 44, 12], [10, 72, 8], [90, 76, -8], [14, 92, -6], [86, 94, 6], [8, 30, 10], [92, 28, -10], [50, 97, 0], [50, 34, 0]],
  scattered: [[84, 17, 14], [14, 11, -14], [7, 57, 10], [93, 63, -12], [24, 91, -6], [77, 95, 8], [52, 5, 4], [6, 33, -18], [94, 38, 14], [50, 97, -3]],
};
const ARRANGEMENTS: Option[] = [["", "Arrange…"], ["corners", "In the corners"], ["sides", "Around the device"], ["scattered", "Scattered"], ["bottom", "Along the bottom"]];

/** Stickers, characters and shapes placed freely on a slide. */
export function ImagesEditor({ slide, change }: { slide: Slide; change: Change<Slide> }) {
  const { images, dragging } = useScope();
  const placed = slide.images ?? [];
  const full = placed.length >= 10;
  const names: Option[] = images.map((image) => [image.name, image.name]);
  const swap = (from: number, to: number) =>
    change((item) => {
      const list = item.images!;
      [list[from], list[to]] = [list[to]!, list[from]!];
    });
  const arrange = (how: string) =>
    change((item) => {
      const list = item.images ?? [];
      list.forEach((entry, index) => {
        const [x, y, rotate] = how === "bottom" ? [Math.round(((index + 0.5) / list.length) * 100), 93, index % 2 ? 6 : -6] : PLACED_SPOTS[how]![index % PLACED_SPOTS[how]!.length]!;
        Object.assign(entry, { x, y });
        put(entry, "rotate", rotate || undefined);
      });
    });
  const percent = (value: number) => `${value}%`;
  return (
    <Section
      id="images"
      title="Images"
      hint="Stickers, characters and shapes, placed freely."
      count={placed.length}
      open={placed.length > 0}
      actions={
        placed.length ? (
          <button className="btn small quiet" type="button" onClick={() => change((item) => void delete item.images)}>
            Remove all
          </button>
        ) : null
      }
    >
      {images.length === 0 && placed.length === 0 ? <span className="hint">{NO_IMAGES}</span> : null}
      {placed.map((entry, index) => {
        const image = images.find((candidate) => candidate.name === entry.image);
        const edit = (key: keyof PlacedImage) => (value: unknown) => change((item) => put(item.images![index]!, key, value));
        return (
          <div className="badge-edit" key={index}>
            <div className="top placed">
              <span className="art-cell still">{image ? <Art image={image} /> : "?"}</span>
              <Select label="Image" options={image ? names : [[entry.image, `${entry.image} (not uploaded)`], ...names]} value={entry.image} onChange={(value) => change((item) => void (item.images![index]!.image = value))} />
              <button className="icon-btn plain" type="button" disabled={index === 0} title="Send backward" aria-label="Send image backward" onClick={() => swap(index, index - 1)}>
                ↑
              </button>
              <button className="icon-btn plain" type="button" disabled={index === placed.length - 1} title="Bring forward" aria-label="Bring image forward" onClick={() => swap(index, index + 1)}>
                ↓
              </button>
              <button
                className="icon-btn"
                type="button"
                title="Remove image"
                aria-label="Remove image"
                onClick={() =>
                  change((item) => {
                    item.images!.splice(index, 1);
                    if (item.images!.length === 0) delete item.images;
                  })
                }
              >
                ×
              </button>
            </div>
            <div className="sliders">
              <Slider label="Left · right" value={entry.x} base={50} min={-30} max={130} step={1} show={percent} onChange={edit("x")} />
              <Slider label="Up · down" value={entry.y} base={50} min={-30} max={130} step={1} show={percent} onChange={edit("y")} />
              <Slider label="Size" value={entry.size} base={30} min={2} max={200} step={1} show={percent} onChange={edit("size")} />
              <Slider label="Turn" value={entry.rotate} base={0} min={-180} max={180} step={1} show={(value) => `${value}°`} onChange={edit("rotate")} />
              <Slider label="Opacity" value={entry.opacity} base={1} min={0.05} max={1} step={0.05} show={(value) => `${Math.round(value * 100)}%`} onChange={edit("opacity")} />
            </div>
            <div className="trio">
              <Select label="Layer" options={[["front", "In front"], ["behind", "Behind everything"]]} value={entry.layer ?? "front"} onChange={(value) => edit("layer")(value === "front" ? undefined : value)} />
              <Select label="Shadow" options={[["none", "No shadow"], ["soft", "Soft shadow"], ["strong", "Strong shadow"]]} value={entry.shadow ?? "none"} onChange={(value) => edit("shadow")(value === "none" ? undefined : value)} />
              <label className="check">
                <input type="checkbox" checked={entry.flip ?? false} onChange={(event) => edit("flip")(event.target.checked || undefined)} />
                Mirror
              </label>
            </div>
          </div>
        );
      })}
      {images.length ? (
        <>
          <div className="art-grid">
            {images.map((image) => (
              <button
                key={image.file}
                className="art-cell add"
                type="button"
                disabled={full}
                title={`Add ${image.name}`}
                aria-label={`Add ${image.name}`}
                onClick={() =>
                  change((item) => {
                    const [x, y, rotate] = PLACED_SPOTS.scattered![placed.length % PLACED_SPOTS.scattered!.length]!;
                    item.images = [...(item.images ?? []), { image: image.name, x, y, size: 24, rotate }];
                  })
                }
              >
                <Art image={image} />
              </button>
            ))}
          </div>
          <div className="row">
            <span className="hint">
              {full ? "Ten is the most a slide holds." : "Click one to add it."}
              {placed.length && dragging ? " Drag it on the slide to move it." : ""}
            </span>
            <span className="spacer" />
            {placed.length > 1 ? <Select label="Arrange the images" options={ARRANGEMENTS} value="" onChange={(value) => value && arrange(value)} /> : null}
          </div>
        </>
      ) : null}
    </Section>
  );
}
