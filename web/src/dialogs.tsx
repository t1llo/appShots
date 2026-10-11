// The four dialogs behind the sidebar: new project, connecting Claude and the CLI, the account, and (for the admin) people.

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
  const origin = location.origin;
  const header = meta.authEnabled ? ` --header "Authorization: Bearer ${token ?? "<your token>"}"` : "";

  const create = attempt(async () => {
    setToken((await api<FreshToken>("POST", "/account/tokens", { name: "Claude and CLI" })).token);
    await queryClient.invalidateQueries({ queryKey: tokensKey });
  });

  return (
    <>
      <h1>Connect</h1>
      <div className="steps">
        {!meta.authEnabled ? null : (
          <div>
            <h3>Your token</h3>
            {token ? (
              <>
                <p>Copy it now: it is shown this once. You can revoke it under Account.</p>
                <CopyBlock text={token} />
              </>
            ) : (
              <>
                <p>Claude and the CLI cannot sign in with Google, so they use a personal token. It reaches your projects only.</p>
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
        <div>
          <h3>Let Claude do the whole set</h3>
          <p>
            With this skill Claude runs your app in the simulator, or uses your plugged-in iPhone, captures the screens worth showing, writes the headlines and builds the set here. Install it once, then type <code>/appshots</code> in your
            app's repository.
          </p>
          <CopyBlock text={`mkdir -p ~/.claude/skills/appshots && curl -fsS ${origin}/skill.md -o ~/.claude/skills/appshots/SKILL.md`} />
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
  const deleteAccount = attempt(async () => {
    await api("DELETE", "/account", { confirm: proof });
    location.href = "/";
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
            <Row title={account.name} sub={`${account.email} · signs in with Google${account.admin ? " · admin of this server" : ""}`} />
          </div>
        </div>
        <div>
          <h3>API tokens</h3>
          <p>Claude and the CLI use a token instead of your Google sign-in. Each one reaches your projects only.</p>
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
        {/* The admin is whoever ADMIN_EMAIL names, and their projects are the server's own. */}
        {account.admin ? null : (
          <details>
            <summary>Delete account</summary>
            <div className="stack">
              <form onSubmit={submit(deleteAccount)}>
                <p>This removes every project, screenshot and render of yours for good. Type your email address to confirm.</p>
                <div className="row">
                  <input type="text" required placeholder={account.email} aria-label="Your email address" value={proof} onChange={(event) => setProof(event.target.value)} />
                  <button className="btn danger" type="submit">
                    Delete account
                  </button>
                </div>
              </form>
            </div>
          </details>
        )}
        <Done close={close} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- people

interface Person {
  email: string;
  admin: boolean;
  /** False for an account whose address is not on the list while sign-in is by list. */
  access: boolean;
  /** These three are there once the person has signed in. */
  name?: string;
  joinedAt?: string;
  projects?: number;
}

interface PeopleData {
  signup: "list" | "open";
  people: Person[];
}

const peopleKey = ["admin", "people"];

/** Admin only. */
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

function describePerson(person: Person): string {
  const parts = [person.name ? person.email : "", person.admin ? "admin" : ""];
  if (person.joinedAt) parts.push(plural(person.projects ?? 0, "project"), `joined ${day(person.joinedAt)}`);
  else parts.push("has not signed in yet");
  if (!person.access) parts.push("not on the list, so cannot sign in");
  return parts.filter(Boolean).join(" · ");
}

function PeopleLists({ data }: { data: PeopleData }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: peopleKey });
  const byList = data.signup === "list";

  const setMode = (mode: string) =>
    attempt(async () => {
      await api("PUT", "/admin/signup", { mode });
      await refresh();
    })();
  const add = (address: string) =>
    attempt(async () => {
      await api("POST", "/admin/people", { email: address });
      setEmail("");
      await refresh();
    });
  const remove = (person: Person) =>
    attempt(async () => {
      if (person.joinedAt && !confirm(`Remove ${person.email} with all of their projects? This cannot be undone.`)) return;
      await api("DELETE", "/admin/people", { email: person.email });
      await refresh();
    });

  return (
    <>
      <div>
        <h3>Who can sign in</h3>
        <p>Everybody signs in with Google and gets a private space: their own projects, screenshots and tokens. Nobody sees anybody else's work.</p>
        <Field label="Sign-in is open to" hint={byList ? "Add the Google address of everyone you want to let in." : "Anybody who finds this address can sign in, make projects and render on your server."}>
          <Select
            options={[
              ["list", "Only the people listed here"],
              ["open", "Anyone with a Google account"],
            ]}
            value={data.signup}
            onChange={setMode}
          />
        </Field>
      </div>
      <div>
        <h3>{plural(data.people.length, "person", "people")}</h3>
        {byList ? (
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              add(email)();
            }}
          >
            <input type="email" required maxLength={254} placeholder="name@gmail.com" aria-label="Google address to let in" value={email} onChange={(event) => setEmail(event.target.value)} />
            <button className="btn primary" type="submit">
              Add
            </button>
          </form>
        ) : null}
        <div className="list">
          {data.people.map((person) => (
            <Row key={person.email} title={person.name ?? person.email} sub={describePerson(person)}>
              {person.access ? null : (
                <button className="btn small" type="button" onClick={add(person.email)}>
                  Allow
                </button>
              )}
              {person.admin ? null : (
                <button className="btn small danger" type="button" onClick={remove(person)}>
                  Remove
                </button>
              )}
            </Row>
          ))}
        </div>
      </div>
    </>
  );
}
