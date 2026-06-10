# D3 — Validate & ship seams (real tau) — design

**Status:** approved (brainstorm 2026-06-10)
**Sub-project:** D3 of the real-tau integration roadmap (D1 run-path merged; D2 inventory + D4 workflow/IR pending). See the `real-tau-integration-roadmap` memory.
**Relates to:** `gateway/src/checks/mod.rs` (CheckSource), `gateway/src/ship/mod.rs` (ShipSource), `gateway/src/state.rs` (`with_options` seam selection + the `checks()/list_targets()/list_bundles()/build()` methods), `gateway/src/api/{checks.rs,ship.rs,mod.rs}` (routes), `web/src/health/HealthPage.tsx`, `web/src/ship/ShipPage.tsx`, the generated `web/src/types/*`, and the real `tau` CLI at `/Users/titouanlebocq/code/tau` (READ-ONLY).

## 1. Context & goal

The gateway's "validate" (`CheckSource`) and "ship" (`ShipSource`) seams are mock-only: `MockChecks`/`MockShip` fabricate data, while `CliChecks`/`CliShip` are unwired unit stubs returning empty. tau ships the real commands — `tau check --json`, `tau target list --json`, `tau build --json`, `tau verify --bundle --json` — so D3 wires the `Cli*` seams to them.

**Principle: the UI is driven by tau.** The mock `#[ts(export)]` types were guesses; real tau output differs (severity levels, category names, far fewer `build` fields). D3 **evolves the types to tau's real shape** (no fabricated or dropped fields) rather than mapping lossily into the guessed types.

**Goal:** when the gateway runs against a real `tau` binary (`--serve-kind real` or a real `--tau-bin`), the validate/ship surfaces show real diagnostics, the real target registry, real bundles, and real reproducibility — with `Mock*` retained as the deterministic test oracle.

## 2. Locked decisions (brainstorm)

- **Evolve types to match tau (Option B)**, for both checks and ship. Faithful, not lossy.
- **Synchronous seams.** Keep `CheckSource`/`ShipSource` synchronous; shell out with `std::process::Command::output()`, matching the established `CliOps`/`GitCloner` precedent (the codebase already calls blocking Command from async handlers). Do not introduce async traits.
- **`list_bundles` is an honest filesystem scan** of `<project>/*.tau` — tau has no enumerate-bundles command, so the gateway surfaces only what is observable on disk (path, size, mtime) rather than inventing richer data.
- **Add a `verify` capability** (new `ShipSource::verify` + `/verify` route + `VerifyOutcome` type + ShipPage action) since the scope is all four commands.
- **Non-zero `tau check` exit (2/3) is data, not failure.** `tau build`/`verify` provisioning failures surface as a typed `NeedsProvisioning` error ("run `tau install` first") — the D2 dependency made explicit, not hidden.
- **Mock stays the oracle**; real-tau paths are covered by canned-output parser unit tests + gated real-tau tests (skip without `TAU_REAL_BIN`), mirroring D1.
- **Out of scope:** building a provisioned (`tau install`) fixture (D2); SARIF parsing (we parse `--json`); `--auto-resolve`.

## 3. Seam plumbing

`CliChecks`/`CliShip` gain constructors `::new(bin: PathBuf, project: PathBuf)` (mirroring `CliOps::new`). `AppState::with_options` passes `bin.clone()`/`project.clone()` when `!is_mock` (the values are already in `Inner`). A small shared helper runs a tau subcommand and returns stdout + exit code: `run_tau(bin, project, args) -> io::Result<(ExitStatus, String stdout, String stderr)>`. User-supplied target triples are validated (reject a leading `-`; pass after `--`) before reaching `tau build --target`.

## 4. `CliChecks` — `tau check --json`

`report()` runs `tau check --json --project <dir>` and parses the JSONL stream:
- `run_started` (ignored for the report), one `check_finished` per category (`{category, status, duration_ms, findings:[…]}`), `run_finished` (ignored — counts are recomputed from findings).
- Each finding: `{category, severity: "error"|"needs-setup"|"warning", rule_id, summary, detail, location:{path,line,column}|null, remediation, structured}`.

Mapping to the evolved `CheckReport`:
- `CheckFinding { category, severity, rule, summary, detail, remediation, location: Option<{path, line}> }` — faithful field names (`rule_id→rule`), keeping `detail`+`remediation`.
- `CategoryStatus { name, errors, warnings, needs_setup }` — counts aggregated from the category's findings by severity.
- `SandboxDiag { tier, status, no_sandbox }` — synthesized: `tier`/`status` from the `sandbox` category result (its finding `structured`/status), `no_sandbox` from the gateway's `Inner.no_sandbox` (tau check does not report it).
- **Exit code 2/3 is expected** on a project with findings (e.g. a bare fixture with no `tau.lock`); parse the output regardless. Only a spawn failure or unparseable stdout is an error (surfaced as an empty report + a synthetic `error` finding describing the failure, so the UI never blanks silently).

## 5. `CliShip` — target / build / verify / list

- **`list_targets()`** → `tau target list --all --json` → JSONL `{event:"target", triple, platform, adapter_family, tier, status, reason, required_shapes}` → `Vec<Target>`. No provisioning required.
- **`build(triple)`** → `tau build --target <triple> --json` (cwd = project) → `{path, sha256, size_bytes}` → `Bundle`. Map exit: `0`→Ok; `3`→`BuildError::NeedsProvisioning` (MissingLockfile/PackageNotInstalled); `2`→`BuildError::Invalid(stderr)`; `70`/other→`BuildError::Internal(stderr)`.
- **`verify(bundle_path)`** → `tau verify --bundle <path> --json` (cwd = project) → `VerifyOutcome { reproducible, shipped_sha256, rebuilt_sha256, diffs: Vec<String> }`. Exit `0` reproducible, `2` not, `3` provisioning.
- **`list_bundles()`** → scan `<project>` for `*.tau` files → `Vec<Bundle>` with `{ path, size_bytes (fs), built_at (mtime, RFC3339) }`; `sha256` left empty (requires unpacking the manifest — not done) unless cheaply available. Documented as a filesystem scan because tau exposes no enumerate-bundles command.

## 6. Evolved `#[ts(export)]` types

```rust
// checks
pub struct CheckFinding { pub category: String, pub severity: String /* error|needs-setup|warning */,
    pub rule: String, pub summary: String, pub detail: Option<String>,
    pub remediation: Option<String>, pub location: Option<FindingLocation> }
pub struct FindingLocation { pub path: String, pub line: Option<u32> }
pub struct CategoryStatus { pub name: String, pub errors: u32, pub warnings: u32, pub needs_setup: u32 }
pub struct SandboxDiag { pub tier: String, pub status: String, pub no_sandbox: bool }
pub struct CheckReport { pub categories: Vec<CategoryStatus>, pub findings: Vec<CheckFinding>, pub sandbox: SandboxDiag }

// ship
pub struct Target { pub triple: String, pub platform: String, pub adapter_family: String,
    pub tier: String, pub status: String /* available|reserved|unknown */, pub required_shapes: Vec<String> }
pub struct Bundle { pub path: String, pub sha256: String, pub size_bytes: u64,
    pub built_at: Option<String> }
pub struct VerifyOutcome { pub reproducible: bool, pub shipped_sha256: String,
    pub rebuilt_sha256: String, pub diffs: Vec<String> }
```

`MockChecks`/`MockShip` are updated to emit the evolved shapes (so the default gate + existing tests still exercise the same types). The ts-rs drift gate regenerates `web/src/types/*`.

## 7. Frontend updates (driven by the type changes)

- **`HealthPage.tsx`**: render the third severity (`needs-setup`) with its own chip/class; show each finding's `remediation`; use the real category names; counts from `{errors, warnings, needs_setup}`.
- **`ShipPage.tsx`**: target cards show the real triple/tier/`required_shapes`; the build dropdown lists `status == "available"` targets; the bundle list drops the staged `steps` view (shows path/hash/size/built_at); add a **Verify** action per bundle calling `/verify` and rendering `VerifyOutcome` (reproducible ✓/✗ + diffs).
- API clients `web/src/api/{checks,ship}.ts` gain the `verify` call; types are regenerated.

## 8. Error handling

- `tau check` non-zero exit → parsed as findings (expected).
- `tau build`/`verify` exit 3 → `NeedsProvisioning`, surfaced to the UI as "this project needs `tau install` first" (the explicit D2 dependency).
- Subprocess spawn failure / unparseable JSON → HTTP 500 with a clear message (checks additionally inject a synthetic `error` finding so the page renders the failure rather than blanking).

## 9. Testing

- **Parser unit tests** (deterministic, no tau): feed captured real `tau check/target/build/verify --json` fixtures (committed under e.g. `gateway/tests/fixtures/tau-json/`) to the `Cli*` parsers; assert the evolved types. This is the primary coverage for build/verify given the provisioning gap.
- **Mock-path tests**: existing checks/ship API + `HealthPage`/`ShipPage` tests keep passing against the evolved `Mock*` shapes.
- **Gated real-tau tests** (skip unless `TAU_REAL_BIN` set, like D1's `real_tau_smoke`): `tau check` + `tau target list` run live against a bare fixture; `build`/`verify` run only if a provisioned (lockfile) fixture is present.
- ts-rs drift gate green; `cargo clippy -D warnings`; `pnpm typecheck`/tests green.

## 10. Out of scope / roadmap

- Provisioned-fixture creation via `tau install` → **D2** (packages/inventory).
- SARIF rendering (parse `--json`, not `--sarif`).
- D2 (tools/plugins/packages/skills inventory) and D4 (workflow runner + IR inspector) remain separate sub-projects.
