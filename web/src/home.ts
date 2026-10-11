// The public home page is plain HTML (web/home.html). This adds what depends on the visit or needs a script:
// why a sign-in just failed, who may sign in, and the motion.

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
  .then((config: { signIn: boolean; signup: "list" | "open" }) => {
    const note = document.getElementById("signin-note")!;
    if (!config.signIn) note.textContent = "No sign-in needed on this server.";
    else if (config.signup === "list") note.textContent = "Free. By invitation for now: sign in with a Google address on the list.";
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
