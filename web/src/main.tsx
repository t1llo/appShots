// The Studio's shell: the sidebar, the routes, and what every page shares.
// Routes live in the URL hash, so the #/<project> links that the MCP tools and the CLI print keep working.

import "./app.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createHashHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@tanstack/react-router";
import { type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { detailQuery, errorText, type Meta, metaQuery, projectsQuery } from "./api.ts";
import { DialogHost, type DialogKind, OpenDialog, useOpenDialog } from "./dialogs.tsx";
import { MockupsPage } from "./mockups.tsx";
import { AdminPage, ProjectsPage, SettingsPage } from "./pages.tsx";
import { dropTarget, ProjectPage } from "./project.tsx";
import { RenderList, useRenderNotes, useRenders } from "./renders.tsx";
import { Icon, Menu, Toasts } from "./ui.tsx";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const PAGE = "M4.2 1.8h4.9l2.7 2.7v9.7H4.2zM9 2v2.7h2.7";
const PLUS = "M8 3.5v9M3.5 8h9";
const BOLT = "M9 1.8 3.8 9H8l-1 5.2L12.2 7H8z";
const BOOK = "M3.5 12V4a1.5 1.5 0 0 1 1.5-1.5h7.5v9M5 10.5h7.5v3H5a1.5 1.5 0 0 1 0-3z";
const GRID = "M2.5 2.5h4.4v4.4H2.5zM9.1 2.5h4.4v4.4H9.1zM2.5 9.1h4.4v4.4H2.5zM9.1 9.1h4.4v4.4H9.1z";
const CHART = "M3 13.2V8.6M8 13.2V2.8M13 13.2V6";

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
  const renders = useRenders();
  useRenderNotes(renders.data?.jobs);
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

  const { account } = meta.data;
  const name = account ? account.name || account.email : "appShots";
  return (
    <OpenDialog.Provider value={setDialog}>
      <nav className="sidebar" aria-label="Projects and settings">
        <Link className="who" to="/settings" title="Settings">
          <span className="avatar" aria-hidden="true">
            {name[0]!.toUpperCase()}
          </span>
          <span className="who-text">
            <span className="who-name">{name}</span>
            <span className="who-sub">{account?.email ?? "Studio"}</span>
          </span>
        </Link>

        <div className="nav-group">
          <Link className="nav-item" activeProps={{ className: "on" }} activeOptions={{ exact: true }} to="/">
            <Icon path={GRID} />
            <span className="nav-text">All projects</span>
          </Link>
        </div>

        <div className="nav-group grow">
          <div className="nav-label">
            Projects
            <button className="icon-btn plain" type="button" title="New project" aria-label="New project" onClick={() => setDialog("new")}>
              <Icon path={PLUS} />
            </button>
          </div>
          <div id="project-list">
            {projects.data.map((project) => (
              <div key={project.id} className="nav-row">
                <Link className="nav-item" activeProps={{ className: "on" }} activeOptions={{ includeSearch: false }} to="/$projectId" params={{ projectId: project.id }}>
                  <Icon path={PAGE} />
                  <span className="nav-text">{project.name}</span>
                </Link>
                <Menu
                  label={`Rename or delete ${project.name}`}
                  items={[
                    { text: "Rename", run: () => setDialog({ rename: project }) },
                    { text: "Delete…", danger: true, run: () => setDialog({ remove: project }) },
                  ]}
                />
              </div>
            ))}
          </div>
          {projects.data.length === 0 ? (
            <button className="nav-item quiet" type="button" onClick={() => setDialog("new")}>
              <Icon path={PLUS} />
              <span className="nav-text">New project</span>
            </button>
          ) : null}
        </div>

        {renders.data ? <RenderList renders={renders.data} /> : null}

        <div className="nav-group foot">
          <button className="nav-item" type="button" onClick={() => setDialog("connect")}>
            <Icon path={BOLT} />
            <span className="nav-text">Connect an agent</span>
          </button>
          <a className="nav-item" href="/docs" target="_blank" rel="noreferrer">
            <Icon path={BOOK} />
            <span className="nav-text">Docs</span>
          </a>
          {account?.admin ? (
            <Link className="nav-item" activeProps={{ className: "on" }} to="/admin">
              <Icon path={CHART} />
              <span className="nav-text">Admin</span>
            </Link>
          ) : null}
          <Link className="nav-item" activeProps={{ className: "on" }} to="/settings">
            <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 5h6.2M12.3 5h1.2M2.5 11h1.2M7.3 11h6.2" />
              <circle cx="10.5" cy="5" r="1.8" />
              <circle cx="5.5" cy="11" r="1.8" />
            </svg>
            <span className="nav-text">Settings</span>
          </Link>
        </div>
      </nav>

      <Outlet />

      <DialogHost kind={dialog} meta={meta.data} close={() => setDialog(null)} />
      <Toasts />
      <DropVeil />
    </OpenDialog.Provider>
  );
}

/**
 * Files dragged anywhere over the window upload into the open project: as screenshots, or as logos and images
 * when they are let go over that part of the page.
 */
function DropVeil() {
  const [shown, setShown] = useState(false);
  const [images, setImages] = useState(false);
  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");
    const overImages = (event: DragEvent) => event.target instanceof Element && event.target.closest("[data-drop='images']") != null;
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth++;
      setShown(dropTarget.upload != null);
    };
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setImages(overImages(event));
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
      dropTarget.upload?.([...event.dataTransfer!.files], overImages(event) ? "image" : "shot");
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
  return shown ? <div className="drop-veil">{images ? "Drop to add as logos and images" : "Drop screenshots to upload"}</div> : null;
}

/** A project's page: its slides, what it is made of, or its mockups. */
function ProjectRoute({ projectId, view }: { projectId: string; view: "slides" | "assets" | "mockups" }) {
  const meta = useQuery(metaQuery).data!;
  const detail = useQuery(detailQuery(projectId));
  const open = useOpenDialog();
  if (detail.data) {
    return view === "mockups" ? (
      <MockupsPage key={projectId} meta={meta} initial={detail.data} />
    ) : (
      <ProjectPage key={projectId} meta={meta} initial={detail.data} view={view} openConnect={() => open("connect")} />
    );
  }
  if (!detail.error) return <Blank />;
  return (
    <Message title="This project could not be opened" text={errorText(detail.error)}>
      <Link className="btn" to="/">
        Back to your projects
      </Link>
    </Message>
  );
}

/** A page that needs nothing but what the shell has loaded already. */
const withMeta = (PageOf: (props: { meta: Meta }) => ReactNode) => () => <PageOf meta={useQuery(metaQuery).data!} />;

const rootRoute = createRootRoute({ component: Shell });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: withMeta(ProjectsPage) });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "settings", component: withMeta(SettingsPage) });
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: "admin", component: withMeta(AdminPage) });
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$projectId",
  // #/<project>?view=assets is what the project is made of; anything else is its slides.
  validateSearch: (search: Record<string, unknown>): { view?: "assets" } => (search.view === "assets" ? { view: "assets" } : {}),
  component: () => <ProjectRoute projectId={projectRoute.useParams().projectId} view={projectRoute.useSearch().view ?? "slides"} />,
});
const mockupsRoute = createRoute({ getParentRoute: () => rootRoute, path: "$projectId/mockups", component: () => <ProjectRoute projectId={mockupsRoute.useParams().projectId} view="mockups" /> });

const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, settingsRoute, adminRoute, projectRoute, mockupsRoute]), history: createHashHistory() });

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
