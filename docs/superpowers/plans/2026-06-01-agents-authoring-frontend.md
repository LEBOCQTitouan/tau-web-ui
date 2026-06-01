# Agents Authoring — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gated Agents stub with a real index + per-agent editor (`/projects/:pid/agents`, `/agents/new`, `/agents/:agentId`) that creates/edits/deletes `[agents.<id>]` via the gateway agent API.

**Architecture:** A scoped `api/agents.ts` module (via the existing client chokepoint); an index page (table + New) and an editor page with focused sub-components (`PromptField`, `RequiresToolsEditor`); pages hold local state like `ConfigPage`/`PackagesPage` (no store changes).

**Tech Stack:** React 18, react-router-dom v6, TypeScript, Tailwind (Slate Compact), Vitest + Testing Library + user-event, Playwright.

This is **Plan 2 of 2** for Agents authoring (see `docs/superpowers/specs/2026-06-01-agents-authoring-design.md`). It depends on Plan 1's API + generated types (`AgentDetail`, `AgentPrompt`, `RequiredToolSpec`).

---

## File Structure

**New:**
- `web/src/api/agents.ts` — `listAgents`/`getAgent`/`putAgent`/`deleteAgent`.
- `web/src/agents/AgentsIndexPage.tsx` — index table + New.
- `web/src/agents/AgentEditorPage.tsx` — create/edit form.
- `web/src/agents/PromptField.tsx` — Inline/File prompt toggle.
- `web/src/agents/RequiresToolsEditor.tsx` — repeatable `{name,source,version}` rows.
- Tests: `web/src/api/agents.test.ts`, `web/src/agents/AgentsIndexPage.test.tsx`, `web/src/agents/AgentEditorPage.test.tsx`, `web/src/agents/RequiresToolsEditor.test.tsx`.

**Modified:**
- `web/src/App.tsx` — swap the `agents` StubPage route for the index + editor routes.
- `web/e2e/run.spec.ts` — add an agent create→edit→delete spec.

---

## Task 1: `api/agents.ts`

**Files:**
- Create: `web/src/api/agents.ts`, `web/src/api/agents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/api/agents.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listAgents, getAgent, putAgent, deleteAgent } from "./agents";
import { setActiveProject } from "./client";

beforeEach(() => {
  vi.restoreAllMocks();
  setActiveProject("demo");
});

const agent = {
  id: "writer",
  display_name: "Writer",
  package: null,
  llm_backend: "anthropic",
  prompt: { system: "hi", system_file: null },
  requires_tools: [],
};

describe("agents api", () => {
  it("listAgents GETs the scoped agents path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listAgents();
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents");
  });

  it("getAgent GETs one", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => agent });
    vi.stubGlobal("fetch", f);
    await getAgent("writer");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer");
  });

  it("putAgent PUTs to the agent id; create adds ?create=1", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => agent });
    vi.stubGlobal("fetch", f);
    await putAgent(agent, { create: true });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer?create=1");
    expect(f.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(f.mock.calls[0][1].body).id).toBe("writer");
  });

  it("putAgent without create has no query", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => agent });
    vi.stubGlobal("fetch", f);
    await putAgent(agent);
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer");
  });

  it("deleteAgent DELETEs", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    vi.stubGlobal("fetch", f);
    await deleteAgent("writer");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer");
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd web && pnpm test -- src/api/agents.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `web/src/api/agents.ts`**

```ts
import type { AgentDetail } from "../types/AgentDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listAgents = () => fetch(scopedPath("/agents")).then(json<AgentDetail[]>);

export const getAgent = (id: string) => fetch(scopedPath(`/agents/${id}`)).then(json<AgentDetail>);

export const putAgent = (agent: AgentDetail, opts?: { create?: boolean }) =>
  fetch(scopedPath(`/agents/${agent.id}${opts?.create ? "?create=1" : ""}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(agent),
  }).then(json<AgentDetail>);

export const deleteAgent = (id: string) =>
  fetch(scopedPath(`/agents/${id}`), { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
  });
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && pnpm test -- src/api/agents.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/agents.ts web/src/api/agents.test.ts
git commit -m "feat(web): scoped agents api module"
```

---

## Task 2: `RequiresToolsEditor` + `PromptField`

**Files:**
- Create: `web/src/agents/RequiresToolsEditor.tsx`, `web/src/agents/PromptField.tsx`, `web/src/agents/RequiresToolsEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/agents/RequiresToolsEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequiresToolsEditor } from "./RequiresToolsEditor";
import type { RequiredToolSpec } from "../types/RequiredToolSpec";

describe("RequiresToolsEditor", () => {
  it("adds and edits a tool row", async () => {
    const user = userEvent.setup();
    let tools: RequiredToolSpec[] = [];
    const onChange = vi.fn((t: RequiredToolSpec[]) => (tools = t));
    const { rerender } = render(<RequiresToolsEditor tools={tools} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /add tool/i }));
    expect(onChange).toHaveBeenLastCalledWith([{ name: "", source: "", version: null }]);

    rerender(<RequiresToolsEditor tools={tools} onChange={onChange} />);
    await user.type(screen.getByLabelText("tool name 0"), "fs-read");
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "fs-read", source: "", version: null },
    ]);
  });

  it("removes a tool row", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RequiresToolsEditor
        tools={[{ name: "a", source: "s", version: null }]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /remove tool 0/i }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd web && pnpm test -- src/agents/RequiresToolsEditor.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement both components**

`web/src/agents/RequiresToolsEditor.tsx`:

```tsx
import type { RequiredToolSpec } from "../types/RequiredToolSpec";

export function RequiresToolsEditor({
  tools,
  onChange,
}: {
  tools: RequiredToolSpec[];
  onChange: (t: RequiredToolSpec[]) => void;
}) {
  const input = "rounded border border-border bg-surface px-2 py-1 text-xs";
  const update = (i: number, patch: Partial<RequiredToolSpec>) =>
    onChange(tools.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-1.5">
      {tools.map((t, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            aria-label={`tool name ${i}`}
            placeholder="name"
            className={`flex-1 ${input}`}
            value={t.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            aria-label={`tool source ${i}`}
            placeholder="source"
            className={`flex-[2] ${input}`}
            value={t.source}
            onChange={(e) => update(i, { source: e.target.value })}
          />
          <input
            aria-label={`tool version ${i}`}
            placeholder="version"
            className={`w-20 ${input}`}
            value={t.version ?? ""}
            onChange={(e) => update(i, { version: e.target.value || null })}
          />
          <button
            type="button"
            aria-label={`remove tool ${i}`}
            className="px-2 text-st-error"
            onClick={() => onChange(tools.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="rounded border border-dashed border-accent/50 px-2 py-1 text-xs font-semibold text-accent"
        onClick={() => onChange([...tools, { name: "", source: "", version: null }])}
      >
        + Add tool
      </button>
    </div>
  );
}
```

`web/src/agents/PromptField.tsx`:

```tsx
import type { AgentPrompt } from "../types/AgentPrompt";

export function PromptField({
  mode,
  prompt,
  onModeChange,
  onChange,
}: {
  mode: "system" | "file";
  prompt: AgentPrompt;
  onModeChange: (m: "system" | "file") => void;
  onChange: (p: AgentPrompt) => void;
}) {
  const tab = (active: boolean) =>
    `rounded px-2 py-0.5 text-[10px] font-semibold ${
      active ? "bg-accent text-accent-fg" : "border border-border text-muted"
    }`;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <button type="button" className={tab(mode === "system")} onClick={() => onModeChange("system")}>
          Inline
        </button>
        <button type="button" className={tab(mode === "file")} onClick={() => onModeChange("file")}>
          File
        </button>
      </div>
      {mode === "system" ? (
        <textarea
          aria-label="system prompt"
          className="h-28 w-full rounded border border-border bg-surface px-2 py-1 text-xs"
          value={prompt.system ?? ""}
          onChange={(e) => onChange({ system: e.target.value || null, system_file: null })}
        />
      ) : (
        <input
          aria-label="system prompt file"
          placeholder="agents/researcher.md"
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
          value={prompt.system_file ?? ""}
          onChange={(e) => onChange({ system: null, system_file: e.target.value || null })}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && pnpm test -- src/agents/RequiresToolsEditor.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/agents/RequiresToolsEditor.tsx web/src/agents/PromptField.tsx web/src/agents/RequiresToolsEditor.test.tsx
git commit -m "feat(web): agent prompt + requires.tools sub-editors"
```

---

## Task 3: Index page + route swap

**Files:**
- Create: `web/src/agents/AgentsIndexPage.tsx`, `web/src/agents/AgentsIndexPage.test.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/agents/AgentsIndexPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AgentsIndexPage } from "./AgentsIndexPage";

const agents = [
  {
    id: "greeter",
    display_name: "Greeter",
    package: null,
    llm_backend: "anthropic",
    prompt: { system: null, system_file: null },
    requires_tools: [],
  },
  {
    id: "researcher",
    display_name: "Researcher",
    package: "fs-read@^0.1",
    llm_backend: "anthropic",
    prompt: { system: "x", system_file: null },
    requires_tools: [{ name: "fs-read", source: "s", version: null }],
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => agents }));
});

function renderAt() {
  render(
    <MemoryRouter initialEntries={["/projects/demo/agents"]}>
      <Routes>
        <Route path="/projects/:pid/agents" element={<AgentsIndexPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentsIndexPage", () => {
  it("lists agents and links to the editor + new", async () => {
    renderAt();
    await waitFor(() => expect(screen.getByText("greeter")).toBeInTheDocument());
    expect(screen.getByText("researcher")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new agent/i })).toHaveAttribute(
      "href",
      "/projects/demo/agents/new",
    );
    expect(screen.getByRole("link", { name: "researcher" })).toHaveAttribute(
      "href",
      "/projects/demo/agents/researcher",
    );
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd web && pnpm test -- src/agents/AgentsIndexPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `AgentsIndexPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AgentDetail } from "../types/AgentDetail";
import { listAgents } from "../api/agents";

export function AgentsIndexPage() {
  const { pid } = useParams();
  const [agents, setAgents] = useState<AgentDetail[]>([]);

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">Agents</h2>
        <Link
          to={`/projects/${pid}/agents/new`}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          + New agent
        </Link>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 pr-2 font-medium">agent</th>
            <th className="px-2 py-1 font-medium">display name</th>
            <th className="px-2 py-1 font-medium">llm_backend</th>
            <th className="px-2 py-1 font-medium">package</th>
            <th className="px-2 py-1 font-medium">tools</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-2 font-medium">
                <Link to={`/projects/${pid}/agents/${a.id}`} className="text-accent">
                  {a.id}
                </Link>
              </td>
              <td className="px-2 py-1 text-muted">{a.display_name ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-muted">{a.llm_backend ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-muted">{a.package ?? "—"}</td>
              <td className="px-2 py-1 text-muted">{a.requires_tools.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Swap the route in `App.tsx`**

In `web/src/App.tsx`, add the import:

```tsx
import { AgentsIndexPage } from "./agents/AgentsIndexPage";
import { AgentEditorPage } from "./agents/AgentEditorPage";
```

Replace the agents stub route:

```tsx
        <Route
          path="agents"
          element={<StubPage title="Agents" subtitle="Author agents — coming soon." />}
        />
```
with:
```tsx
        <Route path="agents" element={<AgentsIndexPage />} />
        <Route path="agents/new" element={<AgentEditorPage />} />
        <Route path="agents/:agentId" element={<AgentEditorPage />} />
```

(`AgentEditorPage` is created in Task 4. This step will not typecheck until Task 4 exists — Tasks 3 and 4 build green together. Run the test in Step 5 after Task 4's component file is created; or create an empty `export function AgentEditorPage() { return null; }` stub now and flesh it out in Task 4.)

To keep this task self-contained and green, create a minimal stub `web/src/agents/AgentEditorPage.tsx` now:

```tsx
export function AgentEditorPage() {
  return null;
}
```

- [ ] **Step 5: Run the index test + typecheck**

Run: `cd web && pnpm test -- src/agents/AgentsIndexPage.test.tsx && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/agents/AgentsIndexPage.tsx web/src/agents/AgentsIndexPage.test.tsx web/src/agents/AgentEditorPage.tsx web/src/App.tsx
git commit -m "feat(web): agents index page + routes (editor stub)"
```

---

## Task 4: Editor page (create / edit / delete)

**Files:**
- Modify: `web/src/agents/AgentEditorPage.tsx`
- Create: `web/src/agents/AgentEditorPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/agents/AgentEditorPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { AgentEditorPage } from "./AgentEditorPage";
import { setActiveProject } from "../api/client";

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="loc">{pathname}</div>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:pid/agents/new" element={<><AgentEditorPage /><Probe /></>} />
        <Route path="/projects/:pid/agents/:agentId" element={<><AgentEditorPage /><Probe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  setActiveProject("demo");
});

describe("AgentEditorPage", () => {
  it("create mode PUTs a new agent with ?create=1", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderAt("/projects/demo/agents/new");

    await user.type(screen.getByLabelText("agent id"), "writer");
    await user.type(screen.getByLabelText("display name"), "Writer");
    await user.type(screen.getByLabelText("system prompt"), "you are a writer");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer?create=1");
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.id).toBe("writer");
    expect(body.display_name).toBe("Writer");
    expect(body.prompt.system).toBe("you are a writer");
  });

  it("edit mode loads the agent then saves without ?create", async () => {
    const existing = {
      id: "greeter",
      display_name: "Greeter",
      package: null,
      llm_backend: "anthropic",
      prompt: { system: "hello", system_file: null },
      requires_tools: [],
    };
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => existing }) // GET load
      .mockResolvedValueOnce({ ok: true, json: async () => existing }); // PUT save
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderAt("/projects/demo/agents/greeter");

    await waitFor(() => expect(screen.getByLabelText("display name")).toHaveValue("Greeter"));
    expect(screen.getByLabelText("agent id")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(f.mock.calls[1][0]).toBe("/api/projects/demo/agents/greeter");
  });

  it("rejects an invalid id in create mode", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    renderAt("/projects/demo/agents/new");
    await user.type(screen.getByLabelText("agent id"), "bad id!");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(screen.getByText(/invalid id/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd web && pnpm test -- src/agents/AgentEditorPage.test.tsx`
Expected: FAIL (editor is the `return null` stub).

- [ ] **Step 3: Implement `AgentEditorPage.tsx`**

Replace `web/src/agents/AgentEditorPage.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AgentDetail } from "../types/AgentDetail";
import type { AgentPrompt } from "../types/AgentPrompt";
import { getAgent, putAgent, deleteAgent } from "../api/agents";
import { PromptField } from "./PromptField";
import { RequiresToolsEditor } from "./RequiresToolsEditor";

const ID_RE = /^[A-Za-z0-9_-]+$/;

const blank = (): AgentDetail => ({
  id: "",
  display_name: null,
  package: null,
  llm_backend: null,
  prompt: { system: null, system_file: null },
  requires_tools: [],
});

export function AgentEditorPage() {
  const { pid, agentId } = useParams();
  const isNew = agentId === undefined; // route /agents/new has no :agentId
  const navigate = useNavigate();

  const [a, setA] = useState<AgentDetail>(blank());
  const [promptMode, setPromptMode] = useState<"system" | "file">("system");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew || !agentId) return;
    getAgent(agentId)
      .then((d) => {
        setA(d);
        setPromptMode(d.prompt.system_file ? "file" : "system");
      })
      .catch(() => setError("could not load agent"));
  }, [isNew, agentId]);

  const label = "mb-1 block text-[10px] uppercase tracking-wide text-muted";
  const input = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const set = (patch: Partial<AgentDetail>) => setA((prev) => ({ ...prev, ...patch }));
  const toolCount = useMemo(() => a.requires_tools.length, [a.requires_tools]);

  async function onSave() {
    setError(null);
    const id = isNew ? a.id.trim() : agentId!;
    if (isNew && !ID_RE.test(id)) {
      setError("invalid id — use letters, digits, _ or -");
      return;
    }
    const payload: AgentDetail = {
      ...a,
      id,
      prompt:
        promptMode === "system"
          ? { system: a.prompt.system || null, system_file: null }
          : { system: null, system_file: a.prompt.system_file || null },
    };
    try {
      await putAgent(payload, { create: isNew });
      navigate(`/projects/${pid}/agents/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  async function onDelete() {
    if (isNew || !agentId) return;
    try {
      await deleteAgent(agentId);
      navigate(`/projects/${pid}/agents`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4">
      <button
        type="button"
        onClick={() => navigate(`/projects/${pid}/agents`)}
        className="text-xs text-accent"
      >
        ← all agents
      </button>
      <h2 className="text-base font-semibold">{isNew ? "New agent" : agentId}</h2>

      <div className="rounded-lg border border-border bg-surface p-3 space-y-2.5">
        <div>
          <label className={label}>agent id</label>
          <input
            aria-label="agent id"
            className={input}
            disabled={!isNew}
            value={a.id}
            onChange={(e) => set({ id: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>display name</label>
          <input
            aria-label="display name"
            className={input}
            value={a.display_name ?? ""}
            onChange={(e) => set({ display_name: e.target.value || null })}
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={label}>package</label>
            <input
              aria-label="package"
              className={input}
              placeholder="fs-read@^0.1"
              value={a.package ?? ""}
              onChange={(e) => set({ package: e.target.value || null })}
            />
          </div>
          <div className="w-40">
            <label className={label}>llm_backend</label>
            <input
              aria-label="llm backend"
              className={input}
              placeholder="anthropic"
              value={a.llm_backend ?? ""}
              onChange={(e) => set({ llm_backend: e.target.value || null })}
            />
          </div>
        </div>
        <div>
          <label className={label}>system prompt</label>
          <PromptField
            mode={promptMode}
            prompt={a.prompt}
            onModeChange={setPromptMode}
            onChange={(p: AgentPrompt) => set({ prompt: p })}
          />
        </div>
        <div>
          <label className={label}>requires.tools ({toolCount})</label>
          <RequiresToolsEditor
            tools={a.requires_tools}
            onChange={(t) => set({ requires_tools: t })}
          />
        </div>
      </div>

      {error && <div className="text-xs text-st-error">{error}</div>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          Save
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-st-error/40 px-3 py-1.5 text-xs font-semibold text-st-error"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
```

Note: the create route is `/agents/new` (no `:agentId` param), so in that route `agentId` is `undefined` → `isNew` true. The edit route `/agents/:agentId` provides `agentId`. (The literal id "new" can never collide because the static `agents/new` route is matched first by react-router.)

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && pnpm test -- src/agents/AgentEditorPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full web suite + typecheck**

Run: `cd web && pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/agents/AgentEditorPage.tsx web/src/agents/AgentEditorPage.test.tsx
git commit -m "feat(web): agent editor page (create/edit/delete)"
```

---

## Task 5: E2e + final gate

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Add the agent CRUD spec**

Append to `web/e2e/run.spec.ts`:

```ts
test("create, edit, and delete an agent", async ({ page }) => {
  await page.goto("/projects/demo/agents");
  await expect(page.getByRole("heading", { name: /^agents$/i })).toBeVisible({ timeout: 5000 });

  // create
  await page.getByRole("link", { name: /new agent/i }).click();
  await page.getByLabel("agent id").fill("e2e-bot");
  await page.getByLabel("display name").fill("E2E Bot");
  await page.getByLabel("llm backend").fill("anthropic");
  await page.getByLabel("system prompt").fill("you are an e2e bot");
  await page.getByRole("button", { name: "+ Add tool" }).click();
  await page.getByLabel("tool name 0").fill("fs-read");
  await page.getByLabel("tool source 0").fill("https://example.com/fs-read.git");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // back in edit mode for the new agent; appears in the index
  await page.goto("/projects/demo/agents");
  await expect(page.getByRole("link", { name: "e2e-bot" })).toBeVisible({ timeout: 5000 });

  // edit the prompt
  await page.getByRole("link", { name: "e2e-bot" }).click();
  await expect(page.getByLabel("display name")).toHaveValue("E2E Bot");
  await page.getByLabel("system prompt").fill("updated prompt");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // delete
  await page.goto("/projects/demo/agents/e2e-bot");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "e2e-bot" })).toHaveCount(0);
});
```

- [ ] **Step 2: Build the gateway, run e2e**

Run:
```bash
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: all specs PASS (the existing 7 + the new agent spec). If Playwright browsers are missing, run `pnpm exec playwright install chromium` once, then re-run. A genuine assertion failure is a real bug to report; a missing-browser error is an environment limitation — fall back to `pnpm exec playwright test --list` to confirm the spec is well-formed and note e2e was deferred to CI.

- [ ] **Step 3: Restore the mutated fixture**

The agent spec mutates `fixtures/demo/tau.toml`. Restore it:
```bash
git checkout fixtures/demo/tau.toml
```

- [ ] **Step 4: Full web gate (mirror CI)**

Run: `cd web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. If `format:check` fails, run `pnpm format` and re-check; commit formatting.

- [ ] **Step 5: Commit**

```bash
git add web/e2e/run.spec.ts
git commit -m "test(web): e2e agent create/edit/delete"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-agents-authoring-design.md`):
- §5.1 api module (list/get/put with create/delete) → Task 1. §5.2 components: index → Task 3; editor (create/edit/delete, error display) → Task 4; PromptField + RequiresToolsEditor → Task 2; route swap (replace StubPage) → Task 3. §5.3 validation (id regex create-only, prompt one-mode via toggle, tool rows) → Tasks 2 & 4. §6 web + e2e tests → Tasks 1–5. All covered. Sidebar "Agents" already routes to `/projects/:pid/agents` (no change needed; it now resolves to the real page).

**Placeholder scan:** none — every code step is complete. Task 3's editor stub (`return null`) is an intentional, labeled placeholder fleshed out in Task 4 so Task 3 builds green.

**Type consistency:** `AgentDetail`/`AgentPrompt`/`RequiredToolSpec` (generated by Plan 1) are used identically across `api/agents.ts`, the index, the editor, and the sub-editors. `putAgent(agent, {create})` → `?create=1` matches the gateway's `PutQuery`. Route params: `:pid` + `:agentId` (create route omits `:agentId` → `isNew`). The `aria-label`s used in tests (`agent id`, `display name`, `llm backend`, `system prompt`, `tool name 0`, `tool source 0`) match the component markup.

**Cross-plan dependency:** generated TS types come from Plan 1 Task 7 — apply/merge Plan 1 before Plan 2's typecheck.
```
