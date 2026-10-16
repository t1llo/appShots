// The pages of the Studio that are not a project: the list of projects, the settings, and the admin's overview.

import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { api, day, errorText, type Meta, plural, projectsQuery } from "./api.ts";
import { attempt, type FreshToken, type TokenEntry, tokensKey, useOpenDialog } from "./dialogs.tsx";
import { rendersQuery } from "./renders.tsx";
import { type Appearance, readAppearance, setAppearance } from "./theme.ts";
import { ask, Confirm, CopyBlock, Icon, Menu, Segmented, Select, toast } from "./ui/index.ts";

/** A page of its own: its name in the bar, and under it a column that holds a heading and sections. */
export function Page({ name, title, sub, actions, wide, children }: { name: string; title: string; sub?: ReactNode; actions?: ReactNode; wide?: boolean; children?: ReactNode }) {
  return (
    <div className="main">
      <header className="bar">
        <span className="bar-title still">{name}</span>
        <span className="spacer" />
        {actions}
      </header>
      <div className="content">
        <div className="page-scroll">
          <div className={`page${wide ? " wide" : ""}`}>
            <div className="page-head">
              <h1>{title}</h1>
              {sub ? <p>{sub}</p> : null}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One part of a settings page: what it is about on the left of its heading, and its rows under it. */
function Part({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <section className="part">
      <div className="part-head">
        <div>
          <h2>{title}</h2>
          {sub ? <p>{sub}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Loading({ error }: { error: unknown }) {
  return error ? <p className="inline-error">{errorText(error)}</p> : <p className="muted">Loading…</p>;
}

const UNITS = ["KB", "MB", "GB", "TB"];
/** A number of bytes as people read it: 1.4 MB. */
export function size(bytes: number): string {
  if (bytes < 1000) return bytes ? "under 1 KB" : "0 KB";
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** How long ago something happened, in the words of a list: 5 min ago, yesterday, 3 Mar 2026. */
function ago(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return plural(Math.floor(minutes / 60), "hour") + " ago";
  if (minutes < 48 * 60) return "Yesterday";
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))} days ago`;
  return day(iso);
}

// ---------------------------------------------------------------- projects

export function ProjectsPage({ meta }: { meta: Meta }) {
  const projects = useQuery(projectsQuery).data ?? [];
  const open = useOpenDialog();
  const navigate = useNavigate();
  const deviceLabel = (id: string) => meta.devices.find((entry) => entry.id === id)?.label ?? id;

  return (
    <Page
      name="Projects"
      title="Projects"
      sub="One project is one app: its screenshots, its slides for the App Store, its banners and its mockups."
      wide
      actions={
        <button className="btn primary" type="button" onClick={() => open("new")}>
          New project
        </button>
      }
    >
      {projects.length === 0 ? (
        <div className="empty-box">
          <b>No projects yet</b>
          <p>Create one here, or let your agent build one. Either way it shows up in this list.</p>
          <div className="actions">
            <button className="btn primary" type="button" onClick={() => open("new")}>
              New project
            </button>
            <button className="btn" type="button" onClick={() => open("connect")}>
              Connect an agent
            </button>
          </div>
        </div>
      ) : (
        <table className="table rows">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slides</th>
              <th className="extra">Languages</th>
              <th className="extra">Changed</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} onClick={() => void navigate({ to: "/$projectId", params: { projectId: project.id } })}>
                <td className="lead">
                  <Link to="/$projectId" params={{ projectId: project.id }} onClick={(event) => event.stopPropagation()}>
                    {project.name}
                  </Link>
                  <span className="dim">{project.id}</span>
                </td>
                <td>
                  {project.slides}
                  {project.ownSets?.length ? <span className="dim"> · own set for {project.ownSets.map(deviceLabel).join(", ")}</span> : null}
                </td>
                <td className="extra" title={project.locales.join(", ")}>
                  {project.locales.slice(0, 3).join(", ")}
                  {project.locales.length > 3 ? <span className="dim"> +{project.locales.length - 3}</span> : null}
                </td>
                <td className="extra dim" title={new Date(project.updatedAt).toLocaleString()}>
                  {ago(project.updatedAt)}
                </td>
                <td className="end" onClick={(event) => event.stopPropagation()}>
                  <Menu
                    label={`Actions for ${project.name}`}
                    items={[
                      { text: "Open", run: () => void navigate({ to: "/$projectId", params: { projectId: project.id } }) },
                      { text: "Rename", run: () => open({ rename: project }) },
                      { text: "Delete…", danger: true, run: () => open({ remove: project }) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- settings

const APPEARANCES: { id: Appearance; text: string; title: string; path: string }[] = [
  { id: "system", text: "Auto", title: "Follow this device's setting", path: "M2.5 3.5h11v7h-11zM6 13.5h4M8 10.5v3" },
  { id: "light", text: "Light", title: "Light", path: "M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" },
  { id: "dark", text: "Dark", title: "Dark", path: "M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" },
];

/** Light, dark, or whatever the device says. */
function AppearanceSwitch() {
  const [chosen, setChosen] = useState(readAppearance);
  return (
    <Segmented
      label="Appearance"
      choices={APPEARANCES.map((entry) => ({
        id: entry.id,
        title: entry.title,
        text: (
          <>
            <Icon path={entry.path} />
            {entry.text}
          </>
        ),
      }))}
      value={chosen}
      onChange={(id) => {
        setAppearance(id);
        setChosen(id);
      }}
    />
  );
}

/** A line of a settings list: what it is, a note under it, and what can be done with it at the right. */
function Row({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="list-row">
      <div className="list-main">
        <span className="list-title">{title}</span>
        {sub ? <span className="list-sub">{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

interface Usage {
  projects: number;
  slides: number;
  shots: number;
  images: number;
  bytes: number;
}

const usageQuery = queryOptions({ queryKey: ["usage"], queryFn: () => api<Usage>("GET", "/usage") });

export function SettingsPage({ meta }: { meta: Meta }) {
  const { account } = meta;
  const open = useOpenDialog();
  const usage = useQuery(usageQuery).data;
  const rendersLeft = useQuery(rendersQuery).data?.rendersLeft ?? meta.rendersLeft;

  return (
    <Page name="Settings" title="Settings" sub={account ? "Your account on this server, and how your agents reach it." : "How this Studio looks, and how your agents reach it."}>
      <Part title="Account">
        <div className="list">
          {account ? (
            <Row title={account.name || account.email} sub={`${account.email} · signs in with Google${account.admin ? " · admin of this server" : ""}`}>
              <form method="post" action="/logout">
                <button className="btn small" type="submit">
                  Sign out
                </button>
              </form>
            </Row>
          ) : (
            <Row title="Sign-in is off" sub="This server has one space, and whoever can open this address works in it." />
          )}
          {usage ? <Row title="What you keep here" sub={`${plural(usage.projects, "project")} · ${plural(usage.shots, "screenshot")} · ${plural(usage.images, "image")} · ${size(usage.bytes)} with the renders`} /> : null}
          {rendersLeft == null ? null : <Row title="Renders" sub={`${plural(rendersLeft, "render")} left. Every export uses one.`} />}
        </div>
      </Part>

      <Part title="Appearance">
        <div className="list">
          <Row title="Theme" sub="Kept in this browser.">
            <AppearanceSwitch />
          </Row>
        </div>
      </Part>

      <Part title="Agents and the command line" sub="An agent can make a whole set: it runs your app, captures the screens, writes the headlines and builds the slides here.">
        <div className="list">
          <Row title="Connect an agent" sub="Claude Code, Codex, OpenCode, Pi or another one. One command to set up.">
            <button className="btn small" type="button" onClick={() => open("connect")}>
              Connect
            </button>
          </Row>
          <Row
            title="Keep the skill and the command up to date"
            sub={
              <>
                The skill and the <code>appshots</code> command on your Mac are copies of this server's. This fetches the current ones, with the token you have already.
              </>
            }
          />
        </div>
        <CopyBlock text="appshots update" />
        <p className="hint">
          <code>appshots check</code> tells you whether they are behind, and the command says so by itself after other commands. An agent connected through MCP alone has nothing to update: it reads the tools from this server every time.
        </p>
      </Part>

      {account ? <Tokens /> : null}

      {/* The admin is whoever ADMIN_EMAIL names, and their projects are the server's own. */}
      {account && !account.admin ? <DeleteAccount email={account.email} /> : null}
    </Page>
  );
}

function Tokens() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: tokensKey, queryFn: () => api<TokenEntry[]>("GET", "/account/tokens") });
  const [fresh, setFresh] = useState<FreshToken | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: tokensKey });

  // A second click while the first is under way would make a token whose secret is never shown.
  const create = attempt(async () => {
    if (busy) return;
    setBusy(true);
    try {
      setFresh(await api<FreshToken>("POST", "/account/tokens", { name }));
      setName("");
      await refresh();
    } finally {
      setBusy(false);
    }
  });
  const revoke = (token: TokenEntry) => () =>
    ask({
      title: `Revoke "${token.name}"?`,
      text: "Whatever uses it stops working.",
      action: "Revoke",
      running: "Revoking…",
      danger: true,
      run: async () => {
        await api("DELETE", `/account/tokens/${token.id}`);
        setFresh((shown) => (shown?.id === token.id ? null : shown));
        await refresh();
      },
    });

  return (
    <Part title="API tokens" sub="Agents and the command line use a token instead of your Google sign-in. Each one reaches your projects only.">
      {fresh ? (
        <div className="note">
          <p>Copy "{fresh.name}" now: it is shown this once.</p>
          <CopyBlock text={fresh.token} />
        </div>
      ) : null}
      {!tokens.data ? (
        <Loading error={tokens.error} />
      ) : tokens.data.length ? (
        <div className="list">
          {tokens.data.map((token) => (
            <Row key={token.id} title={token.name} sub={`appshots_…${token.hint} · created ${day(token.createdAt)} · ${token.lastUsedAt ? `last used ${day(token.lastUsedAt)}` : "never used"}`}>
              <button className="btn small quiet danger" type="button" onClick={revoke(token)}>
                Revoke
              </button>
            </Row>
          ))}
        </div>
      ) : null}
      <form
        className="row"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create();
        }}
      >
        <input type="text" maxLength={60} placeholder="Name it, e.g. MacBook" aria-label="Token name" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="btn" type="submit" disabled={busy}>
          Create token
        </button>
      </form>
    </Part>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const [proof, setProof] = useState("");
  const remove = attempt(async () => {
    await api("DELETE", "/account", { confirm: proof });
    location.href = "/";
  });
  return (
    <Part title="Delete account" sub="This removes every project, screenshot and render of yours for good. Type your email address to confirm.">
      <form
        className="row"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          remove();
        }}
      >
        <input type="text" required placeholder={email} aria-label="Your email address" value={proof} onChange={(event) => setProof(event.target.value)} />
        <button className="btn danger" type="submit">
          Delete account
        </button>
      </form>
    </Part>
  );
}

// ---------------------------------------------------------------- admin

interface Person {
  email: string;
  admin: boolean;
  /** False for an account whose address is not on the list while sign-in is by list. */
  access: boolean;
  /** These are there once the person has signed in. */
  name?: string;
  joinedAt?: string;
  projects?: number;
  bytes?: number;
  /** How many renders the account has made and has left. `left` is null for the admin, whose renders are not counted. */
  renders?: { made: number; left: number | null };
}

interface PeopleData {
  signup: "list" | "open";
  people: Person[];
}

/** The server in numbers. Counts and sizes only: the admin sees how much everybody keeps, never what it is. */
interface Overview extends Usage {
  accounts: number;
  waiting: number;
  locked: number;
  renders: number;
  signup: "list" | "open";
  renderAllowance: number;
}

const peopleKey = ["admin", "people"];
const overviewKey = ["admin", "overview"];

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <b>{value}</b>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

/** Admin only: the server in numbers, who can sign in, and everybody who has. */
export function AdminPage({ meta }: { meta: Meta }) {
  const admin = meta.account?.admin === true;
  const overview = useQuery({ queryKey: overviewKey, queryFn: () => api<Overview>("GET", "/admin/overview"), enabled: admin, refetchInterval: 15_000 });
  const people = useQuery({ queryKey: peopleKey, queryFn: () => api<PeopleData>("GET", "/admin/people"), enabled: admin });

  if (!admin) {
    return (
      <Page name="Admin" title="Admin">
        <div className="empty-box">
          <b>{meta.authEnabled ? "This page is the admin's" : "There is nothing to administer"}</b>
          <p>{meta.authEnabled ? "Only the account that ADMIN_EMAIL names can open it." : "Sign-in is off, so this server has one space and no accounts. Turn sign-in on to let other people in and to see them here."}</p>
          <div className="actions">
            <Link className="btn" to="/">
              Back to your projects
            </Link>
          </div>
        </div>
      </Page>
    );
  }

  const numbers = overview.data;
  return (
    <Page name="Admin" title="Admin" sub="This server in numbers, and who can use it. You see how much everybody keeps, never what it is." wide>
      {numbers ? (
        <div className="stats">
          <Tile label="Accounts" value={numbers.accounts} sub={[numbers.waiting ? `${numbers.waiting} invited, not signed in yet` : "", numbers.locked ? `${numbers.locked} locked out` : ""].filter(Boolean).join(" · ") || undefined} />
          <Tile label="Projects" value={numbers.projects} sub={plural(numbers.slides, "slide")} />
          <Tile label="Screenshots" value={numbers.shots} sub={plural(numbers.images, "logo or image", "logos and images")} />
          <Tile label="Renders made" value={numbers.renders} sub={`${numbers.renderAllowance} for a new account`} />
          <Tile label="Storage" value={size(numbers.bytes)} sub="Uploads and renders" />
        </div>
      ) : (
        <Loading error={overview.error} />
      )}
      {people.data ? <PeopleLists data={people.data} /> : <Loading error={people.error} />}
    </Page>
  );
}

function PeopleLists({ data }: { data: PeopleData }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: peopleKey });
    await queryClient.invalidateQueries({ queryKey: overviewKey });
  };
  const byList = data.signup === "list";
  const [opening, setOpening] = useState(false);

  const putMode = async (mode: "open" | "list") => {
    await api("PUT", "/admin/signup", { mode });
    await refresh();
  };
  // A select also changes by an arrow key or a typed letter, so letting strangers in is asked first.
  const setMode = (mode: string) => (mode === "open" ? setOpening(true) : attempt(() => putMode("list"))());
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
  const remove = (person: Person) => {
    const request = async () => {
      await api("DELETE", "/admin/people", { email: person.email });
      await refresh();
    };
    // Someone who never signed in has nothing to lose with it.
    if (!person.joinedAt) return attempt(request);
    return () => ask({ title: `Remove ${person.email}?`, text: "All of their projects go with them. This cannot be undone.", action: "Remove", running: "Removing…", danger: true, run: request });
  };

  return (
    <>
      <Part title="Who can sign in" sub="Everybody signs in with Google and gets a private space: their own projects, screenshots and tokens. Nobody sees anybody else's work.">
        <div className="list">
          <Row title="Sign-in is open to" sub={byList ? "Add the Google address of everyone you want to let in." : "Anybody who finds this address can sign in, make projects and render on your server."}>
            <Select
              label="Sign-in is open to"
              options={[
                ["open", "Anyone with a Google account"],
                ["list", "Only the people listed here"],
              ]}
              value={data.signup}
              onChange={setMode}
            />
          </Row>
        </div>
      </Part>
      {opening ? (
        <Confirm
          title="Let anyone sign in?"
          action="Open sign-in"
          running="Opening…"
          run={async () => {
            await putMode("open");
            setOpening(false);
            toast("Anyone with a Google account can sign in now.", "", 8000, { text: "Undo", run: attempt(() => putMode("list")) });
          }}
          onClose={() => setOpening(false)}
        >
          Anybody who finds this address could sign in with Google, make projects and render on your server.
        </Confirm>
      ) : null}

      <Part
        title="People"
        sub="Each account gets a number of renders, and every export uses one. Yours are not counted."
        actions={
          byList ? (
            <form
              className="row"
              onSubmit={(event) => {
                event.preventDefault();
                add(email)();
              }}
            >
              <input type="email" required maxLength={254} placeholder="name@gmail.com" aria-label="Google address to let in" value={email} onChange={(event) => setEmail(event.target.value)} />
              <button className="btn" type="submit">
                Add
              </button>
            </form>
          ) : null
        }
      >
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Projects</th>
              <th>Storage</th>
              <th>Renders</th>
              <th className="extra">Joined</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.people.map((person) => (
              <tr key={person.email}>
                <td className="lead">
                  <span>
                    {person.name || person.email}
                    {person.admin ? <span className="pill">Admin</span> : null}
                    {person.access ? null : (
                      <span className="pill warn" title="Not on the list, so this account cannot sign in.">
                        Locked out
                      </span>
                    )}
                  </span>
                  {person.name ? <span className="dim">{person.email}</span> : null}
                </td>
                <td>{person.joinedAt ? (person.projects ?? 0) : "–"}</td>
                <td>{person.bytes == null ? "–" : size(person.bytes)}</td>
                <td>
                  {!person.renders ? (
                    "–"
                  ) : person.renders.left == null ? (
                    <>
                      {person.renders.made} made <span className="dim">· not counted</span>
                    </>
                  ) : (
                    <button className="link" type="button" title="Change how many renders this account has left" onClick={setRenders(person)}>
                      {person.renders.made} made · {person.renders.left} left
                    </button>
                  )}
                </td>
                <td className="extra dim">{person.joinedAt ? day(person.joinedAt) : "Not signed in yet"}</td>
                <td className="end">
                  {person.access ? null : (
                    <button className="btn small" type="button" onClick={add(person.email)}>
                      Allow
                    </button>
                  )}
                  {person.admin ? null : (
                    <button className="btn small quiet danger" type="button" onClick={remove(person)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Part>
    </>
  );
}
