# Plugins view — design

**Status:** approved (brainstorm 2026-06-01)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md) — surface ⑥ "Tools & Skills", slice **#3 of 3** (after [Skills authoring](2026-06-01-skills-authoring-design.md) and [Tools view](2026-06-01-tools-view-design.md)).
**Decomposition:** one implementation plan (gateway + frontend) — a small, read-only surface.

## 1. Goal

Fill in the **Plugins** tab of the Tools & Skills surface: a **gated, read-only** two-pane view of the plugin binaries behind packages. A *plugin* is the executable backing a package that provides a tau **port** (`Tool` or `LlmBackend`) and speaks tau's NDJSON JSON-RPC over stdio (see `docs/tau-contract-v1.md`). For each plugin the surface shows its **describe** (port, protocol version, tool schema, required capabilities, kind/binary) and a **protocol-decode** transcript of the wire frames (discovery + one representative call).

tau has **no real plugin introspection yet**, so the entire tab is **gated**: it renders the intended end-state UI with **mock data**, an amber **"gated"** badge on the tab plus a mock-data **banner**, and a documented `PluginsSource` seam whose `CliPlugins` returns empty — exactly mirroring how [Tools view](2026-06-01-tools-view-design.md)'s `CliTools` is the wired-later path. This is the locked **mock-first, mark-gated** principle: build the whole surface; only the data is mock until tau ships introspection.

Locked decisions (brainstorm):
- Layout: **two-pane master/detail** (left: plugin list; right: selected plugin's describe + protocol-decode). Echoes the run-trace inspector.
- Protocol-decode transcript scope: **describe + one representative call** — `meta.handshake → result → plugin.describe → result`, then a port-appropriate call pair (`tool.invoke → result` for Tool plugins, `llm.generate → result` for LlmBackend). 6 frames per plugin.
- The Plugins tab becomes a **real, navigable tab** (no longer a disabled "soon" stub); the gated framing lives in the badge + banner, not in disabling the tab.

## 2. Data model (ts-rs types)

`Capability` is **reused** from the skills module (`gateway/src/skills/mod.rs`): `{ kind: string, fields: { [param]: string[] } }`.

```rust
// gateway/src/plugins/mod.rs

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProtocolFrame {
    pub direction: String,            // "out" (→ request to plugin) | "in" (← response/notification from plugin)
    pub method: String,               // "meta.handshake" | "result" | "plugin.describe" | "tool.invoke" | "llm.generate"
    pub payload: serde_json::Value,   // exported as `any`; rendered pretty in the decode viewer
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolSchema {
    pub name: String,
    pub input_schema: BTreeMap<String, String>, // param → type, e.g. {"path":"string"}
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDescribe {
    pub port: String,                       // "Tool" | "LlmBackend"
    pub protocol_version: u32,
    pub tool: Option<ToolSchema>,           // present for the Tool port; None for LlmBackend
    pub capabilities: Vec<crate::skills::Capability>,
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDetail {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub kind: String,                       // "rust-cargo"
    pub binary: String,
    pub port: String,                       // "Tool" | "LlmBackend" (mirrors describe.port for list-row convenience)
    pub protocol_version: u32,
    pub describe: PluginDescribe,
    pub transcript: Vec<ProtocolFrame>,     // 6 frames: handshake → describe → result → sample call pair
}
```

`payload` is a structured JSON value (TS `any`) so the frontend renders it with `JSON.stringify(payload, null, 2)` in the `SpanInspector` house style — not a pre-stringified string. The inline two-pane surface needs the full detail up front, so there is **one read-only endpoint** returning `PluginDetail[]`; the frontend derives the list rows and the detail pane from it (no extra calls).

## 3. Gateway

### 3.1 `plugins` module (`gateway/src/plugins/mod.rs`)

Mock-first behind a seam, mirroring `ToolsSource`/`MockTools`/`CliTools`:
- **`PluginsSource` trait**: `fn catalog(&self) -> Vec<PluginDetail>`.
- **`MockPlugins`**: seeds **four** plugins (used when the bin name contains `fake-tau-serve`):
  - `fs-read` — port `Tool`, cap `fs.read` `{paths:["${WORKDIR}/**"]}`, tool `fs-read(path: string)`; sample call `tool.invoke {call_id, args:{path}} → result {ok:true, content:[…], is_error:false}`.
  - `shell` — port `Tool`, cap `process.spawn` `{commands:["sh"]}`, tool `shell(command: string)`; sample `tool.invoke {args:{command:"ls"}} → result {ok:true, …}`.
  - `web-search` — port `Tool`, cap `net.http` `{hosts:["*"]}`, tool `web-search(query: string)`; sample `tool.invoke {args:{query}} → result {ok:true, …}`.
  - `anthropic` — port `LlmBackend`, cap `net.http` `{hosts:["api.anthropic.com"]}`, `tool: None`; sample `llm.generate {model, messages:[…]} → result {content:[…], usage:{input_tokens, output_tokens}}`.
  - Each plugin: `kind:"rust-cargo"`, `binary:name`, `source:"github.com/tau/{name}"`, `protocol_version:1`, and a self-contained 6-frame transcript (the leading `meta.handshake`/`result`/`plugin.describe` frames are the same shape across plugins; the trailing call pair is port-appropriate).
- **`CliPlugins`** (seam, not exercised in v1): future real path — tau plugin introspection; returns an empty catalog for now.

Selection mirrors `AppState::new`'s existing `is_mock` check (as `tools_source` does).

### 3.2 Catalog accessor

```rust
pub fn list_plugins(source: &dyn PluginsSource) -> Vec<PluginDetail>
```

Unlike Tools' `list_tools`, there is **no per-project computation** — the describe/transcript are project-independent mock data, so `list_plugins` just returns `source.catalog()`. (Kept as a thin function for symmetry with the established module shape and to give `CliPlugins` a single composition point later.)

### 3.3 `AppState` wrapper + API

- `AppState` gains a `plugins_source: Box<dyn PluginsSource>` field (selected by `is_mock`) and `pub fn list_plugins(&self) -> Vec<PluginDetail>` delegating to `plugins::list_plugins(self.0.plugins_source.as_ref())`.
- **API:** one scoped route — `GET /api/projects/:pid/plugins` → `PluginDetail[]` (handler `api::plugins::list`, read-only). Project-scoped for nav consistency with the rest of `/api/projects/:pid/...`, though the mock data is project-independent.

New `#[ts(export)]` types (`ProtocolFrame`, `ToolSchema`, `PluginDescribe`, `PluginDetail`) export to `web/src/types` via the drift gate; `PluginDescribe.capabilities` reuses the already-exported `Capability`.

## 4. Frontend

### 4.1 API module

`web/src/api/plugins.ts`: `listPlugins(): Promise<PluginDetail[]>` → `GET /plugins` (scoped via the client chokepoint), with the same ok-checking `json<T>` helper used by `api/tools.ts`.

### 4.2 Components (`web/src/tools/`)

- **`PluginsTab.tsx`** — fetches `listPlugins()` on mount; renders the two-pane layout with local `selected` state (the first plugin's name by default; tolerates an empty list):
  - **Gated banner**: an amber notice ("Mock data — gated until tau exposes plugin introspection").
  - **Left list**: one row per plugin — name + a **port badge** (`Tool` = accent/violet, `LlmBackend` = blue); clicking a row selects it (`bg` highlight on the selected row).
  - **Right detail** for the selected plugin:
    - **describe** section: `port <port> · proto v<n> · <kind> · binary <binary>`, the tool schema (`name(param: type, …)`) when present, and capability chips (reusing the Tools-tab capability rendering: `kind k=[v]`).
    - **protocol-decode** section: the `transcript` as frame rows — `→`/`←` direction glyph (out = blue, in = green), the `method`, and a one-line `payload` preview; each row is a button toggling an inline pretty-printed `JSON.stringify(payload, null, 2)` block (the `SpanInspector` `<pre>` house style). Local `expanded` set keyed by frame index.
- **`ToolsPage.tsx`** (modify) — tab state widens from `"skills" | "tools"` to `"skills" | "tools" | "plugins"`. The **Plugins** chip stops being a disabled `aria-disabled` "soon" span and becomes a clickable tab button that still carries the amber **"gated"** badge; selecting it renders `<PluginsTab />`. (Tab state stays component-local; the Skills editor sub-routes are unaffected; returning to `/tools` still defaults to the Skills tab.)

No new routes (selection is in-tab state; no per-plugin page). The sidebar **Tools & Skills** item already routes to `/projects/:pid/tools`.

## 5. Testing

**Gateway** (`plugins/mod.rs` unit tests + an integration test):
- `MockPlugins::catalog` seeds the four plugins with the right ports (`fs-read`/`shell`/`web-search` = `Tool`, `anthropic` = `LlmBackend`) and protocol versions.
- A Tool plugin's transcript has 6 frames and ends with `method == "result"` carrying `ok: true`; the `anthropic` transcript contains an `llm.generate` frame and its `describe.tool` is `None`.
- `CliPlugins::catalog` is empty.
- API `GET /api/projects/:pid/plugins` returns the array with `describe`/`transcript`/`port` populated (e.g. `fs-read` describe.port == `"Tool"`, transcript non-empty).

**Web (vitest):**
- `PluginsTab` renders a list row per plugin from a mocked `listPlugins`; the first plugin is selected by default and its describe + transcript render; clicking another plugin switches the detail; clicking a frame row expands its JSON payload; the gated banner is present.
- `ToolsPage` tab switch: clicking **Plugins** renders `PluginsTab` (the gated banner / a plugin name is visible); the Plugins tab is a real button (not `aria-disabled`); **Skills** and **Tools** still switch as before.

**E2e (Playwright):**
- From `/projects/demo/tools`, click the **Plugins** tab → the plugin list is visible → select `anthropic` → the detail shows `LlmBackend` and an `llm.generate` frame → expand a frame → its JSON payload is visible. (Read-only; no fixture mutation, so no cleanup needed.)

## 6. ts-rs / CI

`ProtocolFrame`, `ToolSchema`, `PluginDescribe`, `PluginDetail` land in `web/src/types` via `#[ts(export)]` + the drift gate. `ProtocolFrame.payload` (`serde_json::Value`) exports as `any` **iff** ts-rs's `serde-json-impl` is available (it ships enabled by default in ts-rs 7+). The implementation plan must verify this first; **fallback** if the `Value` type does not export: type `payload` as `#[ts(type = "unknown")]` (annotation only, no behavior change) — and only if that also fails, as a pre-stringified `payload: String` (pretty JSON, rendered in a `<pre>` without re-stringifying). No CI job changes.

## 7. Out of scope (YAGNI / later)

- **Real plugin introspection** — `CliPlugins` returns empty until tau exposes a plugin describe/protocol API; the contract is pinned to `docs/tau-contract-v1.md` and the hypothesized `plugin.describe` method is mock-only.
- **Live / streaming protocol capture** — the transcript is a static illustrative mock, not a real capture of a running plugin.
- Editing, installing, or **invoking** plugins from this tab (plugins are external binaries; this surface is read-only).
- A deep-linkable per-plugin **route/page** (selection is in-tab state).
- Extracting a shared `GatedBadge` component / refactoring the existing ad-hoc amber badges — out of scope; match the existing inline pattern.
