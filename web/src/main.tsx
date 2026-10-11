// The Studio's shell: the sidebar, the routes, and what every page shares.
// Routes live in the URL hash, so the #/<project> links that the MCP tools and the CLI print keep working.

import "./app.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createHashHistory, createRootRoute, createRoute, createRouter, Link, Navigate, Outlet, RouterProvider } from "@tanstack/react-router";
import { type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { detailQuery, errorText, metaQuery, projectsQuery } from "./api.ts";
import { DialogHost, type DialogKind, OpenDialog, useOpenDialog } from "./dialogs.tsx";
import { dropTarget, ProjectPage } from "./project.tsx";
import { Icon, Toasts } from "./ui.tsx";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const PAGE = "M4.2 1.8h4.9l2.7 2.7v9.7H4.2zM9 2v2.7h2.7";
const PLUS = "M8 3.5v9M3.5 8h9";
const BOLT = "M9 1.8 3.8 9H8l-1 5.2L12.2 7H8z";
const LEAVE = "M6.5 2.5h-3v11h3M10 5l3 3-3 3M13 8H6.5";

/** The frame of a page that has no project to show. */
function Blank({ children }: { children?: ReactNode }) {
  return (
    <div className="main">
      <header className="bar" />
      <div className="content">
        <div className="workspace">{children}</div>
      </div>
    </div>
  );
}

function Message({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <Blank>
      <section className="empty">
        <h1>{title}</h1>
        <p>{text}</p>
        <div className="actions">{children}</div>
      </section>
    </Blank>
  );
}

function Shell() {
  const meta = useQuery(metaQuery);
  // Polled, so projects that an agent creates through MCP show up without a reload.
  const projects = useQuery({ ...projectsQuery, refetchInterval: 3000 });
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  if (!meta.data || !projects.data) {
    const failure = meta.error ?? projects.error;
    if (!failure) return null;
    return (
      <Message title="appShots could not load" text={errorText(failure)}>
        <button className="btn" type="button" onClick={() => location.reload()}>
          Reload
        </button>
      </Message>
    );
  }

  const { account, authEnabled } = meta.data;
  const name = account ? account.name || account.email : "appShots";
  return (
    <OpenDialog.Provider value={setDialog}>
      <nav className="sidebar" aria-label="Projects and settings">
        <div className="who">
          <span className="avatar" aria-hidden="true">
            {name[0]!.toUpperCase()}
          </span>
          <span className="who-text">
            <span className="who-name">{name}</span>
            <span className="who-sub">{account?.email ?? ""}</span>
          </span>
        </div>

        <div className="nav-group grow">
          <div className="nav-label">Projects</div>
          <div id="project-list">
            {projects.data.map((project) => (
              <Link key={project.id} className="nav-item" activeProps={{ className: "on" }} to="/$projectId" params={{ projectId: project.id }}>
                <Icon path={PAGE} />
                <span className="nav-text">{project.name}</span>
              </Link>
            ))}
          </div>
          <button className="nav-item quiet" type="button" onClick={() => setDialog("new")}>
            <Icon path={PLUS} />
            <span className="nav-text">New project</span>
          </button>
        </div>

        <div className="nav-group">
          <button className="nav-item" type="button" onClick={() => setDialog("connect")}>
            <Icon path={BOLT} />
            <span className="nav-text">Connect an agent</span>
          </button>
          {account?.admin ? (
            <button className="nav-item" type="button" onClick={() => setDialog("people")}>
              <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="6" cy="5.5" r="2.3" />
                <path d="M1.8 13c.5-2.1 2.1-3.2 4.2-3.2s3.7 1.1 4.2 3.2M10.6 3.5a2.2 2.2 0 0 1 0 4.2M12 9.9c1.2.4 2 1.4 2.3 3.1" />
              </svg>
              <span className="nav-text">People</span>
            </button>
          ) : null}
          {account ? (
            <button className="nav-item" type="button" onClick={() => setDialog("account")}>
              <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="5.5" r="2.5" />
                <path d="M3 13.5c.6-2.4 2.6-3.5 5-3.5s4.4 1.1 5 3.5" />
              </svg>
              <span className="nav-text">Account</span>
            </button>
          ) : null}
          {authEnabled ? (
            <form method="post" action="/logout">
              <button className="nav-item" type="submit">
                <Icon path={LEAVE} />
                <span className="nav-text">Sign out</span>
              </button>
            </form>
          ) : null}
        </div>
      </nav>

      <Outlet />

      <DialogHost kind={dialog} meta={meta.data} close={() => setDialog(null)} />
      <Toasts />
      <DropVeil />
    </OpenDialog.Provider>
  );
}

/** Files dragged anywhere over the window upload into the open project. */
function DropVeil() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth++;
      setShown(dropTarget.upload != null);
    };
    const over = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setShown(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setShown(false);
      dropTarget.upload?.([...event.dataTransfer!.files]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return shown ? <div className="drop-veil">Drop screenshots to upload</div> : null;
}

function Home() {
  const first = useQuery(projectsQuery).data?.[0];
  const open = useOpenDialog();
  if (first) return <Navigate to="/$projectId" params={{ projectId: first.id }} replace />;
  return (
    <Message title="App Store screenshots, on tap" text="Create a project here, or let your agent build one. Either way the result shows up here in the Studio.">
      <button className="btn primary" type="button" onClick={() => open("new")}>
        New project
      </button>
      <button className="btn" type="button" onClick={() => open("connect")}>
        Connect an agent
      </button>
    </Message>
  );
}

function ProjectRoute() {
  const { projectId } = projectRoute.useParams();
  const meta = useQuery(metaQuery).data!;
  const detail = useQuery(detailQuery(projectId));
  const open = useOpenDialog();
  if (detail.data) return <ProjectPage key={projectId} meta={meta} initial={detail.data} openConnect={() => open("connect")} />;
  if (!detail.error) return <Blank />;
  return (
    <Message title="This project could not be opened" text={errorText(detail.error)}>
      <Link className="btn" to="/">
        Back to your projects
      </Link>
    </Message>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: "$projectId", component: ProjectRoute });

const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, projectRoute]), history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
