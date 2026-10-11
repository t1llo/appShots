// The dialogs: new project, renaming or deleting one, and connecting an agent.

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createContext, type FormEvent, useContext, useState } from "react";
import { api, detailQuery, errorText, type Meta, type Project, projectsQuery } from "./api.ts";
import { LanguageList } from "./languages.tsx";
import { CopyBlock, Dialog, Field, toast } from "./ui.tsx";

type Named = { id: string; name: string };
export type DialogKind = "new" | "connect" | { rename: Named } | { remove: Named };

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
      ) : (
        <Connect meta={meta} close={close} />
      )}
    </Dialog>
  );
}

/** Runs an action and reports a failure instead of leaving the click without an answer. */
export const attempt = (work: () => Promise<unknown>) => () =>
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

export interface TokenEntry {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastUsedAt?: string;
}
/** A token as it comes back from creating it: the only time its value is known. */
export type FreshToken = TokenEntry & { token: string };

export const tokensKey = ["account", "tokens"];

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
        <p>Done. It is in the next step, and shown this once. You can revoke it in Settings.</p>
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
          <p>Drag them from Finder into the project's window. In the simulator, ⌘S saves one to the desktop.</p>
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
