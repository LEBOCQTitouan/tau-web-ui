# Workflow canvas — display half (Plan 3a of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the (gated) workflow graph editor best-in-class to *read* — sub-project **B**, the read-only half. The gateway resolves each `agent.run` node's **provider** + **tools** from the agent config; the canvas renders **icon-forward nodes** with a **provider pill** and a **selection ring**, an enriched **inspector** (provider row with a ✓ recommended marker + tools pills), and Level-2 **chrome** (minimap + zoom controls).

**Architecture:** `WorkflowNode` (gateway `graph/mod.rs`) gains `provider: Option<String>` + `tools: Vec<String>`; `AppState::workflow_graph` becomes a composer that fills them per `agent.run` node via `config::read_agent` (falling back to the recommended backend). Frontend: `StepNodeData` carries the two fields through `workflowToFlow`; `StepNode` becomes icon-forward with a pill + ring; `GraphCanvas` gains `<MiniMap>`; `GraphEditor`'s inspector shows provider (+ ✓ recommended, via `getProviders()` from Plan 1) and tools. **All read-only** — no graph mutations here; Save → IR stays gated (unchanged).

**Tech Stack:** Rust, axum, serde, ts-rs; React 18, `@xyflow/react` v12 (React Flow), Tailwind, Vitest, Playwright.

**Scope boundary (3a vs 3b):** This plan is **strictly read-only**. Deferred to **Plan 3b** (the edit-interaction half): the per-node hover **toolbar** (Level 2's inspect/disable/duplicate/delete), **Level 3** inline `+` add/edge-insert (pure `graph/edit.ts` helpers), **Level 4** `StepPalette`. Rationale: an inspect-only toolbar adds little over click-to-select, and the toolbar is most coherent built once with its full action set alongside the other edit interactions. 3a delivers Level 1, the inspector enrichment, and Level 2's minimap/zoom chrome + selection ring.

---

## File Structure

**Gateway — Modified:** `gateway/src/graph/mod.rs` (WorkflowNode fields + `node()` defaults), `gateway/src/state.rs` (composer + helpers), `gateway/tests/graph_api.rs` (assert new fields). **Regenerated:** `web/src/types/WorkflowNode.ts`.
**Frontend — Modified:** `web/src/graph/layout.ts` (+ pass-through), `web/src/graph/StepNode.tsx` (icon node), `web/src/graph/GraphCanvas.tsx` (minimap), `web/src/graph/GraphEditor.tsx` (inspector + providers fetch), `web/src/graph/layout.test.ts`, `web/src/graph/GraphEditor.test.tsx` (extend), `web/e2e/run.spec.ts` (e2e).

No new files. The gateway `GET /workflows/:name/graph` route is unchanged (the composer is behind `AppState::workflow_graph`).

---

## Task 1: Gateway — WorkflowNode provider+tools + composer + ts-rs + integration test

**Files:** Modify `gateway/src/graph/mod.rs`, `gateway/src/state.rs`, `gateway/tests/graph_api.rs`; regenerate `web/src/types/WorkflowNode.ts`.

Context: `AppState` is `pub struct AppState(pub Arc<Inner>)` with `self.0.project: PathBuf` and `self.0.graph_source: Box<dyn WorkflowGraphSource>`. `config::read_agent(project, id) -> Result<Option<AgentDetail>>` where `AgentDetail { llm_backend: Option<String>, requires_tools: Vec<RequiredToolSpec>, .. }` and `RequiredToolSpec { name: String, source: String, version: Option<String> }`. `providers::recommended_backend(&[String]) -> String` already exists (Plan 1). The current `AppState::providers()` (state.rs:546) gathers agent backends inline — this task extracts that into a shared helper and reuses it.

- [ ] **Step 1: Add the two fields to `WorkflowNode` in `gateway/src/graph/mod.rs`**

Change the struct (after `pub input: Option<String>,`):

```rust
pub struct WorkflowNode {
    pub id: String,
    pub kind: String, // "agent.run" | "tool.call"
    pub label: String,
    pub agent: Option<String>,
    pub tool: Option<String>,
    pub input: Option<String>,
    pub provider: Option<String>, // agent.run: agent's llm_backend, else the recommended backend
    pub tools: Vec<String>,       // agent.run: the agent's requires_tools names
}
```

And update the `node(...)` constructor's struct literal (the mock seam stays structural — these default to empty; the composer fills them):

```rust
    WorkflowNode {
        id: id.into(),
        kind: kind.into(),
        label: id.into(),
        agent: agent.map(|s| s.to_string()),
        tool: tool.map(|s| s.to_string()),
        input: input.map(|s| s.to_string()),
        provider: None,
        tools: vec![],
    }
```

(The existing `MockGraph`/`CliGraph` unit tests still pass — they assert ids/kinds/edges, not the new fields.)

- [ ] **Step 2: Run the gateway unit tests to confirm the struct change compiles**

Run: `cargo test -p tau-gateway --lib graph::tests`
Expected: PASS (4 tests) — `node()` now sets the defaults, MockGraph tests unaffected.

- [ ] **Step 3: Add the composer + helpers in `gateway/src/state.rs`**

(a) Add a private helper and a public `recommended_backend()`, and refactor `providers()` to reuse the helper. Replace the existing `providers()` method (state.rs ~546-552) with:

```rust
    /// The non-empty `llm_backend` of every agent in the project (real config).
    fn agent_backends(&self) -> Vec<String> {
        config::read(&self.0.project)
            .map(|c| c.agents.into_iter().filter_map(|a| a.llm_backend).collect())
            .unwrap_or_default()
    }

    /// The recommended backend for this project (modal agent backend, else "anthropic").
    pub fn recommended_backend(&self) -> String {
        providers::recommended_backend(&self.agent_backends())
    }

    pub fn providers(&self) -> Vec<Provider> {
        let package_names: Vec<String> = self.packages().into_iter().map(|p| p.name).collect();
        providers::list_providers(&self.agent_backends(), &package_names)
    }
```

(b) Replace the existing `workflow_graph()` method (state.rs ~534-536) with the composer:

```rust
    /// Structural graph from the mock seam, enriched per `agent.run` node with the
    /// agent's provider (its `llm_backend`, else the recommended backend) + tools.
    pub fn workflow_graph(&self, name: &str) -> WorkflowGraph {
        let mut g = self.0.graph_source.graph(name);
        let recommended = self.recommended_backend();
        for n in g.nodes.iter_mut() {
            if n.kind != "agent.run" {
                continue; // tool.call → provider = None, tools = [] (defaults)
            }
            let detail = n
                .agent
                .as_deref()
                .and_then(|id| config::read_agent(&self.0.project, id).ok().flatten());
            match detail {
                Some(a) => {
                    n.provider = Some(a.llm_backend.unwrap_or_else(|| recommended.clone()));
                    n.tools = a.requires_tools.into_iter().map(|t| t.name).collect();
                }
                None => n.provider = Some(recommended.clone()),
            }
        }
        g
    }
```

(`config` and `providers` are already imported in `state.rs` from Plan 1; `WorkflowGraph` is already imported for the existing `workflow_graph`.)

- [ ] **Step 4: Extend the integration test `gateway/tests/graph_api.rs`**

After the existing `let save = ...; assert_eq!(save["kind"], "tool.call");` (end of `workflow_graph_over_http`), add:

```rust
    // composer enrichment: the agent.run node "gather" (agent "researcher", which
    // has no llm_backend in the demo fixture) resolves to the recommended backend
    // (anthropic) and no tools; the tool.call node has a null provider.
    assert_eq!(gather["provider"], "anthropic");
    assert!(gather["tools"].as_array().unwrap().is_empty());
    assert_eq!(save["provider"], serde_json::Value::Null);
```

- [ ] **Step 5: Build the mock + regenerate ts-rs + run the gateway tests**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway`
Expected: PASS — `graph::tests`, the `providers::tests`, and the integration tests (`graph_api`, `providers_api`) all green. `web/src/types/WorkflowNode.ts` regenerates with `provider: string | null` and `tools: Array<string>`. Confirm `git status --porcelain fixtures/demo` is empty.

- [ ] **Step 6: Verify the regenerated binding**

Run: `cat web/src/types/WorkflowNode.ts` → contains `provider: string | null,` and `tools: Array<string>,`.

- [ ] **Step 7: Rust gate**

Run: `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green (run `cargo fmt --all` first if the check fails; fix any clippy warning in the new code minimally).

- [ ] **Step 8: Commit**

```bash
git add gateway/src/graph/mod.rs gateway/src/state.rs gateway/tests/graph_api.rs web/src/types/WorkflowNode.ts
git commit -m "feat(gateway): resolve workflow node provider + tools from agent config"
```

---

## Task 2: Frontend Level 1 — layout pass-through + icon node + provider pill + selection ring

**Files:** Modify `web/src/graph/layout.ts`, `web/src/graph/StepNode.tsx`, `web/src/graph/layout.test.ts`.

Context: `WorkflowNode.ts` (Task 1) now has `provider: string | null` + `tools: Array<string>`. `StepNode` is a React Flow custom node (`nodeTypes = { step: StepNode }`); React Flow passes `selected: boolean` in `NodeProps`. Known-good Tailwind tokens: `border-accent/40`, `bg-accent`, `bg-accent/10`, `text-accent`, `text-accent-fg`, `border-st-running/40`, `bg-st-running`, `bg-surface`, `border-border`, `text-muted`, `ring-accent`, `text-white`.

- [ ] **Step 1: Extend `StepNodeData` + pass the fields through in `web/src/graph/layout.ts`**

(a) Add to the `StepNodeData` interface (after `input: string | null;`):

```ts
  provider: string | null;
  tools: string[];
```

(b) In `workflowToFlow`, extend the `data` object in the `graph.nodes.map(...)` return (currently `data: { label: n.label, kind: n.kind, agent: n.agent, tool: n.tool, input: n.input }`):

```ts
      data: {
        label: n.label,
        kind: n.kind,
        agent: n.agent,
        tool: n.tool,
        input: n.input,
        provider: n.provider,
        tools: n.tools,
      },
```

- [ ] **Step 2: Add a failing pass-through assertion in `web/src/graph/layout.test.ts`**

Read the existing test first to match its fixture shape. Add a test (and ensure the fixture nodes include `provider`/`tools` — extend the existing fixture nodes with `provider: null, tools: []` so the type checks, then assert one enriched node):

```ts
it("passes provider and tools through to node data", () => {
  const { nodes } = workflowToFlow({
    workflow: "w",
    nodes: [
      {
        id: "a",
        kind: "agent.run",
        label: "a",
        agent: "researcher",
        tool: null,
        input: null,
        provider: "anthropic",
        tools: ["web-search", "fs-read"],
      },
    ],
    edges: [],
  });
  expect(nodes[0].data.provider).toBe("anthropic");
  expect(nodes[0].data.tools).toEqual(["web-search", "fs-read"]);
});
```

(If the existing `layout.test.ts` fixtures construct `WorkflowGraph` literals without `provider`/`tools`, add `provider: null, tools: []` to those nodes so they satisfy the updated `WorkflowNode` type — TypeScript will flag them otherwise.)

- [ ] **Step 3: Run the test to verify the new assertion passes and existing layout tests still pass**

Run: `cd web && pnpm test -- src/graph/layout.test.ts`
Expected: PASS (existing + the new pass-through test).

- [ ] **Step 4: Rewrite `web/src/graph/StepNode.tsx` as an icon-forward node**

```tsx
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StepNodeData } from "./layout";

export function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  const tool = data.kind === "tool.call";
  const who = data.agent ?? data.tool;
  const handle = "!h-2 !w-2 !border !border-border !bg-muted";
  return (
    <div
      className={`flex min-w-[150px] items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 text-xs shadow-sm ${
        selected ? "ring-2 ring-accent" : ""
      } ${tool ? "border-st-running/40" : "border-accent/40"}`}
    >
      <Handle type="target" position={Position.Left} className={handle} />
      <div
        aria-hidden
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-md text-sm text-white ${
          tool ? "bg-st-running" : "bg-accent"
        }`}
      >
        {tool ? "⚒" : "◆"}
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold">{data.label}</div>
        <div className="flex items-center gap-1 text-muted">
          <span className="truncate">{who ?? data.kind}</span>
          {!tool && data.provider && (
            <span className="flex-none rounded bg-accent/10 px-1 text-[9px] font-medium text-accent">
              ⚡ {data.provider}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={handle} />
    </div>
  );
}
```

(The provider pill renders only for `agent.run` nodes with a provider. The live render + pill are asserted by the e2e in Task 4 — React Flow nodes are not reliably assertable in jsdom, per the codebase's testing convention; `layout.test.ts` covers the data flow.)

- [ ] **Step 5: Typecheck + run the graph tests**

Run: `cd web && pnpm typecheck && pnpm test -- src/graph/`
Expected: green (the existing `GraphEditor.test.tsx` mocks `GraphCanvas`, so the StepNode rewrite doesn't affect it; `layout.test.ts` passes).

- [ ] **Step 6: Commit**

```bash
git add web/src/graph/layout.ts web/src/graph/StepNode.tsx web/src/graph/layout.test.ts
git commit -m "feat(web): icon-forward workflow node with provider pill + selection ring"
```

---

## Task 3: Frontend — inspector enrichment + Level 2 chrome (minimap)

**Files:** Modify `web/src/graph/GraphCanvas.tsx`, `web/src/graph/GraphEditor.tsx`, `web/src/graph/GraphEditor.test.tsx`.

Context: `GraphEditor` holds the inspector (plain DOM, not React Flow — so it IS assertable in jsdom). `getProviders()` from `web/src/api/providers.ts` (Plan 1) returns `Provider[]`; the recommended one marks the inspector's provider. The inspector's view-mode block is at `GraphEditor.tsx` ~196-208.

- [ ] **Step 1: Add `<MiniMap>` to `web/src/graph/GraphCanvas.tsx`**

(a) Add `MiniMap` to the `@xyflow/react` import (the import list currently includes `ReactFlow, Background, Controls, ...`):

```tsx
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
```

(b) Add the minimap alongside the existing `<Background />` + `<Controls />` (inside `<ReactFlow>…</ReactFlow>`):

```tsx
        <Background />
        <MiniMap pannable zoomable className="!bg-surface" />
        <Controls />
```

- [ ] **Step 2: Add a providers fetch + recommended derivation in `web/src/graph/GraphEditor.tsx`**

(a) Add the import (alongside the other `../api/...` imports):

```tsx
import { getProviders } from "../api/providers";
```

(b) Add state + an effect after the existing `counter` ref / before the first `useEffect` (anywhere in the hook block is fine; place it after the `const counter = useRef(0);` line):

```tsx
  const [recommended, setRecommended] = useState<string>("");
  useEffect(() => {
    getProviders()
      .then((ps) => setRecommended(ps.find((p) => p.recommended)?.name ?? ""))
      .catch(() => {});
  }, []);
```

- [ ] **Step 3: Enrich the view-mode inspector in `web/src/graph/GraphEditor.tsx`**

Replace the view-mode inspector block (the `) : (` branch rendering `current.data.label` / kind / agent-or-tool / input, ~lines 196-208) with one that adds a provider row (with a ✓ recommended marker) and a tools row:

```tsx
            ) : (
              <div className="space-y-0.5">
                <div className="font-semibold">{current.data.label}</div>
                <div className="text-muted">{current.data.kind}</div>
                <div className="text-muted">
                  {current.data.kind === "agent.run"
                    ? `agent ${current.data.agent}`
                    : `tool ${current.data.tool}`}
                </div>
                {current.data.kind === "agent.run" && current.data.provider && (
                  <div className="flex flex-wrap items-center gap-1 text-muted">
                    provider
                    <span className="rounded bg-accent/10 px-1 text-[10px] font-medium text-accent">
                      ⚡ {current.data.provider}
                    </span>
                    {current.data.provider === recommended && (
                      <span className="rounded bg-st-ok-soft px-1 text-[10px] font-medium text-st-ok">
                        ✓ recommended
                      </span>
                    )}
                  </div>
                )}
                {current.data.tools && current.data.tools.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-muted">
                    tools
                    {current.data.tools.map((t) => (
                      <span key={t} className="rounded border border-border px-1 text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {current.data.input && (
                  <div className="font-mono text-[10px] text-muted">{current.data.input}</div>
                )}
              </div>
            )
```

- [ ] **Step 4: Extend `web/src/graph/GraphEditor.test.tsx`**

(a) Update the test `graph` fixture's nodes to include the new fields — `gather` gets `provider: "anthropic", tools: ["web-search"]`; `summarise` gets `provider: "anthropic", tools: []`; `save-results` gets `provider: null, tools: []`. (Add the two keys to each of the three node objects.)

(b) Update the `fetch` stub to answer `/providers` (add this branch BEFORE the catch-all `return`):

```tsx
      if (url.includes("/providers"))
        return Promise.resolve({
          ok: true,
          json: async () => [
            { name: "anthropic", installed: true, recommended: true, source: "well-known", credentials_gated: true },
          ],
        });
```

(c) Add a test asserting the enriched inspector (the first node `gather` is selected by default; canvas is mocked so the inspector text is unique):

```tsx
  it("shows the provider pill (recommended) and tools in the inspector", async () => {
    render(<GraphEditor />);
    await waitFor(() => expect(screen.getByText("gather")).toBeInTheDocument());
    expect(screen.getByText(/⚡ anthropic/)).toBeInTheDocument();
    expect(screen.getByText(/✓ recommended/)).toBeInTheDocument();
    expect(screen.getByText("web-search")).toBeInTheDocument();
  });
```

- [ ] **Step 5: Run the graph tests + typecheck**

Run: `cd web && pnpm typecheck && pnpm test -- src/graph/`
Expected: green (the two existing GraphEditor tests + the new inspector test + layout tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/graph/GraphCanvas.tsx web/src/graph/GraphEditor.tsx web/src/graph/GraphEditor.test.tsx
git commit -m "feat(web): graph inspector shows provider (+recommended) + tools; minimap"
```

---

## Task 4: E2e + final gate

**Files:** Modify `web/e2e/run.spec.ts`.

- [ ] **Step 1: Read `web/e2e/run.spec.ts`** to confirm conventions and whether a workflow-graph test already exists. The workflow graph editor is the **gated** Workflows surface at `/projects/demo/workflows` (route `workflows` → `GraphEditor`). React Flow nodes render as `.react-flow__node`; the minimap as `.react-flow__minimap`. Append a new top-level `test(...)` in the file's style.

- [ ] **Step 2: Append the e2e spec**

```ts
test("workflows: graph shows provider pill on an agent node + a minimap", async ({ page }) => {
  await page.goto("/projects/demo/workflows");
  // the React Flow canvas renders nodes (gated editor still displays the graph)
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 5000 });
  // an agent.run node carries a provider pill (demo agents resolve to anthropic)
  await expect(page.getByText(/⚡ anthropic/).first()).toBeVisible();
  // Level-2 chrome: the minimap renders
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  // Save → IR remains gated
  await expect(page.getByRole("button", { name: /build from ir/i })).toBeDisabled();
});
```

- [ ] **Step 3: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. `web/playwright.config.ts` auto-starts gateway (4317) + vite (5173) via its `webServer` block (`reuseExistingServer: !CI`) — no manual start needed; the `lsof … kill` only clears stale listeners. Real ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; if not permitted, `pnpm exec playwright test --list` to confirm the test parses and note e2e deferred to CI, then proceed with Steps 4–6 (unit gate must be green).

- [ ] **Step 4: Restore fixtures** (mandatory even if e2e fails)

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 5: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green (run `pnpm format` if format:check fails, and include the formatted files in the commit).

- [ ] **Step 6: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (check git status)
git commit -m "test(web): e2e workflow graph provider pill + minimap"
```

---

## Self-Review

**Spec coverage** (the read-only parts of B in `2026-06-02-agent-providers-and-node-display-design.md` §3 + §4.3):
- §3 `WorkflowNode` gains `provider` + `tools`; `AppState::workflow_graph` composer resolves them per `agent.run` node via `config::read_agent` (backend or recommended), `tool.call` → `None`/`[]` → Task 1. ✓
- §4.3 Level 1 icon node (kind icon, title, subtitle, provider pill) + selection ring; `StepNodeData` + `workflowToFlow` pass-through → Task 2. ✓
- §4.3 Level 2 chrome: `<MiniMap>` + `<Controls>` (zoom) → Task 3. ✓
- §4.3 inspector: provider row (+ ✓ recommended marker, via `getProviders()`) + tools pills, keep input → Task 3. ✓
- ts-rs export of the two new fields → Task 1 (Step 5-6). ✓
- Tests: composer integration (Task 1), layout pass-through (Task 2), inspector (Task 3), e2e provider pill + minimap (Task 4). ✓

**Deferred to Plan 3b (documented in the Scope boundary):** the per-node hover **toolbar** (Level 2 inspect/disable/duplicate/delete), **Level 3** inline `+` add/edge-insert (`graph/edit.ts` pure helpers), **Level 4** `StepPalette`. Edits remain local-only; Save → IR stays gated throughout.

**Placeholder scan:** none.

**Type consistency:** `WorkflowNode { …, provider: Option<String>, tools: Vec<String> }` (Rust) ⇒ ts-rs `provider: string | null`, `tools: Array<string>` ⇒ `StepNodeData { …, provider: string \| null, tools: string[] }` ⇒ consumed in `StepNode` (`data.provider`, `data.tools`) and the inspector. `AppState::recommended_backend()` reuses `providers::recommended_backend(&[String])` (Plan 1) via the new private `agent_backends()` helper (also used by the refactored `providers()`). `getProviders(): Promise<Provider[]>` (Plan 1) feeds the inspector's recommended marker. The composer reads `config::read_agent` → `AgentDetail.requires_tools: Vec<RequiredToolSpec>` (`.name`). All seams consistent.

**Read-only guarantee:** no task mutates the graph or persists anything; the gated "Build from IR" button is unchanged and the e2e asserts it stays disabled.
