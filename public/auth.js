// Sign in, sign up and password reset. One page, three routes: /login, /signup and /reset.

const params = new URLSearchParams(location.search);
const mode = location.pathname === "/signup" ? "signup" : location.pathname === "/reset" ? "reset" : "login";
const invite = params.get("invite") ?? "";
const resetCode = params.get("code") ?? "";

const REDIRECT_ERRORS = {
  google_off: "Google sign-in is not set up on this server.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "That Google sign-in expired before it finished. Try again.",
  google_unverified: "Google has not verified that email address, so it cannot be used here.",
  google_failed: "Google sign-in did not work. Try again in a moment.",
  invite_required: "New accounts need an invite link from the person who runs this server.",
  email_taken: "That email already has an account with a password. Sign in with the password instead.",
};

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

const root = document.getElementById("auth");
const error = h("p", { class: "inline-error", role: "alert", hidden: true });

function fail(message) {
  error.textContent = message;
  error.hidden = false;
}

const logo = () => {
  const el = h("div", { class: "auth-logo", "aria-hidden": "true" });
  el.innerHTML =
    '<svg viewBox="0 0 32 32" width="36" height="36"><rect width="32" height="32" rx="7" fill="currentColor"/><rect x="10.5" y="6.5" width="11" height="19" rx="3" fill="none" stroke="var(--bg)" stroke-width="2.2"/></svg>';
  return el;
};

function googleButton(text) {
  const el = h("a", { class: "btn wide", href: `/auth/google${invite ? `?invite=${encodeURIComponent(invite)}` : ""}` });
  el.innerHTML =
    '<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.620z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.180l-2.920-2.260c-.800.540-1.840.860-3.040.860-2.340 0-4.330-1.580-5.040-3.710H.960v2.330A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.960 10.710a5.400 5.400 0 0 1 0-3.420V4.960H.960a9 9 0 0 0 0 8.080l3-2.330z"/><path fill="#EA4335" d="M9 3.580c1.320 0 2.500.450 3.440 1.350l2.580-2.580C13.460.890 11.430 0 9 0A9 9 0 0 0 .960 4.960l3 2.330C4.670 5.160 6.660 3.580 9 3.580z"/></svg>';
  el.append(text);
  return el;
}

const field = (label, input) => h("label", { class: "field" }, h("span", { class: "label" }, label), input);
const divider = () => h("div", { class: "auth-or" }, "or");
const footer = (...children) => h("p", { class: "auth-foot" }, children);

/** Posts the form as JSON; a success leaves a session cookie behind, so the gallery opens. */
function form(route, fields, submitText, body) {
  const submit = h("button", { class: "btn primary wide", type: "submit" }, submitText);
  return h(
    "form",
    {
      class: "auth-form",
      onsubmit: async (event) => {
        event.preventDefault();
        error.hidden = true;
        submit.disabled = true;
        try {
          const response = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body()) });
          if (response.ok) return void location.assign("/");
          fail((await response.json().catch(() => null))?.error ?? "That did not work. Try again.");
        } catch {
          fail("The server could not be reached.");
        }
        submit.disabled = false;
      },
    },
    fields,
    error,
    submit,
  );
}

function show(title, lead, ...children) {
  document.title = `${title} · appShots`;
  root.replaceChildren(logo(), h("h1", null, title), lead && h("p", { class: "auth-lead" }, lead), ...children.flat().filter(Boolean));
  root.querySelector("input")?.focus();
}

function loginView(config, withToken = false) {
  if (withToken) {
    const token = h("input", { type: "password", autocomplete: "current-password", required: true });
    return show(
      "Sign in as the owner",
      "Enter the APPSHOTS_TOKEN this server was deployed with.",
      form("/auth/login", field("Server token", token), "Continue", () => ({ token: token.value })),
      footer(h("a", { href: "#", onclick: (event) => (event.preventDefault(), (error.hidden = true), loginView(config)) }, "Sign in with an account instead")),
    );
  }
  const email = h("input", { type: "email", autocomplete: "username", required: true, placeholder: "you@example.com" });
  const password = h("input", { type: "password", autocomplete: "current-password", required: true });
  show(
    "Sign in",
    "App Store screenshots, on tap.",
    config.google && [googleButton("Continue with Google"), divider()],
    form("/auth/login", [field("Email", email), field("Password", password)], "Continue", () => ({ email: email.value, password: password.value })),
    footer(
      config.signup === "open" ? ["New here? ", h("a", { href: "/signup" }, "Create an account")] : "New accounts are by invitation.",
      h("br"),
      h("a", { href: "#", onclick: (event) => (event.preventDefault(), (error.hidden = true), loginView(config, true)) }, "Sign in with the server token"),
    ),
  );
}

function signupView(config) {
  if (config.signup !== "open" && !config.invite) {
    return show(
      "Sign-ups are by invitation",
      invite ? "This invite link has already been used or has expired. Ask for a new one." : "Ask the person who runs this server for an invite link.",
      footer(h("a", { href: "/login" }, "Back to sign in")),
    );
  }
  const name = h("input", { type: "text", autocomplete: "name", maxLength: 80, placeholder: "Optional" });
  const email = h("input", { type: "email", autocomplete: "username", required: true, placeholder: "you@example.com" });
  const password = h("input", { type: "password", autocomplete: "new-password", required: true, minLength: 8 });
  show(
    "Create your account",
    config.invite ? "You have been invited to appShots." : "Your projects stay private to you.",
    config.google && [googleButton("Sign up with Google"), divider()],
    form("/auth/signup", [field("Name", name), field("Email", email), field("Password (8 characters or more)", password)], "Create account", () => ({
      name: name.value,
      email: email.value,
      password: password.value,
      invite,
    })),
    footer("Already have an account? ", h("a", { href: "/login" }, "Sign in")),
  );
}

function resetView(config) {
  if (!config.reset) return show("This link no longer works", "Reset links can be used once and expire after a day. Ask for a new one.", footer(h("a", { href: "/login" }, "Back to sign in")));
  const password = h("input", { type: "password", autocomplete: "new-password", required: true, minLength: 8 });
  show(
    "Choose a new password",
    "This signs you out everywhere else and revokes your API tokens.",
    form("/auth/reset", field("New password (8 characters or more)", password), "Save and sign in", () => ({ code: resetCode, password: password.value })),
  );
}

try {
  const query = new URLSearchParams({ invite, reset: resetCode });
  const config = await fetch(`/auth/config?${query}`).then((response) => response.json());
  if (mode === "signup") signupView(config);
  else if (mode === "reset") resetView(config);
  else loginView(config);
  const code = params.get("error");
  if (code) fail(REDIRECT_ERRORS[code] ?? "Sign-in did not work. Try again.");
} catch {
  show("appShots", "The server could not be reached. Reload to try again.");
}
