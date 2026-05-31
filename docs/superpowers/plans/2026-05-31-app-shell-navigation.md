# App Shell + Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the tau-web-ui frontend into a persistent shell (left sidebar menu + top navbar + footer) with URL routing via React Router, converting the store-driven Runs/Trace view-switch into routed, deep-linkable pages.

**Architecture:** `react-router-dom` v6. `main.tsx` wraps the app in `<BrowserRouter>`; `App.tsx` is a route table whose single layout route renders `AppLayout` (Sidebar + Navbar + `<Outlet/>` + Footer). Trace becomes `/runs/:id` (deep-linkable); `TracePage` opens/closes the trace from the URL. Dashboard and Health are "coming soon" stub pages.

**Tech Stack:** React 18, react-router-dom v6, Tailwind (Slate Compact tokens), Zustand, Vitest + React Testing Library, Playwright.

**Source spec:** `docs/superpowers/specs/2026-05-31-app-shell-navigation-design.md`. **CI gate:** ESLint + Prettier + the type-gen drift gate are enforced — keep every commit lint/format clean (`pnpm lint && pnpm format:check`) and run `pnpm vitest run` before each commit.

---

## File structure

```
web/src/app/AppLayout.tsx     # shell: Sidebar | (Navbar + Outlet) ; Footer
web/src/app/Sidebar.tsx       # brand + NavLinks (Dashboard/Runs/Health)
web/src/app/Navbar.tsx        # page title + project/engine/version (replaces ProjectBar)
web/src/app/Footer.tsx        # version + gateway status + links
web/src/app/ProjectBar.tsx    # DELETED (superseded by Navbar)
web/src/dashboard/DashboardPage.tsx  # stub
web/src/health/HealthPage.tsx        # stub
web/src/runs/RunsPage.tsx     # wraps RunsView
web/src/trace/TracePage.tsx   # reads :id, opens/closes trace
web/src/App.tsx               # <Routes> table
web/src/main.tsx              # <BrowserRouter>
web/src/store/store.ts        # + health/loadHealth ; launch decoupled
web/src/runs/RunsView.tsx     # navigate on row open
web/src/runs/Launcher.tsx     # navigate after launch
web/src/trace/TraceView.tsx   # back button → navigate
```

---

### Task 1: Store — health slice + decouple launch

**Files:**
- Modify: `web/src/store/store.ts`
- Test: `web/src/store/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe` (or a new one) in `web/src/store/store.test.ts`:

```ts
import { vi } from "vitest";

describe("store.loadHealth", () => {
  it("stores health from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          gateway_ok: true,
          engine_ok: true,
          tau_bin: "x",
          tau_version: "0.0.0-mock",
        }),
      }),
    );
    await useStore.getState().loadHealth();
    expect(useStore.getState().health?.tau_version).toBe("0.0.0-mock");
    vi.restoreAllMocks();
  });
});
```

(`vi` may already be imported at the top — if so, don't duplicate the import.)

Run: `cd web && pnpm vitest run src/store/store.test.ts` → FAIL (`loadHealth`/`health` not on the store).

- [ ] **Step 2: Implement the health slice + decouple launch**

In `web/src/store/store.ts`:

1. Extend the import from the API client to include `getHealth` and the `Health` type:

```ts
import {
  getProject,
  listRuns,
  launchRun,
  getTrace,
  cancelRun,
  openRunSocket,
  getHealth,
  type Project,
  type Health,
} from "../api/client";
```

2. Add to the `AppStore` interface (near `project`):

```ts
  health: Health | null;
```

and (near `loadProject`):

```ts
  loadHealth: () => Promise<void>;
```

3. In the `create<AppStore>(...)` initial state, add `health: null,` next to `project: null,`.

4. Add the action (next to `loadProject`):

```ts
  loadHealth: async () => {
    try {
      set({ health: await getHealth() });
    } catch {
      /* gateway unreachable — leave health null */
    }
  },
```

5. **Decouple `launch` from navigation** — replace the existing `launch` action with:

```ts
  launch: async (agent, prompt) => {
    const id = await launchRun(agent, prompt);
    await get().refreshRuns();
    return id;
  },
```

(Removes the internal `openTrace(id)` call — navigation is now the component's job. `openTrace`/`closeTrace`/`applyWs`/`currentTrace` are unchanged.)

- [ ] **Step 3: Run tests**

Run: `cd web && pnpm vitest run` → all pass (the new loadHealth test + existing 17). Then `pnpm lint && pnpm format:check && pnpm build`.

- [ ] **Step 4: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/store/store.ts web/src/store/store.test.ts
git commit -m "feat(web): store health slice; decouple launch from navigation"
```

---

### Task 2: Shell components (Sidebar, Navbar, Footer, AppLayout)

**Files:**
- Create: `web/src/app/AppLayout.tsx`, `web/src/app/Sidebar.tsx`, `web/src/app/Navbar.tsx`, `web/src/app/Footer.tsx`
- Test: `web/src/app/Sidebar.test.tsx`, `web/src/app/Navbar.test.tsx`, `web/src/app/Footer.test.tsx`

> These are standalone in this task (not wired into `App` yet) so existing tests/app keep working. `ProjectBar` still exists until Task 3.

- [ ] **Step 1: Install react-router-dom**

```bash
cd web && pnpm add react-router-dom@^6
```

- [ ] **Step 2: Sidebar + failing test**

Create `web/src/app/Sidebar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("renders nav links with hrefs", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /runs/i })).toHaveAttribute("href", "/runs");
    expect(screen.getByRole("link", { name: /health/i })).toHaveAttribute("href", "/health");
  });
});
```

Run → FAIL. Then create `web/src/app/Sidebar.tsx`:

```tsx
import { NavLink } from "react-router-dom";

const ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: "▦" },
  { to: "/runs", label: "Runs", icon: "≣" },
  { to: "/health", label: "Health", icon: "♥" },
];

export function Sidebar() {
  return (
    <aside className="flex w-[150px] flex-col gap-1 border-r border-border bg-surface px-2 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        <span className="h-4 w-4 rounded bg-accent" />
        <strong className="text-xs">tau-web-ui</strong>
      </div>
      {ITEMS.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
              isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"
            }`
          }
        >
          <span aria-hidden>{it.icon}</span>
          {it.label}
        </NavLink>
      ))}
    </aside>
  );
}
```

Run `pnpm vitest run src/app/Sidebar.test.tsx` → PASS.

- [ ] **Step 3: Navbar + failing test**

Create `web/src/app/Navbar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useStore } from "../store/store";

describe("Navbar", () => {
  it("shows the project path and tau version", () => {
    useStore.setState({
      project: { project_path: "/p/demo", agents: ["greeter"], tau_version: "0.0.0-mock" },
    });
    render(
      <MemoryRouter initialEntries={["/runs"]}>
        <Navbar />
      </MemoryRouter>,
    );
    expect(screen.getByText(/\/p\/demo/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
  });
});
```

Run → FAIL. Then create `web/src/app/Navbar.tsx`:

```tsx
import { useLocation } from "react-router-dom";
import { useStore } from "../store/store";

function titleFor(pathname: string, agent?: string): string {
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/runs/")) return `Trace · ${agent ?? "…"}`;
  if (pathname.startsWith("/runs")) return "Runs";
  if (pathname.startsWith("/health")) return "Health";
  return "tau-web-ui";
}

export function Navbar() {
  const project = useStore((s) => s.project);
  const agent = useStore((s) => s.currentTrace?.run.agent_id);
  const { pathname } = useLocation();

  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
      <strong className="text-sm">{titleFor(pathname, agent)}</strong>
      <span className="ml-auto font-mono text-xs text-muted">
        {project?.project_path ?? "connecting…"}
      </span>
      <span
        title={project ? "engine reachable" : "no engine"}
        className={`h-2.5 w-2.5 rounded-full ${project ? "bg-st-ok" : "bg-st-error"}`}
      />
      <span className="text-xs text-muted">tau {project?.tau_version ?? "—"}</span>
    </header>
  );
}
```

(Navbar reads `project` from the store; the bootstrap `loadProject()` call lives in `AppLayout`, not here.) Run `pnpm vitest run src/app/Navbar.test.tsx` → PASS.

- [ ] **Step 4: Footer + failing test**

Create `web/src/app/Footer.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Footer } from "./Footer";
import { useStore } from "../store/store";

describe("Footer", () => {
  it("shows version, gateway status, and a GitHub link", () => {
    useStore.setState({
      health: { gateway_ok: true, engine_ok: true, tau_bin: "x", tau_version: "0.0.0-mock" },
    });
    render(<Footer />);
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
    expect(screen.getByText(/gateway ok/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /github/i }).getAttribute("href")).toContain(
      "github.com",
    );
  });
});
```

Run → FAIL. Then create `web/src/app/Footer.tsx`:

```tsx
import { useStore } from "../store/store";

const REPO = "https://github.com/LEBOCQTitouan/tau-web-ui";

export function Footer() {
  const health = useStore((s) => s.health);
  const ok = health?.engine_ok ?? false;
  return (
    <footer className="flex items-center gap-3 border-t border-border bg-surface px-4 py-1.5 text-[11px] text-muted">
      <span>tau-web-ui</span>
      <span>·</span>
      <span>tau {health?.tau_version ?? "—"}</span>
      <span>·</span>
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-st-ok" : "bg-st-error"}`} />
        {ok ? "gateway ok" : "gateway down"}
      </span>
      <span className="ml-auto flex gap-3">
        <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-fg">
          GitHub
        </a>
        <a href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer" className="hover:text-fg">
          docs
        </a>
      </span>
    </footer>
  );
}
```

Run `pnpm vitest run src/app/Footer.test.tsx` → PASS.

- [ ] **Step 5: AppLayout**

Create `web/src/app/AppLayout.tsx`:

```tsx
import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useStore } from "../store/store";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

export function AppLayout() {
  const loadProject = useStore((s) => s.loadProject);
  const loadHealth = useStore((s) => s.loadHealth);
  useEffect(() => {
    loadProject().catch(() => {});
    loadHealth().catch(() => {});
  }, [loadProject, loadHealth]);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar />
          <main className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 6: Verify + commit**

Run: `cd web && pnpm vitest run && pnpm lint && pnpm format:check && pnpm build`
Expected: all green (3 new tests + existing 18; ProjectBar untouched).

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/app/Sidebar.tsx web/src/app/Sidebar.test.tsx web/src/app/Navbar.tsx web/src/app/Navbar.test.tsx web/src/app/Footer.tsx web/src/app/Footer.test.tsx web/src/app/AppLayout.tsx web/package.json web/pnpm-lock.yaml
git commit -m "feat(web): shell components — Sidebar, Navbar, Footer, AppLayout"
```

---

### Task 3: Pages + routing cutover

**Files:**
- Create: `web/src/dashboard/DashboardPage.tsx`, `web/src/health/HealthPage.tsx`, `web/src/runs/RunsPage.tsx`, `web/src/trace/TracePage.tsx`, `web/src/app/routing.test.tsx`
- Modify: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/runs/RunsView.tsx`, `web/src/runs/Launcher.tsx`, `web/src/trace/TraceView.tsx`
- Delete: `web/src/app/ProjectBar.tsx`, `web/src/app/ProjectBar.test.tsx`

- [ ] **Step 1: Stub pages**

Create `web/src/dashboard/DashboardPage.tsx`:

```tsx
export function DashboardPage() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="rounded-lg border border-border bg-surface px-8 py-10 text-center">
        <h2 className="text-base font-semibold">Dashboard</h2>
        <p className="mt-1 text-sm text-muted">Coming soon.</p>
      </div>
    </div>
  );
}
```

Create `web/src/health/HealthPage.tsx`:

```tsx
export function HealthPage() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="rounded-lg border border-border bg-surface px-8 py-10 text-center">
        <h2 className="text-base font-semibold">Health checks</h2>
        <p className="mt-1 text-sm text-muted">Coming soon.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: RunsPage + TracePage**

Create `web/src/runs/RunsPage.tsx`:

```tsx
import { RunsView } from "./RunsView";

export function RunsPage() {
  return <RunsView />;
}
```

Create `web/src/trace/TracePage.tsx`:

```tsx
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../store/store";
import { TraceView } from "./TraceView";

export function TracePage() {
  const { id } = useParams<{ id: string }>();
  const openTrace = useStore((s) => s.openTrace);
  const closeTrace = useStore((s) => s.closeTrace);
  useEffect(() => {
    if (id) openTrace(id).catch(() => {});
    return () => closeTrace();
  }, [id, openTrace, closeTrace]);
  return <TraceView />;
}
```

- [ ] **Step 3: Rewire RunsView (navigate on open) + add a catch on refreshRuns**

Replace `web/src/runs/RunsView.tsx`:

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const refreshRuns = useStore((s) => s.refreshRuns);
  const navigate = useNavigate();

  useEffect(() => {
    refreshRuns().catch(() => {});
  }, [refreshRuns]);

  return (
    <section className="p-4">
      <h2 className="mb-3 text-base font-semibold">Runs</h2>
      <Launcher />
      <RunsTable runs={runs} onOpen={(id) => navigate(`/runs/${id}`)} />
    </section>
  );
}
```

- [ ] **Step 4: Rewire Launcher (navigate after launch)**

Replace `web/src/runs/Launcher.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";

export function Launcher() {
  const project = useStore((s) => s.project);
  const launch = useStore((s) => s.launch);
  const navigate = useNavigate();
  const [agent, setAgent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const agents = project?.agents ?? [];
  const selected = agent || agents[0] || "";

  async function onRun() {
    if (!selected || !prompt.trim()) return;
    setBusy(true);
    try {
      const id = await launch(selected, prompt);
      setPrompt("");
      navigate(`/runs/${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setAgent(e.target.value)}
        aria-label="agent"
        className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
      >
        {agents.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <input
        className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
        placeholder="Prompt…"
        value={prompt}
        aria-label="prompt"
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onRun()}
      />
      <button
        onClick={onRun}
        disabled={busy || !selected}
        className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
      >
        {busy ? "Running…" : "Run"}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: TraceView back button → navigate (drop closeTrace usage)**

In `web/src/trace/TraceView.tsx`: add `import { useNavigate } from "react-router-dom";`, replace `const close = useStore((s) => s.closeTrace);` with `const navigate = useNavigate();`, and change the back button to:

```tsx
        <button onClick={() => navigate("/runs")} className="text-xs text-accent">
          ← Back to runs
        </button>
```

(Everything else in TraceView — tab state, panes — stays. WS cleanup now happens via `TracePage` unmount.)

- [ ] **Step 6: main.tsx → BrowserRouter**

Replace `web/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./index.css";
import "@xyflow/react/dist/style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 7: App.tsx → route table**

Replace `web/src/App.tsx`:

```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { DashboardPage } from "./dashboard/DashboardPage";
import { HealthPage } from "./health/HealthPage";
import { RunsPage } from "./runs/RunsPage";
import { TracePage } from "./trace/TracePage";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<TracePage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="*" element={<Navigate to="/runs" replace />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 8: Delete ProjectBar + its test**

```bash
cd /Users/titouanlebocq/code/tau-ui
git rm web/src/app/ProjectBar.tsx web/src/app/ProjectBar.test.tsx
```

- [ ] **Step 9: Routing smoke test**

Create `web/src/app/routing.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ currentTrace: null }));

describe("routing", () => {
  it("renders the Runs page at /runs", () => {
    render(
      <MemoryRouter initialEntries={["/runs"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });

  it("renders the Dashboard stub at /dashboard", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("redirects unknown paths to /runs", () => {
    render(
      <MemoryRouter initialEntries={["/nope"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Verify + commit**

Run: `cd web && pnpm vitest run && pnpm lint && pnpm format:check && pnpm build`
Expected: all green. The suite no longer has `ProjectBar.test`; it now has `Navbar.test`, `Sidebar.test`, `Footer.test`, `routing.test`.

```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "feat(web): route table + shell pages; trace is now /runs/:id (deep-linkable)"
```

---

### Task 4: End-to-end verification

**Files:** none (verification + evidence)

- [ ] **Step 1: Build the Rust binaries (unchanged, but the e2e needs them) + run e2e**

```bash
cd /Users/titouanlebocq/code/tau-ui && cargo build --workspace
cd web && pnpm exec playwright install chromium && pnpm e2e
```
Expected: both Playwright tests pass. The flows now exercise routing: `goto('/')` redirects to `/runs`; launching navigates to `/runs/:id`; clicking a run row navigates to its trace; `← Back to runs` returns to `/runs`. If a test fails:
- A selector that broke means a visible string/role changed — restore it in the component (don't weaken the test).
- If `goto('/')` lands on a blank page, the `/` → `/runs` redirect or `BrowserRouter` wrapping is wrong — fix `App.tsx`/`main.tsx`.

- [ ] **Step 2: Deep-link smoke (manual)**

Run the gateway + `pnpm dev`, open `http://localhost:5173/dashboard` directly → the Dashboard stub renders inside the shell (proves SPA history-fallback + deep links). Open a real run, copy its `/runs/<id>` URL, paste into a fresh tab → the trace loads directly. (No commit; this is a manual confirmation of acceptance criterion #2.)

- [ ] **Step 3: Refresh visual evidence + commit**

`pnpm e2e` rewrote `docs/verification/trace-complete.png` (now showing the shell). Commit it:

```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "test(web): verify shell + routing keep unit + e2e green; refresh screenshot"
```

- [ ] **Step 4: Push and confirm CI green**

```bash
git push
gh run watch "$(gh run list --branch impl/gateway-v1 --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 15
```
Expected: `rust`, `web`, `e2e` all succeed. Fix any failure at its source and re-push until green.

---

## Self-review

1. **Spec coverage:** §1 routing → Task 3 (App routes, main BrowserRouter). §2 components: AppLayout/Sidebar/Navbar/Footer → Task 2; pages → Task 3. §3 nav/data-flow: row-click navigate → Task 3 (RunsView); launch decoupled + Launcher navigate → Task 1 (store) + Task 3 (Launcher); TraceView back → Task 3; store health slice → Task 1; TracePage open/close → Task 3. §4 testing: Navbar/Sidebar/Footer tests → Task 2; routing test → Task 3; ProjectBar removed → Task 3; e2e preserved → Task 4. §5 acceptance → Task 4 (e2e + manual deep-link). ✓
2. **Placeholder scan:** every file is given in full; no TBD. ✓
3. **Type consistency:** `Health` type imported from the API client (already exported there as `interface Health`); `health`/`loadHealth` added to `AppStore` in Task 1 and consumed by Footer/AppLayout in Task 2; `launch` signature unchanged (still `(agent, prompt) => Promise<string>`), only its body changed; `NavLink`/`useNavigate`/`useParams`/`useLocation`/`Outlet`/`Navigate`/`MemoryRouter`/`Routes`/`Route` all from `react-router-dom` (v6). RunsTable's `onOpen(id)` contract is unchanged (RunsView supplies a navigate callback). ✓
4. **Gap check:** `getHealth` already exists in `web/src/api/client.ts` (returns `Health`); no new API client work needed. The e2e's run-row click already uses a `table tbody tr` locator (robust to the shell), so reopen still works. ✓
