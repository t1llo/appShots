// The four dialogs behind the sidebar: new project, connecting Claude and the CLI, the account, and (for the owner) people.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createContext, type FormEvent, type ReactNode, useContext, useState } from "react";
import { api, day, errorText, type Meta, parseLocales, plural, type Project, projectsQuery } from "./api.ts";
import { CopyBlock, Dialog, Field, Select, toast } from "./ui.tsx";

export type DialogKind = "new" | "connect" | "account" | "people";

export const OpenDialog = createContext<(kind: DialogKind) => void>(() => {});
export const useOpenDialog = () => useContext(OpenDialog);

export function DialogHost({ kind, meta, close }: { kind: DialogKind | null; meta: Meta; close: () => void }) {
  if (kind == null) return null;
  return (
    <Dialog onClose={close}>
      {kind === "new" ? <NewProject close={close} /> : kind === "connect" ? <Connect meta={meta} close={close} /> : kind === "account" ? <Account meta={meta} close={close} /> : <People close={close} />}
    </Dialog>
  );
}

/** Runs a dialog action and reports a failure instead of leaving the click without an answer. */
const attempt = (work: () => Promise<unknown>) => () =>
  void work().catch((error: unknown) => {
    toast(errorText(error), "error");
  });

// Done takes the focus on open, so the first field does not light up before anyone has touched it.
function Done({ close }: { close: () => void }) {
  return (
    <div className="foot">
      <button className="btn primary" type="button" data-autofocus onClick={close}>
        Done
      </button>
    </div>
  );
}

function Row({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="list-row">
      <div className="list-main">
        <span className="list-title">{title}</span>
        <span className="list-sub">{sub}</span>
      </div>
      {children}
    </div>
  );
}

function Loading({ error }: { error: unknown }) {
  return error ? <p className="inline-error">{errorText(error)}</p> : <p className="muted">Loading…</p>;
}

// ---------------------------------------------------------------- new project

function NewProject({ close }: { close: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [locales, setLocales] = useState("en-US");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const project = await api<Project>("POST", "/projects", {
        name: name.trim(),
        locales: parseLocales(locales),
        slides: [{ layout: "device-bottom", headline: "Say what your app does", subheadline: "One short supporting line" }],
      });
      await queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey });
      close();
      await navigate({ to: "/$projectId", params: { projectId: project.id } });
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return (
    <>
      <h1>New project</h1>
      <form onSubmit={(event) => void submit(event)}>
        <Field label="Name">
          <input type="text" required maxLength={80} placeholder="My App" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Languages" hint="Store locales, comma-separated. You can add more later.">
          <input type="text" spellCheck={false} value={locales} onChange={(event) => setLocales(event.target.value)} />
        </Field>
        {error ? <div className="inline-error">{error}</div> : null}
        <div className="foot">
          <button className="btn" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" type="submit">
            Create
          </button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- connect

interface TokenEntry {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastUsedAt?: string;
}
/** A token as it comes back from creating it: the only time its value is known. */
type FreshToken = TokenEntry & { token: string };

const tokensKey = ["account", "tokens"];

function Connect({ meta, close }: { meta: Meta; close: () => void }) {
  const queryClient = useQueryClient();
  const { projectId = "<project>" } = useParams({ strict: false });
  const [token, setToken] = useState<string | null>(null);
  const { account, authEnabled } = meta;
  const origin = location.origin;
  const bearer = token ?? (account ? "<your token>" : "$APPSHOTS_TOKEN");
  const header = authEnabled ? ` --header "Authorization: Bearer ${bearer}"` : "";

  const create = attempt(async () => {
    setToken((await api<FreshToken>("POST", "/account/tokens", { name: "Claude and CLI" })).token);
    await queryClient.invalidateQueries({ queryKey: tokensKey });
  });

  return (
    <>
      <h1>Connect</h1>
      <div className="steps">
        {!authEnabled ? null : (
          <div>
            <h3>Your token</h3>
            {!account ? (
              <p>
                You run this server, so your token is the <code>APPSHOTS_TOKEN</code> it was deployed with.
              </p>
            ) : token ? (
              <>
                <p>Copy it now: it is shown this once. You can revoke it under Account.</p>
                <CopyBlock text={token} />
              </>
            ) : (
              <>
                <p>Claude and the CLI sign in with a personal token instead of your password.</p>
                <div>
                  <button className="btn primary" type="button" onClick={create}>
                    Create a token
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <div>
          <h3>Claude</h3>
          <p>Add the MCP endpoint to Claude Code, then ask for screenshots in plain words: the copy, the look, the badges.</p>
          <CopyBlock text={`claude mcp add --transport http appshots ${origin}/mcp${header}`} />
        </div>
        <div>
          <h3>Capture from your Mac</h3>
          <p>
            The CLI grabs the running simulator, or a plugged-in iPhone or iPad with --device, and uploads the result. It is one file that needs Node and nothing else: run it as <code>node appshots.mjs</code>, or put it on your PATH as{" "}
            <code>appshots</code>.
          </p>
          <div>
            <a className="btn small" href="/cli/appshots.mjs" download="appshots.mjs">
              Download appshots.mjs
            </a>
          </div>
          <CopyBlock text={`appshots login ${origin}`} />
          <CopyBlock text={`appshots capture --name home --project ${projectId}`} />
        </div>
        <Done close={close} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- account

function Account({ meta, close }: { meta: Meta; close: () => void }) {
  const account = meta.account!;
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: tokensKey, queryFn: () => api<TokenEntry[]>("GET", "/account/tokens") });
  const [fresh, setFresh] = useState<FreshToken | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [proof, setProof] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: tokensKey });

  const createToken = attempt(async () => {
    setFresh(await api<FreshToken>("POST", "/account/tokens", { name: tokenName }));
    setTokenName("");
    await refresh();
  });
  const revoke = (token: TokenEntry) =>
    attempt(async () => {
      if (!confirm(`Revoke "${token.name}"? Whatever uses it stops working.`)) return;
      await api("DELETE", `/account/tokens/${token.id}`);
      if (fresh?.id === token.id) setFresh(null);
      await refresh();
    });
  const changePassword = attempt(async () => {
    await api("POST", "/account/password", { current, password: next });
    setCurrent("");
    setNext("");
    toast("Password changed. Your other browsers were signed out.");
  });
  const deleteAccount = attempt(async () => {
    await api("DELETE", "/account", { confirm: proof });
    location.href = "/login";
  });
  const submit = (action: () => void) => (event: FormEvent) => {
    event.preventDefault();
    action();
  };

  return (
    <>
      <h1>Account</h1>
      <div className="steps">
        <div>
          <div className="list">
            <Row title={account.name} sub={`${account.email} · signs in with ${account.google ? "Google" : "a password"}`} />
          </div>
        </div>
        <div>
          <h3>API tokens</h3>
          <p>Claude and the CLI use a token instead of your password. Each one reaches your projects only.</p>
          {fresh ? (
            <>
              <p>Copy "{fresh.name}" now: it is shown this once.</p>
              <CopyBlock text={fresh.token} />
            </>
          ) : null}
          {!tokens.data ? (
            <Loading error={tokens.error} />
          ) : tokens.data.length > 0 ? (
            <div className="list">
              {tokens.data.map((token) => (
                <Row key={token.id} title={token.name} sub={`appshots_…${token.hint} · created ${day(token.createdAt)} · ${token.lastUsedAt ? `last used ${day(token.lastUsedAt)}` : "never used"}`}>
                  <button className="btn small danger" type="button" onClick={revoke(token)}>
                    Revoke
                  </button>
                </Row>
              ))}
            </div>
          ) : null}
          <form className="row" onSubmit={submit(createToken)}>
            <input type="text" maxLength={60} placeholder="Name it, e.g. MacBook" aria-label="Token name" value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
            <button className="btn" type="submit">
              Create token
            </button>
          </form>
        </div>
        {account.password ? (
          <div>
            <h3>Password</h3>
            <form onSubmit={submit(changePassword)}>
              <div className="cols">
                <Field label="Current password">
                  <input type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} />
                </Field>
                <Field label="New password">
                  <input type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(event) => setNext(event.target.value)} />
                </Field>
              </div>
              <div>
                <button className="btn" type="submit">
                  Change password
                </button>
              </div>
            </form>
          </div>
        ) : null}
        <details>
          <summary>Delete account</summary>
          <div className="stack">
            <form onSubmit={submit(deleteAccount)}>
              <p>This removes every project, screenshot and render of yours for good. {account.password ? "Enter your password" : "Type your email address"} to confirm.</p>
              <div className="row">
                {account.password ? (
                  <input type="password" autoComplete="current-password" required placeholder="Your password" value={proof} onChange={(event) => setProof(event.target.value)} />
                ) : (
                  <input type="text" required placeholder={account.email} value={proof} onChange={(event) => setProof(event.target.value)} />
                )}
                <button className="btn danger" type="submit">
                  Delete account
                </button>
              </div>
            </form>
          </div>
        </details>
        <Done close={close} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- people

interface PeopleData {
  signup: "invite" | "open";
  google: boolean;
  users: { id: string; email: string; name: string; createdAt: string; signIn: "Google" | "Password"; projects: number }[];
  invites: { id: string; createdAt: string; expiresAt: string }[];
}

const peopleKey = ["admin", "people"];

/** Owner only. */
function People({ close }: { close: () => void }) {
  const people = useQuery({ queryKey: peopleKey, queryFn: () => api<PeopleData>("GET", "/admin/people") });
  return (
    <>
      <h1>People</h1>
      <div className="steps">
        {people.data ? <PeopleLists data={people.data} /> : <Loading error={people.error} />}
        <Done close={close} />
      </div>
    </>
  );
}

function PeopleLists({ data }: { data: PeopleData }) {
  const queryClient = useQueryClient();
  /** An invite or reset link created a moment ago, shown once. */
  const [link, setLink] = useState<{ note: string; url: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: peopleKey });

  const setMode = (mode: string) =>
    attempt(async () => {
      await api("PUT", "/admin/signup", { mode });
      await refresh();
    })();
  const invite = attempt(async () => {
    const created = await api<{ url: string }>("POST", "/admin/invites");
    setLink({ note: "Send this link to one person. It creates one account and expires in 14 days.", url: created.url });
    await refresh();
  });
  const revoke = (id: string) =>
    attempt(async () => {
      await api("DELETE", `/admin/invites/${id}`);
      await refresh();
    });
  const reset = (user: PeopleData["users"][number]) =>
    attempt(async () => {
      const created = await api<{ url: string }>("POST", `/admin/users/${user.id}/reset`);
      setLink({ note: `Send this link to ${user.email} to set a new password. It works once and expires in 24 hours.`, url: created.url });
    });
  const remove = (user: PeopleData["users"][number]) =>
    attempt(async () => {
      if (!confirm(`Remove ${user.email} with all of their projects? This cannot be undone.`)) return;
      await api("DELETE", `/admin/users/${user.id}`);
      await refresh();
    });

  return (
    <>
    {link ? (
        <div>
          <p>{link.note}</p>
          <CopyBlock text={link.url} />
        </div>
      ) : null}
      <div>
        <h3>Who can join</h3>
        <p>Everyone gets a private space: their own projects, screenshots and tokens. You sign in with the server token and are the only one who sees this page.</p>
        <Field label="New accounts" hint={data.signup === "open" ? "Anyone who can reach this address can create an account and render with it." : "Only people you send an invite link to can create an account."}>
          <Select
            options={[
              ["invite", "Invite only"],
              ["open", "Anyone can sign up"],
            ]}
            value={data.signup}
            onChange={setMode}
          />
        </Field>
        <span className="hint">{data.google ? "Sign in with Google is on." : "Sign in with Google is off. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server to offer it."}</span>
      </div>
      <div>
        <h3>Invites</h3>
        {data.invites.length > 0 ? (
          <div className="list">
            {data.invites.map((entry) => (
              <Row key={entry.id} title="Invite link, not used yet" sub={`created ${day(entry.createdAt)} · expires ${day(entry.expiresAt)}`}>
                <button className="btn small danger" type="button" onClick={revoke(entry.id)}>
                  Revoke
                </button>
              </Row>
            ))}
          </div>
        ) : null}
        <div>
          <button className="btn primary" type="button" onClick={invite}>
            Create invite link
          </button>
        </div>
      </div>
      <div>
        <h3>{data.users.length > 0 ? plural(data.users.length, "account") : "Accounts"}</h3>
        {data.users.length > 0 ? (
          <div className="list">
            {data.users.map((user) => (
              <Row key={user.id} title={user.name} sub={`${user.email} · ${user.signIn} · ${plural(user.projects, "project")} · joined ${day(user.createdAt)}`}>
                {user.signIn === "Password" ? (
                  <button className="btn small" type="button" onClick={reset(user)}>
                    Reset link
                  </button>
                ) : null}
                <button className="btn small danger" type="button" onClick={remove(user)}>
                  Remove
                </button>
              </Row>
            ))}
          </div>
        ) : (
          <p>Nobody has joined yet.</p>
        )}
      </div>
    </>
  );
}
