# tau-web-ui — Product information architecture

**Date:** 2026-05-31
**Status:** Approved (brainstorm). This is the umbrella architecture doc; each sub-project below gets its own spec → plan → implementation cycle and builds against this.
**Purpose:** Define how the entire tau feature surface maps into the web UI — the surfaces, navigation, the runs/workflows model, and the build sequence — so many sub-projects compose into one coherent product without rework.

## 0. Grounding
Feature inventory taken from the tau codebase at `/Users/titouanlebocq/code/tau` (CLI verbs, workflow model, `tau.toml` schema, capabilities/sandbox, targets/build, `tau check`, ROADMAP phases α–δ). tau is "a developer tool, not an end-user tool" (constitution NG11), "not a hosted service" (NG3); files (`tau.toml`, `workflows/*.toml`, `SKILL.md`, lockfile) are the source of truth. This UI is a local, self-hosted client of tau (the gateway) — it never operates a service and never owns state tau owns.

## 1. Product principles (locked)
1. **Mock-first, mark-gated.** Build every surface. Where a surface depends on a tau capability that doesn't exist yet ("gated"), ship the *intended end-state UI with mock data* + a clear **gated** badge, behind a seam that swaps to real data when tau ships it. (Same discipline as `fake-tau-serve` mocking the whole engine.)
2. **Files are the source of truth.** Authoring surfaces read/write tau's files via the gateway; the UI never invents a parallel store. The visual graph editor *emits* Workflow IR (when tau has it), it doesn't replace the TOML.
3. **One normalized Trace model** underpins all observation (agent runs, workflow runs, future OTLP) — already built; `Run.source` distinguishes origin.
4. **Superset architecture, sliced delivery.** Every end-of-roadmap tau capability has a designed home/seam (`docs/seams.md`); we implement slices, never redesign.

## 2. Surface map (every tau feature → a home)
Six surfaces. Status: **built** (shipped) · **now** (buildable against today's tau) · **gated** (mock + badge until a tau phase lands).

| # | Surface | tau features it covers | Status |
|---|---|---|---|
| ① **Author** | Agents (`[agents.*]`), Workflows (`workflows/*.toml` steps), Tools/Skills (`SKILL.md`, import/export), Capabilities editor; **visual Workflow graph → Workflow IR** | now (forms) · **gated** (graph → tau β.2) |
| ② **Configure** | Project (`tau.toml`, inference endpoint, llm_backend), Packages (install/list/update/verify/resolve/lockfile), Plugins (describe/protocol), Sandbox (tier/setup); **Credentials chain**, **`tau add` resolver** | now · **gated** (creds → β.5, resolver → δ.1) |
| ③ **Run** | Launch agent (serve, **built**), Run workflow (`tau workflow run` + JSONL), Chat (REPL), Sessions (list/show/export), run from bundle | built · now |
| ④ **Observe** | **Dashboard** (built), unified **Runs** = workflow + agent runs (filterable), **Trace** detail (turns/tools/agent-spawn for agents; step tree for workflows), plugin protocol recordings; **OTLP/prod** | built · now · **gated** (OTLP) |
| ⑤ **Ship** | Targets (registry list/show), Build (`build --target` → `.tau`), Verify bundle (drift); **wasm/c-abi/mcu** substrates | now · **gated** (γ substrates) |
| ⑥ **Verify** | Checks (`tau check` config/lockfile/pkg/sandbox/plugin/skill → SARIF), Sandbox diagnostics; **Conformance** gate | now · **gated** (conformance → β.6) |

## 3. Navigation (grouped sidebar — chosen)
Top: **Dashboard**. Then two labelled groups (Build = author+configure, Operate = run+observe+ship+verify):

```
Dashboard
─ BUILD ─
  Agents
  Workflows            (graph editor: gated badge)
  Tools & Skills
  Packages
  Config & Capabilities (credentials: gated badge)
─ OPERATE ─
  Runs                 (unified: workflows + agents)
  Ship / Targets       (conformance: gated badge)
  Health               (checks)
```
Trace is a detail view (route `/runs/:id`), not a top-level item. New surfaces land first as routed **stub/gated pages**, then get filled. Routes extend the existing React-Router table; the active item highlights as today.

## 4. Runs / Workflows model (chosen: unified + filter)
One **Runs** surface lists both **workflow runs** and **standalone agent runs**, with a type chip (WF/AG) and filters (type · agent · status · source). Row click opens the shared **Trace** detail, which renders:
- **agent run** → the turn/tool/agent-spawn tree (built), `source: "serve"`;
- **workflow run** → a **step tree** (`agent.run` / `tool.call` StepRecords), `source: "log"`, where an `agent.run` step drills into that agent's own trace.

Workflow runs are ingested by the **log-adapter** (`gateway/src/adapters/log.rs`, currently a stub) tailing `<scope>/.tau/workflow-runs/<name>-<id>.jsonl` → the same Trace/Span model. The Dashboard aggregates over both (a `kind` facet may be added). Since `fake-tau-serve` only emits agent runs, the Workflows sub-project must either point the gateway at real tau workflow logs or extend the mock to emit workflow JSONL.

## 5. Gated-mock convention
A gated surface renders its intended end-state with **mock fixtures** + a persistent **gated** badge (amber, like the context WIP), and a one-line "waits on: tau <phase>" note. Its data path is a seam that activates when tau ships the capability. Gated items and their gate:

| Gated surface | Waits on |
|---|---|
| Visual Workflow graph editor | Workflow IR — tau β.2 |
| Credentials chain config | credential provider chain — β.5 |
| Conformance results | cross-target conformance gate — β.6 |
| OTLP / prod monitoring | tau artifacts emitting OTLP |
| wasm / c-abi / mcu substrate views | those targets — phase γ |
| `tau add <git>` resolver | polyglot resolver — δ.1 |

All are already catalogued in `docs/seams.md`; this doc adds the "mock the end-state" rule.

## 6. Sub-project decomposition + sequence
Each is its own spec → plan → implementation, building on this IA. **now** = real; **gated** = mock+badge.

1. **Nav restructure** *(now; first)* — Build/Operate grouped sidebar; every new surface added as a routed stub/gated page (empty-but-styled, badged). Frames the app; no feature logic. **Detailed in §7.**
2. **Unified executions + Workflows** *(now; second)* — Runs becomes the filterable WF/AG list; gateway log-adapter (workflow JSONL → step-tree trace); Workflows trace view; Dashboard `kind` facet. Closes the thread that prompted this IA.
3. **Project & Config + Packages** *(now)* — `cli-json` adapter; read/write `tau.toml` (project, inference, llm_backend); package install/list/verify/resolve.
4. **Agents authoring** *(now)* — form editor over `[agents.*]` (package, llm, prompt, requires.tools); writes `tau.toml`.
5. **Workflows authoring** *(now + gated)* — steps editor → `workflows/*.toml`; visual graph editor as the gated mock.
6. **Tools & Skills** *(now)* — skills list/show/import/export; plugins describe/protocol decode.
7. **Capabilities & Credentials** *(now + gated)* — fs/net/process allow-deny editor over `tau.toml`; credentials chain as gated mock.
8. **Ship / Targets & Build** *(now + gated)* — targets list/show, `build --target`, verify bundle; conformance as gated mock.
9. **Health / Checks** *(now)* — `tau check --json/--sarif` render; sandbox diagnostics.
Cross-cutting later: OTLP/prod ingest and wasm/c-abi/mcu substrate views (gated), added as adapters per `docs/seams.md`.

## 7. Sub-project 1 — Nav restructure (ready to plan)
**Scope:** restructure the sidebar into Dashboard + **Build** + **Operate** groups and register every surface as a route, with placeholder pages so the IA is navigable end-to-end before features land.
- **Sidebar:** replace the flat 3-item `Sidebar` with grouped sections (a small `NavGroup` + `NavItem`); keep the running-count badge on Runs; gated items show an inline amber **gated** badge.
- **Routes (extend `App.tsx`):** `/agents`, `/workflows`, `/tools`, `/packages`, `/config`, `/ship`, plus existing `/dashboard`, `/runs`, `/runs/:id`, `/health`. Each new route renders a `StubPage` (styled "coming soon" card; gated ones add the badge + "waits on tau <phase>").
- **Components:** `app/Sidebar.tsx` (grouped), `app/NavGroup.tsx`, `app/StubPage.tsx` (reusable: title + subtitle + optional gated badge). Health stays its stub; Dashboard/Runs unchanged.
- **Tests:** Sidebar renders both groups + all items with correct hrefs + the gated badges; routing smoke for each new path renders its StubPage; existing unit + e2e stay green (Runs/Dashboard/Trace untouched; preserve `aria-label`s and the running-count badge).
- **Acceptance:** every menu item navigates to a styled page; gated items are visibly marked; no regressions.

## 8. Non-goals / constitution fit
- No multi-tenant cloud, no auth, no hosted service (NG3/NG9/NG11) — local dev tool only.
- The UI never bypasses tau's files or invents state tau owns; authoring writes the same TOML tau reads.
- We don't build gated features for real ahead of tau; we mock their end-state and wire the seam.
- No telemetry collection (NG10).

## 9. References
- Feature inventory: tau repo (`crates/tau-cli/src/cli.rs`, `crates/tau-workflow/`, `crates/tau-pkg/src/project/`, `ROADMAP.md`).
- Seams catalog: `docs/superpowers/../docs/seams.md` (+ the context-window row).
- Prior specs/plans: serve gateway, frontend, shell+routing, dashboard — under `docs/superpowers/`.
