# D3 — Validate & ship seams (real tau) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the gateway's mock `CheckSource`/`ShipSource` seams to the real `tau` CLI (`tau check`/`tau target`/`tau build`/`tau verify`, all `--json`), evolving the `#[ts(export)]` types to tau's real output shape (UI driven by tau).

**Architecture:** Each `Cli*` seam shells out to the tau binary with `std::process::Command::output()` (mirroring `GitCloner` in `gateway/src/projects/cloner.rs`) and parses the JSONL. Types are evolved to tau's truth; the ts-rs drift gate regenerates `web/src/types/*`; HealthPage/ShipPage update to match. `Mock*` stays the deterministic oracle. Real-tau coverage is canned-output parser tests + gated live tests.

**Tech Stack:** Rust (serde_json line parsing, std::process::Command), React/TS frontend, real `tau` at `/Users/titouanlebocq/code/tau` (READ-ONLY — never modify).

**Conventions (every task):**
- Work in `/Users/titouanlebocq/code/tau-ui`. Build/test the gateway with `cargo`; the web with `pnpm` from `web/`.
- ts-rs types regenerate when you run `cargo test -p tau-gateway` (the drift gate). After changing a `#[ts(export)]` struct, run it and **commit the regenerated `web/src/types/*.ts`**.
- Evolving a Rust type breaks the frontend that references the old fields — so each type change is a **vertical slice**: change the Rust type + the `Mock*` impl + the frontend page + its test in the SAME task, keeping `pnpm typecheck` green.
- Commit from the repo root. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- The real tau binary (built during D1) is at `/Users/titouanlebocq/code/tau/target/debug/tau`. Captured real `--json` output is embedded below as fixtures.

---

## Task 1: Evolve check types + MockChecks + HealthPage (mock stays green)

**Files:**
- Modify: `gateway/src/checks/mod.rs` (types + MockChecks + unit test)
- Modify: `web/src/health/HealthPage.tsx`, `web/src/health/HealthPage.test.tsx`
- Regenerate: `web/src/types/{CheckFinding,CategoryStatus,CheckReport}.ts` (+ new `FindingLocation.ts`)

- [ ] **Step 1: Evolve the Rust types + MockChecks**

In `gateway/src/checks/mod.rs`, replace the `CheckFinding` and `CategoryStatus` structs and the `finding`/`cat` helpers and `MockChecks` impl. New types:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FindingLocation {
    pub path: String,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckFinding {
    pub category: String,  // config|lockfile|packages|sandbox|plugins|skills
    pub severity: String,  // error | needs-setup | warning
    pub rule: String,      // tau's rule_id
    pub summary: String,
    pub detail: Option<String>,
    pub remediation: Option<String>,
    pub location: Option<FindingLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CategoryStatus {
    pub name: String,
    pub errors: u32,
    pub warnings: u32,
    pub needs_setup: u32, // pass = all zero
}
```

Replace the `cat`/`finding` helpers + `MockChecks` impl with evolved values (real category names + severities + a remediation):

```rust
fn cat(name: &str, errors: u32, warnings: u32, needs_setup: u32) -> CategoryStatus {
    CategoryStatus { name: name.into(), errors, warnings, needs_setup }
}

fn finding(
    category: &str,
    severity: &str,
    rule: &str,
    summary: &str,
    remediation: Option<&str>,
    location: Option<(&str, Option<u32>)>,
) -> CheckFinding {
    CheckFinding {
        category: category.into(),
        severity: severity.into(),
        rule: rule.into(),
        summary: summary.into(),
        detail: None,
        remediation: remediation.map(|s| s.to_string()),
        location: location.map(|(p, l)| FindingLocation { path: p.into(), line: l }),
    }
}

pub struct MockChecks;

impl CheckSource for MockChecks {
    fn report(&self) -> CheckReport {
        CheckReport {
            categories: vec![
                cat("config", 1, 0, 0),
                cat("lockfile", 0, 0, 1),
                cat("packages", 0, 0, 0),
                cat("sandbox", 0, 0, 0),
                cat("plugins", 0, 0, 0),
                cat("skills", 0, 0, 0),
            ],
            findings: vec![
                finding(
                    "config", "error", "tau.config.endpoint",
                    "inference.endpoint not set",
                    Some("set inference.endpoint in tau.toml"),
                    Some(("tau.toml", Some(3))),
                ),
                finding(
                    "lockfile", "needs-setup", "tau.lockfile.missing",
                    "no lockfile — packages not installed",
                    Some("run `tau install`"),
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
```

Update `CliChecks::report()`'s `SandboxDiag` block is unchanged (still returns empty for now — Task 2 replaces it).

- [ ] **Step 2: Update the checks unit test**

Replace the `mock_report_seeds_categories_and_findings` test body in `gateway/src/checks/mod.rs`:

```rust
    #[test]
    fn mock_report_seeds_categories_and_findings() {
        let r = MockChecks.report();
        let names: Vec<&str> = r.categories.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["config", "lockfile", "packages", "sandbox", "plugins", "skills"]
        );
        let config = r.categories.iter().find(|c| c.name == "config").unwrap();
        assert_eq!(config.errors, 1);
        let lock = r.categories.iter().find(|c| c.name == "lockfile").unwrap();
        assert_eq!((lock.errors, lock.warnings, lock.needs_setup), (0, 0, 1));
        let err = r.findings.iter().find(|f| f.severity == "error").unwrap();
        assert_eq!(err.rule, "tau.config.endpoint");
        assert_eq!(err.location.as_ref().unwrap().path, "tau.toml");
        assert!(r.findings.iter().any(|f| f.severity == "needs-setup"));
        assert!(err.remediation.is_some());
        assert_eq!(r.sandbox.tier, "seatbelt");
    }
```

- [ ] **Step 3: Run the gateway test + regenerate types**

Run: `cargo test -p tau-gateway --lib checks::`
Expected: PASS. This also regenerates `web/src/types/CheckFinding.ts`, `CategoryStatus.ts`, `CheckReport.ts`, and creates `FindingLocation.ts`.

- [ ] **Step 4: Update HealthPage.tsx to the evolved shape**

In `web/src/health/HealthPage.tsx`:
- Add `needs-setup` to `SEV_CLASS` and use it in `worst()`:

```tsx
const SEV_CLASS: Record<string, string> = {
  error: "bg-st-error-soft text-st-error",
  "needs-setup": "bg-amber-100 text-amber-800",
  warning: "bg-st-running-soft text-st-running",
  pass: "bg-st-ok-soft text-st-ok",
};
```

```tsx
function worst(c: CategoryStatus): "error" | "needs-setup" | "warning" | "pass" {
  if (c.errors > 0) return "error";
  if (c.needs_setup > 0) return "needs-setup";
  if (c.warnings > 0) return "warning";
  return "pass";
}
```
- In the category button, change `const total = c.errors + c.warnings + c.notes;` → `const total = c.errors + c.warnings + c.needs_setup;`.
- In the findings table: change the header `message`→`summary`; render `f.summary` instead of `f.message`; render location from the object; add a remediation line. Replace the `<tbody>` rows mapping with:

```tsx
            {shown.map((f, i) => (
              <tr key={`${f.rule}-${i}`} className="border-b border-border/60 align-top">
                <td className="py-1 pr-2">
                  <SeverityBadge severity={f.severity} />
                </td>
                <td className="px-2 py-1 font-mono text-accent">{f.rule}</td>
                <td className="px-2 py-1">
                  {f.summary}
                  {f.remediation && (
                    <div className="text-[10px] text-muted">↳ {f.remediation}</div>
                  )}
                </td>
                <td className="px-2 py-1 font-mono text-muted">
                  {f.location ? `${f.location.path}${f.location.line ? `:${f.location.line}` : ""}` : "—"}
                </td>
              </tr>
            ))}
```
- The sandbox section is unchanged (still reads `report.sandbox.tier/status/no_sandbox`).

- [ ] **Step 5: Update HealthPage.test.tsx**

Read `web/src/health/HealthPage.test.tsx`. It mocks `getChecks` with a `CheckReport`. Update the mocked findings to the evolved shape (`summary`/`severity: "needs-setup"`/`location: {path,line}`/`remediation`) and any assertion on `message`/`notes` → `summary`/`needs_setup`. Keep the test's intent (renders findings + categories). If it asserts a specific category name like `pkg`, change to `packages`.

- [ ] **Step 6: Typecheck + web tests**

Run:
```bash
cd web && pnpm typecheck && pnpm test -- src/health/HealthPage.test.tsx
```
Expected: typecheck clean; HealthPage test passes. (Run `npx vitest run src/health/HealthPage.test.tsx` if the `--` filter doesn't filter.)

- [ ] **Step 7: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/checks/mod.rs web/src/types web/src/health
git commit -m "feat(checks): evolve CheckReport types to tau's real shape (severity/remediation/location)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CliChecks — parse `tau check --json`

**Files:**
- Modify: `gateway/src/checks/mod.rs` (CliChecks + parser + tests)
- Create: `gateway/tests/fixtures/tau-json/check-demo.jsonl` (captured real output)
- Modify: `gateway/src/state.rs` (pass bin/project to `CliChecks::new`)

- [ ] **Step 1: Save the captured real `tau check --json` output as a fixture**

Create `gateway/tests/fixtures/tau-json/check-demo.jsonl` with this exact captured output (real `tau check --json --project fixtures/demo`):

```
{"categories":["config","lockfile","packages","sandbox","plugins","skills"],"fast":false,"project_root":"/p","type":"run_started"}
{"category":"config","duration_ms":0,"findings":[{"category":"config","detail":null,"location":{"column":null,"line":null,"path":"/p/tau.toml"},"remediation":"fix tau.toml per the error message above","rule_id":"tau.config.invalid","severity":"error","structured":{"kind":"Parse"},"summary":"failed to parse project tau.toml"}],"status":"failed","type":"check_finished"}
{"category":"lockfile","duration_ms":0,"findings":[],"status":"ok","type":"check_finished"}
{"category":"packages","duration_ms":0,"findings":[],"status":{"skipped":"tau.toml malformed (see config check)"},"type":"check_finished"}
{"category":"sandbox","duration_ms":0,"findings":[],"status":{"skipped":"tau.toml malformed"},"type":"check_finished"}
{"category":"plugins","duration_ms":0,"findings":[],"status":{"skipped":"no lockfile"},"type":"check_finished"}
{"category":"skills","duration_ms":0,"findings":[],"status":{"skipped":"no lockfile"},"type":"check_finished"}
{"duration_ms":0,"exit_code":2,"summary":{"by_severity":{"error":1,"needs-setup":0},"failed":1,"ok":1},"type":"run_finished"}
```

- [ ] **Step 2: Write the failing parser test**

Add to `gateway/src/checks/mod.rs`'s `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn parse_check_jsonl_maps_findings_and_categories() {
        let jsonl = include_str!("../../tests/fixtures/tau-json/check-demo.jsonl");
        let report = parse_check_jsonl(jsonl, false);
        // config category: 1 error
        let config = report.categories.iter().find(|c| c.name == "config").unwrap();
        assert_eq!((config.errors, config.warnings, config.needs_setup), (1, 0, 0));
        // the error finding maps rule_id->rule, summary, location.path
        let f = report.findings.iter().find(|f| f.severity == "error").unwrap();
        assert_eq!(f.rule, "tau.config.invalid");
        assert_eq!(f.category, "config");
        assert_eq!(f.location.as_ref().unwrap().path, "/p/tau.toml");
        assert_eq!(f.remediation.as_deref(), Some("fix tau.toml per the error message above"));
        // all six categories present even when skipped/ok
        assert_eq!(report.categories.len(), 6);
        // no_sandbox plumbed from the arg
        assert!(!report.sandbox.no_sandbox);
    }
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cargo test -p tau-gateway --lib parse_check_jsonl_maps_findings_and_categories`
Expected: FAIL to compile — `parse_check_jsonl` does not exist.

- [ ] **Step 4: Implement the parser + CliChecks**

In `gateway/src/checks/mod.rs`, add `use std::path::PathBuf;` and `use std::process::Command;` at the top. Add the parser as a free fn:

```rust
/// Parse the JSONL emitted by `tau check --json` into a CheckReport.
/// `no_sandbox` is the gateway's own flag (tau check does not report it).
fn parse_check_jsonl(stdout: &str, no_sandbox: bool) -> CheckReport {
    let mut categories: Vec<CategoryStatus> = Vec::new();
    let mut findings: Vec<CheckFinding> = Vec::new();
    let mut sandbox = SandboxDiag {
        tier: "unknown".into(),
        status: "unknown".into(),
        no_sandbox,
    };
    for line in stdout.lines().filter(|l| !l.trim().is_empty()) {
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("check_finished") {
            continue;
        }
        let name = v["category"].as_str().unwrap_or("").to_string();
        let (mut errors, mut warnings, mut needs_setup) = (0u32, 0u32, 0u32);
        for fv in v["findings"].as_array().into_iter().flatten() {
            let severity = fv["severity"].as_str().unwrap_or("warning").to_string();
            match severity.as_str() {
                "error" => errors += 1,
                "needs-setup" => needs_setup += 1,
                _ => warnings += 1,
            }
            let location = fv.get("location").and_then(|l| l.as_object()).map(|l| FindingLocation {
                path: l.get("path").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                line: l.get("line").and_then(|n| n.as_u64()).map(|n| n as u32),
            });
            findings.push(CheckFinding {
                category: name.clone(),
                severity,
                rule: fv["rule_id"].as_str().unwrap_or("").to_string(),
                summary: fv["summary"].as_str().unwrap_or("").to_string(),
                detail: fv.get("detail").and_then(|d| d.as_str()).map(String::from),
                remediation: fv.get("remediation").and_then(|r| r.as_str()).map(String::from),
                location,
            });
        }
        // The sandbox category carries the tier; status is the category result.
        if name == "sandbox" {
            sandbox.status = match &v["status"] {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Object(_) => "skipped".to_string(),
                _ => "unknown".to_string(),
            };
            if let Some(t) = v["findings"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|f| f["structured"].get("tier"))
                .and_then(|t| t.as_str())
            {
                sandbox.tier = t.to_string();
            }
        }
        categories.push(CategoryStatus { name, errors, warnings, needs_setup });
    }
    CheckReport { categories, findings, sandbox }
}
```

Replace the `CliChecks` unit struct + impl with a real one:

```rust
/// Shells `tau check --json` and parses the result. Non-zero exit (findings) is data.
pub struct CliChecks {
    bin: PathBuf,
    project: PathBuf,
    no_sandbox: bool,
}

impl CliChecks {
    pub fn new(bin: PathBuf, project: PathBuf, no_sandbox: bool) -> Self {
        Self { bin, project, no_sandbox }
    }
}

impl CheckSource for CliChecks {
    fn report(&self) -> CheckReport {
        let out = Command::new(&self.bin)
            .arg("check")
            .arg("--json")
            .arg("--project")
            .arg(&self.project)
            .output();
        match out {
            // Non-zero exit (2/3) is expected when there are findings — parse anyway.
            Ok(out) => parse_check_jsonl(&String::from_utf8_lossy(&out.stdout), self.no_sandbox),
            Err(e) => CheckReport {
                categories: vec![],
                findings: vec![CheckFinding {
                    category: "config".into(),
                    severity: "error".into(),
                    rule: "gateway.tau.spawn".into(),
                    summary: format!("could not run `tau check`: {e}"),
                    detail: None,
                    remediation: Some("check the tau binary path".into()),
                    location: None,
                }],
                sandbox: SandboxDiag {
                    tier: "unknown".into(),
                    status: "unknown".into(),
                    no_sandbox: self.no_sandbox,
                },
            },
        }
    }
}
```

Delete the old `cli_checks_is_empty` test (CliChecks now requires args + shells out — it's covered by the parser test instead).

- [ ] **Step 5: Run the parser test**

Run: `cargo test -p tau-gateway --lib checks::`
Expected: PASS (mock test + parser test).

- [ ] **Step 6: Wire `CliChecks::new` in state.rs**

In `gateway/src/state.rs` `with_options`, change the `check_source` else-branch:

```rust
        let check_source: Box<dyn CheckSource> = if is_mock {
            Box::new(checks::MockChecks)
        } else {
            Box::new(checks::CliChecks::new(bin.clone(), project.clone(), no_sandbox))
        };
```

- [ ] **Step 7: Build + commit**

Run: `cargo build -p tau-gateway` (clean).
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/checks/mod.rs gateway/src/state.rs gateway/tests/fixtures/tau-json/check-demo.jsonl
git commit -m "feat(checks): CliChecks shells tau check --json (exit 2/3 is data)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Evolve ship Target/Bundle types + MockShip + ShipPage (mock stays green)

**Files:**
- Modify: `gateway/src/ship/mod.rs` (types + MockShip + tests)
- Modify: `web/src/ship/ShipPage.tsx`, `web/src/ship/ShipPage.test.tsx`, `web/src/api/ship.ts`
- Regenerate/remove: `web/src/types/{Target,Bundle}.ts`; remove `web/src/types/BuildStep.ts`

- [ ] **Step 1: Evolve the Rust types**

In `gateway/src/ship/mod.rs`, replace `Target`, `BuildStep`, `Bundle` with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Target {
    pub triple: String,
    pub platform: String,
    pub adapter_family: String,
    pub tier: String,
    pub status: String, // available | reserved | unknown
    pub required_shapes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Bundle {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub built_at: Option<String>,
}
```

(Delete the `BuildStep` struct entirely. Keep `BuildRequest`.) Update `BuildError` to add provisioning/internal variants:

```rust
#[derive(Debug)]
pub enum BuildError {
    NeedsProvisioning(String),
    Invalid(String),
    Internal(String),
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildError::NeedsProvisioning(m) => write!(f, "project needs `tau install` first: {m}"),
            BuildError::Invalid(m) => write!(f, "build rejected: {m}"),
            BuildError::Internal(m) => write!(f, "build failed: {m}"),
        }
    }
}
impl std::error::Error for BuildError {}
```

- [ ] **Step 2: Rewrite MockShip + targets() to the evolved shape**

Replace `targets()`, the `step` helper, `MockShip`, its `impl`, and the `CliShip` stub's `list_targets/list_bundles/build` return types. New `targets()` + `MockShip`:

```rust
fn targets() -> Vec<Target> {
    let t = |triple: &str, platform: &str, fam: &str, tier: &str, status: &str| Target {
        triple: triple.into(),
        platform: platform.into(),
        adapter_family: fam.into(),
        tier: tier.into(),
        status: status.into(),
        required_shapes: vec!["fs.r".into(), "fs.w".into(), "exec".into(), "net.http".into()],
    };
    vec![
        t("darwin-native-strict", "darwin", "native", "strict", "available"),
        t("linux-native-strict", "linux", "native", "strict", "available"),
        t("passthrough", "any", "passthrough", "none", "available"),
        t("windows-native-strict", "windows", "native", "strict", "reserved"),
    ]
}

pub struct MockShip {
    project: String,
    bundles: Mutex<Vec<Bundle>>,
}

impl MockShip {
    pub fn new(project: String) -> Self {
        let artifact = format!("{project}.tau");
        let seed = |size: u64, built_at: &str| Bundle {
            path: artifact.clone(),
            sha256: "9f3c1a2b7e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b".into(),
            size_bytes: size,
            built_at: Some(built_at.into()),
        };
        MockShip {
            project,
            bundles: Mutex::new(vec![seed(2_456_789, "2m ago"), seed(2_310_004, "1d ago")]),
        }
    }
}

impl ShipSource for MockShip {
    fn list_targets(&self) -> Vec<Target> {
        targets()
    }
    fn list_bundles(&self) -> Vec<Bundle> {
        self.bundles.lock().unwrap().clone()
    }
    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        let t = targets()
            .into_iter()
            .find(|t| t.triple == target)
            .ok_or_else(|| BuildError::Invalid(format!("unknown target '{target}'")))?;
        if t.status != "available" {
            return Err(BuildError::Invalid(format!("target '{target}' is {}", t.status)));
        }
        let bundle = Bundle {
            path: format!("{}.tau", self.project),
            sha256: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b".into(),
            size_bytes: 2_460_512,
            built_at: Some("just now".into()),
        };
        self.bundles.lock().unwrap().insert(0, bundle.clone());
        Ok(bundle)
    }
}
```

The `CliShip` unit-struct stub stays for now (Task 4 replaces it) but its method bodies must compile against the new types — update them to:

```rust
pub struct CliShip;
impl ShipSource for CliShip {
    fn list_targets(&self) -> Vec<Target> { vec![] }
    fn list_bundles(&self) -> Vec<Bundle> { vec![] }
    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        Err(BuildError::Invalid(format!("unknown target '{target}'")))
    }
}
```

- [ ] **Step 3: Update the ship unit tests**

Replace the `#[cfg(test)] mod tests` body in `gateway/src/ship/mod.rs`:

```rust
    #[test]
    fn mock_seeds_targets_and_bundles() {
        let s = MockShip::new("demo".into());
        let ts = s.list_targets();
        assert!(ts.iter().any(|t| t.triple == "darwin-native-strict" && t.status == "available"));
        assert!(ts.iter().any(|t| t.triple == "windows-native-strict" && t.status == "reserved"));
        assert!(!s.list_bundles().is_empty());
    }

    #[test]
    fn build_available_appends_bundle() {
        let s = MockShip::new("demo".into());
        let before = s.list_bundles().len();
        let b = s.build("darwin-native-strict").unwrap();
        assert_eq!(b.path, "demo.tau");
        assert_eq!(s.list_bundles().len(), before + 1);
        assert_eq!(s.list_bundles()[0].built_at.as_deref(), Some("just now"));
    }

    #[test]
    fn build_rejects_reserved_and_unknown() {
        let s = MockShip::new("demo".into());
        assert!(matches!(s.build("windows-native-strict"), Err(BuildError::Invalid(_))));
        assert!(matches!(s.build("nope"), Err(BuildError::Invalid(_))));
    }

    #[test]
    fn cli_ship_is_empty() {
        assert!(CliShip.list_targets().is_empty());
        assert!(CliShip.list_bundles().is_empty());
        assert!(CliShip.build("darwin-native-strict").is_err());
    }
```

- [ ] **Step 4: Run gateway test + regenerate types**

Run: `cargo test -p tau-gateway --lib ship::`
Expected: PASS. Regenerates `web/src/types/Target.ts`, `Bundle.ts`. **Delete the now-orphaned `web/src/types/BuildStep.ts`** (`git rm web/src/types/BuildStep.ts`).

- [ ] **Step 5: Rewrite ShipPage.tsx**

In `web/src/ship/ShipPage.tsx`: remove the `BuildStep` import + `StepTimeline` component + `DriftBadge` + `lastBuild` step rendering. Key region changes:
- Drop `import type { BuildStep }`.
- The build dropdown uses `triple`/`status==="available"`. Replace the `useEffect` target-default + `ready` + `<select>` options + the bundles table. Concretely:
  - `setTarget((cur) => cur || t.find((x) => x.status === "available")?.triple || "")`
  - `const ready = targets.filter((t) => t.status === "available");`
  - `<option key={t.triple} value={t.triple}>{t.triple}</option>`
  - Remove `{lastBuild && <StepTimeline …>}`.
- `TargetCard`: render `target.triple`, `target.tier`, `target.required_shapes.join(" ")`; `available` vs `reserved` instead of ready/gated:

```tsx
function TargetCard({ target }: { target: Target }) {
  const reserved = target.status !== "available";
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${reserved ? "border-border opacity-60" : "border-st-ok/40 bg-st-ok-soft/40"}`}>
      <div className="font-mono font-semibold text-accent">{target.triple}</div>
      <div className="mt-0.5 text-[10px] text-muted">
        {target.tier} · {target.status}
      </div>
    </div>
  );
}
```
- Bundles table: columns `path | sha256 | size | built`. Replace the `<thead>`/`<tbody>`:

```tsx
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">artifact</th>
              <th className="px-2 py-1 font-medium">hash</th>
              <th className="px-2 py-1 font-medium">size</th>
              <th className="px-2 py-1 font-medium">built</th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((b, i) => (
              <tr key={`${b.sha256}-${i}`} className="border-b border-border/60">
                <td className="py-1 pr-2 font-mono font-medium text-accent">{b.path}</td>
                <td className="px-2 py-1 font-mono text-muted">{shortHash(b.sha256)}</td>
                <td className="px-2 py-1 text-muted">{humanSize(b.size_bytes)}</td>
                <td className="px-2 py-1 text-muted">{b.built_at ?? "—"}</td>
              </tr>
            ))}
          </tbody>
```
- `onBuild` sets `lastBuild` still (used for nothing now — remove `lastBuild` state + its setter to avoid an unused var, OR keep and show a one-line "built {path}" confirmation). Simplest: keep `lastBuild` and render `{lastBuild && <div className="text-[10px] text-muted">built {lastBuild.path}</div>}` where the StepTimeline was.

- [ ] **Step 6: Update ShipPage.test.tsx + ship.ts client**

`web/src/api/ship.ts` needs no change (still `Target[]`/`Bundle[]`/`Bundle`). Read `web/src/ship/ShipPage.test.tsx`; update the mocked `Target`/`Bundle` objects to the evolved shape (`triple`/`status:"available"`/`required_shapes`; `path`/`sha256`/`size_bytes`/`built_at`) and any assertion on `name`/`hash`/`drift`/steps → `triple`/`sha256`. Keep the test's intent.

- [ ] **Step 7: Typecheck + web tests + commit**

Run:
```bash
cd web && pnpm typecheck && npx vitest run src/ship/ShipPage.test.tsx
```
Expected: clean + pass.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/ship/mod.rs web/src/types web/src/ship
git rm web/src/types/BuildStep.ts 2>/dev/null; git add -A web/src/types
git commit -m "feat(ship): evolve Target/Bundle types to tau's real shape (triple/tier; drop steps/drift)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CliShip — `tau target list` + `tau build`

**Files:**
- Modify: `gateway/src/ship/mod.rs` (CliShip + parsers + tests)
- Create: `gateway/tests/fixtures/tau-json/targets.jsonl`
- Modify: `gateway/src/state.rs` (pass bin/project to `CliShip::new`)

- [ ] **Step 1: Save the captured `tau target list --all --json` fixture**

Create `gateway/tests/fixtures/tau-json/targets.jsonl` (real output):

```
{"adapter_family":"native","event":"target","platform":"linux","reason":null,"required_shapes":["fs.r","fs.w","exec","net.http"],"status":"available","tier":"strict","triple":"linux-native-strict"}
{"adapter_family":"native","event":"target","platform":"darwin","reason":null,"required_shapes":["fs.r","fs.w","exec","net.http"],"status":"available","tier":"strict","triple":"darwin-native-strict"}
{"adapter_family":"passthrough","event":"target","platform":"any","reason":null,"required_shapes":["fs.r","fs.w","exec","net.http","agent.spawn"],"status":"available","tier":"none","triple":"passthrough"}
{"adapter_family":"native","event":"target","platform":"windows","reason":"windows AppContainer scaffold; probe Unavailable in v1","required_shapes":["fs.r","fs.w","exec","net.http"],"status":"reserved","tier":"strict","triple":"windows-native-strict"}
```

- [ ] **Step 2: Write the failing parser tests**

Add to `gateway/src/ship/mod.rs`'s `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn parse_targets_jsonl_maps_triples() {
        let jsonl = include_str!("../../tests/fixtures/tau-json/targets.jsonl");
        let ts = parse_targets_jsonl(jsonl);
        assert_eq!(ts.len(), 4);
        let darwin = ts.iter().find(|t| t.triple == "darwin-native-strict").unwrap();
        assert_eq!(darwin.platform, "darwin");
        assert_eq!(darwin.adapter_family, "native");
        assert_eq!(darwin.status, "available");
        assert!(ts.iter().any(|t| t.triple == "windows-native-strict" && t.status == "reserved"));
        assert!(darwin.required_shapes.contains(&"exec".to_string()));
    }

    #[test]
    fn safe_target_rejects_flag_smuggling() {
        assert!(is_safe_target("darwin-native-strict"));
        assert!(!is_safe_target("--output=/etc/x"));
        assert!(!is_safe_target("-rf"));
    }
```

- [ ] **Step 3: Run them to confirm they fail**

Run: `cargo test -p tau-gateway --lib ship::parse_targets_jsonl_maps_triples`
Expected: FAIL — `parse_targets_jsonl`/`is_safe_target` do not exist.

- [ ] **Step 4: Implement the parsers + CliShip (targets + build)**

In `gateway/src/ship/mod.rs`, add `use std::path::PathBuf;` and `use std::process::Command;`. Add:

```rust
/// Reject a target triple that could be smuggled to `tau build` as a flag.
fn is_safe_target(t: &str) -> bool {
    !t.is_empty() && !t.starts_with('-') && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn parse_targets_jsonl(stdout: &str) -> Vec<Target> {
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v.get("event").and_then(|e| e.as_str()) == Some("target"))
        .map(|v| Target {
            triple: v["triple"].as_str().unwrap_or("").to_string(),
            platform: v["platform"].as_str().unwrap_or("").to_string(),
            adapter_family: v["adapter_family"].as_str().unwrap_or("").to_string(),
            tier: v["tier"].as_str().unwrap_or("").to_string(),
            status: v["status"].as_str().unwrap_or("unknown").to_string(),
            required_shapes: v["required_shapes"]
                .as_array()
                .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        })
        .collect()
}

/// Map a `tau build --json` result + exit code to a Bundle or a typed error.
fn parse_build_result(status: std::process::ExitStatus, stdout: &str, stderr: &str) -> Result<Bundle, BuildError> {
    if status.success() {
        let v: serde_json::Value = serde_json::from_str(stdout.trim().lines().last().unwrap_or(""))
            .map_err(|e| BuildError::Internal(format!("unparseable build output: {e}")))?;
        return Ok(Bundle {
            path: v["path"].as_str().unwrap_or("").to_string(),
            sha256: v["sha256"].as_str().unwrap_or("").to_string(),
            size_bytes: v["size_bytes"].as_u64().unwrap_or(0),
            built_at: None,
        });
    }
    match status.code() {
        Some(3) => Err(BuildError::NeedsProvisioning(stderr.trim().to_string())),
        Some(2) => Err(BuildError::Invalid(stderr.trim().to_string())),
        _ => Err(BuildError::Internal(stderr.trim().to_string())),
    }
}

pub struct CliShip {
    bin: PathBuf,
    project: PathBuf,
}

impl CliShip {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        Self { bin, project }
    }
}

impl ShipSource for CliShip {
    fn list_targets(&self) -> Vec<Target> {
        Command::new(&self.bin)
            .arg("target").arg("list").arg("--all").arg("--json")
            .output()
            .ok()
            .map(|o| parse_targets_jsonl(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or_default()
    }

    fn list_bundles(&self) -> Vec<Bundle> {
        scan_bundles(&self.project) // Task 5
    }

    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        if !is_safe_target(target) {
            return Err(BuildError::Invalid(format!("invalid target '{target}'")));
        }
        let out = Command::new(&self.bin)
            .arg("build").arg("--target").arg(target).arg("--json")
            .current_dir(&self.project)
            .output()
            .map_err(|e| BuildError::Internal(format!("could not run tau build: {e}")))?;
        parse_build_result(out.status, &String::from_utf8_lossy(&out.stdout), &String::from_utf8_lossy(&out.stderr))
    }
}
```

> `scan_bundles` is added in Task 5. To keep this task compiling on its own, temporarily implement `list_bundles` as `vec![]` and replace it in Task 5 — OR do Task 5's `scan_bundles` fn first. Simplest: in this task, write `fn list_bundles(&self) -> Vec<Bundle> { Vec::new() }` and Task 5 swaps the body + adds `scan_bundles`.

(Use `Vec::new()` for `list_bundles` in this task.)

- [ ] **Step 5: Run the parser tests**

Run: `cargo test -p tau-gateway --lib ship::`
Expected: PASS (mock + targets parser + safe_target).

- [ ] **Step 6: Wire `CliShip::new` in state.rs**

In `gateway/src/state.rs` `with_options`, change the `ship_source` else-branch:

```rust
        } else {
            Box::new(ship::CliShip::new(bin.clone(), project.clone()))
        };
```
(Leave the `is_mock` MockShip branch unchanged.)

- [ ] **Step 7: Build + commit**

Run: `cargo build -p tau-gateway` (clean).
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/ship/mod.rs gateway/src/state.rs gateway/tests/fixtures/tau-json/targets.jsonl
git commit -m "feat(ship): CliShip shells tau target list + tau build (--json), flag-guarded

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: CliShip — `list_bundles` filesystem scan

**Files:** Modify `gateway/src/ship/mod.rs`.

- [ ] **Step 1: Write the failing test**

Add to the ship `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn scan_bundles_lists_tau_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("app.tau"), b"xxxxx").unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"y").unwrap();
        let bundles = scan_bundles(dir.path());
        assert_eq!(bundles.len(), 1);
        assert!(bundles[0].path.ends_with("app.tau"));
        assert_eq!(bundles[0].size_bytes, 5);
        assert!(bundles[0].built_at.is_some());
    }
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cargo test -p tau-gateway --lib ship::scan_bundles_lists_tau_files`
Expected: FAIL — `scan_bundles` does not exist.

- [ ] **Step 3: Implement `scan_bundles` + use it in CliShip**

In `gateway/src/ship/mod.rs`, add (`use std::path::Path;` near the other use lines):

```rust
/// List `*.tau` files in the project dir. tau has no enumerate-bundles command,
/// so this surfaces only what is observable on disk (path, size, mtime).
fn scan_bundles(project: &Path) -> Vec<Bundle> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(project) else { return out };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("tau") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let built_at = meta
            .modified()
            .ok()
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());
        out.push(Bundle {
            path: path.to_string_lossy().to_string(),
            sha256: String::new(),
            size_bytes: meta.len(),
            built_at,
        });
    }
    out.sort_by(|a, b| b.built_at.cmp(&a.built_at));
    out
}
```

Change `CliShip::list_bundles` to `fn list_bundles(&self) -> Vec<Bundle> { scan_bundles(&self.project) }`.

- [ ] **Step 4: Run the test**

Run: `cargo test -p tau-gateway --lib ship::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/ship/mod.rs
git commit -m "feat(ship): CliShip.list_bundles scans the project for .tau files

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Verify surface (`tau verify --bundle`)

**Files:**
- Modify: `gateway/src/ship/mod.rs` (VerifyOutcome + `ShipSource::verify` + Mock/Cli impls + parser test)
- Modify: `gateway/src/state.rs` (`AppState::verify`), `gateway/src/api/ship.rs` (handler), `gateway/src/api/mod.rs` (route)
- Modify: `web/src/api/ship.ts`, `web/src/ship/ShipPage.tsx`

- [ ] **Step 1: Add the type + trait method + impls (failing parser test first)**

Add to `gateway/src/ship/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerifyRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerifyOutcome {
    pub reproducible: bool,
    pub shipped_sha256: String,
    pub rebuilt_sha256: String,
    pub diffs: Vec<String>,
}
```

Add a `verify` method to the `ShipSource` trait:

```rust
    fn verify(&self, bundle_path: &str) -> Result<VerifyOutcome, BuildError>;
```

Add the parser + test (in `#[cfg(test)] mod tests`):

```rust
    #[test]
    fn parse_verify_reads_reproducibility() {
        let line = r#"{"reproducible":true,"shipped_sha256":"aa","rebuilt_sha256":"aa","diffs":[]}"#;
        let v = parse_verify_json(line).unwrap();
        assert!(v.reproducible);
        assert_eq!(v.shipped_sha256, "aa");
    }
```

```rust
fn parse_verify_json(stdout: &str) -> Result<VerifyOutcome, BuildError> {
    let line = stdout.trim().lines().last().unwrap_or("");
    let v: serde_json::Value =
        serde_json::from_str(line).map_err(|e| BuildError::Internal(format!("unparseable verify output: {e}")))?;
    Ok(VerifyOutcome {
        reproducible: v["reproducible"].as_bool().unwrap_or(false),
        shipped_sha256: v["shipped_sha256"].as_str().unwrap_or("").to_string(),
        rebuilt_sha256: v["rebuilt_sha256"].as_str().unwrap_or("").to_string(),
        diffs: v["diffs"]
            .as_array()
            .map(|a| a.iter().map(|d| d.to_string()).collect())
            .unwrap_or_default(),
    })
}
```

- [ ] **Step 2: Implement `verify` on MockShip + CliShip**

MockShip:
```rust
    fn verify(&self, bundle_path: &str) -> Result<VerifyOutcome, BuildError> {
        Ok(VerifyOutcome {
            reproducible: true,
            shipped_sha256: "9f3c1a2b7e".into(),
            rebuilt_sha256: "9f3c1a2b7e".into(),
            diffs: vec![],
        })
    }
```
(prefix `bundle_path` with `_` to avoid the unused warning: `_bundle_path`.)

CliShip:
```rust
    fn verify(&self, bundle_path: &str) -> Result<VerifyOutcome, BuildError> {
        let out = Command::new(&self.bin)
            .arg("verify").arg("--bundle").arg(bundle_path).arg("--json")
            .current_dir(&self.project)
            .output()
            .map_err(|e| BuildError::Internal(format!("could not run tau verify: {e}")))?;
        if out.status.code() == Some(3) {
            return Err(BuildError::NeedsProvisioning(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        parse_verify_json(&String::from_utf8_lossy(&out.stdout))
    }
```

Run: `cargo test -p tau-gateway --lib ship::` → PASS (incl. the new parser test). This regenerates `web/src/types/{VerifyOutcome,VerifyRequest}.ts`.

- [ ] **Step 3: AppState + route + handler**

`gateway/src/state.rs` — add near `build`:
```rust
    pub fn verify(&self, bundle_path: &str) -> Result<crate::ship::VerifyOutcome, crate::ship::BuildError> {
        self.0.ship_source.verify(bundle_path)
    }
```

`gateway/src/api/ship.rs` — add:
```rust
use crate::ship::{BuildRequest, Bundle, Target, VerifyOutcome, VerifyRequest};

pub async fn verify(
    Scoped(state): Scoped,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyOutcome>, (StatusCode, String)> {
    state
        .verify(&req.path)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}
```

`gateway/src/api/mod.rs` — add the route next to `/build` (inside the scoped router):
```rust
        .route("/verify", post(ship::verify))
```

Run: `cargo test -p tau-gateway` → all green.

- [ ] **Step 4: Frontend verify action**

`web/src/api/ship.ts` — add:
```ts
import type { VerifyOutcome } from "../types/VerifyOutcome";

export const verifyBundle = (path: string) =>
  fetch(scopedPath("/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).then(json<VerifyOutcome>);
```

`web/src/ship/ShipPage.tsx` — import `verifyBundle` + `VerifyOutcome`; add per-bundle verify state and a Verify button in the bundles table (a 5th column). Add to the component:
```tsx
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, VerifyOutcome>>({});

  async function onVerify(path: string) {
    setVerifying(path);
    try {
      const v = await verifyBundle(path);
      setVerifyResult((p) => ({ ...p, [path]: v }));
    } catch {
      /* surface nothing on the mock */
    } finally {
      setVerifying(null);
    }
  }
```
Add a `verify` column header (`<th className="px-2 py-1 font-medium">verify</th>`) and a cell per row:
```tsx
                <td className="px-2 py-1">
                  {verifyResult[b.path] ? (
                    <span className={verifyResult[b.path].reproducible ? "text-st-ok" : "text-st-error"}>
                      {verifyResult[b.path].reproducible ? "✓ reproducible" : "✗ drift"}
                    </span>
                  ) : (
                    <button
                      onClick={() => onVerify(b.path)}
                      disabled={verifying === b.path}
                      className="rounded border border-border px-1.5 py-0.5 text-[10px] disabled:opacity-50"
                    >
                      {verifying === b.path ? "…" : "Verify"}
                    </button>
                  )}
                </td>
```

- [ ] **Step 5: Typecheck + tests + commit**

Run:
```bash
cd web && pnpm typecheck && npx vitest run src/ship/ShipPage.test.tsx
```
Expected: clean + pass (the test may need the `verifyBundle` import mocked — add a vi.mock for it returning a reproducible outcome if the test imports the api module).
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/ship/mod.rs gateway/src/state.rs gateway/src/api web/src/types web/src/api/ship.ts web/src/ship/ShipPage.tsx
git commit -m "feat(ship): tau verify --bundle surface (VerifyOutcome + /verify route + ShipPage action)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Gated real-tau tests (check + targets)

**Files:** Create `gateway/tests/real_tau_validate.rs`.

- [ ] **Step 1: Write the gated tests**

Create `gateway/tests/real_tau_validate.rs`:

```rust
//! Live checks against a REAL `tau` binary. Skips unless `TAU_REAL_BIN` points at
//! a runnable binary. `tau target list` needs no project; `tau check` runs on the
//! bare demo fixture (which a real tau reports config findings for — exit 2).

use std::path::PathBuf;
use std::process::Command;

fn real_bin() -> Option<PathBuf> {
    std::env::var("TAU_REAL_BIN").ok().map(PathBuf::from).filter(|p| p.exists())
}

fn demo() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

#[test]
fn real_tau_target_list_emits_triples() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN");
        return;
    };
    let out = Command::new(bin).arg("target").arg("list").arg("--all").arg("--json").output().unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("\"event\":\"target\""), "got: {stdout}");
    assert!(stdout.contains("darwin-native-strict") || stdout.contains("linux-native-strict"));
}

#[test]
fn real_tau_check_runs_and_reports_categories() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN");
        return;
    };
    let out = Command::new(bin)
        .arg("check").arg("--json").arg("--project").arg(demo())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    // Non-zero exit is expected (the bare fixture has findings); we assert the JSONL shape.
    assert!(stdout.contains("\"type\":\"run_started\""), "got: {stdout}");
    assert!(stdout.contains("\"category\":\"config\""));
}
```

- [ ] **Step 2: Confirm it compiles + skips cleanly**

Run: `cargo test -p tau-gateway --test real_tau_validate`
Expected: PASS (both skip, `TAU_REAL_BIN` unset).

- [ ] **Step 3: Run once against real tau (best-effort)**

Run:
```bash
TAU_REAL_BIN=/Users/titouanlebocq/code/tau/target/debug/tau \
  cargo test -p tau-gateway --test real_tau_validate -- --nocapture
```
Expected: both pass (target list emits triples; check emits the JSONL). If the real binary path differs or is the wrong arch, capture the error and note it — the gate does not depend on this.

- [ ] **Step 4: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/tests/real_tau_validate.rs
git commit -m "test(gateway): gated real-tau check + target list smoke tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Final gate

**Files:** none (verification + fixups).

- [ ] **Step 1: Rust build + fmt + clippy**

Run:
```bash
cd /Users/titouanlebocq/code/tau-ui
cargo fmt -p tau-gateway
cargo clippy -p tau-gateway --all-targets --all-features -- -D warnings 2>&1 | grep -v "ts-rs failed to parse"
cargo test -p tau-gateway
```
Expected: clippy clean (ignoring the pre-existing ts-rs serde-attribute notes); all tests pass.

- [ ] **Step 2: Web gate**

Run:
```bash
cd web && pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all green. (`pnpm format` first; include any reformatting in the commit.)

- [ ] **Step 3: ts-rs drift gate**

Run: `cargo test -p tau-gateway` once more, then `git status --porcelain web/src/types`.
Expected: empty (all regenerated types already committed). If not, `git add web/src/types` and include them.

- [ ] **Step 4: Commit any fixups**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "chore: fmt + lint after the validate/ship seams

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage** (`2026-06-10-validate-ship-seams-design.md`):
- §3 seam plumbing (`CliChecks::new`/`CliShip::new` + bin/project + flag guard) → Tasks 2, 4. ✓
- §4 CliChecks (`tau check --json`, JSONL parse, exit-as-data, SandboxDiag synth) → Task 2. ✓
- §5 CliShip target/build/verify/list_bundles → Tasks 4 (target/build), 5 (list_bundles fs scan), 6 (verify). ✓
- §6 evolved types (CheckFinding/CategoryStatus/FindingLocation/Target/Bundle/VerifyOutcome; drop BuildStep/gate/drift) → Tasks 1, 3, 6. ✓
- §7 frontend (HealthPage severity+remediation+location; ShipPage triples, no steps, verify action) → Tasks 1, 3, 6. ✓
- §8 error handling (exit-as-data; NeedsProvisioning) → Tasks 2, 4. ✓
- §9 testing (canned parser tests + mock-path + gated real-tau) → Tasks 1–7. ✓
- §10 out of scope (provisioned fixture, SARIF) → untouched. ✓

**Placeholder scan:** No TBD/TODO. The one forward-reference (`scan_bundles` used in Task 4, defined in Task 5) is called out explicitly with a compile-on-its-own fallback (`Vec::new()` in Task 4, swapped in Task 5).

**Type/signature consistency:** `CheckFinding{category,severity,rule,summary,detail,remediation,location:Option<FindingLocation>}`, `CategoryStatus{name,errors,warnings,needs_setup}`, `Target{triple,platform,adapter_family,tier,status,required_shapes}`, `Bundle{path,sha256,size_bytes,built_at}`, `VerifyOutcome{reproducible,shipped_sha256,rebuilt_sha256,diffs}`, `BuildError::{NeedsProvisioning,Invalid,Internal}`, `ShipSource::{list_targets,list_bundles,build,verify}`, `CliChecks::new(bin,project,no_sandbox)`, `CliShip::new(bin,project)` — names are consistent across Tasks 1–8 and match `state.rs` wiring. `parse_check_jsonl`/`parse_targets_jsonl`/`parse_build_result`/`parse_verify_json`/`scan_bundles`/`is_safe_target` are each defined once.
