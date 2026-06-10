# Non-determinism (C) — the Agent map (runtime spawn-tree view) — design

**Status:** approved (brainstorm 2026-06-10)
**Relates to:** the run trace view (`web/src/trace/`) — the `Graph` tab, the `Timeline` tab, the span model (`gateway/src/trace/mod.rs`), and the serve adapter (`gateway/src/adapters/serve.rs`). The fake-tau-serve mock (`fake-tau-serve/`).
**Context:** the last roadmap item. Non-determinism in tau is **runtime sub-agent spawning** (a Run is a *"tree of agents"*, all *"observable in the trace"* — `multi-agent-orchestration.md`). Static fan-out/conditional is **deferred by tau itself** (`workflows.md`) and is out of scope.

## 1. Goal

Make a run's **dynamic sub-agent spawning** legible. Today the trace `Graph` tab is **span-level** — every turn / tool call / spawn is a node, so a real run is an exploding wall of boxes, and a spawned sub-agent is indistinguishable from a tool call. The `Timeline` tab already gives the **span detail** (a collapsible, indented waterfall — the agent-trace standard, à la LangSmith / LangFuse / Phoenix).

Replace the `Graph` tab with an **Agent map**: an **agent-level** topology — one node per agent (the root + each spawned sub-agent), edges = *who spawned whom*. That makes the two tabs complementary: **Graph (→ "Agents") = the run's dynamic org-chart; Timeline = the span detail.** Multi-agent dashboards (LangGraph Studio, CrewAI visualizers) reserve the node-link graph for exactly this agent-level topology.

Mock-first: the fake-tau-serve mock emits a representative spawn tree so the view has real non-determinism to show; the serve adapter already classifies `agent.*.spawn`/`task.*`/`run.*` tool calls as `Agent` spans.

## 2. Locked decisions (brainstorm)

- **Agent-level, not span-level.** One node per agent (root + each `SpanKind::Agent` span). Tool/turn spans are *summarized* into their owning agent's node, never drawn as nodes. So the map is small (≈ one node per agent) and never explodes — even under recursive spawning.
- **Edges = spawn relationships.** A dashed accent edge from a parent agent to each agent it spawned. This *is* the non-determinism, drawn as topology.
- **Live.** The trace streams over the websocket; the map recomputes from spans on each update, so spawned agents **pop in** as they're spawned and animate through their states (running → ok/error). A completed run shows the final tree.
- **Per-agent summary on each node:** the agent name, status, tool-call count, and token usage (derived from the spans that agent owns).
- **Click an agent node → select it** (drives the existing inspector/selection). The Timeline, reading the same `selectedSpanId`, highlights it. (A full "filter Timeline to this agent" is a nice-to-have, deferred — §7.)
- **Replace, don't add.** The `Graph` tab renders the Agent map (relabel "Agents"); the span-level node-link graph (`TraceGraph.tsx`, `layout.ts`'s `spansToFlow`, its `SpanNode`) is removed — the Timeline supersedes it for span detail. `forest.ts` stays (shared with the Timeline).

## 3. The agent-map model (frontend, pure)

A new pure helper `web/src/trace/agentMap.ts`, unit-tested, reusing `buildForest` for ancestor walks:

```ts
export interface AgentNode {
  id: string;            // root: a sentinel ("__root__"); spawned: the Agent span's id
  name: string;          // root: run.agent_id; spawned: derived from the span name
  status: SpanStatus;    // root: run status; spawned: the Agent span's status
  parentAgentId: string | null; // the agent that spawned it (root: null)
  depth: number;         // spawn depth (root = 0)
  toolCount: number;     // ToolCall/McpCall spans this agent owns
  tokens: number | null; // summed token usage of owned spans (null if none)
}

export function buildAgentMap(
  spans: Span[],
  rootAgentId: string,
  rootStatus: SpanStatus,
): { agents: AgentNode[]; edges: { source: string; target: string }[] };
```

- **Agents** = a synthetic **root** node (`__root__`, name = `rootAgentId`) + every `span.kind === "agent"`.
- **Spawn name** derivation: `agent.<name>.spawn` → `<name>`; `task.*`/`run.*` → the span name verbatim.
- **parentAgentId**: walk the Agent span's `parent_id` chain to the nearest *ancestor Agent span*; if none, the root. (So a spawn nested under another spawn becomes that agent's child; a spawn directly under the turn becomes the root's child.)
- **Ownership** (for `toolCount`/`tokens`): each non-Agent span belongs to the nearest Agent-or-root ancestor. `toolCount` = owned `ToolCall` + `McpCall` spans; `tokens` = sum of `attributes.usage`/`token_usage` over owned spans (+ the agent span's own usage), `null` if none.
- **edges** = `{ source: parentAgentId, target: id }` for every non-root agent.

The builder is general over nesting depth, so it renders a flat (root → N) *or* a recursive tree identically — future-proof for when real tau emits deeper trees.

## 4. The Agent map view (frontend)

- **`web/src/trace/AgentMap.tsx`** (replaces `TraceGraph` under the tab): a React Flow graph (same library/pattern as the workflow canvas + the old trace graph). `agentMapToFlow(agents, edges)` lays out nodes by `depth` (x) + sibling order (y) — a small `agentLayout.ts` (mirrors the removed `layout.ts`).
- **`AgentNode` component** (custom React Flow node): an icon avatar (◆, accent gradient) + the agent **name** + a meta line **`<status> · <toolCount> tools · <tokens> tok`**; a status treatment — **running** = pulsing accent dot (+ the *incoming spawn edge* animated), **ok** = green, **error** = red; a **root** badge on the root; a selection ring (reads `selectedSpanId`, where the root maps to no span and spawned agents map to their Agent span id).
- **Spawn edges**: dashed accent edges; `animated` while the target agent is `running`.
- **Wire into `TraceView.tsx`**: the `graph` tab renders `<AgentMap spans run />` (relabel the tab "Agents"); remove the `TraceGraph` import. Tabs become `[Agents, Timeline]`. Clicking an agent node calls `selectSpan(agentSpanId)` (root selects nothing / a run-level summary).
- **Remove** `web/src/trace/TraceGraph.tsx`, `web/src/trace/layout.ts` (+ its test), and the span-level `SpanNode`. (Confirm nothing else imports them — only `TraceView` + `TraceGraph` do.)

## 5. Mock: emit a representative spawn tree (gateway)

- The **`researcher` script** (`fake-tau-serve/src/scripts.rs`) emits a sequence where the agent makes a few `agent.<kind>.spawn` tool calls (e.g. `agent.summarizer.spawn`, `agent.factcheck.spawn`) interleaved with ordinary tool calls — each as `ToolCallStarted` → `ToolCallCompleted` events with a `token_usage` in the result. The serve adapter already maps these to `Agent` spans (`kind_for_tool`).
- **Nesting (recursion):** to show a multi-level tree (a spawned agent that itself spawns), the serve adapter (`serve.rs`) tracks a **current-agent stack** — an `agent.*.spawn` span nests under the top-of-stack agent (else the turn), is pushed on `ToolCallStarted` and popped on its `ToolCallCompleted`; the mock emits the child's activity *between* a spawn's start and completion. (If the adapter stack proves out of scope during planning, fall back to a **flat** demo — root → several spawned agents, one level — which the builder renders fine; the plan makes this call and `log()`s it.)
- **Greeter stays simple** (no spawns) so a non-spawning run still renders a clean single-agent map.

## 6. Inspector

`SpanInspector` already renders the selected span. For an **Agent** span, add a short note: *"⤳ Spawned sub-agent — created at runtime by its parent (non-deterministic)."* plus **spawn depth** and **direct sub-agents** count (from the agent map). The existing gated **"↗ view agent trace"** drill stays gated (tau doesn't link a workflow step to its run yet). No secret/data changes.

## 7. Testing

**Frontend (vitest):**
- `agentMap.test.ts` (pure): root + spawned agents from `Agent` spans; `parentAgentId` resolves to the nearest agent ancestor (flat → root; nested → the spawner); `toolCount`/`tokens` aggregate owned spans; name derivation (`agent.x.spawn` → `x`); edges connect spawner → spawned.
- `AgentMap` is React-Flow-backed → jsdom mocks the canvas (per the codebase convention); assert the pure builder + the tab wiring, not the live canvas.
- `TraceView`: the `Agents` tab renders `AgentMap`; the removed `TraceGraph` import is gone.
- `agentLayout.test.ts`: depth→x, sibling→y, edges follow `parentAgentId`.

**Gateway (rust):**
- The serve adapter produces a nested `Agent` span tree from a bracketed spawn sequence (extend `serve.rs` tests) — or, in the flat fallback, ≥2 `Agent` spans under the turn.
- A run of the `researcher` agent yields Agent spans (mock/adapter integration).

**E2e (Playwright):**
- Launch/open a `researcher` run → the trace **Agents** tab shows ≥2 agent nodes (root + a spawned sub-agent) with a spawn edge; a tool-call span is NOT a top-level node (it's summarized).

## 8. Out of scope (YAGNI) / roadmap

- **Static fan-out / conditional / loop authoring** in the workflow graph — deferred by tau itself (no β.2 IR contract). Not built.
- **Workflow-step → agent-run linking** — gated in `SpanInspector` ("tau doesn't link a workflow step to the agent's run yet"); stays gated.
- **Filter the Timeline to a clicked agent** — selection sync is included; hiding other agents' spans is a deferred enhancement.
- **Flame-graph / icicle view** — the Timeline (collapsible waterfall) already covers the time/structure axis; not adding a third representation.
