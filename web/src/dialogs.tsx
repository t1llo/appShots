// The four dialogs behind the sidebar: new project, connecting Claude, the account, and (for the admin) people.

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

/** The three ways to get a set made, most automatic first. Connect asks which one, then walks through it. */
type Way = "auto" | "ask" | "hand";

const WAYS: { id: Way; title: string; text: string }[] = [
  { id: "auto", title: "Let Claude do everything", text: "Claude runs your app, captures the screens, writes the headlines and builds the set. One command to set up." },
  { id: "ask", title: "Tell Claude what you want", text: "Describe the set in a sentence and Claude builds it here. You add the screenshots. One command to connect." },
  { id: "hand", title: "Make it by hand", text: "Build the set yourself, here in the Studio. Nothing to set up." },
];

function Connect({ meta, close }: { meta: Meta; close: () => void }) {
  const queryClient = useQueryClient();
  const openDialog = useOpenDialog();
  const { projectId } = useParams({ strict: false });
  const [way, setWay] = useState<Way | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const origin = location.origin;
  // Without sign-in there is no token, and nothing to wait for.
  const ready = !meta.authEnabled || token != null;

  const create = attempt(async () => {
    setToken((await api<FreshToken>("POST", "/account/tokens", { name: "Claude" })).token);
    await queryClient.invalidateQueries({ queryKey: tokensKey });
  });

  if (way == null) {
    return (
      <>
        <h1>Connect Claude</h1>
        <div className="steps">
          <p>How do you want to make your screenshots?</p>
          <div className="choices">
            {WAYS.map((option) => (
              <button className="choice" type="button" key={option.id} onClick={() => setWay(option.id)}>
                <b>{option.title}</b>
                <span>{option.text}</span>
              </button>
            ))}
          </div>
          <Done close={close} />
        </div>
      </>
    );
  }

  // The token comes first on purpose: a command copied with a placeholder in it connects nothing.
  const tokenStep = !meta.authEnabled ? null : (
    <li>
      <h3>Create your token</h3>
      {token ? (
        <p>Done. It is in the command below, and shown this once. You can revoke it under Account.</p>
      ) : (
        <>
          <p>Claude cannot sign in with Google, so it uses a token of yours. It reaches your projects only.</p>
          <div>
            <button className="btn primary" type="button" data-autofocus onClick={create}>
              Create token
            </button>
          </div>
        </>
      )}
    </li>
  );
  const command = (text: string) => (ready ? <CopyBlock text={text} /> : <p className="hint">The command appears here once the token is created.</p>);

  return (
    <>
      <h1>{WAYS.find((option) => option.id === way)!.title}</h1>
      <ol className="guide">
        {way === "auto" ? (
          <>
            {tokenStep}
            <li className={ready ? undefined : "waiting"}>
              <h3>Paste this into Terminal</h3>
              <p>
                It installs the <code>/appshots</code> skill and the capture tool, and connects Claude Code to this server. Your Mac needs Claude Code and Node.
              </p>
              {command(`curl -fsS ${origin}/install.sh | ${meta.authEnabled ? `APPSHOTS_TOKEN=${token} ` : ""}sh`)}
            </li>
            <li className={ready ? undefined : "waiting"}>
              <h3>Open Claude Code in your app's folder and type</h3>
              <CopyBlock text="/appshots" />
              <p>Start a new session so it sees the connection. Claude takes it from there, and the set shows up here.</p>
            </li>
          </>
        ) : way === "ask" ? (
          <>
            {tokenStep}
            <li className={ready ? undefined : "waiting"}>
              <h3>Paste this into Terminal</h3>
              <p>It connects Claude Code to this server, for every folder you work in.</p>
              {command(`claude mcp add --transport http --scope user appshots ${origin}/mcp${meta.authEnabled ? ` --header "Authorization: Bearer ${token}"` : ""}`)}
            </li>
            <li className={ready ? undefined : "waiting"}>
              <h3>Start a new Claude session and ask</h3>
              <CopyBlock text={`Make App Store screenshots for my habit tracker${projectId ? ` in project "${projectId}"` : ""}: six slides, dark look, one benefit per slide.`} />
              <p>Drop your screenshots on the project here, before or after. Claude does the layout, the copy and the look.</p>
            </li>
          </>
        ) : (
          <>
            <li>
              <h3>Create a project</h3>
              {projectId ? (
                <p>You are in one already.</p>
              ) : (
                <div>
                  <button className="btn primary" type="button" onClick={() => openDialog("new")}>
                    New project
                  </button>
                </div>
              )}
            </li>
            <li>
              <h3>Add your screenshots</h3>
              <p>Drag them from Finder onto Screenshots at the bottom of the project. In the simulator, ⌘S saves one to the desktop.</p>
            </li>
            <li>
              <h3>Write the headlines and export</h3>
              <p>Pick a layout for each slide, set the look once for the whole set, then Export ZIP.</p>
            </li>
          </>
        )}
      </ol>
      {way === "auto" ? (
        <p className="hint guide-note">
          The same setup gives you <code>appshots</code> in Terminal, to capture the simulator yourself: <code>appshots capture --name home --project {projectId ?? "<project>"} --clean</code>
        </p>
      ) : null}
      <div className="foot">
        <button className="btn" type="button" onClick={() => setWay(null)}>
          Back
        </button>
        <button className="btn primary" type="button" data-autofocus={ready ? true : undefined} onClick={close}>
          Done
        </button>
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
              ["open", "Anyone with a Google account"],
              ["list", "Only the people listed here"],
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
