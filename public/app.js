// Gallery and editor for an appShots server. Plain DOM, no build step: previews are iframes of the very
// pages the renderer screenshots, so what is on screen is what gets exported.

const PREVIEW_HEIGHT = 440;
const LOCALE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

const state = {
  meta: null,
  projects: [],
  /** { project, shots, outputs, defaultTargets }; `project` carries edits that may not be saved yet. */
  detail: null,
  /** What the server last accepted, as a string for comparing and as an object for preview keys. */
  saved: "",
  savedProject: null,
  selected: null,
  tab: "slide",
  target: null,
  locale: null,
  open: { style: false, json: false },
};

// ---------------------------------------------------------------- helpers

const $ = (selector) => document.querySelector(selector);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((child) => child != null && child !== false));
  return el;
}

function icon(path) {
  const holder = document.createElement("span");
  holder.innerHTML = `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg>`;
  return holder.firstChild;
}

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const label = (id) => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

const slugify = (value) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "shot";

async function api(method, route, body) {
  const init = { method, headers: {} };
  if (body instanceof Blob) {
    init.body = body;
    init.headers["content-type"] = "application/octet-stream";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  const response = await fetch(`/api${route}`, init);
  if (response.status === 401) {
    location.href = "/login";
    throw new Error("Signed out");
  }
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = (await response.json()).error ?? message;
    } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function toast(message, kind = "", ms = 4000) {
  const el = h("div", { class: `toast ${kind}` }, message);
  $("#toasts").append(el);
  setTimeout(() => el.remove(), ms);
}

let statusTimer = null;
function setStatus(text, isError = false) {
  const el = $("#status");
  clearTimeout(statusTimer);
  el.textContent = text;
  el.classList.toggle("error", isError);
  if (text && !isError && text !== "Saving…") statusTimer = setTimeout(() => (el.textContent = ""), 1500);
}

const button = (text, onclick, props = {}) => h("button", { class: "btn small", type: "button", onclick, ...props }, text);

function field(text, control, hint) {
  return h("label", { class: "field" }, h("span", { class: "label" }, text), control, hint && h("span", { class: "hint" }, hint));
}

function select(options, value, onchange) {
  const el = h("select", { onchange: () => onchange(el.value) }, options.map(([id, text]) => h("option", { value: id }, text)));
  el.value = value;
  return el;
}

function numberInput(value, onchange, { min, max, step, placeholder }) {
  const el = h("input", { type: "number", min, max, step, placeholder });
  if (value != null) el.value = value;
  el.addEventListener("input", () => {
    const number = el.value === "" ? NaN : Number(el.value);
    onchange(Number.isNaN(number) ? null : Math.min(max, Math.max(min, number)));
  });
  return el;
}

function copyBlock(text) {
  const copy = button("Copy", async () => {
    await navigator.clipboard.writeText(text);
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy"), 1200);
  });
  return h("div", { class: "copy" }, h("pre", null, text), copy);
}

function openDialog(...children) {
  const dialog = $("#dialog");
  dialog.replaceChildren(...children.flat().filter(Boolean));
  // The account and people dialogs redraw themselves while open.
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  return dialog;
}

// ---------------------------------------------------------------- localized text

function getText(value) {
  if (value == null) return "";
  return typeof value === "string" ? value : (value[state.locale] ?? "");
}

/** A plain string serves every language; it only becomes a per-language map once a translation is typed. */
function setText(owner, key, text) {
  const primary = state.detail.project.locales[0];
  const current = owner[key];
  if (current == null || typeof current === "string") {
    if (state.locale === primary) {
      if (text) owner[key] = text;
      else delete owner[key];
      return;
    }
    const map = current ? { [primary]: current } : {};
    if (text) map[state.locale] = text;
    if (Object.keys(map).length) owner[key] = map;
    else delete owner[key];
    return;
  }
  if (text) current[state.locale] = text;
  else delete current[state.locale];
  if (Object.keys(current).length === 0) delete owner[key];
}

function textInput(owner, key, { rows, placeholder } = {}) {
  const el = rows ? h("textarea", { rows }) : h("input", { type: "text" });
  const value = owner[key];
  const fallback = value && typeof value === "object" ? (value[state.detail.project.locales[0]] ?? "") : "";
  el.value = getText(value);
  el.placeholder = fallback || placeholder || "";
  el.addEventListener("input", () => {
    setText(owner, key, el.value);
    edited();
  });
  return el;
}

// ---------------------------------------------------------------- saving

const snapshot = (project) => JSON.stringify({ name: project.name, locales: project.locales, theme: project.theme, slides: project.slides });

let saveTimer = null;
let inflight = Promise.resolve();

/** Call after changing state.detail.project. `structure` also rebuilds the panels (slides added, fields appearing). */
function edited(structure = false) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, structure ? 0 : 350);
  setStatus("Saving…");
  if (structure) {
    renderHead();
    renderShots();
    renderSlides();
    renderEditor();
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  inflight = inflight.then(async () => {
    const detail = state.detail;
    if (!detail) return;
    const body = snapshot(detail.project);
    if (body === state.saved) return setStatus("");
    try {
      const fresh = await api("PUT", `/projects/${detail.project.id}`, JSON.parse(body));
      if (state.detail !== detail) return;
      state.saved = body;
      state.savedProject = JSON.parse(body);
      detail.project.updatedAt = fresh.project.updatedAt;
      Object.assign(detail, { shots: fresh.shots, outputs: fresh.outputs, defaultTargets: fresh.defaultTargets });
      const entry = state.projects.find((p) => p.id === detail.project.id);
      if (entry && entry.name !== detail.project.name) {
        entry.name = detail.project.name;
        renderBar();
      }
      setStatus("Saved");
      renderSlides();
    } catch (error) {
      setStatus(`Not saved: ${error.message}`, true);
    }
  });
  return inflight;
}

// ---------------------------------------------------------------- routing

function navigate(id) {
  const hash = `#/${id}`;
  if (location.hash === hash) void route();
  else location.hash = hash;
}

async function route() {
  await save();
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  if (!id) {
    if (state.projects[0]) return location.replace(`#/${state.projects[0].id}`);
    state.detail = null;
    return renderAll();
  }
  if (state.detail?.project.id === id) return;
  try {
    const detail = await api("GET", `/projects/${id}`);
    if (!state.projects.some((p) => p.id === id)) state.projects = await api("GET", "/projects");
    state.detail = detail;
    state.saved = snapshot(detail.project);
    state.savedProject = JSON.parse(state.saved);
    state.selected = detail.project.slides.length ? 0 : null;
    state.tab = "slide";
    state.target = detail.defaultTargets[0];
    state.locale = detail.project.locales[0];
    $("#slides").replaceChildren();
    renderAll();
  } catch (error) {
    toast(error.message, "error");
    state.detail = null;
    history.replaceState(null, "", "#/");
    renderAll();
  }
}

/** Re-reads screenshots and renders from the server without touching the project being edited. */
async function refresh() {
  await save();
  const detail = state.detail;
  const fresh = await api("GET", `/projects/${detail.project.id}`);
  if (state.detail !== detail) return;
  const first = detail.shots.length === 0;
  Object.assign(detail, { shots: fresh.shots, outputs: fresh.outputs, defaultTargets: fresh.defaultTargets });
  if (first) state.target = fresh.defaultTargets[0];
  renderAll();
}

const shotsKey = (shots) => shots.map((shot) => `${shot.file}:${shot.version}`).join(",");
const isDirty = () => saveTimer !== null || snapshot(state.detail.project) !== state.saved;

/** Picks up changes made elsewhere while the gallery is open: Claude editing through MCP, or the CLI uploading a capture. */
async function sync() {
  const detail = state.detail;
  if (document.visibilityState !== "visible" || (detail && isDirty())) return;
  let fresh;
  try {
    const projects = await api("GET", "/projects");
    const listing = (list) => list.map((p) => `${p.id}:${p.name}`).join(",");
    if (listing(projects) !== listing(state.projects)) {
      state.projects = projects;
      // A project created elsewhere while the empty state is showing opens by itself.
      if (!detail) return void route();
      renderBar();
    }
    if (!detail) return;
    fresh = await api("GET", `/projects/${detail.project.id}`);
  } catch {
    return;
  }
  if (state.detail !== detail || isDirty()) return;
  const projectChanged = fresh.project.updatedAt !== detail.project.updatedAt;
  if (!projectChanged && shotsKey(fresh.shots) === shotsKey(detail.shots)) return;

  Object.assign(detail, { shots: fresh.shots, outputs: fresh.outputs, defaultTargets: fresh.defaultTargets });
  if (projectChanged) {
    const { slides, locales } = fresh.project;
    detail.project = fresh.project;
    state.saved = snapshot(fresh.project);
    state.savedProject = JSON.parse(state.saved);
    state.selected = slides.length === 0 ? null : Math.min(state.selected ?? 0, slides.length - 1);
    if (!locales.includes(state.locale)) state.locale = locales[0];
    const entry = state.projects.find((p) => p.id === fresh.project.id);
    if (entry) entry.name = fresh.project.name;
  }
  renderBar();
  renderHead();
  renderShots();
  renderSlides();
  // The editor holds references into the old project, so it has to follow; otherwise leave the cursor alone.
  if (projectChanged || !$("#panel").contains(document.activeElement)) renderEditor();
}

// ---------------------------------------------------------------- sidebar, top bar and page head

const PAGE_ICON = "M4.2 1.8h4.9l2.7 2.7v9.7H4.2zM9 2v2.7h2.7";

function renderBar() {
  const detail = state.detail;
  const { account, authEnabled } = state.meta;
  const name = account ? account.name || account.email : "appShots";
  $("#avatar").textContent = name[0].toUpperCase();
  $("#who-name").textContent = name;
  $("#who-sub").textContent = account ? account.email : authEnabled ? "Owner" : "";
  $("#logout").hidden = !authEnabled;
  $("#account").hidden = !account;
  $("#people").hidden = !authEnabled || Boolean(account);

  $("#project-list").replaceChildren(
    ...state.projects.map((p) => {
      const on = p.id === detail?.project.id;
      return h("a", { class: `nav-item${on ? " on" : ""}`, href: `#/${p.id}`, "aria-current": on ? "page" : null }, icon(PAGE_ICON), h("span", { class: "nav-text" }, p.name));
    }),
  );
  $("#crumb").textContent = detail ? detail.project.name : "";
  document.title = detail ? `${detail.project.name} · appShots` : "appShots";

  for (const id of ["target-select", "locale-select", "export"]) $(`#${id}`).hidden = !detail;
  if (!detail) return;

  const targets = $("#target-select");
  targets.replaceChildren(...Object.entries(state.meta.targets).map(([id, t]) => h("option", { value: id }, `${t.label} · ${t.width}×${t.height}`)));
  targets.value = state.target;

  const locales = $("#locale-select");
  locales.replaceChildren(...detail.project.locales.map((code) => h("option", { value: code }, code)));
  locales.value = state.locale;
  locales.hidden = detail.project.locales.length < 2;
}

function renderHead() {
  const { project, shots } = state.detail;
  const title = $("#title");
  // Leave the name alone while it is being typed.
  if (document.activeElement !== title) title.value = project.name;
  $("#page-meta").textContent = [plural(project.slides.length, "slide"), plural(shots.length, "screenshot"), project.locales.join(", ")].join(" · ");
}

function renderAll() {
  renderBar();
  const open = Boolean(state.detail);
  $("#empty").hidden = open;
  for (const id of ["page-head", "shots-section", "slides-section", "panel"]) $(`#${id}`).hidden = !open;
  if (!open) {
    $("#empty").replaceChildren(
      h("h1", null, "App Store screenshots, on tap"),
      h("p", null, "Create a project here, or let Claude build one through the MCP endpoint. Either way the result shows up in this gallery."),
      h("div", { class: "actions" }, button("New project", newProjectDialog, { class: "btn primary" }), button("Connect Claude and the CLI", () => connectDialog(), { class: "btn" })),
    );
    return;
  }
  renderHead();
  renderShots();
  renderSlides();
  renderEditor();
}

// ---------------------------------------------------------------- raw screenshots

function renderShots() {
  const { project, shots } = state.detail;
  const used = new Set(project.slides.flatMap((slide) => [slide.screenshot, slide.screenshot2]));
  $("#shots-hint").textContent = shots.length ? "Click one to put it in the selected slide." : "";

  const thumbs = shots.map((shot) =>
    h(
      "div",
      {
        class: `shot${used.has(shot.name) ? " used" : ""}`,
        role: "button",
        tabIndex: 0,
        title: `${shot.name} · ${shot.width}×${shot.height}`,
        onclick: () => assignShot(shot),
        onkeydown: (event) => event.key === "Enter" && event.target === event.currentTarget && assignShot(shot),
      },
      h("img", { src: `/files/${project.id}/shots/${shot.file}?v=${shot.version}`, alt: "", loading: "lazy" }),
      shot.device === "ipad" && h("span", { class: "tag" }, "iPad"),
      h(
        "button",
        {
          class: "remove",
          type: "button",
          title: "Delete screenshot",
          "aria-label": `Delete ${shot.name}`,
          onclick: (event) => {
            event.stopPropagation();
            void removeShot(shot);
          },
        },
        "×",
      ),
      h("span", { class: "name" }, shot.name),
    ),
  );
  const dropzone = h(
    "div",
    { class: "dropzone" },
    shots.length
      ? h("div", null, "Drop more screenshots here")
      : h("div", null, "Drop screenshots here, or capture one from your Mac:", h("br"), h("code", null, `appshots capture --name home --project ${project.id}`)),
  );
  $("#shots").replaceChildren(...thumbs, dropzone);
}

function assignShot(shot) {
  const slide = state.selected == null ? null : state.detail.project.slides[state.selected];
  if (!slide) return toast("Select a slide first, then click a screenshot to use it there.");
  slide.screenshot = shot.name;
  edited(true);
}

async function removeShot(shot) {
  if (!confirm(`Delete the screenshot "${shot.name}"?`)) return;
  try {
    await api("DELETE", `/projects/${state.detail.project.id}/shots/${shot.file}`);
    await refresh();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function uploadFiles(files) {
  const detail = state.detail;
  if (!detail) return toast("Create a project first.");
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (images.length === 0) return toast("Those are not images.", "error");
  setStatus(`Uploading ${images.length}…`);
  const uploaded = [];
  for (const file of images) {
    try {
      uploaded.push(await api("PUT", `/projects/${detail.project.id}/shots/${slugify(file.name.replace(/\.[^.]+$/, ""))}`, file));
    } catch (error) {
      toast(`${file.name}: ${error.message}`, "error");
    }
  }
  if (state.detail !== detail) return;
  // Fresh uploads fill slides that are still waiting for a screenshot, so a new project comes alive on the first drop.
  const used = new Set(detail.project.slides.flatMap((slide) => [slide.screenshot, slide.screenshot2]));
  for (const shot of uploaded) {
    if (used.has(shot.name)) continue;
    const empty = detail.project.slides.find((slide) => !slide.screenshot);
    if (!empty) break;
    empty.screenshot = shot.name;
    used.add(shot.name);
  }
  setStatus("");
  await refresh();
}

// ---------------------------------------------------------------- slide previews

function previewKey(index) {
  const saved = state.savedProject;
  return JSON.stringify([saved.slides[index], saved.theme, saved.locales[0], state.target, state.locale, shotsKey(state.detail.shots)]);
}

/** Loads the new preview underneath and swaps once it has laid itself out, so edits never flash blank. */
function setFrame(stage, index, target, scale) {
  const key = previewKey(index);
  if (stage.dataset.key === key) return;
  stage.dataset.key = key;
  const query = new URLSearchParams({ target: state.target, locale: state.locale, t: Date.now() });
  const frame = h("iframe", { class: "incoming", src: `/render/${state.detail.project.id}/${index}?${query}`, tabIndex: -1, "aria-hidden": "true" });
  frame.style.cssText = `width:${target.width}px;height:${target.height}px;transform:scale(${scale})`;
  frame.addEventListener("load", () => {
    const started = performance.now();
    const reveal = () => {
      let ready = true;
      try {
        ready = frame.contentDocument?.body?.dataset.ready === "1";
      } catch {}
      if (!ready && performance.now() - started < 4000) return void setTimeout(reveal, 60);
      if (stage.dataset.key !== key) return frame.remove();
      frame.classList.remove("incoming");
      // The old preview stays underneath until the new one has faded in and been painted.
      for (const old of stage.querySelectorAll("iframe")) if (old !== frame) setTimeout(() => old.remove(), 400);
    };
    reveal();
  });
  stage.append(frame);
}

function renderSlides() {
  const { project } = state.detail;
  const target = state.meta.targets[state.target];
  const scale = PREVIEW_HEIGHT / target.height;
  const size = `width:${Math.round(target.width * scale)}px;height:${PREVIEW_HEIGHT}px`;
  const container = $("#slides");

  let add = container.querySelector(".card.add");
  if (!add) {
    add = h("button", { class: "card add", type: "button", onclick: addSlide }, h("div", { class: "stage" }, "+ Add slide"), h("div", { class: "caption" }, " "));
    container.append(add);
  }
  const cards = [...container.querySelectorAll(".card:not(.add)")];
  while (cards.length > project.slides.length) cards.pop().remove();
  while (cards.length < project.slides.length) {
    const index = cards.length;
    const card = h("button", { class: "card", type: "button", onclick: () => selectSlide(index) }, h("div", { class: "stage" }), h("div", { class: "caption" }));
    container.insertBefore(card, add);
    cards.push(card);
  }
  add.hidden = project.slides.length >= 10;
  add.firstChild.style.cssText = size;

  cards.forEach((card, index) => {
    const slide = project.slides[index];
    const stage = card.firstChild;
    card.classList.toggle("selected", index === state.selected);
    card.setAttribute("aria-pressed", String(index === state.selected));
    card.setAttribute("aria-label", `Slide ${index + 1}, ${label(slide.layout ?? "device-bottom")}`);
    stage.style.cssText = size;
    card.lastChild.replaceChildren(h("span", null, String(index + 1).padStart(2, "0")), h("span", null, label(slide.layout ?? "device-bottom")));
    // A slide added a moment ago has no page on the server until the save lands.
    if (index < state.savedProject.slides.length) setFrame(stage, index, target, scale);
  });
}

function selectSlide(index) {
  state.selected = index;
  state.tab = "slide";
  renderSlides();
  renderEditor();
}

function addSlide() {
  const { project, shots } = state.detail;
  const used = new Set(project.slides.map((slide) => slide.screenshot));
  const unused = shots.find((shot) => !used.has(shot.name));
  const at = state.selected == null ? project.slides.length : state.selected + 1;
  project.slides.splice(at, 0, { layout: "device-bottom", headline: "Your headline", ...(unused ? { screenshot: unused.name } : {}) });
  state.selected = at;
  state.tab = "slide";
  edited(true);
}

function moveSlide(delta) {
  const { slides } = state.detail.project;
  const from = state.selected;
  const to = from + delta;
  if (to < 0 || to >= slides.length) return;
  [slides[from], slides[to]] = [slides[to], slides[from]];
  state.selected = to;
  edited(true);
}

function duplicateSlide() {
  const { slides } = state.detail.project;
  slides.splice(state.selected + 1, 0, structuredClone(slides[state.selected]));
  state.selected += 1;
  edited(true);
}

function deleteSlide() {
  const { slides } = state.detail.project;
  if (!confirm(`Delete slide ${state.selected + 1}?`)) return;
  slides.splice(state.selected, 1);
  state.selected = slides.length ? Math.min(state.selected, slides.length - 1) : null;
  edited(true);
}

// ---------------------------------------------------------------- editor panel

function renderEditor() {
  const { project } = state.detail;
  const slide = state.selected == null ? null : project.slides[state.selected];
  const tab = (id, text) =>
    h(
      "button",
      {
        class: `tab${state.tab === id ? " on" : ""}`,
        type: "button",
        onclick: () => {
          state.tab = id;
          renderEditor();
        },
      },
      text,
    );
  const body =
    state.tab === "project"
      ? projectEditor(project)
      : slide
        ? slideEditor(slide, state.selected)
        : h("p", { class: "muted pad" }, "Select a slide to edit it, or add one.");
  $("#panel").replaceChildren(h("div", { class: "tabs" }, tab("slide", slide ? `Slide ${state.selected + 1}` : "Slide"), tab("project", "Project")), body);
}

function backgroundField(owner, inheritLabel) {
  const current = owner.background;
  const custom = current != null && typeof current === "object";
  const isHex = typeof current === "string" && current.startsWith("#");
  const options = [["", inheritLabel], ...state.meta.backgrounds.map((id) => [id, id === "auto" ? "Auto (from the screenshot)" : label(id)]), ["#", "Custom colour…"]];
  if (custom) options.push(["{}", "Custom gradient (see JSON)"]);
  const color = h("input", { type: "color", hidden: !isHex, "aria-label": "Background colour" });
  color.value = isHex && current.length === 7 ? current : "#4f46e5";
  color.addEventListener("input", () => {
    owner.background = color.value.toUpperCase();
    edited();
  });
  const picker = select(options, current == null ? "" : custom ? "{}" : isHex ? "#" : current, (value) => {
    if (value === "{}") return;
    if (value === "") delete owner.background;
    else owner.background = value === "#" ? color.value.toUpperCase() : value;
    color.hidden = value !== "#";
    edited();
  });
  return field("Background", h("div", { class: "row" }, picker, color));
}

function colorField(text, owner, key) {
  const input = h("input", { type: "color", "aria-label": text });
  const value = h("span", { class: "swatch-value" });
  const show = () => {
    value.textContent = owner[key] ?? "Auto";
    if (owner[key]?.length === 7) input.value = owner[key];
  };
  input.addEventListener("input", () => {
    owner[key] = input.value.toUpperCase();
    show();
    edited();
  });
  const reset = button("Auto", () => {
    delete owner[key];
    show();
    edited();
  });
  show();
  return field(text, h("div", { class: "row" }, input, value, reset));
}

/** Style controls shared by the project theme and per-slide overrides. */
function styleFields(owner, inherits) {
  const base = inherits ? "Project default" : "Default";
  const set = (key, value) => {
    if (value === "" || value == null) delete owner[key];
    else owner[key] = value;
    edited();
  };
  const setDevice = (key, value) => {
    const device = { ...owner.device };
    if (value === "" || value == null) delete device[key];
    else device[key] = value;
    if (Object.keys(device).length) owner.device = device;
    else delete owner.device;
    edited();
  };
  const device = owner.device ?? {};
  const ids = (list) => list.map((id) => [id, label(id)]);
  return [
    backgroundField(owner, inherits ? "Project default" : "Default (midnight)"),
    h(
      "div",
      { class: "cols" },
      field("Font", select([["", base], ...ids(state.meta.fonts)], owner.font ?? "", (v) => set("font", v))),
      field("Alignment", select([["", base], ["center", "Centre"], ["left", "Left"]], owner.align ?? "", (v) => set("align", v))),
    ),
    h("div", { class: "cols" }, colorField("Accent colour", owner, "accentColor"), colorField("Text colour", owner, "textColor")),
    h(
      "div",
      { class: "cols" },
      field("Device colour", select([["", base], ...ids(state.meta.deviceColors)], device.color ?? "", (v) => setDevice("color", v))),
      field(
        "Frame",
        select([["", base], ["auto", "Match screenshot"], ["iphone", "iPhone"], ["ipad", "iPad"], ["none", "No frame"]], device.frame ?? "", (v) => setDevice("frame", v)),
      ),
    ),
    h(
      "div",
      { class: "cols" },
      field("Device size", numberInput(device.scale, (v) => setDevice("scale", v), { min: 0.4, max: 1.6, step: 0.05, placeholder: "1" })),
      field("Tilt in degrees", numberInput(device.rotate, (v) => setDevice("rotate", v), { min: -45, max: 45, step: 1, placeholder: "0" })),
    ),
    h(
      "div",
      { class: "cols" },
      field("Headline size", numberInput(owner.textScale, (v) => set("textScale", v), { min: 0.5, max: 1.5, step: 0.05, placeholder: "1" })),
      field("Shadow", select([["", base], ["none", "None"], ["soft", "Soft"], ["strong", "Strong"]], device.shadow ?? "", (v) => setDevice("shadow", v))),
    ),
  ];
}

function section(id, title, ...children) {
  const details = h("details", { open: state.open[id], ontoggle: () => (state.open[id] = details.open) }, h("summary", null, title), h("div", { class: "stack" }, children));
  return details;
}

function badgesEditor(slide) {
  const badges = slide.badges ?? [];
  const ids = (list) => list.map((id) => [id, label(id)]);
  const blocks = badges.map((badge, index) =>
    h(
      "div",
      { class: "badge-edit" },
      h(
        "div",
        { class: "top" },
        select(ids(Object.keys(state.meta.badgeTypes)), badge.type ?? "laurel", (value) => {
          badge.type = value;
          edited();
        }),
        select([["", "No icon"], ...ids(state.meta.icons)], badge.icon ?? "", (value) => {
          if (value) badge.icon = value;
          else delete badge.icon;
          edited();
        }),
        numberInput(
          badge.stars,
          (value) => {
            if (value == null) delete badge.stars;
            else badge.stars = value;
            edited();
          },
          { min: 0, max: 5, step: 0.1, placeholder: "★" },
        ),
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            title: "Remove badge",
            "aria-label": "Remove badge",
            onclick: () => {
              badges.splice(index, 1);
              if (badges.length === 0) delete slide.badges;
              edited(true);
            },
          },
          "×",
        ),
      ),
      textInput(badge, "title", { placeholder: "Big line, e.g. 4.9" }),
      textInput(badge, "subtitle", { placeholder: "Small line, e.g. App Store rating" }),
    ),
  );
  const add = button("Add badge", () => {
    slide.badges = [...badges, { type: "laurel" }];
    edited(true);
  });
  return [
    h("div", { class: "group-head" }, h("span", { class: "label" }, "Badges"), h("span", { class: "hint" }, "Real figures only; App Review rejects invented ones."), h("span", { class: "spacer" })),
    ...blocks,
    h(
      "div",
      { class: "row" },
      badges.length < 4 && add,
      badges.length > 0 &&
        select([["", "Position: by layout"], ["top", "Above the headline"], ["bottom", "Below the copy"]], slide.badgePosition ?? "", (value) => {
          if (value) slide.badgePosition = value;
          else delete slide.badgePosition;
          edited();
        }),
    ),
  ];
}

function slideEditor(slide, index) {
  const { project, shots } = state.detail;
  const names = [...new Set(shots.map((shot) => shot.name))];
  const shotOptions = (current) => [["", "None"], ...names.map((name) => [name, name]), ...(current && !names.includes(current) ? [[current, `${current} (not uploaded)`]] : [])];
  const setShot = (key) => (value) => {
    if (value) slide[key] = value;
    else delete slide[key];
    edited(true);
  };
  const layout = slide.layout ?? "device-bottom";
  const query = new URLSearchParams({ target: state.target, locale: state.locale });

  const json = h("textarea", { class: "code", rows: 14, spellcheck: false });
  json.value = JSON.stringify(slide, null, 2);
  const jsonError = h("div", { class: "inline-error", hidden: true });
  const applyJson = () => {
    try {
      const parsed = JSON.parse(json.value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
      project.slides[index] = parsed;
      edited(true);
    } catch (error) {
      jsonError.textContent = error.message;
      jsonError.hidden = false;
    }
  };

  return h(
    "div",
    { class: "form" },
    h(
      "div",
      { class: "actions" },
      button("←", () => moveSlide(-1), { disabled: index === 0, title: "Move earlier", "aria-label": "Move earlier" }),
      button("→", () => moveSlide(1), { disabled: index === project.slides.length - 1, title: "Move later", "aria-label": "Move later" }),
      button("Duplicate", duplicateSlide, { disabled: project.slides.length >= 10 }),
      button("Delete", deleteSlide, { class: "btn small danger" }),
      h("span", { class: "spacer" }),
      h("a", { class: "btn small quiet", href: `/render/${project.id}/${index}?${query}`, target: "_blank", rel: "noopener" }, "Full size ↗"),
    ),
    field(
      "Layout",
      select(
        Object.keys(state.meta.layouts).map((id) => [id, label(id)]),
        layout,
        (value) => {
          slide.layout = value;
          edited(true);
        },
      ),
      state.meta.layouts[layout],
    ),
    h(
      "div",
      { class: layout === "duo" ? "cols" : "" },
      field("Screenshot", select(shotOptions(slide.screenshot), slide.screenshot ?? "", setShot("screenshot"))),
      layout === "duo" && field("Behind it", select(shotOptions(slide.screenshot2), slide.screenshot2 ?? "", setShot("screenshot2"))),
    ),
    field("Eyebrow", textInput(slide, "eyebrow", { placeholder: "Small line above the headline" })),
    field("Headline", textInput(slide, "headline", { rows: 2 }), "Wrap words in *asterisks* to tint them. Enter starts a new line."),
    field("Subheadline", textInput(slide, "subheadline", { rows: 2 })),
    ...badgesEditor(slide),
    section("style", "Style for this slide", ...styleFields(slide, true)),
    section("json", "JSON", h("span", { class: "hint" }, "Everything Claude can set on this slide, including custom gradients and device offsets."), json, jsonError, h("div", { class: "actions" }, button("Apply", applyJson))),
  );
}

function projectEditor(project) {
  const locales = h("input", { type: "text", value: project.locales.join(", "), spellcheck: false });
  locales.addEventListener("change", () => {
    const list = [...new Set(locales.value.split(/[\s,]+/).filter(Boolean))];
    if (list.length === 0 || list.some((code) => !LOCALE.test(code))) {
      toast("Languages are codes like en-US or de-DE, separated by commas.", "error");
      locales.value = project.locales.join(", ");
      return;
    }
    project.locales = list;
    if (!list.includes(state.locale)) state.locale = list[0];
    renderBar();
    edited(true);
  });
  return h(
    "div",
    { class: "form" },
    field("Languages", locales, "The first is the fallback. Pick a language in the top bar, then type its translations into the slide fields."),
    h("div", { class: "group-head" }, h("span", { class: "label" }, "Theme"), h("span", { class: "hint" }, "Used by every slide that does not override it.")),
    ...styleFields(project.theme, false),
    h("details", null, h("summary", null, "Delete"), h("div", { class: "stack" }, h("div", null, button("Delete this project", deleteProject, { class: "btn small danger" })))),
  );
}

// ---------------------------------------------------------------- project actions

function parseLocales(value) {
  const list = [...new Set(value.split(/[\s,]+/).filter(Boolean))];
  if (list.length === 0 || list.some((code) => !LOCALE.test(code))) throw new Error("Languages are codes like en-US or de-DE, separated by commas.");
  return list;
}

function newProjectDialog() {
  const name = h("input", { type: "text", required: true, maxLength: 80, placeholder: "My App" });
  const locales = h("input", { type: "text", value: "en-US", spellcheck: false });
  const error = h("div", { class: "inline-error", hidden: true });
  const form = h(
    "form",
    {
      onsubmit: async (event) => {
        event.preventDefault();
        try {
          const project = await api("POST", "/projects", {
            name: name.value.trim(),
            locales: parseLocales(locales.value),
            slides: [{ layout: "device-bottom", headline: "Say what your app does", subheadline: "One short supporting line" }],
          });
          state.projects = await api("GET", "/projects");
          dialog.close();
          navigate(project.id);
        } catch (failure) {
          error.textContent = failure.message;
          error.hidden = false;
        }
      },
    },
    field("Name", name),
    field("Languages", locales, "Store locales, comma-separated. You can add more later."),
    error,
    h("div", { class: "foot" }, button("Cancel", () => dialog.close(), { class: "btn" }), h("button", { class: "btn primary", type: "submit" }, "Create")),
  );
  const dialog = openDialog(h("h1", null, "New project"), form);
  name.focus();
}

async function deleteProject() {
  const { project } = state.detail;
  if (!confirm(`Delete "${project.name}" with its screenshots and renders? This cannot be undone.`)) return;
  try {
    clearTimeout(saveTimer);
    await inflight;
    await api("DELETE", `/projects/${project.id}`);
    state.detail = null;
    state.projects = await api("GET", "/projects");
    navigate(state.projects[0]?.id ?? "");
  } catch (error) {
    toast(error.message, "error");
  }
}

/** Runs a dialog action and reports a failure instead of leaving the click without an answer. */
const attempt = (work) => async () => {
  try {
    await work();
  } catch (error) {
    toast(error.message, "error");
  }
};

// Done takes the focus on open, so the first field does not light up before anyone has touched it.
const done = (dialog) => h("div", { class: "foot" }, button("Done", () => dialog.close(), { class: "btn primary", autofocus: true }));
const row = (title, sub, ...actions) => h("div", { class: "list-row" }, h("div", { class: "list-main" }, h("span", { class: "list-title" }, title), h("span", { class: "list-sub" }, sub)), actions);

/** `token` is a personal token created a moment ago; it can only be shown this once. */
function connectDialog(token) {
  const origin = location.origin;
  const project = state.detail?.project.id ?? "<project>";
  const { account, authEnabled } = state.meta;
  const bearer = token ?? (account ? "<your token>" : "$APPSHOTS_TOKEN");
  const header = authEnabled ? ` --header "Authorization: Bearer ${bearer}"` : "";
  const create = button("Create a token", attempt(async () => connectDialog((await api("POST", "/account/tokens", { name: "Claude and CLI" })).token)), { class: "btn primary" });
  const tokenStep = !authEnabled
    ? null
    : !account
      ? h("div", null, h("h3", null, "Your token"), h("p", null, "You run this server, so your token is the ", h("code", null, "APPSHOTS_TOKEN"), " it was deployed with."))
      : token
        ? h("div", null, h("h3", null, "Your token"), h("p", null, "Copy it now: it is shown this once. You can revoke it under Account."), copyBlock(token))
        : h("div", null, h("h3", null, "Your token"), h("p", null, "Claude and the CLI sign in with a personal token instead of your password."), h("div", null, create));
  const dialog = openDialog(
    h("h1", null, "Connect"),
    h(
      "div",
      { class: "steps" },
      tokenStep,
      h(
        "div",
        null,
        h("h3", null, "Claude"),
        h("p", null, "Add the MCP endpoint to Claude Code, then ask for screenshots in plain words: the copy, the look, the badges."),
        copyBlock(`claude mcp add --transport http appshots ${origin}/mcp${header}`),
      ),
      h(
        "div",
        null,
        h("h3", null, "Capture from your Mac"),
        h(
          "p",
          null,
          "The CLI grabs the running simulator, or a plugged-in iPhone or iPad with --device, and uploads the result. It is one file that needs Node and nothing else: run it as ",
          h("code", null, "node appshots.mjs"),
          ", or put it on your PATH as ",
          h("code", null, "appshots"),
          ".",
        ),
        h("div", null, h("a", { class: "btn small", href: "/cli/appshots.mjs", download: "appshots.mjs" }, "Download appshots.mjs")),
        copyBlock(`appshots login ${origin}`),
        copyBlock(`appshots capture --name home --project ${project}`),
      ),
      done($("#dialog")),
    ),
  );
  return dialog;
}

/** `fresh` is a token created a moment ago, shown once. */
async function accountDialog(fresh) {
  const { account } = state.meta;
  const tokens = await api("GET", "/account/tokens");
  const redraw = (created) => attempt(() => accountDialog(created))();

  const tokenName = h("input", { type: "text", maxLength: 60, placeholder: "Name it, e.g. MacBook", "aria-label": "Token name" });
  const tokenForm = h(
    "form",
    {
      class: "row",
      onsubmit: (event) => {
        event.preventDefault();
        void attempt(async () => redraw(await api("POST", "/account/tokens", { name: tokenName.value })))();
      },
    },
    tokenName,
    h("button", { class: "btn", type: "submit" }, "Create token"),
  );
  const tokenRows = tokens.map((token) =>
    row(
      token.name,
      `appshots_…${token.hint} · created ${day(token.createdAt)} · ${token.lastUsedAt ? `last used ${day(token.lastUsedAt)}` : "never used"}`,
      button(
        "Revoke",
        attempt(async () => {
          if (!confirm(`Revoke "${token.name}"? Whatever uses it stops working.`)) return;
          await api("DELETE", `/account/tokens/${token.id}`);
          redraw();
        }),
        { class: "btn small danger" },
      ),
    ),
  );

  const current = h("input", { type: "password", autocomplete: "current-password", required: true });
  const next = h("input", { type: "password", autocomplete: "new-password", required: true, minLength: 8 });
  const passwordForm = h(
    "form",
    {
      onsubmit: (event) => {
        event.preventDefault();
        void attempt(async () => {
          await api("POST", "/account/password", { current: current.value, password: next.value });
          event.target.reset();
          toast("Password changed. Your other browsers were signed out.");
        })();
      },
    },
    h("div", { class: "cols" }, field("Current password", current), field("New password", next)),
    h("div", null, h("button", { class: "btn", type: "submit" }, "Change password")),
  );

  const proof = account.password ? h("input", { type: "password", autocomplete: "current-password", required: true, placeholder: "Your password" }) : h("input", { type: "text", required: true, placeholder: account.email });
  const deleteForm = h(
    "form",
    {
      onsubmit: (event) => {
        event.preventDefault();
        void attempt(async () => {
          await api("DELETE", "/account", { confirm: proof.value });
          location.href = "/login";
        })();
      },
    },
    h("p", null, `This removes every project, screenshot and render of yours for good. ${account.password ? "Enter your password" : "Type your email address"} to confirm.`),
    h("div", { class: "row" }, proof, h("button", { class: "btn danger", type: "submit" }, "Delete account")),
  );

  const dialog = openDialog(
    h("h1", null, "Account"),
    h(
      "div",
      { class: "steps" },
      h("div", null, h("div", { class: "list" }, row(account.name, `${account.email} · signs in with ${account.google ? "Google" : "a password"}`))),
      h(
        "div",
        null,
        h("h3", null, "API tokens"),
        h("p", null, "Claude and the CLI use a token instead of your password. Each one reaches your projects only."),
        fresh && h("p", null, `Copy "${fresh.name}" now: it is shown this once.`),
        fresh && copyBlock(fresh.token),
        tokenRows.length > 0 && h("div", { class: "list" }, tokenRows),
        tokenForm,
      ),
      account.password && h("div", null, h("h3", null, "Password"), passwordForm),
      h("details", null, h("summary", null, "Delete account"), h("div", { class: "stack" }, deleteForm)),
      done($("#dialog")),
    ),
  );
  return dialog;
}

/** Owner only. `link` is an invite or reset link created a moment ago, shown once. */
async function peopleDialog(link) {
  const data = await api("GET", "/admin/people");
  const redraw = (created) => attempt(() => peopleDialog(created))();

  const mode = select(
    [
      ["invite", "Invite only"],
      ["open", "Anyone can sign up"],
    ],
    data.signup,
    (value) =>
      attempt(async () => {
        await api("PUT", "/admin/signup", { mode: value });
        redraw();
      })(),
  );
  const invite = button(
    "Create invite link",
    attempt(async () => {
      const created = await api("POST", "/admin/invites");
      redraw({ note: "Send this link to one person. It creates one account and expires in 14 days.", url: created.url });
    }),
    { class: "btn primary" },
  );
  const inviteRows = data.invites.map((entry) =>
    row(
      "Invite link, not used yet",
      `created ${day(entry.createdAt)} · expires ${day(entry.expiresAt)}`,
      button(
        "Revoke",
        attempt(async () => {
          await api("DELETE", `/admin/invites/${entry.id}`);
          redraw();
        }),
        { class: "btn small danger" },
      ),
    ),
  );
  const userRows = data.users.map((user) =>
    row(
      user.name,
      `${user.email} · ${user.signIn} · ${plural(user.projects, "project")} · joined ${day(user.createdAt)}`,
      user.signIn === "Password" &&
        button(
          "Reset link",
          attempt(async () => {
            const created = await api("POST", `/admin/users/${user.id}/reset`);
            redraw({ note: `Send this link to ${user.email} to set a new password. It works once and expires in 24 hours.`, url: created.url });
          }),
        ),
      button(
        "Remove",
        attempt(async () => {
          if (!confirm(`Remove ${user.email} with all of their projects? This cannot be undone.`)) return;
          await api("DELETE", `/admin/users/${user.id}`);
          redraw();
        }),
        { class: "btn small danger" },
      ),
    ),
  );

  const dialog = openDialog(
    h("h1", null, "People"),
    h(
      "div",
      { class: "steps" },
      link && h("div", null, h("p", null, link.note), copyBlock(link.url)),
      h(
        "div",
        null,
        h("h3", null, "Who can join"),
        h("p", null, "Everyone gets a private space: their own projects, screenshots and tokens. You sign in with the server token and are the only one who sees this page."),
        field(
          "New accounts",
          mode,
          data.signup === "open" ? "Anyone who can reach this address can create an account and render with it." : "Only people you send an invite link to can create an account.",
        ),
        h("span", { class: "hint" }, data.google ? "Sign in with Google is on." : "Sign in with Google is off. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server to offer it."),
      ),
      h("div", null, h("h3", null, "Invites"), inviteRows.length > 0 && h("div", { class: "list" }, inviteRows), h("div", null, invite)),
      h("div", null, h("h3", null, data.users.length > 0 ? plural(data.users.length, "account") : "Accounts"), userRows.length > 0 ? h("div", { class: "list" }, userRows) : h("p", null, "Nobody has joined yet.")),
      done($("#dialog")),
    ),
  );
  return dialog;
}

async function exportZip() {
  const detail = state.detail;
  const trigger = $("#export");
  trigger.disabled = true;
  trigger.textContent = "Rendering…";
  try {
    await save();
    const result = await api("POST", `/projects/${detail.project.id}/render`, {});
    detail.outputs = result.outputs;
    if (result.warnings.length) toast(result.warnings.join("\n"), "warn", 9000);
    toast(`Rendered ${result.files.length} screenshots. The download starts now.`);
    const link = h("a", { href: `/api/projects/${detail.project.id}/export.zip`, download: "" });
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    toast(error.message, "error", 8000);
  } finally {
    trigger.disabled = false;
    trigger.textContent = "Export ZIP";
  }
}

// ---------------------------------------------------------------- wiring

$("#title").addEventListener("input", (event) => {
  const name = event.target.value.trim();
  if (!name || !state.detail) return;
  state.detail.project.name = name;
  const entry = state.projects.find((p) => p.id === state.detail.project.id);
  if (entry) entry.name = name;
  renderBar();
  edited();
});
$("#title").addEventListener("keydown", (event) => event.key === "Enter" && event.target.blur());
$("#title").addEventListener("blur", (event) => {
  if (state.detail) event.target.value = state.detail.project.name;
});
$("#target-select").addEventListener("change", (event) => {
  state.target = event.target.value;
  renderSlides();
  renderEditor();
});
$("#locale-select").addEventListener("change", (event) => {
  state.locale = event.target.value;
  renderSlides();
  renderEditor();
});
$("#new-project").addEventListener("click", newProjectDialog);
$("#connect").addEventListener("click", () => connectDialog());
$("#account").addEventListener("click", attempt(() => accountDialog()));
$("#people").addEventListener("click", attempt(() => peopleDialog()));
$("#export").addEventListener("click", exportZip);
$("#file-input").addEventListener("change", (event) => {
  void uploadFiles([...event.target.files]);
  event.target.value = "";
});

let dragDepth = 0;
const carriesFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
window.addEventListener("dragenter", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  $("#drop-veil").hidden = !state.detail;
});
window.addEventListener("dragover", (event) => {
  if (carriesFiles(event)) event.preventDefault();
});
window.addEventListener("dragleave", (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $("#drop-veil").hidden = true;
});
window.addEventListener("drop", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $("#drop-veil").hidden = true;
  void uploadFiles([...event.dataTransfer.files]);
});
window.addEventListener("hashchange", () => void route());
document.addEventListener("visibilitychange", () => void sync());
setInterval(() => void sync(), 3000);
window.addEventListener("beforeunload", () => {
  if (saveTimer) void save();
});

try {
  state.meta = await api("GET", "/meta");
  state.projects = await api("GET", "/projects");
  await route();
} catch (error) {
  toast(`Could not load: ${error.message}`, "error", 10000);
}
