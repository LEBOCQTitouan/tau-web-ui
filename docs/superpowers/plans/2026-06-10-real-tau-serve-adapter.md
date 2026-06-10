# D1 — Real `tau serve` run-path foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the gateway drive a *real* `tau serve` subprocess for runs (uniform `serve` invocation, explicit mock-vs-real binary kind, credentials→subprocess-env bridge, clean failure mapping), verified against a locally-built tau with Ollama, while keeping `fake-tau-serve` as the deterministic test oracle.

**Architecture:** The gateway already speaks the real serve wire protocol (NDJSON JSON-RPC over stdio — see `docs/tau-contract-v1.md`); `is_mock` only switches the *non-run* sidecar seams. So this plan (1) inserts the `serve` subcommand into the spawn, (2) makes `is_mock` explicit via `--serve-kind` and **decouples it from the run binary** (so `--tau-bin /real/tau --serve-kind mock` = real runs + mock sidecars during D1), (3) adds a Local/Env-only credential→env bridge applied at spawn, (4) confirms serve-error→run-state mapping, and (5) adds an Ollama verification fixture + gated smoke tests.

**Tech Stack:** Rust (axum, tokio, serde, anyhow), `fake-tau-serve` mock, the real `tau` binary at `/Users/titouanlebocq/code/tau` (READ-ONLY — never modify tau source), Ollama for a local LLM.

**Conventions for every task:**
- Work happens in `/Users/titouanlebocq/code/tau-ui`. Build/test the gateway crate with `cargo` from the repo root.
- Run a single test with `cargo test -p tau-gateway <test_name>`; a file with `cargo test -p tau-gateway --test <file_stem>`.
- The mock binary must be built before any test that spawns it: `cargo build -p fake-tau-serve` (tests reference `target/debug/fake-tau-serve`).
- Commit from the repo root. End commit messages with the `Co-Authored-By` trailer used in this repo.
- This plan touches **no** `#[ts(export)]` types, so there is no `web/` typecheck or ts-rs drift to worry about.

---

## Task 1: Uniform `serve` invocation

**Files:**
- Modify: `gateway/src/serve_client/mod.rs` (extract a command builder; insert the `serve` subcommand)
- Modify: `fake-tau-serve/src/main.rs` (tolerate a leading `serve` token; update the header doc)

- [ ] **Step 1: Write the failing unit test for the command builder**

Append to the bottom of `gateway/src/serve_client/mod.rs` (a new `#[cfg(test)] mod tests`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn build_serve_command_inserts_serve_subcommand_and_flags() {
        let cmd = build_serve_command(
            &PathBuf::from("/opt/tau"),
            &PathBuf::from("/proj"),
            true,
            &[],
        );
        let std = cmd.as_std();
        let args: Vec<String> = std
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args[0], "serve", "serve subcommand must come first");
        assert!(args.iter().any(|a| a == "--project"));
        assert!(args.iter().any(|a| a == "/proj"));
        assert!(args.iter().any(|a| a == "--ready-on-stderr"));
        assert!(args.iter().any(|a| a == "--no-sandbox"));
    }
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cargo test -p tau-gateway build_serve_command_inserts_serve_subcommand_and_flags`
Expected: FAIL to compile — `build_serve_command` does not exist yet.

- [ ] **Step 3: Extract `build_serve_command` and call it from `spawn`**

In `gateway/src/serve_client/mod.rs`, add `use std::path::Path;` to the existing `use std::path::PathBuf;` line (make it `use std::path::{Path, PathBuf};`). Add this free function just above `impl ServeClient {`:

```rust
/// Build the `tau serve` child command: `<bin> serve --project <path> --ready-on-stderr [--no-sandbox]`,
/// with stdio piped and the given env vars applied on top of the inherited environment.
/// The `serve` subcommand is what the real `tau` binary requires; `fake-tau-serve`
/// tolerates (ignores) it.
fn build_serve_command(
    bin: &Path,
    project: &Path,
    no_sandbox: bool,
    envs: &[(String, String)],
) -> Command {
    let mut cmd = Command::new(bin);
    cmd.arg("serve").arg("--project").arg(project).arg("--ready-on-stderr");
    if no_sandbox {
        cmd.arg("--no-sandbox");
    }
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    cmd
}
```

Then replace the inline command construction at the top of `pub async fn spawn` (currently lines 67–75: the `let mut cmd = Command::new(&bin); … cmd.kill_on_drop(true);` block) with:

```rust
        let mut cmd = build_serve_command(&bin, &project, no_sandbox, &[]);
```

Leave the rest of `spawn` (the `cmd.spawn()` call and everything after) unchanged.

- [ ] **Step 4: Run the unit test to confirm it passes**

Run: `cargo test -p tau-gateway build_serve_command_inserts_serve_subcommand_and_flags`
Expected: PASS.

- [ ] **Step 5: Make the mock tolerate a leading `serve` token**

In `fake-tau-serve/src/main.rs`, update the header doc comment (lines 1–3) to:

```rust
//! Faithful mock of the `tau serve` wire protocol (NDJSON JSON-RPC over stdio).
//! Implements the contract snapshotted in tau-web-ui/docs/tau-contract-v1.md.
//! Invoked like the real binary: `fake-tau-serve serve --project <path> --ready-on-stderr`
//! (a leading `serve` subcommand is accepted and ignored).
//! Flags: --project <path> --ready-on-stderr [--max-concurrent N] [--idle-timeout S]
```

The mock parses only named flags via `flag(&args, …)`, so a leading `serve` positional is already ignored — no logic change is required. To make the intent explicit and guard future parsing, add this line right after `let args: Vec<String> = std::env::args().collect();` (currently line 13):

```rust
    // The gateway invokes us as `<bin> serve --project …`; the `serve` subcommand
    // (present for parity with the real `tau` binary) is accepted and ignored here.
    debug_assert!(args.iter().any(|a| a == "serve") || args.len() <= 1);
```

- [ ] **Step 6: Build the mock and run the serve-client e2e to confirm nothing broke**

Run:
```bash
cargo build -p fake-tau-serve
cargo test -p tau-gateway --test serve_client_e2e
```
Expected: all 3 tests PASS (`handshake_lists_agents`, `streaming_run_emits_events_then_final`, `cancel_mid_run_yields_error`) — the mock now receives `serve --project …` and still handshakes/streams/cancels.

- [ ] **Step 7: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/serve_client/mod.rs fake-tau-serve/src/main.rs
git commit -m "feat(gateway): spawn tau serve with the serve subcommand (mock tolerates it)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Explicit binary kind (`--serve-kind`), decoupled from the run binary

**Goal:** `is_mock` (which selects the *sidecar* seams) becomes an explicit choice via `--serve-kind real|mock`, defaulting to today's filename autodetect. The run path always spawns the real `--tau-bin`. This lets `--tau-bin /real/tau --serve-kind mock` run *real* agents while keeping *mock* sidecars during D1 (before D2–D4 wire the real sidecar seams). It also threads `data_root` into `AppState` for the credential bridge (Task 5).

**Files:**
- Modify: `gateway/src/projects/mod.rs` (add `load_with_kind`; `Inner` already stores `is_mock`; pass `is_mock` + `data_root` into `AppState`)
- Modify: `gateway/src/state.rs` (add `AppState::with_options`; keep `AppState::new` as a back-compat wrapper; store `data_root` + explicit `is_mock`)
- Modify: `gateway/src/main.rs` (parse `--serve-kind`, call `load_with_kind`)

- [ ] **Step 1: Write the failing test for serve-kind override**

Create `gateway/tests/serve_kind.rs`:

```rust
use std::path::PathBuf;
use tau_gateway::projects::ProjectRegistry;

fn real_bin_name() -> PathBuf {
    // A non-"fake-tau-serve" name autodetects is_mock=false.
    PathBuf::from("/usr/local/bin/tau")
}

#[tokio::test]
async fn serve_kind_mock_override_forces_mock_sidecars_even_with_real_bin_name() {
    let data = tempfile::tempdir().unwrap();
    // Real-looking bin name, but explicitly request mock sidecars.
    let reg = ProjectRegistry::load_with_kind(
        real_bin_name(),
        true,
        data.path().to_path_buf(),
        Some(true), // is_mock override = mock
    )
    .await
    .unwrap();
    // The workspace project exists; its tools come from the MOCK seam (non-empty,
    // deterministic) rather than the unwired CliTools stub (which returns empty).
    let state = reg.state(tau_gateway::projects::WORKSPACE_ID).await.unwrap();
    assert!(
        !state.list_tools().is_empty(),
        "mock sidecar seam should yield deterministic tools"
    );
}

#[tokio::test]
async fn load_defaults_to_filename_autodetect() {
    let data = tempfile::tempdir().unwrap();
    // No override: a real-looking name autodetects is_mock=false → Cli* sidecars.
    let reg = ProjectRegistry::load_with_kind(
        real_bin_name(),
        true,
        data.path().to_path_buf(),
        None,
    )
    .await
    .unwrap();
    let state = reg.state(tau_gateway::projects::WORKSPACE_ID).await.unwrap();
    // CliTools is an unwired stub → empty list (contrast with the mock seam above).
    assert!(state.list_tools().is_empty());
}
```

> Note: `MockTools` yields a non-empty deterministic list and `CliTools` is an unwired stub returning empty — verify these two facts hold in `gateway/src/tools/mod.rs` while implementing; if `CliTools` returns non-empty, assert on a field that differs instead (e.g. a known mock tool name present only in `MockTools`).

- [ ] **Step 2: Run it to confirm it fails**

Run: `cargo test -p tau-gateway --test serve_kind`
Expected: FAIL to compile — `load_with_kind` does not exist.

- [ ] **Step 3: Add `AppState::with_options` (and keep `new` as a wrapper)**

In `gateway/src/state.rs`, add two fields to `Inner` (after `pub no_sandbox: bool,`):

```rust
    pub data_root: PathBuf,
    pub is_mock: bool,
```

Replace the whole `impl AppState { pub fn new(...) -> Self { … } }` constructor (currently lines 54–127) with a `with_options` constructor plus a back-compat `new`:

```rust
impl AppState {
    /// Back-compat constructor used by tests: autodetects `is_mock` from the bin
    /// filename and defaults `data_root` to the store's parent. Prefer
    /// `with_options` from the registry, which passes both explicitly.
    pub fn new(bin: PathBuf, project: PathBuf, no_sandbox: bool, store: RunStore) -> Self {
        let is_mock = bin
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.contains("fake-tau-serve"))
            .unwrap_or(false);
        let data_root = store.root().parent().map(PathBuf::from).unwrap_or_default();
        Self::with_options(bin, project, no_sandbox, store, data_root, is_mock)
    }

    /// Construct with an explicit `data_root` (for the credential bridge) and an
    /// explicit `is_mock` (which selects the non-run sidecar seams only).
    pub fn with_options(
        bin: PathBuf,
        project: PathBuf,
        no_sandbox: bool,
        store: RunStore,
        data_root: PathBuf,
        is_mock: bool,
    ) -> Self {
        let workflow_runner: Box<dyn WorkflowRunner> = if is_mock {
            Box::new(MockRunner)
        } else {
            Box::new(crate::workflow::CliRunner::new(bin.clone(), project.clone()))
        };
        let package_ops: Box<dyn PackageOps> = if is_mock {
            Box::new(MockOps::new())
        } else {
            Box::new(CliOps::new(bin.clone(), project.clone()))
        };
        let installed_skills: Box<dyn InstalledSkills> = if is_mock {
            Box::new(skills::MockInstalled::new())
        } else {
            Box::new(skills::CliInstalled)
        };
        let tools_source: Box<dyn ToolsSource> = if is_mock {
            Box::new(tools::MockTools)
        } else {
            Box::new(tools::CliTools)
        };
        let plugins_source: Box<dyn PluginsSource> = if is_mock {
            Box::new(plugins::MockPlugins)
        } else {
            Box::new(plugins::CliPlugins)
        };
        let ship_source: Box<dyn ShipSource> = if is_mock {
            let project_name = project
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string();
            Box::new(ship::MockShip::new(project_name))
        } else {
            Box::new(ship::CliShip)
        };
        let check_source: Box<dyn CheckSource> = if is_mock {
            Box::new(checks::MockChecks)
        } else {
            Box::new(checks::CliChecks)
        };
        let graph_source: Box<dyn WorkflowGraphSource> = if is_mock {
            Box::new(graph::MockGraph)
        } else {
            Box::new(graph::CliGraph)
        };
        AppState(Arc::new(Inner {
            bin,
            project,
            no_sandbox,
            data_root,
            is_mock,
            store,
            workflow_runner,
            package_ops,
            installed_skills,
            tools_source,
            plugins_source,
            ship_source,
            check_source,
            graph_source,
            client: Mutex::new(None),
            runs: RwLock::new(HashMap::new()),
            serve_ids: RwLock::new(HashMap::new()),
            channels: RwLock::new(HashMap::new()),
        }))
    }
```

> `RunStore` (`gateway/src/store/mod.rs`) holds a private `dir: PathBuf` with no accessor. Add one inside `impl RunStore`:
>
> ```rust
>     /// The directory this store writes run files into.
>     pub fn root(&self) -> &std::path::Path {
>         &self.dir
>     }
> ```
>
> The back-compat `new` only needs *a* path here (its callers are tests that never spawn a credential-bearing run, so `credential_env` reads a non-existent `credentials.toml` → empty); `with_options` from the registry passes the true `data_root`.

- [ ] **Step 4: Add `ProjectRegistry::load_with_kind` and use `with_options`**

In `gateway/src/projects/mod.rs`, replace `pub async fn load(...)` (lines 108–127) with a delegating pair:

```rust
    /// Load with autodetected binary kind (filename contains "fake-tau-serve").
    pub async fn load(bin: PathBuf, no_sandbox: bool, data_root: PathBuf) -> Result<Self> {
        Self::load_with_kind(bin, no_sandbox, data_root, None).await
    }

    /// Load with an explicit `is_mock` override (`--serve-kind`). `None` = autodetect.
    /// `is_mock` selects the non-run sidecar seams only; runs always spawn `bin`.
    pub async fn load_with_kind(
        bin: PathBuf,
        no_sandbox: bool,
        data_root: PathBuf,
        is_mock_override: Option<bool>,
    ) -> Result<Self> {
        let is_mock = is_mock_override.unwrap_or_else(|| {
            bin.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.contains("fake-tau-serve"))
                .unwrap_or(false)
        });
        std::fs::create_dir_all(&data_root).ok();
        let reg = ProjectRegistry(Arc::new(Inner {
            projects: RwLock::new(IndexMap::new()),
            bin,
            no_sandbox,
            data_root,
            is_mock,
        }));
        reg.ensure_workspace().await?;
        for meta in reg.read_manifest()? {
            reg.insert_entry(meta).await?;
        }
        Ok(reg)
    }
```

In the same file, update `insert_entry` (lines 174–195) to call `with_options` with the registry's `data_root` + `is_mock`:

```rust
        let store = RunStore::new(&store_dir)?;
        let state = AppState::with_options(
            self.0.bin.clone(),
            PathBuf::from(&meta.path),
            self.0.no_sandbox,
            store,
            self.0.data_root.clone(),
            self.0.is_mock,
        );
        state.rehydrate().await?;
```

- [ ] **Step 5: Parse `--serve-kind` in `main.rs`**

In `gateway/src/main.rs`, after the `no_sandbox` line (line 18) add:

```rust
    let serve_kind = flag(&args, "--serve-kind"); // "real" | "mock" | None (autodetect)
    let is_mock_override = serve_kind.as_deref().map(|k| k.eq_ignore_ascii_case("mock"));
```

Replace `let reg = ProjectRegistry::load(bin, no_sandbox, data_root).await?;` (line 24) with:

```rust
    let reg =
        ProjectRegistry::load_with_kind(bin, no_sandbox, data_root, is_mock_override).await?;
```

- [ ] **Step 6: Run the new test + the registry suite**

Run:
```bash
cargo build -p fake-tau-serve
cargo test -p tau-gateway --test serve_kind
cargo test -p tau-gateway --test projects_registry
```
Expected: `serve_kind` (2 tests) PASS; `projects_registry` unchanged and PASS (it calls `load(...)`, which still works).

- [ ] **Step 7: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/projects/mod.rs gateway/src/state.rs gateway/src/main.rs gateway/tests/serve_kind.rs gateway/src/store/mod.rs
git commit -m "feat(gateway): --serve-kind decouples sidecar mock seams from the run binary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Credential resolution (Local + Env → env var), pure

**Goal:** A pure helper that turns the credential chain into `(env_var, value)` pairs for backends whose winning source is **Local** (stored secret) or **Env** (referenced var). `SecretManager`/`TokenBroker`/`WorkloadIdentity` resolve to nothing (the gateway never reads their values).

**Files:**
- Modify: `gateway/src/credentials/mod.rs` (add `canonical_env_var`, `Credentials::resolve_secret`, `Credentials::credential_env` + unit tests)

- [ ] **Step 1: Write the failing unit tests**

Add to the existing `#[cfg(test)] mod store_tests` in `gateway/src/credentials/mod.rs` (reuse its `cfg` helper):

```rust
    #[test]
    fn credential_env_injects_local_value_under_canonical_var() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put("anthropic", vec![cfg(SourceKind::Local, None)], Some("sk-abc".into()))
            .unwrap();
        let env = c.credential_env(&|_| None);
        assert_eq!(env, vec![("ANTHROPIC_API_KEY".to_string(), "sk-abc".to_string())]);
    }

    #[test]
    fn credential_env_reads_env_source_value_under_canonical_var() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put("openai", vec![cfg(SourceKind::Env, Some("MY_OAI"))], None)
            .unwrap();
        let getter = |k: &str| (k == "MY_OAI").then(|| "sk-env".to_string());
        let env = c.credential_env(&getter);
        assert_eq!(env, vec![("OPENAI_API_KEY".to_string(), "sk-env".to_string())]);
    }

    #[test]
    fn credential_env_skips_unreadable_and_unknown_backends() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        // Manager source: configured-by-ambient-env but value never read by the gateway.
        c.put("anthropic", vec![cfg(SourceKind::Vault, Some("secret/x"))], None)
            .unwrap();
        // Unknown backend with a local value: no canonical var → skipped.
        c.put("acme-llm", vec![cfg(SourceKind::Local, None)], Some("v".into()))
            .unwrap();
        let getter = |k: &str| (k == "VAULT_ADDR").then(|| "http://v".to_string());
        assert!(c.credential_env(&getter).is_empty());
    }
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `cargo test -p tau-gateway --lib credentials::store_tests::credential_env`
Expected: FAIL to compile — `credential_env`/`canonical_env_var`/`resolve_secret` do not exist.

- [ ] **Step 3: Implement the resolver**

In `gateway/src/credentials/mod.rs`, add this free function just above `// ---- store:` (after `resolve`, around line 140):

```rust
/// The canonical env var that tau's LLM plugin reads for `backend` (default
/// `api_key_env`). `None` for backends with no known cloud key (e.g. ollama).
pub fn canonical_env_var(backend: &str) -> Option<&'static str> {
    match backend {
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" => Some("OPENAI_API_KEY"),
        _ => None,
    }
}
```

Add these two methods inside `impl Credentials { … }` (e.g. after `status_all`):

```rust
    /// The secret value for `backend` when its winning source is Local or Env,
    /// else `None`. Managers / TokenBroker / WorkloadIdentity are never read here.
    pub fn resolve_secret(
        &self,
        backend: &str,
        env_get: &dyn Fn(&str) -> Option<String>,
    ) -> Option<String> {
        let cfg = self.read_config();
        let bc = cfg.backends.get(backend)?;
        let secrets = self.read_secrets();
        let has_local = secrets.contains_key(backend);
        let (_, via) = resolve(&bc.sources, has_local, env_get);
        match via? {
            SourceKind::Local => secrets.get(backend).cloned(),
            SourceKind::Env => bc
                .sources
                .iter()
                .find(|s| s.kind == SourceKind::Env)
                .and_then(|s| s.reference.as_deref())
                .and_then(env_get),
            _ => None,
        }
    }

    /// `(env_var, value)` pairs for every configured backend that has a known
    /// canonical var and a Local/Env-resolvable secret. Never logs values.
    pub fn credential_env(
        &self,
        env_get: &dyn Fn(&str) -> Option<String>,
    ) -> Vec<(String, String)> {
        let cfg = self.read_config();
        let mut out = Vec::new();
        for backend in cfg.backends.keys() {
            if let (Some(var), Some(val)) =
                (canonical_env_var(backend), self.resolve_secret(backend, env_get))
            {
                out.push((var.to_string(), val));
            }
        }
        out
    }
```

- [ ] **Step 4: Run the unit tests to confirm they pass**

Run: `cargo test -p tau-gateway --lib credentials::store_tests::credential_env`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/credentials/mod.rs
git commit -m "feat(gateway): credential_env resolves Local/Env secrets to (var,value) pairs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Inject env at spawn + prove it reaches the child

**Goal:** `spawn_with_env` applies the credential env to the child; a `meta.env` probe on the mock proves (presence-only) that an injected var reaches the child process.

**Files:**
- Modify: `gateway/src/serve_client/mod.rs` (`spawn_with_env`; `spawn` delegates; `debug_env_present`; env-in-builder unit test)
- Modify: `fake-tau-serve/src/main.rs` (`meta.env` probe — presence only, never echoes the value)
- Modify: `gateway/tests/serve_client_e2e.rs` (round-trip: injected var present, other var absent)

- [ ] **Step 1: Write the failing builder unit test (envs) + round-trip e2e test**

In `gateway/src/serve_client/mod.rs`'s `#[cfg(test)] mod tests`, add:

```rust
    #[test]
    fn build_serve_command_applies_injected_env() {
        let cmd = build_serve_command(
            &PathBuf::from("/opt/tau"),
            &PathBuf::from("/proj"),
            false,
            &[("ANTHROPIC_API_KEY".to_string(), "sk-xyz".to_string())],
        );
        let std = cmd.as_std();
        let found = std
            .get_envs()
            .any(|(k, v)| k == "ANTHROPIC_API_KEY" && v == Some("sk-xyz".as_ref()));
        assert!(found, "injected env var must be set on the child command");
    }
```

Add to `gateway/tests/serve_client_e2e.rs`:

```rust
#[tokio::test]
async fn injected_env_reaches_the_child() {
    let client = ServeClient::spawn_with_env(
        mock_bin(),
        project(),
        true,
        vec![("INJECTED_PROBE".to_string(), "yes".to_string())],
    )
    .await
    .unwrap();
    assert!(client.debug_env_present("INJECTED_PROBE").await.unwrap());
    assert!(!client.debug_env_present("DEFINITELY_NOT_SET_XZ").await.unwrap());
}
```

- [ ] **Step 2: Run them to confirm they fail**

Run:
```bash
cargo test -p tau-gateway build_serve_command_applies_injected_env
cargo test -p tau-gateway --test serve_client_e2e injected_env_reaches_the_child
```
Expected: FAIL to compile — `spawn_with_env` / `debug_env_present` do not exist.

- [ ] **Step 3: Add `spawn_with_env`, make `spawn` delegate, add `debug_env_present`**

In `gateway/src/serve_client/mod.rs`, change the `spawn` signature block. Replace the line:

```rust
    pub async fn spawn(bin: PathBuf, project: PathBuf, no_sandbox: bool) -> Result<ServeClient> {
        let mut cmd = build_serve_command(&bin, &project, no_sandbox, &[]);
```

with a delegating `spawn` plus a real `spawn_with_env`:

```rust
    /// Spawn with no injected env (back-compat; used by tests).
    pub async fn spawn(bin: PathBuf, project: PathBuf, no_sandbox: bool) -> Result<ServeClient> {
        Self::spawn_with_env(bin, project, no_sandbox, Vec::new()).await
    }

    /// Spawn `tau serve`, injecting `envs` on top of the inherited environment;
    /// wait for the ready line on stderr; handshake.
    pub async fn spawn_with_env(
        bin: PathBuf,
        project: PathBuf,
        no_sandbox: bool,
        envs: Vec<(String, String)>,
    ) -> Result<ServeClient> {
        let mut cmd = build_serve_command(&bin, &project, no_sandbox, &envs);
```

(Everything from `let mut child = cmd.spawn()...` to the end of the old `spawn` body stays exactly as-is, now inside `spawn_with_env`.)

Add a `debug_env_present` method inside `impl ServeClient` (near `ping`):

```rust
    /// TEST/DEBUG ONLY: ask the child whether an env var is set (presence only;
    /// the value is never returned). The real `tau` binary does not implement
    /// `meta.env` and will answer "method not found" — this is for the mock.
    pub async fn debug_env_present(&self, var: &str) -> Result<bool> {
        Ok(self
            .unary_call("meta.env", json!({ "var": var }))
            .await?["present"]
            .as_bool()
            .unwrap_or(false))
    }
```

- [ ] **Step 4: Add the `meta.env` probe to the mock**

In `fake-tau-serve/src/main.rs`, add a new match arm in the `match method { … }` block (e.g. right after the `"meta.ping"` arm, before `"runtime.run_streaming"`):

```rust
            "meta.env" => {
                // Presence only — never echo the value (it may be a secret).
                let var = req["params"]["var"].as_str().unwrap_or("");
                let present =
                    !var.is_empty() && std::env::var(var).map(|v| !v.is_empty()).unwrap_or(false);
                write_line(
                    &mut *out.lock().await,
                    &json!({"jsonrpc":"2.0","id":id,"result":{"present":present}}),
                )
                .await?;
            }
```

- [ ] **Step 5: Switch the gateway's spawn call to `spawn_with_env`**

In `gateway/src/state.rs`, in `pub async fn client`, replace the `ServeClient::spawn(...)` call (lines 156–161) with `spawn_with_env`, computing the env from the project's credential chain:

```rust
        let envs = crate::credentials::Credentials::new(self.0.data_root.clone())
            .credential_env(&|k| std::env::var(k).ok());
        let c = ServeClient::spawn_with_env(
            self.0.bin.clone(),
            self.0.project.clone(),
            self.0.no_sandbox,
            envs,
        )
        .await?;
```

- [ ] **Step 6: Build the mock, run the tests**

Run:
```bash
cargo build -p fake-tau-serve
cargo test -p tau-gateway build_serve_command_applies_injected_env
cargo test -p tau-gateway --test serve_client_e2e
```
Expected: builder test PASS; all `serve_client_e2e` tests PASS including `injected_env_reaches_the_child`.

- [ ] **Step 7: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/serve_client/mod.rs fake-tau-serve/src/main.rs gateway/tests/serve_client_e2e.rs gateway/src/state.rs
git commit -m "feat(gateway): inject resolved credentials into the tau serve child env

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: End-to-end credential bridge through the gateway

**Goal:** Prove that a **Local** credential stored in the gateway's `data_root` reaches a real (mock) child spawned via `AppState::client()`.

**Files:**
- Create: `gateway/tests/credential_bridge.rs`

- [ ] **Step 1: Write the failing integration test**

Create `gateway/tests/credential_bridge.rs`:

```rust
use std::path::PathBuf;
use tau_gateway::credentials::{Credentials, SourceConfig, SourceKind};
use tau_gateway::projects::ProjectRegistry;

fn mock_bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

#[tokio::test]
async fn local_credential_reaches_the_serve_child() {
    let data = tempfile::tempdir().unwrap();
    // Store a Local secret for anthropic in this gateway's data_root.
    Credentials::new(data.path().to_path_buf())
        .put(
            "anthropic",
            vec![SourceConfig { kind: SourceKind::Local, reference: None }],
            Some("sk-bridge".into()),
        )
        .unwrap();

    let reg = ProjectRegistry::load_with_kind(
        mock_bin(),
        true,
        data.path().to_path_buf(),
        Some(true),
    )
    .await
    .unwrap();
    let state = reg.state(tau_gateway::projects::WORKSPACE_ID).await.unwrap();

    // Spawning the child injects ANTHROPIC_API_KEY; the mock confirms presence.
    let client = state.client().await.unwrap();
    assert!(client.debug_env_present("ANTHROPIC_API_KEY").await.unwrap());
}
```

> This requires `Credentials`, `SourceConfig`, `SourceKind`, and `AppState::client` to be reachable from outside the crate. Verify `pub use`/`pub` visibility while implementing: `credentials` is already `pub` (used by `credentials_api.rs`); `client` is `pub` on `AppState`. If `SourceConfig`/`SourceKind` are not re-exported at `tau_gateway::credentials`, they already are (`pub enum`/`pub struct` in that module). Adjust the `use` path to match the actual module layout if needed.

- [ ] **Step 2: Run it to confirm it fails (or compile-checks the wiring)**

Run:
```bash
cargo build -p fake-tau-serve
cargo test -p tau-gateway --test credential_bridge
```
Expected: FAIL — before Task 4's wiring is correct, the var would be absent. (If Task 4 is already merged, this test documents/locks the behavior and should pass; if it fails, the bug is in `client()`'s env construction — fix there, not in the test.)

- [ ] **Step 3: Make it pass**

No new production code should be needed beyond Task 4. If the test fails, the cause is almost certainly one of: `data_root` not threaded into `AppState` (Task 2), or `client()` not building `credential_env` (Task 4). Fix the wiring so the test passes; do not weaken the assertion.

- [ ] **Step 4: Confirm**

Run: `cargo test -p tau-gateway --test credential_bridge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/tests/credential_bridge.rs
git commit -m "test(gateway): a Local credential reaches the tau serve child via the gateway

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Real-failure mapping (LLM error → Failed run)

**Goal:** Confirm a serve error response maps to a `Failed` run with a non-empty message (the existing `state.rs` mapping is generic — this adds a deterministic driver + an assertion). Uses a mock `boom` agent that returns `-32008 LLM_ERROR`.

**Files:**
- Modify: `fake-tau-serve/src/main.rs` (a `boom` agent → immediate `-32008` error)
- Modify: `fake-tau-serve/src/scripts.rs` (only if `script_for` must special-case; see below)
- Create: `gateway/tests/run_failure.rs`

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/run_failure.rs`:

```rust
use std::path::PathBuf;
use std::time::Duration;
use tau_gateway::projects::ProjectRegistry;
use tau_gateway::trace::RunStatus;

fn mock_bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

#[tokio::test]
async fn llm_error_maps_to_failed_run_with_detail() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load_with_kind(mock_bin(), true, data.path().to_path_buf(), Some(true))
        .await
        .unwrap();
    let state = reg.state(tau_gateway::projects::WORKSPACE_ID).await.unwrap();

    let run_id = state.launch("boom".into(), "go".into()).await.unwrap();

    // Poll the in-memory run until terminal (the stream task finalizes async).
    let mut run = None;
    for _ in 0..50 {
        let r = state.get_run(&run_id).await.unwrap();
        if r.status != RunStatus::Running {
            run = Some(r);
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let run = run.expect("run reached a terminal state");
    assert_eq!(run.status, RunStatus::Failed);
    let err = run.error.expect("failed run carries an error");
    assert!(err.detail.contains("boom"), "detail was: {}", err.detail);
}
```

> Confirm `state.launch`, `state.get_run`, `RunStatus`, and `Run.error`/`RunError.detail` are reachable (`tau_gateway::trace::RunStatus` is `pub`; `launch`/`get_run` are `pub` on `AppState`). The error kind for a non-cancel rpc error is `format!("rpc:{}", code)` and `detail` is the rpc message — so the mock's message must contain `boom`.

- [ ] **Step 2: Run it to confirm it fails**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test run_failure`
Expected: FAIL — the mock currently runs the default `greeter` script for an unknown agent, so the run completes instead of failing.

- [ ] **Step 3: Add the `boom` agent to the mock**

In `fake-tau-serve/src/main.rs`, in the `"runtime.run_streaming"` arm, immediately after `let prompt = …;` (line 81) and before `let id_str = id.to_string();`, add an early error return for the reserved `boom` agent:

```rust
                if agent == "boom" {
                    // Deterministic LLM_ERROR for failure-path tests.
                    write_line(&mut *out.lock().await, &err_response(&id, -32008, "llm boom"))
                        .await?;
                    continue;
                }
```

(No change to `scripts.rs` is needed — the early return happens before the script task is spawned.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test run_failure`
Expected: PASS — `boom` → `-32008` → run `Failed`, `error.detail == "llm boom"`.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add fake-tau-serve/src/main.rs gateway/tests/run_failure.rs
git commit -m "test(gateway): serve LLM_ERROR maps to a Failed run with a surfaced message

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Ollama verification fixture + gated real-tau smoke test

**Goal:** A verification fixture project declaring an Ollama-backed agent, plus a smoke test that exercises a *real* `tau serve` + Ollama run — gated so it **skips** when the real binary or Ollama is unavailable (the default `cargo test` gate never needs them). Also: build the real tau binary and run the smoke test once, manually.

**Files:**
- Create: `fixtures/ollama-smoke/tau.toml` (a project with an Ollama agent)
- Create: `gateway/tests/real_tau_smoke.rs` (gated smoke test)
- Modify: `docs/tau-contract-v1.md` (append a short "Verifying against real tau" note)

- [ ] **Step 1: Create the Ollama fixture project**

Create `fixtures/ollama-smoke/tau.toml`:

```toml
[project]
name = "ollama-smoke"

[agents.local]
display_name = "local ollama agent"
llm_backend  = "ollama"

[agents.local.config]
model = "mistral"
base_url = "http://localhost:11434"
```

> `mistral` advertises tool support and is pulled locally; if a different tool-capable model is preferred, change `model`. The `[agents.local.config]` table maps to `OllamaConfig` (fields `model`, `base_url`) in tau's ollama plugin.

- [ ] **Step 2: Write the gated smoke test**

Create `gateway/tests/real_tau_smoke.rs`:

```rust
//! Smoke test against a REAL `tau serve` + Ollama. Skips unless BOTH:
//!   - env `TAU_REAL_BIN` points at a runnable `tau` binary, and
//!   - Ollama answers at http://localhost:11434.
//! Never runs in the default CI gate (no model in CI).

use std::path::PathBuf;
use tau_gateway::serve_client::{RunItem, ServeClient};

fn real_bin() -> Option<PathBuf> {
    std::env::var("TAU_REAL_BIN").ok().map(PathBuf::from).filter(|p| p.exists())
}

fn fixture() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/ollama-smoke");
    p
}

async fn ollama_up() -> bool {
    // Best-effort TCP probe; treat any connect success as "up".
    tokio::net::TcpStream::connect("127.0.0.1:11434").await.is_ok()
}

#[tokio::test]
async fn real_tau_ollama_streams_a_completed_run() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN to a runnable tau binary");
        return;
    };
    if !ollama_up().await {
        eprintln!("skip: Ollama not reachable on :11434");
        return;
    }

    let client = ServeClient::spawn(bin, fixture(), true).await.unwrap();
    let hs = client.handshake().await;
    assert!(hs.agents.iter().any(|a| a == "local"), "agents: {:?}", hs.agents);

    let (_id, mut rx) = client.run_streaming("local", "Say hello in one short sentence.").await.unwrap();
    let mut saw_text = false;
    let mut completed = false;
    while let Some(item) = rx.recv().await {
        match item {
            RunItem::Event { kind, .. } if kind == "TextDelta" => saw_text = true,
            RunItem::Final { .. } => { completed = true; break; }
            RunItem::Error(e) => panic!("run errored: {} {}", e.code, e.message),
            _ => {}
        }
    }
    assert!(saw_text, "expected at least one TextDelta from the model");
    assert!(completed, "expected a final result");
}
```

- [ ] **Step 3: Confirm the gated test compiles and skips cleanly without real tau**

Run: `cargo test -p tau-gateway --test real_tau_smoke`
Expected: PASS (the test returns early with a `skip:` message because `TAU_REAL_BIN` is unset).

- [ ] **Step 4: Build real tau and run the smoke test once (manual)**

Run (this builds the real binary for this arch — it may take several minutes; never modify tau source):
```bash
cargo build --manifest-path /Users/titouanlebocq/code/tau/Cargo.toml -p tau-cli
# Locate the built binary (name may be `tau` or `tau-cli`):
ls /Users/titouanlebocq/code/tau/target/debug/tau /Users/titouanlebocq/code/tau/target/debug/tau-cli 2>/dev/null
# Make sure a tool-capable model is pulled:
ollama list | grep -i mistral || ollama pull mistral
# Run the smoke test against real tau:
TAU_REAL_BIN=/Users/titouanlebocq/code/tau/target/debug/tau \
  cargo test -p tau-gateway --test real_tau_smoke -- --nocapture
```
Expected: the run streams `TextDelta`s and completes. **If the build fails or the binary name differs**, capture the exact error/paths and report it (the gateway code is unaffected; this is a verification step). If real tau cannot be built in this environment, record that in the commit/report and rely on the deterministic mock tests — do NOT block the plan on it.

- [ ] **Step 5: Append the verification note to the contract doc**

Add to the end of `docs/tau-contract-v1.md`:

```markdown

## Verifying against real tau (D1)

The gateway speaks this contract to either `fake-tau-serve` (deterministic oracle)
or the real `tau` binary. To verify against real tau locally:

1. Build tau: `cargo build --manifest-path /path/to/tau/Cargo.toml -p tau-cli`.
2. Pull a tool-capable Ollama model (e.g. `ollama pull mistral`) and ensure Ollama
   is running on `:11434`.
3. Run the gated smoke test:
   `TAU_REAL_BIN=/path/to/tau/target/debug/tau cargo test -p tau-gateway --test real_tau_smoke -- --nocapture`.

The smoke test skips automatically when `TAU_REAL_BIN` is unset or Ollama is down,
so it is safe in the default `cargo test` gate. Cloud backends (anthropic/openai)
authenticate via the credential→env bridge once a key is stored in the chain.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add fixtures/ollama-smoke/tau.toml gateway/tests/real_tau_smoke.rs docs/tau-contract-v1.md
git commit -m "test(gateway): gated real-tau+Ollama serve smoke test + Ollama fixture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Final gate

**Files:** none (verification only)

- [ ] **Step 1: Build all crates + the mock**

Run:
```bash
cd /Users/titouanlebocq/code/tau-ui
cargo build -p fake-tau-serve
cargo build -p tau-gateway
```
Expected: both build clean.

- [ ] **Step 2: Format + clippy**

Run:
```bash
cargo fmt -p tau-gateway -p fake-tau-serve
cargo clippy -p tau-gateway -p fake-tau-serve --all-targets -- -D warnings
```
Expected: no diffs left unstaged after fmt; clippy clean. Fix any clippy findings, then re-run.

- [ ] **Step 3: Full gateway test suite**

Run: `cargo test -p tau-gateway`
Expected: ALL tests pass, including the new `serve_kind`, `credential_bridge`, `run_failure`, `real_tau_smoke` (skips), and the unchanged `serve_client_e2e` / `run_orchestration` / `ws_e2e` / sidecar suites. If a previously-passing test fails, it indicates a regression in the spawn/kind/credentials wiring — fix the wiring, not the test.

- [ ] **Step 4: Frontend smoke (no changes expected)**

Run: `cd web && pnpm typecheck`
Expected: clean (this plan changed no `#[ts(export)]` types, so the generated `web/src/types/` is unchanged). If ts-rs emitted any drift, regenerate and commit it.

- [ ] **Step 5: Commit any fmt/clippy fixups**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "chore(gateway): fmt + clippy after the real tau serve adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage** (`2026-06-10-real-tau-serve-adapter-design.md`):
- §3 spawn (uniform `serve`, mock tolerates it) → Task 1. Explicit `--serve-kind` decoupled from the run binary → Task 2. ✓
- §4 credential bridge (Local/Env only; Manager/Broker/WI skipped; canonical var map; injected on the Command; never logs values) → Task 3 (pure) + Task 4 (spawn injection) + Task 5 (end-to-end). ✓
- §5 real-failure mapping (serve error → Failed with message) → Task 6 (the generic mapping already exists in `state.rs`; Task 6 adds a deterministic driver + assertion). The `-32603` child-exit path is exercised by the existing pump behavior; the cancel `-32001` path by the existing `cancel_mid_run_yields_error`. ✓
- §6 verification (build tau, Ollama fixture, gated smoke, deterministic bridge test) → Task 7 + Task 5. ✓
- §7 test-double strategy (mock stays the default oracle; smoke lane gated/out of CI) → Task 7. ✓
- §8 out of scope (sidecar seams, live cloud, Manager/Broker/WI resolution) → untouched; `--serve-kind mock` explicitly keeps mock sidecars during D1. ✓

**Placeholder scan:** No TBD/TODO. Each code step shows full code. The two "verify visibility/shape" notes (RunStore root in Task 2; pub paths in Task 5) are explicit guards with concrete fallbacks, not placeholders.

**Type/▸signature consistency:** `build_serve_command(bin,project,no_sandbox,envs)` is introduced once (Task 1) and extended via the same signature (Task 4 just passes a non-empty slice). `spawn`/`spawn_with_env`, `load`/`load_with_kind`, `AppState::new`/`with_options` are delegating pairs, so existing callers compile unchanged. `credential_env(&dyn Fn)->Vec<(String,String)>`, `resolve_secret`, `canonical_env_var` names match across Tasks 3–5. `debug_env_present`/`meta.env` (`{present:bool}`) match across Task 4 and Task 5. `RunStatus`/`RunError.detail` usage in Task 6 matches `state.rs`.
