// The dialogs: new project, renaming or deleting one, and connecting an agent.

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createContext, type FormEvent, useContext, useEffect, useState } from "react";
import { api, detailQuery, errorText, type Meta, type Project, projectsQuery } from "./api.ts";
import { LanguageList } from "./languages.tsx";
import { forgetDraft, openProject } from "./state/useDraft.ts";
import { track } from "./track.ts";
import { Confirm, CopyBlock, Dialog, Field, toast } from "./ui/index.ts";

type Named = { id: string; name: string };
export type DialogKind = "new" | "connect" | { rename: Named } | { remove: Named };

export const OpenDialog = createContext<(kind: DialogKind) => void>(() => {});
export const useOpenDialog = () => useContext(OpenDialog);

export function DialogHost({ kind, meta, close }: { kind: DialogKind | null; meta: Meta; close: () => void }) {
  if (kind == null) return null;
  if (typeof kind === "object" && "remove" in kind) return <DeleteProject key="remove" project={kind.remove} close={close} />;
  // Each kind is a dialog of its own, so one opened from another, as Connect opens New project, takes the focus.
  return (
    <Dialog key={typeof kind === "object" ? "rename" : kind} onClose={close}>
      {typeof kind === "object" ? <RenameProject project={kind.rename} close={close} /> : kind === "new" ? <NewProject close={close} /> : <Connect meta={meta} close={close} />}
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
  // The server numbers a second project of the same name instead of turning it down, so a double click made two.
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    // `required` lets a name of spaces through, which the server answers in its own words.
    if (!name.trim()) return setError("Give the project a name.");
    setBusy(true);
    try {
      const project = await api<Project>("POST", "/projects", {
        name: name.trim(),
        locales,
        slides: [{ layout: "device-bottom", headline: "Say what your app does", subheadline: "One short supporting line" }],
      });
      track("create_project");
      await queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey });
      close();
      await navigate({ to: "/$projectId", params: { projectId: project.id } });
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
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
          <button className="btn primary" type="submit" disabled={busy}>
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
  // The router says whether the project is on screen; only the slides view holds a draft whose saving has to stop.
  const { projectId } = useParams({ strict: false });

  const remove = async () => {
    const open = projectId === project.id || openProject.id === project.id;
    const resume = openProject.id === project.id ? await openProject.quiesce() : null;
    try {
      await api("DELETE", `/projects/${project.id}`);
      // Whichever page it was last open on, its draft has nowhere to go now.
      forgetDraft(project.id);
      await queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey });
      close();
      if (open) await navigate({ to: "/" });
      queryClient.removeQueries({ queryKey: detailQuery(project.id).queryKey });
      toast(`Deleted "${project.name}".`);
    } catch (failure) {
      resume?.();
      throw failure;
    }
  };

  return (
    <Confirm title={`Delete "${project.name}"?`} action="Delete project" running="Deleting…" danger run={remove} onClose={close}>
      Its slides, screenshots, images and renders are deleted with it. This cannot be undone.
    </Confirm>
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

/**
 * The mark each choice in Connect's first step is shown with: the agent's own, as on the home page (web/home.html
 * holds the same paths), or a drawn sign where there is none. `line` marks are stroked, the others filled.
 */
const MARKS: Record<AgentId | "none", { box: string; path: string; line?: true }> = {
  claude: { box: "0 0 24 24", path: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" },
  codex: { box: "0 0 24 24", path: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" },
  opencode: { box: "0 0 24 24", path: "M22 24H2V0h20zM17 4.8H7v14.4h10z" },
  pi: { box: "0 0 560 560", path: "M420 280H280V140H0V0h420zM560 560H420V280h140zM140 560H0V140h140v140h140v140H140z" },
  other: { box: "0 0 24 24", path: "M5 7l5 5-5 5M13 17h6", line: true },
  none: { box: "0 0 24 24", path: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4", line: true },
};

function AgentMark({ id }: { id: AgentId | "none" }) {
  const mark = MARKS[id];
  return (
    <svg className={`agent-mark${mark.line ? " line" : ""}${id === "claude" ? " claude" : ""}`} viewBox={mark.box} aria-hidden="true">
      <path d={mark.path} />
    </svg>
  );
}

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const origin = location.origin;
  // Without sign-in there is no token, and nothing to wait for.
  const ready = !meta.authEnabled || token != null;

  // A failure shows here: the page under the dialog, where the notes are, is out of reach while it is open.
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setToken((await api<FreshToken>("POST", "/account/tokens", { name: agent?.id === "other" || !agent ? "Agent" : agent.name })).token);
      track("connect_agent", { agent: agent?.id ?? "none" });
      await queryClient.invalidateQueries({ queryKey: tokensKey });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  // Each step takes the place of the last, button pressed and all, so the focus moves on to the new step.
  useEffect(() => {
    document.querySelector<HTMLElement>("dialog[open] [data-autofocus]")?.focus();
  }, [agent, way, token]);

  if (way == null && agent == null) {
    return (
      <>
        <h1>Connect an agent</h1>
        <div className="steps">
          <p>Which agent do you use? It can make the whole set for you.</p>
          <div className="choices tiles">
            {AGENTS.map((option) => (
              <button className="choice" type="button" key={option.id} onClick={() => setAgent(option)}>
                <AgentMark id={option.id} />
                <b>{option.title}</b>
                <span>{option.from}</span>
              </button>
            ))}
            <button className="choice" type="button" onClick={() => setWay("hand")}>
              <AgentMark id="none" />
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
            <button className="btn primary" type="button" data-autofocus disabled={busy} onClick={() => void create()}>
              Create token
            </button>
          </div>
          {error ? <div className="inline-error">{error}</div> : null}
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
