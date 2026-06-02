# Workflow graph editor (gated β.2) — design

**Status:** approved (brainstorm 2026-06-02)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md) — surface ① "Author", the gated **visual Workflow graph → Workflow IR** piece (`docs/seams.md` ① "Graph editor"). Fulfills the deferred seam at `web/src/graph/README.md`.
**Decomposition:** one implementation plan (gateway + frontend). The frontend (a React Flow editor) is the heaviest part of the surface so far.

## 1. Goal

Replace the `/workflows` `StubPage` with a real, mock-backed **Workflow graph editor** on the existing `@xyflow/react` canvas. It renders a selected workflow as a node/edge **DAG** — nodes = steps (`agent.run` / `tool.call`), edges = data-flow dependencies (`${steps.<id>.output}` references). It **defaults to a read-only viewer** (pan/zoom, click a node → inspector) and offers an **"Edit" toggle** into a local, interactive edit mode (drag, connect, add steps from a palette, edit the selected node's fields). The authoring/persist path — **Save → Workflow IR** (`build-from-ir`) — is **gated on tau β.2**: shown but disabled (amber), with an edit-mode "changes are local" banner.

The whole surface is **mock-first, mark-gated**: a `WorkflowGraphSource` seam backs the graph with mock data; the surface keeps its **sidebar `gated` badge** because its core purpose (authoring → Workflow IR) is gated. This mirrors the run/observe side of workflows that already exists (Launcher + trace timeline) — this surface is the *authoring* half.

Locked decisions (brainstorm):
- **View mode by default**, with an explicit toggle into **local edit mode**; **Save → IR is gated** (never persists in v1).
- Graph data is **mock-first** via `WorkflowGraphSource`/`MockGraph`/`CliGraph` (the latter is the future real-parse + IR seam).
- Reuse the `@xyflow/react` canvas + the deterministic-layout approach from `trace/TraceGraph.tsx` / `trace/layout.ts`.
- Keep the **sidebar gated badge** (the graph editor's authoring purpose is gated until β.2).
- `POST /api/build-from-ir` is a **documented future seam only** — no endpoint in v1 (Save is frontend-gated and never calls it).

## 2. Data model (ts-rs types)

```rust
// gateway/src/graph/mod.rs

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkflowNode {
    pub id: String,
    pub kind: String,            // "agent.run" | "tool.call"
    pub label: String,           // the step id (display)
    pub agent: Option<String>,   // for agent.run
    pub tool: Option<String>,    // for tool.call
    pub input: Option<String>,   // raw input/args summary (for the inspector)
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkflowEdge {
    pub source: String,
    pub target: String,
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkflowGraph {
    pub workflow: String,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
}
```

One read-only endpoint returns `WorkflowGraph`; the frontend loads it into local React state for the editor.

## 3. Gateway

### 3.1 `graph` module (`gateway/src/graph/mod.rs`)

Mock-first behind a seam, mirroring `CheckSource`/`ShipSource`:
- **`WorkflowGraphSource` trait**: `fn graph(&self, name: &str) -> WorkflowGraph`.
- **`MockGraph`**: seeds graphs matching the two demo workflows (`fixtures/demo/workflows/*.toml`):
  - `nightly-research` — nodes `gather` (agent.run, researcher, input `${input}`), `summarise` (agent.run, greeter, input `${steps.gather.output}`), `save-results` (tool.call, fs-write, input `${steps.summarise.output}`); edges `gather→summarise`, `summarise→save-results`.
  - `build-report` — nodes `collect` (agent.run, researcher), `render` (tool.call, fs-write); **no edges** (the real `render` step doesn't reference `collect`'s output).
  - Any other name → an empty graph (`nodes: []`, `edges: []`) with `workflow` set to the requested name.
- **`CliGraph`** (seam, not exercised in v1): the future real path (parse `workflows/<name>.toml`, derive edges from `${steps.<id>.output}` references, and later round-trip the tau β.2 Workflow IR). Returns an empty graph for now.

Selection mirrors `AppState::new`'s `is_mock` check (as `check_source`/`ship_source` do).

### 3.2 `AppState` wrapper + API

- `AppState` gains a `graph_source: Box<dyn WorkflowGraphSource>` field (selected by `is_mock`) and `pub fn workflow_graph(&self, name: &str) -> WorkflowGraph` delegating to the source.
- **API** (`gateway/src/api/graph.rs`): one scoped route — `GET /api/projects/:pid/workflows/:name/graph → Json<WorkflowGraph>` (handler `api::graph::graph`; `name` via the `Path<(String, String)>` extractor for `(pid, name)`, read-only). Registered after the existing `/workflows/run` route; does not disturb `GET /workflows` or `POST /workflows/run`.

New `#[ts(export)]` types (`WorkflowNode`, `WorkflowEdge`, `WorkflowGraph`) export to `web/src/types` via the drift gate.

## 4. Frontend

### 4.1 API module

`web/src/api/graph.ts`: `getWorkflowGraph(name: string): Promise<WorkflowGraph>` → `GET /workflows/<name>/graph` (scoped via the client chokepoint, same ok-checking `json<T>` helper as `api/ship.ts`). The workflow **list** is already available via the existing `getWorkflows` (store / `api/client.ts`).

### 4.2 Layout (`web/src/graph/layout.ts`)

A pure `workflowToFlow(graph: WorkflowGraph)` → `{ nodes: Node<StepNodeData>[]; edges: Edge[] }`, mirroring `trace/layout.ts`:
- **Depth** = longest dependency chain to a node (roots — no incoming edge — at depth 0; otherwise `max(source depths) + 1`), computed from `graph.edges`.
- **Position**: `x = depth * X_GAP`, `y = orderWithinDepth * Y_GAP` (constants like the trace graph's 220 / 70).
- `StepNodeData = { label, kind, agent?, tool? }`; node `type: "step"`. Edges map `{ id: "src->tgt", source, target }`.
- Deterministic (no layout library), so it's unit-testable as a pure function.

### 4.3 Components (`web/src/graph/`)

- **`GraphEditor.tsx`** (replaces the `/workflows` `StubPage` route) — holds:
  - **Toolbar**: a workflow `<select>` (options from the existing workflows list via the store/`getWorkflows`); a **mode toggle** (View ↔ Edit); a gated **"Build from IR"** button (disabled, amber `gated` styling, title "waits on tau β.2").
  - On workflow change (and mount): `getWorkflowGraph(name)` → store the `WorkflowGraph` in **local state** (`nodes`/`edges` derived via `workflowToFlow`, held as React Flow controlled state so edit mode can mutate them).
  - **Canvas**: the `@xyflow/react` `ReactFlow` with a custom **step node** type (`StepNode`) — `agent.run` styled with the accent token, `tool.call` with a blue token; left/right `Handle`s; selectable (selection drives the inspector). In **view mode**: `nodesDraggable={false}`, `nodesConnectable={false}`, no element changes. In **edit mode**: draggable, `onConnect` adds an edge, `onNodesChange`/`onEdgesChange` applied to local state, a node delete affordance.
  - **Node inspector** (right): the selected step's `kind`, `agent`/`tool`, `input`. Read-only in view mode; in edit mode the `label`/`agent`/`tool` become editable inputs that update local node state.
  - **Add-step palette** (edit mode only): `+ agent.run` / `+ tool.call` buttons that append a new node (default id like `step-N`) to local state.
  - **Edit-mode banner**: "Edit mode — changes are local; Save → IR waits on tau β.2."
- **`StepNode.tsx`** — the custom React Flow node (kept small; mirrors `trace/TraceGraph.tsx`'s `SpanNode` shape with handles + label + `kind · agent/tool`).

### 4.4 Routing + nav

- `web/src/App.tsx`: replace the `/workflows` `StubPage` route with `<GraphEditor />`. `/workflows` is the **last** `StubPage` route consumer, so **remove the now-unused `import { StubPage }`** from `App.tsx` (otherwise the lint gate fails on no-unused-vars). **Keep** `web/src/app/StubPage.tsx` and its `StubPage.test.tsx` — the component stays a tested utility, just no longer routed.
- `web/src/app/Sidebar.tsx`: **keep** `gated: true` on the Workflows item (the authoring purpose is gated).

## 5. Testing

**Gateway** (`graph/mod.rs` unit tests + an integration test):
- `MockGraph::graph("nightly-research")` returns 3 nodes (kinds `agent.run`, `agent.run`, `tool.call`) and 2 edges (`gather→summarise`, `summarise→save-results`); `graph("build-report")` returns 2 nodes and 0 edges; an unknown name returns an empty graph.
- `CliGraph::graph(...)` returns an empty graph.
- API: `GET /api/projects/:pid/workflows/nightly-research/graph` returns `workflow == "nightly-research"`, 3 nodes, 2 edges, with `gather`'s kind `agent.run` and `save-results`'s kind `tool.call`.

**Web (vitest):**
- **`workflowToFlow`** (pure): for the nightly-research graph, produces 3 nodes with depths 0/1/2 (positions stepping in x) and 2 edges; a disconnected graph (build-report) places both nodes at depth 0.
- **`GraphEditor`** (component, non-canvas assertions — React Flow canvas internals are not asserted in jsdom): renders the workflow `<select>`; the **Build from IR** button is present and **disabled**; clicking the **Edit** toggle switches the mode label/affordance (the edit-mode banner text appears) and back. (The `@xyflow/react` `ReactFlow` is mocked to a passthrough `<div>` in this test to avoid jsdom layout requirements.)

**E2e (Playwright):**
- From `/projects/demo/workflows`, the graph canvas shows the `gather` node (the real canvas renders) → click **Edit** → the gated **Build from IR** button and the "changes are local" banner are visible. (Read-only on disk; no fixture mutation.)

## 6. ts-rs / CI

`WorkflowNode`, `WorkflowEdge`, `WorkflowGraph` land in `web/src/types` via `#[ts(export)]` + the drift gate. No CI job changes.

## 7. Out of scope (YAGNI / later)

- **`POST /api/build-from-ir` + real Workflow IR (de)serialization** — gated β.2; documented future seam, no endpoint in v1 (Save is frontend-gated, never calls it).
- **Persisting edits** — edit mode is local-only React state; nothing is written back to `workflows/*.toml` or to tau.
- **Parsing real workflow TOML in the gateway** — `MockGraph` is mock-first; `CliGraph` is the future real-parse seam.
- **Workflow running / launching** — already built on the Runs surface (Launcher + trace); this surface is authoring-only.
- **Auto-layout libraries** (dagre/elk) — a deterministic column layout (depth × order) suffices, matching the trace graph.
- **Validation of the edited graph** (cycle detection, dangling refs) — not meaningful until the IR/build path exists.
