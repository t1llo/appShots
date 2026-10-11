// The public home page is plain HTML (web/home.html). This adds the two things that depend on the visit:
// why a sign-in just failed, and whether signing in is by invitation.

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
  .then((config: { signup: "list" | "open" }) => {
    if (config.signup === "list") document.getElementById("signin-note")!.textContent = "Free to use. Sign-in is by invitation for now: your Google address has to be on the list.";
  })
  .catch(() => {});
