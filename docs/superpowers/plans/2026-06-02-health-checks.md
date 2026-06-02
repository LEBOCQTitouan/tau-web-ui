# Verify / Health (Checks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/health` `StubPage` with a real, mock-backed Health / Checks surface that renders `tau check` results — a connectivity strip, category chips over a flat SARIF-style findings table (with chip filtering), sandbox diagnostics, and a gated Conformance card.

**Architecture:** A new gateway `checks` module (mock seam `CheckSource`/`MockChecks`/`CliChecks` returning a `CheckReport`) + one scoped read-only endpoint `GET /checks`; a frontend `HealthPage` (replacing the stub) that fetches the report and reuses the existing store connectivity `Health`. Severities map error→`st-error`, warning→amber, note→`st-running`, pass→`st-ok`. Conformance is a frontend-only gated card.

**Tech Stack:** Rust, axum 0.7, serde, ts-rs; React 18, react-router-dom v6, Zustand, Vitest, Playwright.

This is the single plan for Verify / Health (see `docs/superpowers/specs/2026-06-02-health-checks-design.md`) — surface ⑥, the last Product-IA surface.

---

## File Structure

**New:**
- `gateway/src/checks/mod.rs` — `CheckFinding`/`CategoryStatus`/`SandboxDiag`/`CheckReport` types, `CheckSource` seam (`MockChecks`/`CliChecks`).
- `gateway/src/api/checks.rs` — the `report` handler.
- `web/src/api/checks.ts` — `getChecks`.
- `web/src/health/HealthPage.tsx` — the Health / Checks surface.
- Tests: `gateway/tests/checks_api.rs`, `web/src/health/HealthPage.test.tsx`.

**Modified:**
- `gateway/src/lib.rs` — `pub mod checks;`.
- `gateway/src/state.rs` — `check_source` field + `checks()` wrapper.
- `gateway/src/api/mod.rs` — `pub mod checks;` + `/checks` route.
- `web/src/App.tsx` — `/health` route renders `<HealthPage />`.

(`Sidebar.tsx` is unchanged — the Health nav item is already un-gated.)

---

## Task 1: Types + `CheckSource` seam

**Files:**
- Create: `gateway/src/checks/mod.rs`
- Modify: `gateway/src/lib.rs`

- [ ] **Step 1: Add the module to lib.rs**

In `gateway/src/lib.rs`, insert `pub mod checks;` alphabetically — after `pub mod api;` and before `pub mod config;`:

```rust
pub mod api;
pub mod checks;
pub mod config;
```

- [ ] **Step 2: Create `gateway/src/checks/mod.rs`**

```rust
//! Verify / Health checks: a mock-backed `tau check` report (SARIF-style findings
//! over categories + sandbox diagnostics). Mirrors the tools/ship seam. tau has no
//! real check endpoint yet — `CliChecks` is the empty seam.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckFinding {
    pub category: String, // "config"|"lockfile"|"pkg"|"sandbox"|"plugin"|"skill"
    pub severity: String, // "error" | "warning" | "note"
    pub rule: String,
    pub message: String,
    pub location: Option<String>, // "tau.toml:3" | None
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CategoryStatus {
    pub name: String,
    pub errors: u32,
    pub warnings: u32,
    pub notes: u32, // pass = all zero
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SandboxDiag {
    pub tier: String,
    pub status: String,
    pub no_sandbox: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckReport {
    pub categories: Vec<CategoryStatus>,
    pub findings: Vec<CheckFinding>,
    pub sandbox: SandboxDiag,
}

/// Source of the check report. Mock-first; the CLI path stays empty until tau
/// exposes `tau check --sarif` over the gateway.
pub trait CheckSource: Send + Sync {
    fn report(&self) -> CheckReport;
}

fn cat(name: &str, errors: u32, warnings: u32, notes: u32) -> CategoryStatus {
    CategoryStatus {
        name: name.into(),
        errors,
        warnings,
        notes,
    }
}

fn finding(
    category: &str,
    severity: &str,
    rule: &str,
    message: &str,
    location: Option<&str>,
) -> CheckFinding {
    CheckFinding {
        category: category.into(),
        severity: severity.into(),
        rule: rule.into(),
        message: message.into(),
        location: location.map(|s| s.to_string()),
    }
}

pub struct MockChecks;

impl CheckSource for MockChecks {
    fn report(&self) -> CheckReport {
        CheckReport {
            categories: vec![
                cat("config", 1, 0, 0),
                cat("lockfile", 0, 1, 0),
                cat("pkg", 0, 0, 0),
                cat("sandbox", 0, 0, 1),
                cat("plugin", 0, 0, 0),
                cat("skill", 0, 0, 0),
            ],
            findings: vec![
                finding(
                    "config",
                    "error",
                    "TAU-CONFIG-ENDPOINT",
                    "inference.endpoint not set",
                    Some("tau.toml:3"),
                ),
                finding(
                    "lockfile",
                    "warning",
                    "TAU-LOCK-STALE",
                    "lockfile is stale vs tau.toml — run `tau resolve`",
                    Some("tau.lock:1"),
                ),
                finding(
                    "sandbox",
                    "note",
                    "TAU-SANDBOX-TIER",
                    "sandbox tier: seatbelt (macOS)",
                    None,
                ),
            ],
            sandbox: SandboxDiag {
                tier: "seatbelt".into(),
                status: "ready".into(),
                no_sandbox: false,
            },
        }
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliChecks;

impl CheckSource for CliChecks {
    fn report(&self) -> CheckReport {
        CheckReport {
            categories: vec![],
            findings: vec![],
            sandbox: SandboxDiag {
                tier: "unknown".into(),
                status: "unknown".into(),
                no_sandbox: false,
            },
        }
    }
}
```

- [ ] **Step 3: Write the failing tests** — add a test module at the bottom of `gateway/src/checks/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_report_seeds_categories_and_findings() {
        let r = MockChecks.report();
        let names: Vec<&str> = r.categories.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["config", "lockfile", "pkg", "sandbox", "plugin", "skill"]
        );
        let config = r.categories.iter().find(|c| c.name == "config").unwrap();
        assert_eq!(config.errors, 1);
        let pkg = r.categories.iter().find(|c| c.name == "pkg").unwrap();
        assert_eq!((pkg.errors, pkg.warnings, pkg.notes), (0, 0, 0));
        assert_eq!(r.findings.len(), 3);
        let err = r.findings.iter().find(|f| f.severity == "error").unwrap();
        assert_eq!(err.rule, "TAU-CONFIG-ENDPOINT");
        assert_eq!(err.category, "config");
        assert_eq!(r.sandbox.tier, "seatbelt");
    }

    #[test]
    fn cli_checks_is_empty() {
        let r = CliChecks.report();
        assert!(r.categories.is_empty());
        assert!(r.findings.is_empty());
    }
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo test -p tau-gateway --lib checks::tests`
Expected: PASS (2 tests). Also `cargo build -p tau-gateway` (compiles clean — no unused imports).

```bash
git add gateway/src/lib.rs gateway/src/checks/mod.rs
git commit -m "feat(gateway): check report types + mock seam"
```

---

## Task 2: AppState wrapper

**Files:**
- Modify: `gateway/src/state.rs`

- [ ] **Step 1: Add the import** — in `gateway/src/state.rs`, add to the `use` block. Alphabetically `checks` sits near the top of the `crate::` imports, just before `use crate::config::...`:

```rust
use crate::checks::{self, CheckReport, CheckSource};
```

- [ ] **Step 2: Add the `Inner` field** — add to the `Inner` struct, right after the existing `ship_source: Box<dyn ShipSource>,` field:

```rust
    check_source: Box<dyn CheckSource>,
```

- [ ] **Step 3: Build it in `AppState::new`** — right after the existing `ship_source` selection block (`is_mock` is in scope):

```rust
        let check_source: Box<dyn CheckSource> = if is_mock {
            Box::new(checks::MockChecks)
        } else {
            Box::new(checks::CliChecks)
        };
```

and add `check_source` to the `Inner { ... }` struct literal, right after the existing `ship_source,` line:

```rust
            ship_source,
            check_source,
```

- [ ] **Step 4: Add the wrapper method** — inside `impl AppState`, right after the existing `build` method (the ship wrapper added in the previous feature):

```rust
    pub fn checks(&self) -> CheckReport {
        self.0.check_source.report()
    }
```

- [ ] **Step 5: Run + commit**

Run: `cargo build -p tau-gateway && cargo test -p tau-gateway --lib`
Expected: PASS, no regressions.

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): AppState check_source + checks wrapper"
```

---

## Task 3: API route + integration test

**Files:**
- Create: `gateway/src/api/checks.rs`, `gateway/tests/checks_api.rs`
- Modify: `gateway/src/api/mod.rs`

- [ ] **Step 1: Create `gateway/src/api/checks.rs`**

```rust
use axum::Json;

use crate::api::scope::Scoped;
use crate::checks::CheckReport;

pub async fn report(Scoped(state): Scoped) -> Json<CheckReport> {
    Json(state.checks())
}
```

- [ ] **Step 2: Wire the route in `gateway/src/api/mod.rs`**

Add `pub mod checks;` to the module list at the top — alphabetically, after `pub mod agents;` and before `pub mod config;`:

```rust
pub mod agents;
pub mod checks;
pub mod config;
```

In the scoped router, the current last route is `.route("/build", post(ship::build));` (it ends with a semicolon). Change it to chain `/checks` after it:

```rust
        .route("/build", post(ship::build))
        .route("/checks", get(checks::report));
```

(`get` is already imported via `axum::routing::{delete, get, post}`.)

- [ ] **Step 3: Create `gateway/tests/checks_api.rs`**

```rust
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn checks_report_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!("{base}/api/projects/{}/checks", meta.id))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let report: serde_json::Value = resp.json().await.unwrap();

    assert_eq!(report["categories"].as_array().unwrap().len(), 6);
    assert_eq!(report["findings"].as_array().unwrap().len(), 3);
    assert_eq!(report["sandbox"]["tier"], "seatbelt");

    let config = report["categories"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "config")
        .unwrap();
    assert_eq!(config["errors"], 1);

    let err = report["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["severity"] == "error")
        .unwrap();
    assert_eq!(err["rule"], "TAU-CONFIG-ENDPOINT");
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test checks_api`
Expected: PASS. Confirm `git status --porcelain fixtures/demo` stays clean (read-only).

```bash
git add gateway/src/api/checks.rs gateway/src/api/mod.rs gateway/tests/checks_api.rs
git commit -m "feat(gateway): GET /checks route + integration test"
```

---

## Task 4: ts-rs export + rust gate

**Files:**
- Regenerated: `web/src/types/{CheckFinding,CategoryStatus,SandboxDiag,CheckReport}.ts`

- [ ] **Step 1: Regenerate** — `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS; new files under `web/src/types/`. Confirm `git status --porcelain fixtures/demo` is empty.

- [ ] **Step 2: Verify** — `ls web/src/types/ | grep -E "CheckFinding|CategoryStatus|SandboxDiag|CheckReport"` → all four present. `cat web/src/types/CheckReport.ts` should reference `CategoryStatus`, `CheckFinding`, `SandboxDiag`.

- [ ] **Step 3: Full rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green. Fix fmt minimally with `cargo fmt --all` if needed. The pre-existing ts-rs serde-attr note is benign.

- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export check TS bindings + fmt/clippy"
```

---

## Task 5: Frontend — `api/checks.ts` + `HealthPage` + routing

**Files:**
- Create: `web/src/api/checks.ts`, `web/src/health/HealthPage.tsx`, `web/src/health/HealthPage.test.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create `web/src/api/checks.ts`**

```ts
import type { CheckReport } from "../types/CheckReport";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getChecks = () => fetch(scopedPath("/checks")).then(json<CheckReport>);
```

- [ ] **Step 2: Write the failing `HealthPage` test `web/src/health/HealthPage.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HealthPage } from "./HealthPage";

const report = {
  categories: [
    { name: "config", errors: 1, warnings: 0, notes: 0 },
    { name: "lockfile", errors: 0, warnings: 1, notes: 0 },
    { name: "pkg", errors: 0, warnings: 0, notes: 0 },
  ],
  findings: [
    {
      category: "config",
      severity: "error",
      rule: "TAU-CONFIG-ENDPOINT",
      message: "inference.endpoint not set",
      location: "tau.toml:3",
    },
    {
      category: "lockfile",
      severity: "warning",
      rule: "TAU-LOCK-STALE",
      message: "stale",
      location: "tau.lock:1",
    },
  ],
  sandbox: { tier: "seatbelt", status: "ready", no_sandbox: false },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => report }));
});

describe("HealthPage", () => {
  it("renders category chips + findings, gated conformance present", async () => {
    render(<HealthPage />);
    await waitFor(() => expect(screen.getByText("TAU-CONFIG-ENDPOINT")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /config/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lockfile/i })).toBeInTheDocument();
    expect(screen.getByText(/waits on tau β\.6/i)).toBeInTheDocument();
  });

  it("filters the findings table by category chip", async () => {
    const user = userEvent.setup();
    render(<HealthPage />);
    await waitFor(() => expect(screen.getByText("TAU-CONFIG-ENDPOINT")).toBeInTheDocument());
    expect(screen.getByText("TAU-LOCK-STALE")).toBeInTheDocument();
    // filter to lockfile → config finding disappears
    await user.click(screen.getByRole("button", { name: /lockfile/i }));
    expect(screen.getByText("TAU-LOCK-STALE")).toBeInTheDocument();
    expect(screen.queryByText("TAU-CONFIG-ENDPOINT")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Create `web/src/health/HealthPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { CheckReport } from "../types/CheckReport";
import type { CategoryStatus } from "../types/CategoryStatus";
import { getChecks } from "../api/checks";
import { useStore } from "../store/store";

const SEV_CLASS: Record<string, string> = {
  error: "bg-st-error-soft text-st-error",
  warning: "bg-amber-100 text-amber-800",
  note: "bg-st-running-soft text-st-running",
  pass: "bg-st-ok-soft text-st-ok",
};

function SeverityBadge({ severity, label }: { severity: string; label?: string }) {
  const cls = SEV_CLASS[severity] ?? SEV_CLASS.note;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {label ?? severity}
    </span>
  );
}

function worst(c: CategoryStatus): "error" | "warning" | "note" | "pass" {
  if (c.errors > 0) return "error";
  if (c.warnings > 0) return "warning";
  if (c.notes > 0) return "note";
  return "pass";
}

export function HealthPage() {
  const health = useStore((s) => s.health);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  function load() {
    getChecks()
      .then(setReport)
      .catch(() => {});
  }
  useEffect(() => {
    load();
  }, []);

  const findings = report?.findings ?? [];
  const shown = filter ? findings.filter((f) => f.category === filter) : findings;

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-base font-semibold">Health / Checks</h2>

      {/* connectivity */}
      <div className="flex items-center gap-4 rounded-md border border-border bg-surface px-3 py-1.5 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${health?.gateway_ok ? "bg-st-ok" : "bg-st-error"}`}
          />
          gateway {health?.gateway_ok ? "ok" : "down"}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${health?.engine_ok ? "bg-st-ok" : "bg-st-error"}`}
          />
          engine {health?.engine_ok ? "ok" : "down"}
        </span>
        <span className="font-mono text-muted">tau {health?.tau_version || "—"}</span>
        <button
          onClick={load}
          className="ml-auto rounded-md border border-border px-2 py-0.5 text-xs font-semibold"
        >
          Re-run
        </button>
      </div>

      {/* checks */}
      <section className="space-y-2">
        <div className="text-[9px] uppercase text-muted">checks</div>
        <div className="flex flex-wrap gap-2">
          {(report?.categories ?? []).map((c) => {
            const w = worst(c);
            const total = c.errors + c.warnings + c.notes;
            const active = filter === c.name;
            return (
              <button
                key={c.name}
                onClick={() => setFilter(active ? null : c.name)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                  active ? "border-accent" : "border-border"
                }`}
              >
                <SeverityBadge severity={w} label={w === "pass" ? "✓" : String(total)} />
                <span className="font-medium">{c.name}</span>
              </button>
            );
          })}
        </div>

        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">severity</th>
              <th className="px-2 py-1 font-medium">rule</th>
              <th className="px-2 py-1 font-medium">message</th>
              <th className="px-2 py-1 font-medium">location</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f, i) => (
              <tr key={`${f.rule}-${i}`} className="border-b border-border/60">
                <td className="py-1 pr-2">
                  <SeverityBadge severity={f.severity} />
                </td>
                <td className="px-2 py-1 font-mono text-accent">{f.rule}</td>
                <td className="px-2 py-1">{f.message}</td>
                <td className="px-2 py-1 font-mono text-muted">{f.location ?? "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-2 text-muted">
                  No findings.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* sandbox */}
      <section className="space-y-1">
        <div className="text-[9px] uppercase text-muted">sandbox</div>
        <div className="text-xs">
          tier <span className="font-mono">{report?.sandbox.tier ?? "—"}</span>
          {" · "}
          <SeverityBadge
            severity={report?.sandbox.status === "ready" ? "pass" : "note"}
            label={report?.sandbox.status ?? "—"}
          />
          {report?.sandbox.no_sandbox && (
            <span className="ml-2 text-amber-800">⚠ running with --no-sandbox</span>
          )}
        </div>
      </section>

      {/* conformance (gated) */}
      <section className="space-y-1">
        <div className="flex items-center gap-2 text-[9px] uppercase text-muted">
          conformance
          <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
            gated
          </span>
        </div>
        <div className="rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Cross-target conformance — waits on tau β.6.
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route in `web/src/App.tsx`**

Add the import near the other page imports (after the existing `ShipPage` import on line 15):

```tsx
import { HealthPage } from "./health/HealthPage";
```

Find the existing `/health` route (it renders `<StubPage title="Health checks" subtitle="tau check & sandbox — coming soon." />`). Replace that ENTIRE `<Route path="health" … />` element with:

```tsx
          <Route path="health" element={<HealthPage />} />
```

(Leave the `StubPage` import in place — it is still used by the `workflows` route.)

- [ ] **Step 5: Run + commit**

Run: `cd web && pnpm test -- src/health/HealthPage.test.tsx && pnpm test && pnpm typecheck`
Expected: all green.

```bash
git add web/src/api/checks.ts web/src/health/HealthPage.tsx web/src/health/HealthPage.test.tsx web/src/App.tsx
git commit -m "feat(web): Health / Checks page (tau check findings + sandbox + gated conformance)"
```

---

## Task 6: E2e + final gate

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Append the spec**

```ts
test("health: checks findings + filter + gated conformance", async ({ page }) => {
  await page.goto("/projects/demo/health");
  await expect(page.getByText("TAU-CONFIG-ENDPOINT")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/waits on tau β\.6/i)).toBeVisible();
  // filter by the lockfile chip → the config error finding disappears
  await page.getByRole("button", { name: /lockfile/i }).click();
  await expect(page.getByText("TAU-LOCK-STALE")).toBeVisible();
  await expect(page.getByText("TAU-CONFIG-ENDPOINT")).toHaveCount(0);
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. Real ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` and note e2e deferred to CI. A strict-mode "N elements" error → fix the selector minimally (`exact:true`/`.first()`), report the fix.

- [ ] **Step 3: Restore fixtures** (the health surface is read-only, but other specs mutate `fixtures/demo/tau.toml` + may leave skill dirs):

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green. If format:check fails, `pnpm format`, re-check, include in the commit.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (git status)
git commit -m "test(web): e2e health checks + chip filter"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-02-health-checks-design.md`):
- §2 types (`CheckFinding`, `CategoryStatus`, `SandboxDiag`, `CheckReport`) → Task 1. §3.1 `CheckSource`/`MockChecks` (6 categories, 3 findings, sandbox)/`CliChecks` empty → Task 1. §3.2 AppState wrapper + `GET /checks` → Tasks 2–3. ts-rs/CI (§6) → Task 4. §4.1 `api/checks.ts` → Task 5. §4.2 `HealthPage` (connectivity strip w/ Re-run, category chips + filter, findings table, sandbox, gated conformance, `SeverityBadge`) → Task 5. §4.3 route swap (no Sidebar change) → Task 5. §5 tests → Tasks 1, 3, 5, 6. All covered.

**Placeholder scan:** none — every step has complete code.

**Type consistency:** `CheckFinding { category, severity, rule, message, location: Option<String> }`, `CategoryStatus { name, errors, warnings, notes }`, `SandboxDiag { tier, status, no_sandbox }`, `CheckReport { categories, findings, sandbox }` are used identically across the module, the AppState wrapper, the handler, the integration test, and the frontend (`api/checks.ts`, `HealthPage`). `report() -> CheckReport` and `MockChecks`/`CliChecks` signatures match callers. The frontend reads `report.categories`/`report.findings`/`report.sandbox` and the existing store `health.{gateway_ok,engine_ok,tau_version}` — matching the gateway field names. The `GET /checks` path matches `getChecks` (`scopedPath("/checks")`). `SeverityBadge` maps `error|warning|note|pass` to tokens consistently between chips and rows.

**Note for executor:** `checks` is read-only — `GET /checks` reads no project files (pure mock), so `git status --porcelain fixtures/demo` stays clean; other e2e specs mutate fixtures, so Task 6 Step 3 restores them. The vitest/e2e assertions target unique finding rule strings (`TAU-CONFIG-ENDPOINT`, `TAU-LOCK-STALE`) and role-scoped chip buttons (`/config/i`, `/lockfile/i`) — no duplicate-match trap (the rule strings appear once each, in the findings table only; the category names appear in chips, never as finding-rule text). `HealthPage` reads `useStore(s => s.health)`; in the vitest tests no store setup is needed — the Zustand store's initial `health` is `null`, so the connectivity strip renders "down/—" (not asserted), which is fine.
