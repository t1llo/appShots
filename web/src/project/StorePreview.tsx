// How the App Store shows the first slides of a set: three side by side under the app's name in search results,
// and larger, in a row that scrolls, on the product page. Whether a headline reads at that size decides whether
// anyone opens the page, so the slides are drawn at the size a device draws them, one point to one CSS pixel, in
// light and dark. They are the same previews as on the slides page; the store around them is generic shapes.

import "./store.css";
import { type CSSProperties, type ReactNode, useState } from "react";
import type { DeviceKind, Slide, StoredImage, Target, Theme } from "../api.ts";
import { type Choice, Segmented } from "../ui/index.ts";
import { pressed, Stage, useWidth } from "./Previews.tsx";

type Look = "light" | "dark";
type Looks = Look | "both";
const LOOKS: Choice<Looks>[] = [
  { id: "both", text: "Both", title: "Light and dark side by side" },
  { id: "light", text: "Light" },
  { id: "dark", text: "Dark" },
];

/** How many slides the store shows at first. */
const SHOWN = 3;
const GUTTER = 24;

interface Form {
  /** The screen, in points. */
  width: number;
  height: number;
  /** Below this the screen is shrunk to fit rather than drawn narrower, which no device of its kind is. */
  least: number;
  margin: number;
  gap: number;
  /** The icon in a search result and on the product page. */
  icon: number;
  pageIcon: number;
  /** How wide a portrait screenshot is on the product page, as a share of the screen. */
  page: number;
  /** Search results side by side. */
  columns: number;
  /** What draws it, in a sentence: "a phone". */
  what: string;
}

const FORMS = {
  phone: { width: 393, height: 852, least: 320, margin: 20, gap: 8, icon: 62, pageIcon: 118, page: 0.59, columns: 1, what: "a phone" },
  tablet: { width: 820, height: 1180, least: 600, margin: 28, gap: 12, icon: 72, pageIcon: 128, page: 0.38, columns: 1, what: "a tablet" },
  desktop: { width: 980, height: 660, least: 720, margin: 24, gap: 14, icon: 64, pageIcon: 128, page: 0.45, columns: 2, what: "a store window" },
} satisfies Record<string, Form>;
type FormId = keyof typeof FORMS;
const FORM_OF: Record<DeviceKind, FormId> = { iphone: "phone", duo: "tablet", ipad: "tablet", mac: "desktop" };

const remembered = (): Looks => {
  try {
    const kept = localStorage.getItem("appshots.storeLook");
    return kept === "light" || kept === "dark" ? kept : "both";
  } catch {
    return "both";
  }
};

/** The screen's width for the room it has: as wide as the real one where that fits, narrower down to the least, then shrunk. */
function fit(form: Form, room: number): { width: number; zoom: number } {
  if (room <= 0 || room >= form.width) return { width: form.width, zoom: 1 };
  if (room >= form.least) return { width: Math.floor(room), zoom: 1 };
  return { width: form.least, zoom: room / form.least };
}

export interface StoreSlide {
  slide: Slide;
  /** The preview's page and what it is drawn from, as on the slides page. */
  src: string | null;
  frameKey: string;
}

export function StorePreview(props: {
  name: string;
  device: DeviceKind;
  deviceLabel: string;
  size: Target;
  slides: StoreSlide[];
  theme: Theme;
  icon: StoredImage | undefined;
  projectId: string;
  selected: number | null;
  select: (index: number) => void;
  /** The device and language switches, which the slides page has too. */
  controls: ReactNode;
}) {
  const { size, slides } = props;
  const [looks, setLooksState] = useState<Looks>(remembered);
  const setLooks = (next: Looks) => {
    setLooksState(next);
    try {
      localStorage.setItem("appshots.storeLook", next);
    } catch {}
  };
  const [room, area] = useWidth();

  const formId = FORM_OF[props.device];
  const form: Form = FORMS[formId];
  const shown: Look[] = looks === "both" ? ["light", "dark"] : [looks];
  // Two screens side by side where both fit at the least width of their kind, one under the other where not.
  const paired = shown.length === 2 && (room - GUTTER) / 2 >= form.least;
  const screen = fit(form, paired ? (room - GUTTER) / 2 : room);
  const landscape = size.width > size.height;
  const first = slides.slice(0, SHOWN);

  const scene = { ...props, form, formId, screen, landscape, slides: first };
  return (
    <div className="workspace store-view">
      <div className="toolbar">
        {props.controls}
        <span className="spacer" />
        <Segmented label="Appearance" choices={LOOKS} value={looks} onChange={setLooks} />
      </div>
      <div className="set-line">
        <span>
          <b>How the App Store shows the {props.deviceLabel} set</b>. The first {SHOWN} slides in search results and on the product page, at the size {form.what}{" "}
          {screen.width} points wide draws them{screen.zoom < 1 ? `, shrunk to ${Math.round(screen.zoom * 100)}% to fit` : ""}.
          {landscape ? " A landscape screenshot fills a search result on its own, so only the first one shows there." : ""}
        </span>
      </div>
      <div ref={area}>
        {slides.length === 0 ? (
          <div className="dropzone empty">Add a slide to see how the store shows it.</div>
        ) : (
          <>
            <section className="store-part">
              <h2>Search results</h2>
              <div className="store-row">
                {shown.map((look) => (
                  <Screen key={look} look={look} {...scene} label={`A search result, ${look}`}>
                    <SearchResults {...scene} />
                  </Screen>
                ))}
              </div>
            </section>
            <section className="store-part">
              <h2>Product page</h2>
              <div className="store-row">
                {shown.map((look) => (
                  <Screen key={look} look={look} {...scene} label={`The product page, ${look}`}>
                    <ProductPage {...scene} />
                  </Screen>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

type Scene = Parameters<typeof StorePreview>[0] & { form: Form; formId: FormId; screen: { width: number; zoom: number }; landscape: boolean };

/** One screen of the store, in light or dark. What surrounds the slides is hidden from a screen reader; the slides are buttons. */
function Screen({ look, form, formId, screen, label, children }: Scene & { look: Look; label: string; children: ReactNode }) {
  const height = Math.round((form.height * screen.width) / form.width);
  return (
    <figure className="store-figure">
      <div className={`store-screen ${look} ${formId}`} role="group" aria-label={label} style={{ width: screen.width, height, zoom: screen.zoom === 1 ? undefined : screen.zoom }}>
        {formId === "desktop" ? <div className="store-titlebar" aria-hidden="true" /> : <StatusBar />}
        <div className="store-scroll">{children}</div>
        {formId === "phone" ? <TabBar /> : null}
      </div>
      <figcaption className="caption">
        <span>{look === "light" ? "Light" : "Dark"}</span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- the two pages

function SearchResults(scene: Scene) {
  const { form, screen, landscape, slides, size } = scene;
  const column = (screen.width - 2 * form.margin - (form.columns - 1) * form.gap) / form.columns;
  const count = landscape ? 1 : SHOWN;
  const width = (column - (count - 1) * form.gap) / count;
  const height = (width * size.height) / size.width;
  return (
    <>
      <div className="store-search" style={{ marginInline: form.margin }} aria-hidden="true">
        <Glyph path={MAGNIFIER} />
        <span>{scene.name}</span>
      </div>
      <div className="store-results" style={{ gridTemplateColumns: `repeat(${form.columns}, 1fr)`, gap: `28px ${form.gap}px`, paddingInline: form.margin }}>
        <div className="store-result">
          <AppLine {...scene} iconSize={form.icon} />
          <div className="store-shots" style={{ gap: form.gap }}>
            {slides.slice(0, count).map((entry, index) => (
              <Shot key={index} {...scene} entry={entry} index={index} width={width} />
            ))}
          </div>
        </div>
        {/* Another app under it, or beside it, so the set is seen among others. */}
        <div className="store-result other" aria-hidden="true">
          <div className="store-app">
            <i className="store-icon blank" style={{ width: form.icon, height: form.icon, borderRadius: form.icon * 0.225 }} />
            <div className="store-app-text">
              <Bar width="54%" tall />
              <Bar width="72%" />
              <Bar width="36%" />
            </div>
            <i className="store-get blank" />
          </div>
          <div className="store-shots" style={{ gap: form.gap }}>
            {Array.from({ length: count }, (_, index) => (
              <i key={index} className="store-shot blank" style={{ width, height, borderRadius: radius(width) }} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ProductPage(scene: Scene) {
  const { form, screen, landscape, slides } = scene;
  const width = landscape && scene.formId !== "desktop" ? screen.width - 2 * form.margin - 24 : screen.width * form.page;
  return (
    <>
      <div className="store-nav" style={{ paddingInline: form.margin - 6 }} aria-hidden="true">
        <Glyph path={BACK} />
        <span>Search</span>
      </div>
      <div className="store-head" style={{ paddingInline: form.margin }} aria-hidden="true">
        <AppIcon icon={scene.icon} name={scene.name} theme={scene.theme} projectId={scene.projectId} size={form.pageIcon} />
        <div className="store-head-text">
          <b className="store-title">{scene.name}</b>
          <Bar width="64%" />
          <div className="store-head-actions">
            <span className="store-get solid">Get</span>
            <Glyph path={SHARE} />
          </div>
        </div>
      </div>
      <div className="store-facts" style={{ marginInline: form.margin }} aria-hidden="true">
        {Array.from({ length: form.columns === 2 ? 6 : 4 }, (_, index) => (
          <div key={index}>
            <Bar width="60%" />
            <Bar width="44%" tall />
            <Bar width="70%" />
          </div>
        ))}
      </div>
      <div className="store-carousel" style={{ gap: form.gap + 4, paddingInline: form.margin, scrollPaddingInline: form.margin }}>
        {slides.map((entry, index) => (
          <Shot key={index} {...scene} entry={entry} index={index} width={width} />
        ))}
      </div>
      <div className="store-device-line" style={{ paddingInline: form.margin }} aria-hidden="true">
        <Glyph path={scene.formId === "desktop" ? LAPTOP : scene.formId === "tablet" ? TABLET : PHONE} />
        <span>{scene.deviceLabel}</span>
      </div>
      <div className="store-text" style={{ paddingInline: form.margin }} aria-hidden="true">
        <Bar width="92%" />
        <Bar width="86%" />
        <Bar width="58%" />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- parts

/** The corners the store rounds a screenshot with, which grow with it. */
const radius = (width: number) => Math.max(4, Math.round(width * 0.075));

function Shot({ entry, index, width, size, selected, select }: Scene & { entry: StoreSlide; index: number; width: number }) {
  const style = { "--radius": `${radius(width)}px` } as CSSProperties;
  const on = selected === index;
  // Picking a slide here opens it in the editor beside, as a card on the slides page does.
  return (
    <div className={`store-shot${on ? " selected" : ""}`} style={style} role="button" tabIndex={0} aria-pressed={on} aria-label={`Slide ${index + 1}`} title={`Slide ${index + 1}. Click to edit it.`} onClick={() => select(index)} onKeyDown={pressed(() => select(index))}>
      <Stage src={entry.src} frameKey={entry.frameKey} width={size.width} height={size.height} scale={width / size.width} />
    </div>
  );
}

/** The app's line in a search result: its icon, name, a line under it, a rating and the button. */
function AppLine(scene: Scene & { iconSize: number }) {
  return (
    <div className="store-app" aria-hidden="true">
      <AppIcon icon={scene.icon} name={scene.name} theme={scene.theme} projectId={scene.projectId} size={scene.iconSize} />
      <div className="store-app-text">
        <b>{scene.name}</b>
        <Bar width="70%" />
        <span className="store-stars">
          {Array.from({ length: 5 }, (_, index) => (
            <Glyph key={index} path={STAR} filled />
          ))}
          <Bar width="28px" />
        </span>
      </div>
      <span className="store-get">Get</span>
    </div>
  );
}

/** The project's icon where it has an image that is one, or its initial on its accent colour. */
function AppIcon({ icon, name, theme, projectId, size }: { icon: StoredImage | undefined; name: string; theme: Theme; projectId: string; size: number }) {
  const shape = { width: size, height: size, borderRadius: size * 0.225 };
  if (icon) return <img className="store-icon" src={`/files/${projectId}/images/${icon.file}?v=${icon.version}`} alt="" style={shape} />;
  return (
    <span className="store-icon" aria-hidden="true" style={{ ...shape, background: theme.accentColor ?? "var(--accent)", fontSize: size * 0.46 }}>
      {name.trim()[0]?.toUpperCase() ?? ""}
    </span>
  );
}

/** A line of text the project does not have, such as a subtitle or a developer's name, as a grey bar. */
function Bar({ width, tall }: { width: string; tall?: boolean }) {
  return <i className={`store-bar${tall ? " tall" : ""}`} style={{ width }} />;
}

function StatusBar() {
  return (
    <div className="store-status" aria-hidden="true">
      <span>9:41</span>
      <span className="store-status-icons">
        <i />
        <i />
        <i className="battery" />
      </span>
    </div>
  );
}

function TabBar() {
  return (
    <div className="store-tabs" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index === 4 ? "on" : ""}>
          <i />
          <Bar width="60%" />
        </span>
      ))}
    </div>
  );
}

const MAGNIFIER = "M7 2.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zM10.2 10.2l3.4 3.4";
const BACK = "M10 3 5 8l5 5";
const SHARE = "M8 1.8v8M5.2 4.6 8 1.8l2.8 2.8M4.6 7H3.4v7h9.2V7h-1.2";
const STAR = "M8 1.6l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.3l-4 2.3 1-4.4-3.4-3 4.5-.5z";
const PHONE = "M5 1.6h6a1 1 0 0 1 1 1v10.8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2.6a1 1 0 0 1 1-1zM7 12.6h2";
const TABLET = "M3.4 1.6h9.2a1 1 0 0 1 1 1v10.8a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V2.6a1 1 0 0 1 1-1zM7 12.6h2";
const LAPTOP = "M3 3.4h10v7H3zM1.4 12.6h13.2";

function Glyph({ path, filled }: { path: string; filled?: boolean }) {
  return (
    <svg className={`store-glyph${filled ? " filled" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
