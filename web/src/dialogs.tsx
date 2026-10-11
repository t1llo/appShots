// The dialogs behind the sidebar: new project, renaming or deleting one, connecting an agent, the account, and
// (for the admin) people.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createContext, type FormEvent, type ReactNode, useContext, useState } from "react";
import { api, day, detailQuery, errorText, type Meta, plural, type Project, projectsQuery } from "./api.ts";
import { LanguageList } from "./languages.tsx";
import { rendersQuery } from "./renders.tsx";
import { CopyBlock, Dialog, Field, Select, toast } from "./ui.tsx";

type Named = { id: string; name: string };
export type DialogKind = "new" | "connect" | "account" | "people" | { rename: Named } | { remove: Named };

/**
 * The project that is open in the Studio, which holds edits the server has not seen yet. Renaming it goes through
 * its draft, and before it is deleted its saving is stopped; `quiesce` hands back how to start it again.
 */
export const openProject: { id: string | null; rename: (name: string) => void; quiesce: () => Promise<() => void> } = {
  id: null,
  rename: () => {},
  quiesce: async () => () => {},
};

export const OpenDialog = createContext<(kind: DialogKind) => void>(() => {});
export const useOpenDialog = () => useContext(OpenDialog);

export function DialogHost({ kind, meta, close }: { kind: DialogKind | null; meta: Meta; close: () => void }) {
  if (kind == null) return null;
  return (
    <Dialog onClose={close}>
      {typeof kind === "object" ? (
        "rename" in kind ? (
          <RenameProject project={kind.rename} close={close} />
        ) : (
          <DeleteProject project={kind.remove} close={close} />
        )
      ) : kind === "new" ? (
        <NewProject close={close} />
      ) : kind === "connect" ? (
        <Connect meta={meta} close={close} />
      ) : kind === "account" ? (
        <Account meta={meta} close={close} />
      ) : (
        <People close={close} />
      )}
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
  const [locales, setLocales] = useState(["en-US"]);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const project = await api<Project>("POST", "/projects", {
        name: name.trim(),
        locales,
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
        <div className="field">
          <span className="label">Languages</span>
          <LanguageList locales={locales} onChange={setLocales} />
          <span className="hint">The languages your App Store page is in. The set is made once for each, and you can add more later.</span>
        </div>
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

// ---------------------------------------------------------------- rename and delete

function RenameProject({ project, close }: { project: Named; close: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next) return;
    try {
      if (openProject.id === project.id) openProject.rename(next);
      else {
        await api("PUT", `/projects/${project.id}`, { name: next });
        await queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey });
        await queryClient.invalidateQueries({ queryKey: detailQuery(project.id).queryKey });
      }
      close();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return (
    <>
      <h1>Rename project</h1>
      <form onSubmit={(event) => void submit(event)}>
        <Field label="Name" hint="Links to the project keep working: its address stays the same.">
          <input type="text" required maxLength={80} data-autofocus value={name} onFocus={(event) => event.target.select()} onChange={(event) => setName(event.target.value)} />
        </Field>
        {error ? <div className="inline-error">{error}</div> : null}
        <div className="foot">
          <button className="btn" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" type="submit">
            Rename
          </button>
        </div>
      </form>
    </>
  );
}

function DeleteProject({ project, close }: { project: Named; close: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    const open = openProject.id === project.id;
    const resume = open ? await openProject.quiesce() : null;
    try {
      await api("DELETE", `/projects/${project.id}`);
      await queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey });
      close();
      if (open) await navigate({ to: "/" });
      queryClient.removeQueries({ queryKey: detailQuery(project.id).queryKey });
      toast(`Deleted "${project.name}".`);
    } catch (failure) {
      resume?.();
      toast(errorText(failure), "error");
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Delete "{project.name}"?</h1>
      <p className="dialog-sub">Its slides, screenshots, images and renders are deleted with it. This cannot be undone.</p>
      <div className="foot">
        <button className="btn" type="button" data-autofocus onClick={close}>
          Cancel
        </button>
        <button className="btn danger solid" type="button" disabled={busy} onClick={() => void remove()}>
          {busy ? "Deleting…" : "Delete project"}
        </button>
      </div>
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

/**
 * The agents Connect knows how to set up. `connect` is how an agent gets the server's MCP tools when that is
 * all that is wanted: a command of its own, the setup command (which also works where there is no MCP), or
 * settings the user fills in. `start` is what starts the skill in that agent.
 */
type AgentId = "claude" | "codex" | "opencode" | "pi" | "other";

interface Agent {
  id: AgentId;
  /** As it reads in a sentence. */
  name: string;
  title: string;
  from: string;
  connect: "own" | "setup" | "manual";
  mcp: boolean;
  start: string;
}

const AGENTS: Agent[] = [
  { id: "claude", name: "Claude Code", title: "Claude Code", from: "Anthropic", connect: "own", mcp: true, start: "/appshots" },
  { id: "codex", name: "Codex", title: "Codex", from: "OpenAI", connect: "setup", mcp: true, start: "$appshots" },
  { id: "opencode", name: "OpenCode", title: "OpenCode", from: "opencode.ai", connect: "own", mcp: true, start: "Use the appshots skill to make my App Store screenshots" },
  { id: "pi", name: "Pi", title: "Pi", from: "pi.dev", connect: "setup", mcp: false, start: "/skill:appshots" },
  { id: "other", name: "your agent", title: "Something else", from: "Any other agent", connect: "manual", mcp: false, start: "Read ~/.agents/skills/appshots/SKILL.md and follow it" },
];

/** What the agent should do, most automatic first. Connect asks which agent, then this, then walks through it. */
type Way = "auto" | "ask" | "hand";

const WAYS: { id: Way; title: string; text: string }[] = [
  { id: "auto", title: "Do everything for me", text: "It runs your app, captures the screens, writes the headlines and builds the set. One command to set up." },
  { id: "ask", title: "Tell it what to do", text: "You add the screenshots and describe the set in a sentence. It builds it here. One command to connect." },
  { id: "hand", title: "Make it by hand", text: "Build the set yourself, here in the Studio. Nothing to set up." },
];

function Connect({ meta, close }: { meta: Meta; close: () => void }) {
  const queryClient = useQueryClient();
  const openDialog = useOpenDialog();
  const { projectId } = useParams({ strict: false });
  const [agent, setAgent] = useState<Agent | null>(null);
  const [way, setWay] = useState<Way | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const origin = location.origin;
  // Without sign-in there is no token, and nothing to wait for.
  const ready = !meta.authEnabled || token != null;

  const create = attempt(async () => {
    setToken((await api<FreshToken>("POST", "/account/tokens", { name: agent?.id === "other" || !agent ? "Agent" : agent.name })).token);
    await queryClient.invalidateQueries({ queryKey: tokensKey });
  });

  if (way == null && agent == null) {
    return (
      <>
        <h1>Connect an agent</h1>
        <div className="steps">
          <p>Which agent do you use? It can make the whole set for you.</p>
          <div className="choices tiles">
            {AGENTS.map((option) => (
              <button className="choice" type="button" key={option.id} onClick={() => setAgent(option)}>
                <b>{option.title}</b>
                <span>{option.from}</span>
              </button>
            ))}
            <button className="choice" type="button" onClick={() => setWay("hand")}>
              <b>No agent</b>
              <span>Make it by hand</span>
            </button>
          </div>
          <Done close={close} />
        </div>
      </>
    );
  }

  if (way == null) {
    return (
      <>
        <h1>{agent!.title}</h1>
        <div className="steps">
          <p>What should {agent!.name} do?</p>
          <div className="choices">
            {WAYS.map((option) => (
              <button className="choice" type="button" key={option.id} onClick={() => setWay(option.id)}>
                <b>{option.title}</b>
                <span>{option.text}</span>
              </button>
            ))}
          </div>
          <div className="foot">
            <button className="btn" type="button" onClick={() => setAgent(null)}>
              Back
            </button>
            <button className="btn primary" type="button" data-autofocus onClick={close}>
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  // The token comes first on purpose: a command copied with a placeholder in it connects nothing.
  const tokenStep = !meta.authEnabled ? null : (
    <li>
      <h3>Create your token</h3>
      {token ? (
        <p>Done. It is in the next step, and shown this once. You can revoke it under Account.</p>
      ) : (
        <>
          <p>An agent cannot sign in with Google, so it uses a token of yours. It reaches your projects only.</p>
          <div>
            <button className="btn primary" type="button" data-autofocus onClick={create}>
              Create token
            </button>
          </div>
        </>
      )}
    </li>
  );
  const command = (text: string) => (ready ? <CopyBlock text={text} /> : <p className="hint">This appears once the token is created.</p>);
  const waiting = ready ? undefined : "waiting";
  // Claude Code is what the script sets up when it is told nothing.
  const setup = `curl -fsS ${origin}/install.sh | ${meta.authEnabled ? `APPSHOTS_TOKEN=${token} ` : ""}sh${agent && agent.id !== "claude" ? ` -s ${agent.id}` : ""}`;
  const example = `make App Store screenshots for my habit tracker${projectId ? ` in project "${projectId}"` : ""}: six slides, dark look, one benefit per slide.`;

  const steps =
    way === "hand" || !agent ? (
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
    ) : way === "auto" ? (
      <>
        {tokenStep}
        <li className={waiting}>
          <h3>Paste this into Terminal</h3>
          <p>
            It installs the appshots skill and the <code>appshots</code> command
            {agent.id === "other" ? (
              <>
                , with the skill in <code>~/.agents/skills</code>, where most agents look. Your Mac needs Node.
              </>
            ) : agent.mcp ? (
              `, and connects ${agent.name} to this server. Your Mac needs ${agent.name} and Node.`
            ) : (
              `, which ${agent.name} uses to reach this server. Your Mac needs Node.`
            )}
          </p>
          {command(setup)}
        </li>
        <li className={waiting}>
          {/* A start with a space in it is a sentence to say, not a command to type. */}
          <h3>
            Open {agent.name} in your app's folder and {agent.start.includes(" ") ? "say" : "type"}
          </h3>
          <CopyBlock text={agent.start} />
          <p>Start a new session so it sees the skill. It takes it from there, and the set shows up here.</p>
        </li>
      </>
    ) : (
      <>
        {tokenStep}
        {agent.connect === "manual" ? (
          <li className={waiting}>
            <h3>Add this server to your agent</h3>
            <p>In its MCP settings, add an HTTP server called appshots with this address{meta.authEnabled ? " and this header" : ""}.</p>
            <CopyBlock text={`${origin}/mcp`} />
            {meta.authEnabled ? command(`Authorization: Bearer ${token}`) : null}
            <p className="hint">No MCP in your agent? Go back and choose Do everything for me, which works through a command instead.</p>
          </li>
        ) : (
          <li className={waiting}>
            <h3>Paste this into Terminal</h3>
            {agent.connect === "own" ? (
              <p>It connects {agent.name} to this server, for every folder you work in.</p>
            ) : agent.mcp ? (
              <p>
                It connects {agent.name} to this server, for every folder you work in, and installs the appshots skill and command along the way. Your Mac needs Node.
              </p>
            ) : (
              <p>
                {agent.name} has no MCP, so it reaches this server through the <code>appshots</code> command. This installs it. Your Mac needs Node.
              </p>
            )}
            {command(
              agent.connect === "setup"
                ? setup
                : agent.id === "opencode"
                  ? `opencode mcp add --global --url ${origin}/mcp${meta.authEnabled ? ` --header "Authorization=Bearer ${token}"` : ""} appshots`
                  : `claude mcp add --transport http --scope user appshots ${origin}/mcp${meta.authEnabled ? ` --header "Authorization: Bearer ${token}"` : ""}`,
            )}
          </li>
        )}
        <li className={waiting}>
          <h3>Start a new {agent.id === "other" ? "" : `${agent.name} `}session and ask</h3>
          <CopyBlock text={agent.mcp || agent.connect === "manual" ? `M${example.slice(1)}` : `Run "appshots tools", then ${example}`} />
          <p>Drop your screenshots on the project here, before or after. It does the layout, the copy and the look.</p>
        </li>
      </>
    );

  return (
    <>
      <h1>{WAYS.find((option) => option.id === way)!.title}</h1>
      {agent && way !== "hand" ? <p className="dialog-sub">With {agent.id === "other" ? "another agent" : agent.name}</p> : null}
      <ol className="guide">{steps}</ol>
      {way === "auto" && agent ? (
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
  const rendersLeft = useQuery(rendersQuery).data?.rendersLeft ?? meta.rendersLeft;
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
            <Row title={account.name} sub={`${account.email} · signs in with Google${account.admin ? " · admin of this server" : ""}${rendersLeft == null ? "" : ` · ${plural(rendersLeft, "render")} left`}`} />
          </div>
        </div>
        <div>
          <h3>API tokens</h3>
          <p>Agents and the CLI use a token instead of your Google sign-in. Each one reaches your projects only.</p>
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
  /** These are there once the person has signed in. */
  name?: string;
  joinedAt?: string;
  projects?: number;
  /** How many renders the account has made and has left. `left` is null for the admin, whose renders are not counted. */
  renders?: { made: number; left: number | null };
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
  const setRenders = (person: Person) =>
    attempt(async () => {
      const typed = prompt(`How many renders should ${person.name ?? person.email} have left?`, String(person.renders?.left ?? 0))?.trim();
      if (!typed) return;
      const left = Number(typed);
      if (!Number.isInteger(left) || left < 0) return toast("Type a whole number, 0 or more.", "error");
      await api("PUT", "/admin/renders", { email: person.email, left });
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
        <p>
          Everybody signs in with Google and gets a private space: their own projects, screenshots and tokens. Nobody sees anybody else's work. Each account gets a number of renders, and every export uses one. Yours are
          not counted.
        </p>
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
              {person.renders?.left != null ? (
                <button className="btn small" type="button" title={`${plural(person.renders.made, "render")} made so far. Change how many this account has left.`} onClick={setRenders(person)}>
                  {plural(person.renders.left, "render")} left
                </button>
              ) : null}
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
