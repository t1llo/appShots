// The public home page is plain HTML (web/home.html). This adds what depends on the visit or needs a script:
// why a sign-in just failed, who may sign in or is signed in already, and the motion.

import { setAppearance, shownAppearance } from "./theme.ts";

document.getElementById("appearance")!.addEventListener("click", () => setAppearance(shownAppearance() === "dark" ? "light" : "dark"));

const ERRORS: Record<string, string> = {
  not_allowed: "That Google account is not on the list for this server yet. Ask the person who runs it to add your address.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "That sign-in expired before it finished. Try again.",
  google_unverified: "Google has not verified that email address, so it cannot be used here.",
  google_failed: "Google sign-in did not work. Try again in a moment.",
  too_many: "Too many sign-in attempts. Try again in a few minutes.",
};

const code = new URLSearchParams(location.search).get("error");
if (code) {
  const box = document.getElementById("signin-error")!;
  box.textContent = ERRORS[code] ?? "Sign-in did not work. Try again.";
  box.hidden = false;
  // A reload should not show the message again.
  history.replaceState(null, "", location.pathname);
}

fetch("/auth/config")
  .then((response) => response.json())
  .then((config: { signIn: boolean; signup: "list" | "open"; account: { name: string } | null }) => {
    // The line under the setup command says where the token comes from. Which one fits depends on the visit.
    const show = (when: string) => {
      for (const note of document.querySelectorAll<HTMLElement>("[data-when]")) note.hidden = note.dataset.when !== when;
    };
    if (!config.signIn) {
      // Without sign-in there is no token, and the setup line works as it stands.
      for (const part of document.querySelectorAll("[data-token]")) part.remove();
      show("none");
    } else if (config.account) {
      // Somebody who is signed in and looks at this page is told so, and where their token is.
      for (const name of document.querySelectorAll("[data-name]")) name.textContent = config.account.name;
      show("account");
    } else if (config.signup === "list") {
      show("list");
    }
  })
  .catch(() => {});

// A reel drifts sideways for ever: the row is repeated until it is wider than any window it can end up in, then
// slides by exactly one row and starts over. Anyone who asked for less motion keeps a row to scroll by hand.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
for (const reel of still ? [] : document.querySelectorAll<HTMLElement>("[data-reel]")) {
  const track = reel.querySelector<HTMLElement>(".reel-track")!;
  const row = [...track.children];
  reel.classList.add("rolling");
  const width = track.scrollWidth + parseFloat(getComputedStyle(track).columnGap);
  const copies = Math.max(2, Math.ceil(Math.max(screen.width, innerWidth) / width) + 1);
  for (let n = 1; n < copies; n++) {
    for (const image of row) {
      const copy = image.cloneNode(true) as HTMLImageElement;
      copy.alt = "";
      copy.setAttribute("aria-hidden", "true");
      // A lazy copy off to the right would pop in mid-scroll.
      copy.loading = "eager";
      track.append(copy);
    }
  }
  reel.style.setProperty("--copies", String(copies));
  reel.style.setProperty("--time", `${Math.round(width / (reel.classList.contains("wide") ? 26 : 34))}s`);
}

for (const host of document.querySelectorAll("[data-host]")) host.textContent = location.host;
for (const origin of document.querySelectorAll("[data-origin]")) origin.textContent = location.origin;

// An agent's name above the first setup line, or its card further down, writes both lines for that agent and
// shows how to start the skill in it.
const agents = [...document.querySelectorAll<HTMLElement>("[data-agent]")];
for (const card of agents) {
  card.addEventListener("click", () => {
    const id = card.dataset.agent!;
    for (const other of agents) other.setAttribute("aria-pressed", String(other.dataset.agent === id));
    for (const name of document.querySelectorAll("[data-agent-id]")) name.textContent = id;
    for (const line of document.querySelectorAll<HTMLElement>("[data-for]")) line.hidden = line.dataset.for !== id;
  });
}

// The terminal writes itself out the first time it scrolls into view.
const terminal = document.querySelector(".term");
if (terminal) {
  terminal.classList.add("armed");
  const watcher = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      terminal.classList.add("on");
      watcher.disconnect();
    },
    { threshold: 0.5 },
  );
  watcher.observe(terminal);
}
