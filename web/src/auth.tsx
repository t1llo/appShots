// Sign in, sign up and password reset. One page, three routes: /login, /signup and /reset.

import "./app.css";
import { type FormEvent, type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Field } from "./ui.tsx";

const params = new URLSearchParams(location.search);
const mode = location.pathname === "/signup" ? "signup" : location.pathname === "/reset" ? "reset" : "login";
const invite = params.get("invite") ?? "";
const resetCode = params.get("code") ?? "";

const REDIRECT_ERRORS: Record<string, string> = {
  google_off: "Google sign-in is not set up on this server.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "That Google sign-in expired before it finished. Try again.",
  google_unverified: "Google has not verified that email address, so it cannot be used here.",
  google_failed: "Google sign-in did not work. Try again in a moment.",
  invite_required: "New accounts need an invite link from the person who runs this server.",
  email_taken: "That email already has an account with a password. Sign in with the password instead.",
};
const redirectCode = params.get("error");
const redirectError = redirectCode ? (REDIRECT_ERRORS[redirectCode] ?? "Sign-in did not work. Try again.") : "";

interface Config {
  google: boolean;
  signup: "invite" | "open";
  /** Whether the invite or reset code in the address is still good. */
  invite: boolean;
  reset: boolean;
}

function View({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · appShots`;
    document.querySelector<HTMLInputElement>("#auth input")?.focus();
  }, [title]);
  return (
    <>
      <div className="auth-logo" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="36" height="36">
          <rect width="32" height="32" rx="7" fill="currentColor" />
          <rect x="10.5" y="6.5" width="11" height="19" rx="3" fill="none" stroke="var(--bg)" strokeWidth="2.2" />
        </svg>
      </div>
      <h1>{title}</h1>
      <p className="auth-lead">{lead}</p>
      {children}
    </>
  );
}

function Google({ text }: { text: string }) {
  return (
    <>
      <a className="btn wide" href={`/auth/google${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`}>
        <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
        </svg>
        {text}
      </a>
      <div className="auth-or">or</div>
    </>
  );
}

/** Posts the form's fields as JSON; a success leaves a session cookie behind, so the gallery opens. */
function Form({ route, extra, submit, startError = "", children }: { route: string; extra?: Record<string, string>; submit: string; startError?: string; children: ReactNode }) {
  const [error, setError] = useState(startError);
  const [busy, setBusy] = useState(false);
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = { ...Object.fromEntries(new FormData(event.currentTarget)), ...extra };
      const response = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (response.ok) return void location.assign("/");
      setError((await response.json().catch(() => null))?.error ?? "That did not work. Try again.");
    } catch {
      setError("The server could not be reached.");
    }
    setBusy(false);
  };
  return (
    <form className="auth-form" onSubmit={(event) => void send(event)}>
      {children}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn primary wide" type="submit" disabled={busy}>
        {submit}
      </button>
    </form>
  );
}

function Login({ config }: { config: Config }) {
  const [withToken, setWithToken] = useState(false);
  if (withToken) {
    return (
      <View title="Sign in as the owner" lead="Enter the APPSHOTS_TOKEN this server was deployed with.">
        <Form key="token" route="/auth/login" submit="Continue">
          <Field label="Server token">
            <input name="token" type="password" autoComplete="current-password" required />
          </Field>
        </Form>
        <p className="auth-foot">
          <button className="link" type="button" onClick={() => setWithToken(false)}>
            Sign in with an account instead
          </button>
        </p>
      </View>
    );
  }
  return (
    <View title="Sign in" lead="App Store screenshots, on tap.">
      {config.google ? <Google text="Continue with Google" /> : null}
      <Form key="account" route="/auth/login" submit="Continue" startError={redirectError}>
        <Field label="Email">
          <input name="email" type="email" autoComplete="username" required placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <input name="password" type="password" autoComplete="current-password" required />
        </Field>
      </Form>
      <p className="auth-foot">
        {config.signup === "open" ? (
          <>
            New here? <a href="/signup">Create an account</a>
          </>
        ) : (
          "New accounts are by invitation."
        )}
        <br />
        <button className="link" type="button" onClick={() => setWithToken(true)}>
          Sign in with the server token
        </button>
      </p>
    </View>
  );
}

function Signup({ config }: { config: Config }) {
  if (config.signup !== "open" && !config.invite) {
    return (
      <View title="Sign-ups are by invitation" lead={invite ? "This invite link has already been used or has expired. Ask for a new one." : "Ask the person who runs this server for an invite link."}>
        <p className="auth-foot">
          <a href="/login">Back to sign in</a>
        </p>
      </View>
    );
  }
  return (
    <View title="Create your account" lead={config.invite ? "You have been invited to appShots." : "Your projects stay private to you."}>
      {config.google ? <Google text="Sign up with Google" /> : null}
      <Form route="/auth/signup" extra={{ invite }} submit="Create account" startError={redirectError}>
        <Field label="Name">
          <input name="name" type="text" autoComplete="name" maxLength={80} placeholder="Optional" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" autoComplete="username" required placeholder="you@example.com" />
        </Field>
        <Field label="Password (8 characters or more)">
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
      </Form>
      <p className="auth-foot">
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </View>
  );
}

function Reset({ config }: { config: Config }) {
  if (!config.reset) {
    return (
      <View title="This link no longer works" lead="Reset links can be used once and expire after a day. Ask for a new one.">
        <p className="auth-foot">
          <a href="/login">Back to sign in</a>
        </p>
      </View>
    );
  }
  return (
    <View title="Choose a new password" lead="This signs you out everywhere else and revokes your API tokens.">
      <Form route="/auth/reset" extra={{ code: resetCode }} submit="Save and sign in">
        <Field label="New password (8 characters or more)">
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
      </Form>
    </View>
  );
}

function Page() {
  const [config, setConfig] = useState<Config | "unreachable" | null>(null);
  useEffect(() => {
    fetch(`/auth/config?${new URLSearchParams({ invite, reset: resetCode })}`)
      .then((response) => response.json())
      .then(setConfig, () => setConfig("unreachable"));
  }, []);
  if (config == null) return null;
  if (config === "unreachable") return <View title="appShots" lead="The server could not be reached. Reload to try again." />;
  return mode === "signup" ? <Signup config={config} /> : mode === "reset" ? <Reset config={config} /> : <Login config={config} />;
}

createRoot(document.getElementById("auth")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
