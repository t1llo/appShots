// The live previews of a project: iframes of the very pages the renderer screenshots, so what is on screen is what
// gets exported. A preview loads once it comes near the screen, and loads again only when what it shows changed.

import { type KeyboardEvent, memo, type RefObject, useEffect, useRef, useState } from "react";
import { type Creative, type DeviceKind, label, type PlacedImage, type PlacementId, type Shot, shotFor, type Slide, type StoredImage, type Theme } from "../api.ts";

/** Loads the new preview underneath and swaps once it has laid itself out, so edits never flash blank. */
export function Stage({ src, frameKey, width, height, scale }: { src: string | null; frameKey: string; width: number; height: number; scale: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const look = `width:${width}px;height:${height}px;transform:scale(${scale})`;

  // A new size or zoom only scales what is there: the page itself is the same.
  useEffect(() => {
    for (const frame of ref.current!.querySelectorAll("iframe")) frame.style.cssText = look;
  }, [look]);

  useEffect(() => {
    const stage = ref.current!;
    if (!near || src == null || stage.dataset.key === frameKey) return;
    stage.dataset.key = frameKey;
    const frame = document.createElement("iframe");
    frame.className = "incoming";
    frame.src = `${src}${src.includes("?") ? "&" : "?"}t=${Date.now()}`;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = look;
    frame.addEventListener("load", () => {
      const started = performance.now();
      const reveal = () => {
        let ready = true;
        try {
          const state = frame.contentDocument?.body?.dataset.ready;
          ready = state === "1" || state === "error";
        } catch {}
        if (!ready && performance.now() - started < 4000) return void setTimeout(reveal, 60);
        if (stage.dataset.key !== frameKey) return frame.remove();
        frame.classList.remove("incoming");
        // The old preview stays underneath until the new one has faded in and been painted.
        for (const old of stage.querySelectorAll("iframe")) if (old !== frame) setTimeout(() => old.remove(), 400);
      };
      reveal();
    });
    stage.append(frame);
  }, [near, src, frameKey]);
  return <div className="stage" ref={ref} style={{ width: Math.round(width * scale), height: Math.round(height * scale) }} />;
}

/** Whether an element has come near the screen. Once it has, it stays so: a loaded preview is kept. */
function useNear(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (near) return;
    const watch = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setNear(true), { rootMargin: "600px" });
    watch.observe(ref.current!);
    return () => watch.disconnect();
  }, [near]);
  return near;
}

/**
 * The width an element has to fill, followed as the window changes, and the ref that names the element. Zero until
 * it has been laid out.
 */
export function useWidth(): [number, (element: HTMLElement | null) => void] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      // A hidden element measures zero, which says nothing about the room it has once it is shown.
      const next = element.clientWidth;
      if (next > 0) setWidth(next);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, [element]);
  return [width, setElement];
}

// ---------------------------------------------------------------- what a preview shows

/** A short fingerprint of a text, so a preview's key stays small however large what it shows is. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/** The files a piece names, by version: what it shows changes when one of them is uploaded again. */
function files<T extends Shot | StoredImage>(json: string, list: T[], pick: (named: T[]) => T[] = (named) => named): string[] {
  return pick(list.filter((entry) => json.includes(JSON.stringify(entry.name)))).map((entry) => `${entry.file}:${entry.version}`);
}

/**
 * The key of a slide's preview: everything its page is drawn from. Only the screenshots the slide shows on this
 * device in this language count, so an upload elsewhere leaves it be.
 */
export function slideKey(slide: Slide | undefined, scope: { theme: Theme; primary: string; locale: string; target: string; device: DeviceKind; shots: Shot[]; images: StoredImage[] }): string {
  const json = JSON.stringify([slide, scope.theme]);
  const shown = (named: Shot[]) => [...new Set(named.map((shot) => shot.name))].flatMap((name) => shotFor(scope.shots, name, scope.device, scope.locale) ?? []);
  return hash(JSON.stringify([json, scope.primary, scope.locale, scope.target, files(json, scope.shots, shown), files(json, scope.images)]));
}

/** The key of a store asset's or banner's preview. Its size on screen is left out: zooming only scales it. */
export function creativeKey(creative: Creative | undefined, scope: { theme: Theme; primary: string; locale: string; guides: boolean; shots: Shot[]; images: StoredImage[] }): string {
  const json = JSON.stringify([creative, scope.theme]);
  return hash(JSON.stringify([json, scope.primary, scope.locale, scope.guides, files(json, scope.shots), files(json, scope.images)]));
}

// ---------------------------------------------------------------- cards

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Lies over the preview of the selected slide with one handle per placed image, so an image is moved by dragging it.
 * The preview itself only changes once the move is saved, so a handle shows its image for as long as the two differ.
 */
function PlacedHandles(props: { placed: PlacedImage[]; shown: PlacedImage[]; images: StoredImage[]; projectId: string; onMove: (index: number, x: number, y: number) => void }) {
  const { placed, shown, images, projectId, onMove } = props;
  const box = useRef<HTMLDivElement>(null);
  const grip = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ index: number; x: number; y: number } | null>(null);
  return (
    <div className="handles" ref={box}>
      {placed.map((item, index) => {
        const image = images.find((entry) => entry.name === item.image);
        if (!image) return null;
        const dragging = drag?.index === index;
        const x = dragging ? drag.x : (item.x ?? 50);
        const y = dragging ? drag.y : (item.y ?? 50);
        const waiting = shown[index]?.x !== item.x || shown[index]?.y !== item.y;
        return (
          <div
            key={index}
            className={`handle${dragging ? " dragging" : ""}`}
            title={`Drag to move ${item.image}`}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: `${item.size ?? 30}%`,
              aspectRatio: `${image.width} / ${image.height}`,
              transform: `translate(-50%, -50%) rotate(${item.rotate ?? 0}deg)${item.flip ? " scaleX(-1)" : ""}`,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              grip.current = { pointerX: event.clientX, pointerY: event.clientY, x, y };
              setDrag({ index, x, y });
            }}
            onPointerMove={(event) => {
              const from = grip.current;
              if (!from || !dragging) return;
              const frame = box.current!.getBoundingClientRect();
              setDrag({
                index,
                x: clamp(Math.round(from.x + ((event.clientX - from.pointerX) / frame.width) * 100), -30, 130),
                y: clamp(Math.round(from.y + ((event.clientY - from.pointerY) / frame.height) * 100), -30, 130),
              });
            }}
            onPointerUp={() => {
              if (dragging && (drag.x !== (item.x ?? 50) || drag.y !== (item.y ?? 50))) onMove(index, drag.x, drag.y);
              grip.current = null;
              setDrag(null);
            }}
            onPointerCancel={() => {
              grip.current = null;
              setDrag(null);
            }}
          >
            {dragging || waiting ? <img src={`/files/${projectId}/images/${image.file}?v=${image.version}`} alt="" draggable={false} style={{ opacity: item.opacity ?? 1 }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Enter and Space press a card the way they press a button. */
export const pressed = (run: () => void) => (event: KeyboardEvent) => {
  if ((event.key !== "Enter" && event.key !== " ") || event.target !== event.currentTarget) return;
  event.preventDefault();
  run();
};

interface SlideCardProps {
  projectId: string;
  index: number;
  /** The slide as it is edited, and as the server has it, which the preview shows. */
  slide: Slide;
  shown: Slide | undefined;
  src: string | null;
  frameKey: string;
  width: number;
  height: number;
  scale: number;
  on: boolean;
  /** Whether the placed images can be dragged: the slide is selected and its own editor is open. */
  handles: boolean;
  images: StoredImage[];
  select: (index: number) => void;
  move: (index: number, image: number, x: number, y: number) => void;
}

/** One slide in the row. It draws again only when something it shows changes, not on every edit of another slide. */
export const SlideCard = memo(function SlideCard(props: SlideCardProps) {
  const { projectId, index, slide, shown, on, images, select, move } = props;
  const layout = label(slide.layout ?? "device-bottom");
  return (
    <div className={`card${on ? " selected" : ""}`} role="button" tabIndex={0} aria-pressed={on} aria-label={`Slide ${index + 1}, ${layout}`} onClick={() => select(index)} onKeyDown={pressed(() => select(index))}>
      <div className="stage-box">
        <Stage src={props.src} frameKey={props.frameKey} width={props.width} height={props.height} scale={props.scale} />
        {props.handles && slide.images?.length ? <PlacedHandles placed={slide.images} shown={shown?.images ?? []} images={images} projectId={projectId} onMove={(at, x, y) => move(index, at, x, y)} /> : null}
      </div>
      <div className="caption">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <span>{layout}</span>
      </div>
    </div>
  );
});

/**
 * A store asset or banner in its row. Like a slide it is a card that acts as a button, rather than a button, since
 * a button may not hold the preview's iframe.
 */
export const CreativeCard = memo(function CreativeCard(props: {
  where: PlacementId;
  name: string;
  /** What the caption says: the kind of asset on the left, its shape and size on the right. */
  title: string;
  size: string;
  on: boolean;
  select: (where: PlacementId) => void;
  src: string | null;
  frameKey: string;
  width: number;
  height: number;
  scale: number;
}) {
  const { where, on, select } = props;
  return (
    <div className={`card${on ? " selected" : ""}`} role="button" tabIndex={0} aria-pressed={on} aria-label={props.name} onClick={() => select(where)} onKeyDown={pressed(() => select(where))}>
      <Stage src={props.src} frameKey={props.frameKey} width={props.width} height={props.height} scale={props.scale} />
      <div className="caption">
        <span>{props.title}</span>
        <span>{props.size}</span>
      </div>
    </div>
  );
});
