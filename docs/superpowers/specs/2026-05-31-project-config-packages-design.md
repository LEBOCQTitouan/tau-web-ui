# Project config + Packages — design

**Date:** 2026-05-31
**Status:** Approved (brainstorm), pending spec review → writing-plans
**Scope:** Sub-project 3 of the product IA. Fill the **Config** (`/config`) and **Packages** (`/packages`) stub surfaces: edit `tau.toml` `[project]` + read the agents/backends overview, and do full package management (list · install · uninstall · update · resolve · verify) mock-backed with a real-tau `cli-json` seam.

## 0. Decisions (locked in brainstorm)
- **Config = real `tau.toml` read/write** (it's a file the gateway already has) via `toml_edit` (preserves the rest of the file). Editable: project `name`/`description`. Read-only overview: agents → `llm_backend`/`package`. Credentials = gated stub (tau β.5).
- **Packages = mock-first** `PackageOps` trait (`MockOps` + `CliOps` seam), full mutating set.
- Per-agent **capability editing** stays in the Agents-authoring sub-project (noted on the page).

## 1. Gateway (Rust)
### 1.1 ConfigStore (real tau.toml I/O)
`gateway/src/config/mod.rs`:
- Deps: add `toml = "0.8"` and `toml_edit = "0.22"` to `gateway/Cargo.toml`.
- `ProjectConfig { name: String, description: Option<String>, agents: Vec<AgentInfo> }`, `AgentInfo { id, llm_backend: Option<String>, package: Option<String> }` (serde + ts-rs export, like the trace types).
- `read(project: &Path) -> Result<ProjectConfig>` — parse `<project>/tau.toml` with `toml` into the above (tolerate missing `[agents]`).
- `write_project(project: &Path, name: &str, description: Option<&str>) -> Result<()>` — load `tau.toml` with `toml_edit`, set `project.name`/`project.description`, write back (preserving comments/other tables). If the file lacks a `[project]` table, create it.
- Unit-tested against a tempdir `tau.toml`.

### 1.2 PackageOps (mock-first cli-json)
`gateway/src/packages/mod.rs`:
- `Package { name, version, source, status }` (serde + ts-rs), `VerifyResult { name, status }`.
- `trait PackageOps: Send + Sync { fn list() -> Vec<Package>; fn install(git_url) -> Result<Package>; fn uninstall(name) -> Result<()>; fn update(name, to: Option<String>) -> Result<Package>; fn resolve() -> Result<Vec<Package>>; fn verify() -> Vec<VerifyResult>; }` (sync, behind a `Mutex` for the mock's in-memory state — or `async` mirroring the workflow runner; pick sync + interior mutability for simplicity).
- `MockOps` — `Mutex<Vec<Package>>` seeded with ~3 canned packages (e.g. `anthropic@0.1.0` from `https://github.com/tau/anthropic.git` status `ok`, `fs-read@1.0.0`, `shell@0.2.0`). `install` derives a name from the git URL + appends; `uninstall` removes; `update` bumps version; `resolve` is a no-op returning the list; `verify` returns `ok` for each.
- `CliOps` (seam) — shells `tau list packages --json`, `tau verify --json`, `tau install <git>`, `tau uninstall`, `tau update`, `tau resolve`, parsing `--json`. Stubbed to a graceful error in v1 (mock path covers fake-tau-serve), documented like `CliRunner`.
- Selection in `AppState::new`: `MockOps` when `--tau-bin` is `fake-tau-serve`, else `CliOps`. Stored on `Inner` as `Box<dyn PackageOps>`. `ConfigStore` is stateless (operates on `self.0.project`).

### 1.3 API (`gateway/src/api/config.rs`, `packages.rs` + routes)
- `GET /api/project/config` → `ProjectConfig`.
- `PUT /api/project/config` `{ name, description? }` → `{ ok: true }` (writes tau.toml).
- `GET /api/packages` → `{ packages: [Package] }`.
- `POST /api/packages/install` `{ git_url }` → `{ package }`.
- `DELETE /api/packages/:name` → `{ ok }`.
- `POST /api/packages/:name/update` `{ to? }` → `{ package }`.
- `POST /api/packages/resolve` → `{ packages }`.
- `POST /api/packages/verify` → `{ results: [VerifyResult] }`.

## 2. Frontend
- **Types**: ts-rs generates `ProjectConfig`/`AgentInfo`/`Package`/`VerifyResult` into `web/src/types/` (drift-gated, like the trace types).
- **API client** (`web/src/api/config.ts`): `getConfig`, `putConfig`, `getPackages`, `installPackage`, `uninstallPackage`, `updatePackage`, `resolvePackages`, `verifyPackages`.
- **ConfigPage** (`web/src/config/ConfigPage.tsx`, route `/config`): on mount `getConfig`; an editable **name**/**description** form with a **Save** button (`putConfig` → toast/inline "saved"); a read-only **Agents** table (id · llm_backend · package); a **Credentials** card stub with the amber **gated** badge ("β.5"); a one-line note that capability editing lives in Agents. Page-local React state (no global store).
- **PackagesPage** (`web/src/packages/PackagesPage.tsx`, route `/packages`): a **packages table** (name · version · source · status-badge), per-row **Uninstall**/**Update** buttons; an **Install** input (git URL) + button; **Resolve** + **Verify** buttons; verify results merge a status badge per row; all mutations refetch the list. Page-local state.
- **Routing**: in `App.tsx`, swap the `/config` and `/packages` `StubPage`s for `<ConfigPage/>` / `<PackagesPage/>`. The sidebar items lose their stub status (Config keeps no gated badge at the item level; the credentials *card* inside is the gated bit).

## 3. Mock fixtures
- `MockOps` canned packages (above) — no files needed; in-memory.
- `ConfigStore` reads/writes the real `fixtures/demo/tau.toml` (already exists with `[project]` + `[agents.greeter]`/`[agents.researcher]`). Editing name/description in the UI rewrites that file (acceptable in dev).

## 4. Testing
- **Gateway**: `ConfigStore` read (parses fixture-like tau.toml → name + agents) and write (set name/description in a tempdir tau.toml, re-read → updated, other tables preserved); `MockOps` (list seeded; install adds; uninstall removes; update bumps; verify returns ok per package); API smoke (curl GET config, PUT config, GET/POST packages); ts-rs export of the new types.
- **Frontend**: ConfigPage (renders fetched name; Save calls `putConfig` with edited values; gated credentials badge shown); PackagesPage (renders seeded rows; Install calls `installPackage` and the new row appears; Uninstall removes). Mock `fetch` in unit tests.
- **e2e (Playwright)**: a light case — navigate to `/config`, edit the name, Save (expect a "saved" affirmation); navigate to `/packages`, install a git URL (expect a new row). Keep the existing run/workflow e2e green.
- All existing unit + e2e + the ts-rs drift gate stay green.

## 5. Non-goals (YAGNI)
- No agent/capability **authoring** (separate sub-project) — Config only edits `[project]` and shows a read-only agent overview.
- No real credential management — gated stub.
- No real-tau package mutations in v1 — `CliOps` is a documented seam.
- No lockfile editor beyond what `verify`/`resolve` expose.

## 6. File-change summary
- **Gateway:** `gateway/Cargo.toml` (+toml/toml_edit), `gateway/src/config/mod.rs` (ConfigStore + types + tests), `gateway/src/packages/mod.rs` (PackageOps + MockOps + CliOps seam + types + tests), `gateway/src/lib.rs` (+modules), `gateway/src/state.rs` (PackageOps on Inner + selection; config helpers), `gateway/src/api/{config.rs,packages.rs}` + `api/mod.rs` routes.
- **Frontend:** `web/src/api/config.ts`; `web/src/config/ConfigPage.tsx` (+test); `web/src/packages/PackagesPage.tsx` (+test); `web/src/App.tsx` (routes); generated `web/src/types/*` ; `web/e2e/run.spec.ts` (config/packages case).
- **Docs:** flip the Project/Config + resolver rows in `docs/seams.md` (config implemented; package mutations mock + CliOps seam; credentials gated).
