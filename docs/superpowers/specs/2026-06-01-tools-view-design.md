# Tools view — design

**Status:** approved (brainstorm 2026-06-01)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md) — surface ⑥ "Tools & Skills", slice **#2 of 3** (after [Skills authoring](2026-06-01-skills-authoring-design.md); before gated Plugins).
**Decomposition:** one implementation plan (gateway + frontend) — this is a small, read-only surface.

## 1. Goal

Fill in the **Tools** tab of the Tools & Skills surface: a **read-only** list of the tool packages (`kind="tool"`) an agent's or skill's `requires.tools` reference — each row expandable inline to show what it **provides**, its **capabilities**, its source, and **which agents/skills in this project use it**. The tool catalog is mock-seeded (real tool packages need tau's package/plugin system), but **`used_by` is computed from the real project files**, so the cross-reference is genuine.

Locked decisions (brainstorm):
- Detail presentation: **inline expand** (click a row → it expands in place; no separate route).
- **`used_by`** is **per-project** (this project's agents + local skills), with density handled by showing the first few references then **"+N more"**; a tool with none shows **"unused"**.
- The Tools tab is real now; the **Plugins** tab stays a gated "soon" placeholder (slice #3).

## 2. Data model (ts-rs types)

`Capability` is **reused** from the skills module (`gateway/src/skills/mod.rs`): `{ kind: string, fields: { [param]: string[] } }`.

```rust
// gateway/src/tools/mod.rs

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolUser {
    pub kind: String,   // "agent" | "skill"
    pub name: String,
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolDetail {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub provides: String,              // "tool"
    pub plugin_kind: Option<String>,   // e.g. "rust-cargo"
    pub binary: Option<String>,        // the plugin binary name
    pub capabilities: Vec<crate::skills::Capability>,
    pub used_by: Vec<ToolUser>,
}
```

The inline-expand surface needs the full detail up front, so there is **one read-only endpoint** returning `ToolDetail[]`; the frontend derives each row's summary (provides, capability kinds, `used_by` count) from it.

## 3. Gateway

### 3.1 `tools` module (`gateway/src/tools/mod.rs`)

Mock-first behind a seam, mirroring the skills `InstalledSkills` pattern:
- **`ToolsSource` trait**: `fn catalog(&self) -> Vec<ToolDetail>` — returns the tool packages with `used_by` left empty (filled by the composer).
- **`MockTools`**: seeds three tool packages —
  - `fs-read` — provides `tool`, plugin_kind `rust-cargo`, binary `fs-read`, capability `fs.read` `{paths:["${WORKDIR}/**"]}`;
  - `shell` — capability `process.spawn` `{commands:["sh"]}`;
  - `web-search` — capability `net.http` `{hosts:["*"]}`.
  Used when the bin name contains `fake-tau-serve`.
- **`CliTools`** (seam, not exercised in v1): future real path — tau `kind="tool"` packages + their plugin manifests; returns an empty catalog for now.

Selection mirrors `AppState::new`'s existing `is_mock` check (as `installed_skills` does).

### 3.2 Composer + `used_by`

```rust
pub fn list_tools(project: &Path, source: &dyn ToolsSource) -> Vec<ToolDetail>
```
Takes the catalog and fills each tool's `used_by` by scanning **real project files**:
- **Agents**: `crate::config::list_agents(project)` → for each `AgentDetail` whose `requires_tools` contains the tool's name → `ToolUser { kind: "agent", name: agent.id }`.
- **Local skills**: `crate::skills::list_local(project)` then `read_local` each → for each `SkillDetail` whose `requires_tools` contains the tool's name → `ToolUser { kind: "skill", name: skill.name }`.

Both sources are read tolerantly (errors → skipped), like the existing summary readers. `used_by` is sorted (agents before skills, then by name) for stable output.

For the **demo fixture**, the seeded `critic` skill's `requires_tools` includes `fs-read`, so `fs-read` shows `used_by: [skill: critic]` and the others show "unused" — real computed data with no fixture changes.

### 3.3 `AppState` wrapper + API

- `AppState` gains a `tools_source: Box<dyn ToolsSource>` field (selected by `is_mock`) and `pub fn list_tools(&self) -> Vec<ToolDetail>` delegating to `tools::list_tools(&self.0.project, self.0.tools_source.as_ref())`.
- **API:** one scoped route — `GET /api/projects/:pid/tools` → `ToolDetail[]` (handler `api::tools::list`, read-only).

New `#[ts(export)]` types (`ToolUser`, `ToolDetail`) export to `web/src/types` via the drift gate; `ToolDetail.capabilities` reuses the already-exported `Capability`.

## 4. Frontend

### 4.1 API module

`web/src/api/tools.ts`: `listTools(): Promise<ToolDetail[]>` → `GET /tools` (scoped via the client chokepoint).

### 4.2 Components (`web/src/tools/`)

- **`ToolsTab.tsx`** — fetches `listTools()` on mount; renders a table (tool · version · source · provides · capabilities · used-by count). Each row is a button toggling an **inline-expanded** detail region (local `expanded` set keyed by tool name) showing:
  - **provides**: `port <provides> · <plugin_kind> · binary <binary>`,
  - **capabilities**: each `{kind}` with its field lists (e.g. `fs.read paths=[…]`),
  - **used by**: chips — agents (accent) + skills (green) — showing the first **6**, then **"+N more"**; **"unused"** when empty,
  - **source**.
- **`ToolsPage.tsx`** (modify) — gains local tab state `useState<"skills" | "tools">("skills")`. The **Skills** and **Tools** tab chips become clickable buttons that switch the rendered body between `SkillsIndex` and `ToolsTab`; **Plugins** stays a disabled "soon" chip. (Tab state is component-local — the Skills editor sub-routes still work; returning to `/tools` defaults to the Skills tab.)

No new routes (inline expand, no detail page). The sidebar **Tools & Skills** item already routes to `/projects/:pid/tools`.

## 5. Testing

**Gateway** (`tools/mod.rs` unit tests + an integration test):
- `MockTools::catalog` seeds the three tools with the right capability kinds.
- `list_tools` against `fixtures/demo` computes `used_by`: `fs-read` includes `{skill, critic}`; `shell`/`web-search` are empty.
- An agent with a `requires.tools` entry (written into a temp project) shows up as `{agent, <id>}` in the matching tool's `used_by`.
- API `GET /api/projects/:pid/tools` returns the array with `provides`/`capabilities`/`used_by`.

**Web (vitest):**
- `ToolsTab` renders a row per tool from a mocked `listTools`; clicking a row expands it and shows capabilities + the `used_by` chips; an unused tool shows "unused"; a tool with >6 users shows "+N more".
- `ToolsPage` tab switch: clicking **Tools** renders `ToolsTab`; clicking **Skills** renders `SkillsIndex`; **Plugins** is disabled.

**E2e (Playwright):**
- From `/projects/demo/tools`, click the **Tools** tab → `fs-read` row visible → expand it → shows `fs.read` and **used by** `critic`. (Read-only; no fixture mutation, so no cleanup needed.)

## 6. ts-rs / CI

`ToolUser`, `ToolDetail` land in `web/src/types` via `#[ts(export)]` + the drift gate. No CI job changes.

## 7. Out of scope (YAGNI / later)

- **Cross-project** `used_by` (aggregate across all registered projects) — considered and deferred; v1 is per-project.
- Editing/installing/removing tools here (tools are installed via the Packages surface / are external binaries; this tab is read-only).
- A deep-linkable tool detail **page** (inline expand only).
- **Plugins** describe + protocol-decode viewer — slice #3 (gated).
- Real tool-catalog enumeration from tau (`CliTools` seam returns empty until tau's package/plugin introspection is wired).
