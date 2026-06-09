# Credentials chain — CR-1 (chain core + Env + Local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each LLM backend a credential resolved through an ordered source **chain** (first-resolves-wins), with two real source kinds — **Env** (reference a var name) and **Local** (capture a write-only value into a 0600 file) — surfaced as an inline chain editor on the Providers screen.

**Architecture:** A new gateway module `credentials` holds the ts-rs types + a pure, injectable-env **resolver** + a global **store** (two 0600 files under `data_root`: config `credentials.toml` + secrets `credentials.secrets.json`). Global (non-scoped) `/api/credentials` routes back it via `ProjectRegistry`. The frontend adds a global `credentials.ts` client, a `CredentialChainEditor`, and an inline-expand on each Providers row. Resolver/store/UI are fully real (mock-first); the only future seam is injecting a resolved credential into a real `tau serve` subprocess.

**Tech Stack:** Rust (axum, serde, `toml` 0.8, `serde_json`, ts-rs); React 18, TypeScript, Tailwind, Vitest, Playwright. Spec: `docs/superpowers/specs/2026-06-09-credentials-chain-cr1-design.md`.

---

## File Structure

**Gateway — Create:** `gateway/src/credentials/mod.rs` (types + resolver + store), `gateway/src/api/credentials.rs` (handlers), `gateway/tests/credentials_api.rs`. **Modify:** `gateway/src/lib.rs` (+`pub mod credentials;`), `gateway/src/projects/mod.rs` (+`credentials()` accessor), `gateway/src/api/mod.rs` (routes). **Regenerated:** `web/src/types/{SourceKind,SourceConfig,SourceStatus,BackendCredentialStatus}.ts`.
**Frontend — Create:** `web/src/api/credentials.ts`, `web/src/providers/CredentialChainEditor.tsx`, `web/src/providers/CredentialChainEditor.test.tsx`. **Modify:** `web/src/providers/ProvidersPage.tsx`, `web/src/providers/ProvidersPage.test.tsx`, `web/e2e/run.spec.ts`.

---

## Task 1: Credential types + resolver (pure) + unit tests

**Files:** Create `gateway/src/credentials/mod.rs`; Modify `gateway/src/lib.rs`.

- [ ] **Step 1: Register the module** — in `gateway/src/lib.rs`, insert `pub mod credentials;` alphabetically after `pub mod config;` and before `pub mod graph;`:

```rust
pub mod config;
pub mod credentials;
pub mod graph;
```

- [ ] **Step 2: Create `gateway/src/credentials/mod.rs` with the types + resolver**

```rust
//! LLM-backend credentials: an ordered source **chain** (first-resolves-wins),
//! tau's "provider chain, never a vault" model with the gateway as the parent-app
//! resolver. CR-1 ships Env + Local; the rest are gated (CR-2/CR-3). The store is
//! global (per gateway `data_root`); secret values are write-only and never echoed.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Env,
    Local,
    Vault,
    AwsKv,
    GcpKv,
    AzureKv,
    TokenBroker,
    WorkloadIdentity,
}

impl SourceKind {
    /// Not yet wired in CR-1 (everything except Env/Local).
    pub fn gated(self) -> bool {
        !matches!(self, SourceKind::Env | SourceKind::Local)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SourceConfig {
    pub kind: SourceKind,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    #[ts(rename = "ref")]
    pub reference: Option<String>, // Env: var name; CR-2/3: addr/path/url; Local: None
}

/// Per-source status — NEVER carries a secret value.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SourceStatus {
    pub kind: SourceKind,
    #[serde(rename = "ref")]
    #[ts(rename = "ref")]
    pub reference: Option<String>,
    pub configured: bool,
    pub gated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BackendCredentialStatus {
    pub backend: String,
    pub sources: Vec<SourceStatus>,
    pub resolved: bool,
    pub resolved_via: Option<SourceKind>,
}

/// Whether one source can resolve, given local-secret presence + an env lookup.
pub fn source_configured(
    s: &SourceConfig,
    has_local: bool,
    env_get: &dyn Fn(&str) -> Option<String>,
) -> bool {
    match s.kind {
        SourceKind::Local => has_local,
        SourceKind::Env => s
            .reference
            .as_deref()
            .and_then(env_get)
            .map(|v| !v.is_empty())
            .unwrap_or(false),
        _ => false, // gated kinds never resolve in CR-1
    }
}

/// Walk the chain; the first configured source wins.
pub fn resolve(
    sources: &[SourceConfig],
    has_local: bool,
    env_get: &dyn Fn(&str) -> Option<String>,
) -> (bool, Option<SourceKind>) {
    for s in sources {
        if source_configured(s, has_local, env_get) {
            return (true, Some(s.kind));
        }
    }
    (false, None)
}

#[cfg(test)]
mod resolver_tests {
    use super::*;

    fn src(kind: SourceKind, r: Option<&str>) -> SourceConfig {
        SourceConfig { kind, reference: r.map(|s| s.to_string()) }
    }
    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn local_resolves_when_value_present() {
        let s = [src(SourceKind::Local, None)];
        assert_eq!(resolve(&s, true, &no_env), (true, Some(SourceKind::Local)));
        assert_eq!(resolve(&s, false, &no_env), (false, None));
    }

    #[test]
    fn env_resolves_when_var_set() {
        let s = [src(SourceKind::Env, Some("MY_KEY"))];
        let getter = |k: &str| (k == "MY_KEY").then(|| "secret".to_string());
        assert_eq!(resolve(&s, false, &getter), (true, Some(SourceKind::Env)));
        assert_eq!(resolve(&s, false, &no_env), (false, None));
    }

    #[test]
    fn first_match_wins() {
        let s = [src(SourceKind::Local, None), src(SourceKind::Env, Some("MY_KEY"))];
        let getter = |k: &str| (k == "MY_KEY").then(|| "x".to_string());
        assert_eq!(resolve(&s, true, &getter), (true, Some(SourceKind::Local)));
        assert_eq!(resolve(&s, false, &getter), (true, Some(SourceKind::Env)));
    }

    #[test]
    fn gated_never_resolves() {
        let s = [src(SourceKind::Vault, Some("secret/x"))];
        assert_eq!(resolve(&s, true, &no_env), (false, None));
        assert!(SourceKind::Vault.gated());
        assert!(!SourceKind::Env.gated());
        assert!(!SourceKind::Local.gated());
    }

    #[test]
    fn empty_chain_unresolved() {
        assert_eq!(resolve(&[], true, &no_env), (false, None));
    }
}
```

- [ ] **Step 3: Run the resolver tests** — `cargo test -p tau-gateway --lib credentials::resolver_tests` → PASS (5 tests). `cargo build -p tau-gateway` clean.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/lib.rs gateway/src/credentials/mod.rs
git commit -m "feat(gateway): credential types + chain resolver (Env/Local)"
```

---

## Task 2: Credential store (two 0600 files, CRUD) + unit tests

**Files:** Modify `gateway/src/credentials/mod.rs` (append the store + its tests).

- [ ] **Step 1: Append the store to `gateway/src/credentials/mod.rs`** (after the `resolve` function, before `#[cfg(test)] mod resolver_tests`)

```rust
// ---- store: global per-gateway, two 0600 files under `data_root` ----

#[derive(Default, Serialize, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    backends: BTreeMap<String, BackendConfig>,
}

#[derive(Default, Serialize, Deserialize)]
struct BackendConfig {
    #[serde(default)]
    sources: Vec<SourceConfig>,
}

/// Serializes credential writes process-wide (one gateway → one `data_root`).
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// The credential store, bound to a gateway `data_root`. Reads are lock-free;
/// writes take `WRITE_LOCK` to serialize the read-modify-write of both files.
pub struct Credentials {
    data_root: PathBuf,
}

impl Credentials {
    pub fn new(data_root: PathBuf) -> Self {
        Self { data_root }
    }

    fn config_path(&self) -> PathBuf {
        self.data_root.join("credentials.toml")
    }
    fn secrets_path(&self) -> PathBuf {
        self.data_root.join("credentials.secrets.json")
    }

    fn read_config(&self) -> ConfigFile {
        std::fs::read_to_string(self.config_path())
            .ok()
            .and_then(|t| toml::from_str(&t).ok())
            .unwrap_or_default()
    }
    fn read_secrets(&self) -> BTreeMap<String, String> {
        std::fs::read_to_string(self.secrets_path())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }
    fn write_config(&self, c: &ConfigFile) -> std::io::Result<()> {
        std::fs::write(self.config_path(), toml::to_string_pretty(c).unwrap_or_default())?;
        set_0600(&self.config_path());
        Ok(())
    }
    fn write_secrets(&self, s: &BTreeMap<String, String>) -> std::io::Result<()> {
        std::fs::write(self.secrets_path(), serde_json::to_string_pretty(s).unwrap_or_default())?;
        set_0600(&self.secrets_path());
        Ok(())
    }

    fn status_for(
        &self,
        backend: &str,
        cfg: &BackendConfig,
        secrets: &BTreeMap<String, String>,
    ) -> BackendCredentialStatus {
        let has_local = secrets.contains_key(backend);
        let env_get = |k: &str| std::env::var(k).ok();
        let sources: Vec<SourceStatus> = cfg
            .sources
            .iter()
            .map(|s| SourceStatus {
                kind: s.kind,
                reference: s.reference.clone(),
                configured: source_configured(s, has_local, &env_get),
                gated: s.kind.gated(),
            })
            .collect();
        let (resolved, resolved_via) = resolve(&cfg.sources, has_local, &env_get);
        BackendCredentialStatus {
            backend: backend.to_string(),
            sources,
            resolved,
            resolved_via,
        }
    }

    /// Status for every configured backend (no secret values).
    pub fn status_all(&self) -> Vec<BackendCredentialStatus> {
        let cfg = self.read_config();
        let secrets = self.read_secrets();
        cfg.backends
            .iter()
            .map(|(name, bc)| self.status_for(name, bc, &secrets))
            .collect()
    }

    /// Set a backend's ordered sources (+ optional write-only Local value).
    /// `Err(msg)` → the caller maps to HTTP 422.
    pub fn put(
        &self,
        backend: &str,
        sources: Vec<SourceConfig>,
        local_value: Option<String>,
    ) -> Result<BackendCredentialStatus, String> {
        let mut seen = HashSet::new();
        for s in &sources {
            if s.kind.gated() {
                return Err(format!("source kind {:?} is gated in CR-1", s.kind));
            }
            if matches!(s.kind, SourceKind::Env)
                && s.reference.as_deref().unwrap_or("").is_empty()
            {
                return Err("env source requires a non-empty ref".to_string());
            }
            if !seen.insert(s.kind) {
                return Err("duplicate source kind".to_string());
            }
        }

        let _guard = WRITE_LOCK.lock().unwrap();
        let mut cfg = self.read_config();
        let mut secrets = self.read_secrets();
        let has_local_kind = sources.iter().any(|s| matches!(s.kind, SourceKind::Local));
        cfg.backends.insert(backend.to_string(), BackendConfig { sources });
        match (has_local_kind, local_value) {
            (true, Some(v)) => {
                secrets.insert(backend.to_string(), v);
            }
            (false, _) => {
                secrets.remove(backend);
            }
            (true, None) => {} // keep existing local value
        }
        self.write_config(&cfg).map_err(|e| e.to_string())?;
        self.write_secrets(&secrets).map_err(|e| e.to_string())?;
        Ok(self.status_for(backend, cfg.backends.get(backend).unwrap(), &secrets))
    }

    /// Remove a backend's config + secret.
    pub fn delete(&self, backend: &str) -> std::io::Result<()> {
        let _guard = WRITE_LOCK.lock().unwrap();
        let mut cfg = self.read_config();
        let mut secrets = self.read_secrets();
        cfg.backends.remove(backend);
        secrets.remove(backend);
        self.write_config(&cfg)?;
        self.write_secrets(&secrets)?;
        Ok(())
    }
}

#[cfg(unix)]
fn set_0600(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn set_0600(_path: &Path) {}
```

- [ ] **Step 2: Append store tests** at the very bottom of the file (after `mod resolver_tests`)

```rust
#[cfg(test)]
mod store_tests {
    use super::*;

    fn cfg(kind: SourceKind, r: Option<&str>) -> SourceConfig {
        SourceConfig { kind, reference: r.map(|s| s.to_string()) }
    }

    #[test]
    fn put_local_then_status_resolves_without_echoing_value() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        let st = c
            .put("anthropic", vec![cfg(SourceKind::Local, None)], Some("sk-secret".into()))
            .unwrap();
        assert!(st.resolved);
        assert_eq!(st.resolved_via, Some(SourceKind::Local));
        // the status carries no value
        let json = serde_json::to_string(&st).unwrap();
        assert!(!json.contains("sk-secret"));
        // status_all agrees
        let all = c.status_all();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].backend, "anthropic");
    }

    #[test]
    fn secrets_file_is_0600() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put("openai", vec![cfg(SourceKind::Local, None)], Some("v".into())).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("credentials.secrets.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn config_round_trips_and_delete_clears() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put(
            "anthropic",
            vec![cfg(SourceKind::Local, None), cfg(SourceKind::Env, Some("ANTHROPIC_API_KEY"))],
            Some("v".into()),
        )
        .unwrap();
        // a fresh handle reads the persisted config back
        let c2 = Credentials::new(dir.path().to_path_buf());
        let st = &c2.status_all()[0];
        assert_eq!(st.sources.len(), 2);
        assert_eq!(st.sources[0].kind, SourceKind::Local);
        assert_eq!(st.sources[1].reference.as_deref(), Some("ANTHROPIC_API_KEY"));
        c2.delete("anthropic").unwrap();
        assert!(c2.status_all().is_empty());
    }

    #[test]
    fn put_rejects_gated_and_duplicate_kinds() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        assert!(c.put("x", vec![cfg(SourceKind::Vault, Some("p"))], None).is_err());
        assert!(c
            .put("x", vec![cfg(SourceKind::Env, Some("A")), cfg(SourceKind::Env, Some("B"))], None)
            .is_err());
        assert!(c.put("x", vec![cfg(SourceKind::Env, None)], None).is_err()); // empty ref
    }

    #[test]
    fn dropping_local_source_clears_the_secret() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put("anthropic", vec![cfg(SourceKind::Local, None)], Some("v".into())).unwrap();
        // re-put with only an env source → local secret cleared, env unset → unresolved
        let st = c
            .put("anthropic", vec![cfg(SourceKind::Env, Some("DEFINITELY_UNSET_VAR_XZ"))], None)
            .unwrap();
        assert!(!st.resolved);
    }
}
```

- [ ] **Step 3: Run the store tests** — `cargo test -p tau-gateway --lib credentials::store_tests` → PASS (5 tests). `cargo test -p tau-gateway --lib credentials` runs all 10.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/credentials/mod.rs
git commit -m "feat(gateway): credential store (0600 config + secrets, CRUD)"
```

---

## Task 3: Registry accessor + global API routes + integration test + ts-rs + gate

**Files:** Modify `gateway/src/projects/mod.rs`, `gateway/src/api/mod.rs`; Create `gateway/src/api/credentials.rs`, `gateway/tests/credentials_api.rs`. Regenerated `web/src/types/*`.

- [ ] **Step 1: Add the registry accessor** — in `gateway/src/projects/mod.rs`, inside `impl ProjectRegistry` (anywhere; e.g. after `load`), add:

```rust
    /// The global credential store, bound to this gateway's data root.
    pub fn credentials(&self) -> crate::credentials::Credentials {
        crate::credentials::Credentials::new(self.0.data_root.clone())
    }
```

- [ ] **Step 2: Create `gateway/src/api/credentials.rs`**

```rust
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::credentials::{BackendCredentialStatus, SourceConfig};
use crate::projects::ProjectRegistry;

pub async fn list(State(reg): State<ProjectRegistry>) -> Json<Vec<BackendCredentialStatus>> {
    Json(reg.credentials().status_all())
}

#[derive(Deserialize)]
pub struct PutBody {
    pub sources: Vec<SourceConfig>,
    #[serde(default)]
    pub local_value: Option<String>,
}

pub async fn put(
    State(reg): State<ProjectRegistry>,
    Path(backend): Path<String>,
    Json(body): Json<PutBody>,
) -> Result<Json<BackendCredentialStatus>, (StatusCode, String)> {
    reg.credentials()
        .put(&backend, body.sources, body.local_value)
        .map(Json)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, e))
}

pub async fn remove(
    State(reg): State<ProjectRegistry>,
    Path(backend): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    reg.credentials()
        .delete(&backend)
        .map(|_| Json(serde_json::json!({ "ok": true })))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
```

- [ ] **Step 3: Wire the module + routes in `gateway/src/api/mod.rs`**

(a) Add `put` to the routing import (currently `use axum::{routing::{delete, get, post}, Router};`):

```rust
use axum::{
    routing::{delete, get, post, put},
    Router,
};
```

(b) Add `pub mod credentials;` to the `api` module list (with the other `pub mod …;` at the top of `api/mod.rs` — alphabetical, e.g. after `pub mod config;` / `pub mod checks;`; match the existing ordering).

(c) Add the two **top-level** (non-scoped) routes to the outer `Router::new()` (the one with `/api/projects`, NOT the `scoped` one) — before `.with_state(reg)`:

```rust
        .route("/api/credentials", get(credentials::list))
        .route(
            "/api/credentials/:backend",
            put(credentials::put).delete(credentials::remove),
        )
```

- [ ] **Step 4: Create the integration test `gateway/tests/credentials_api.rs`**

```rust
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
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
async fn credentials_crud_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // PUT a Local source with a value → resolves via local, no value echoed
    let put = http
        .put(format!("{base}/api/credentials/anthropic"))
        .json(&serde_json::json!({ "sources": [{ "kind": "local" }], "local_value": "sk-test" }))
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), reqwest::StatusCode::OK);
    let st: serde_json::Value = put.json().await.unwrap();
    assert_eq!(st["resolved"], true);
    assert_eq!(st["resolved_via"], "local");
    assert!(!serde_json::to_string(&st).unwrap().contains("sk-test"));

    // GET list shows it, still no value
    let list: serde_json::Value = http
        .get(format!("{base}/api/credentials"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let a = list
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["backend"] == "anthropic")
        .unwrap();
    assert_eq!(a["resolved_via"], "local");
    assert!(!serde_json::to_string(&list).unwrap().contains("sk-test"));

    // env source with an unset var → not configured
    let st2: serde_json::Value = http
        .put(format!("{base}/api/credentials/openai"))
        .json(&serde_json::json!({ "sources": [{ "kind": "env", "ref": "TAU_UNSET_VAR_QWZ" }] }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(st2["resolved"], false);
    assert_eq!(st2["sources"][0]["gated"], false);

    // gated kind → 422
    let gated = http
        .put(format!("{base}/api/credentials/x"))
        .json(&serde_json::json!({ "sources": [{ "kind": "vault", "ref": "secret/x" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(gated.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);

    // DELETE clears
    let del = http
        .delete(format!("{base}/api/credentials/anthropic"))
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), reqwest::StatusCode::OK);
    let list2: serde_json::Value = http
        .get(format!("{base}/api/credentials"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(list2.as_array().unwrap().iter().all(|c| c["backend"] != "anthropic"));
}
```

- [ ] **Step 5: Build mock + run tests (regenerates ts-rs) + verify bindings**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS (lib `credentials` 10, `credentials_api` 1, plus existing). Confirm `git status --porcelain fixtures/demo` is empty.
Run: `cat web/src/types/SourceKind.ts web/src/types/SourceConfig.ts web/src/types/BackendCredentialStatus.ts` → `SourceKind` is a union incl. `"env" | "local" | …`; `SourceConfig` has `kind` + `ref: string | null`; `BackendCredentialStatus` has `backend, sources, resolved, resolved_via`.

- [ ] **Step 6: Rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green (run `cargo fmt --all` first if needed; fix any clippy warning in the new code).

- [ ] **Step 7: Commit**

```bash
git add gateway/src/projects/mod.rs gateway/src/api/credentials.rs gateway/src/api/mod.rs gateway/tests/credentials_api.rs web/src/types
git commit -m "feat(gateway): global /api/credentials routes + integration test + TS bindings"
```

---

## Task 4: Frontend — credentials API client + CredentialChainEditor + test

**Files:** Create `web/src/api/credentials.ts`, `web/src/providers/CredentialChainEditor.tsx`, `web/src/providers/CredentialChainEditor.test.tsx`.

- [ ] **Step 1: Create `web/src/api/credentials.ts`** (global path — NOT `scopedPath`)

```ts
import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import type { SourceConfig } from "../types/SourceConfig";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Credentials are per-machine (global), so these hit /api/credentials directly,
// not the project-scoped path.
export const getCredentials = () =>
  fetch("/api/credentials").then(json<BackendCredentialStatus[]>);

export const putCredential = (
  backend: string,
  body: { sources: SourceConfig[]; local_value?: string },
) =>
  fetch(`/api/credentials/${backend}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<BackendCredentialStatus>);

export const deleteCredential = (backend: string) =>
  fetch(`/api/credentials/${backend}`, { method: "DELETE" }).then(json<{ ok: boolean }>);
```

- [ ] **Step 2: Write the failing test `web/src/providers/CredentialChainEditor.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CredentialChainEditor } from "./CredentialChainEditor";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          backend: "anthropic",
          sources: [{ kind: "local", ref: null, configured: true, gated: false }],
          resolved: true,
          resolved_via: "local",
        }),
        text: async () => "",
      }),
    ),
  );
});

describe("CredentialChainEditor", () => {
  it("adds a Local source, captures a write-only value, and PUTs it", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.type(screen.getByLabelText("local secret value"), "sk-demo");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
      .mock.calls;
    const putCall = calls.find(([u, o]) => u.includes("/api/credentials/anthropic") && o?.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall![1]!.body as string);
    expect(body.sources).toEqual([{ kind: "local", ref: null }]);
    expect(body.local_value).toBe("sk-demo");
  });

  it("disables gated source kinds in the add menu", () => {
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: "Env" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Local" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Vault" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Token broker" })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `cd web && npx vitest run src/providers/CredentialChainEditor.test.tsx` → FAIL (no module).

- [ ] **Step 4: Create `web/src/providers/CredentialChainEditor.tsx`**

```tsx
import { useState } from "react";
import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import type { SourceConfig } from "../types/SourceConfig";
import type { SourceKind } from "../types/SourceKind";
import { putCredential } from "../api/credentials";

const KIND_LABEL: Record<SourceKind, string> = {
  env: "Env",
  local: "Local",
  vault: "Vault",
  aws_kv: "AWS KV",
  gcp_kv: "GCP KV",
  azure_kv: "Azure KV",
  token_broker: "Token broker",
  workload_identity: "Workload identity",
};
const REAL_KINDS: SourceKind[] = ["env", "local"];
const GATED_KINDS: SourceKind[] = [
  "vault",
  "aws_kv",
  "gcp_kv",
  "azure_kv",
  "token_broker",
  "workload_identity",
];

interface Row {
  kind: SourceKind;
  ref: string;
}

export function CredentialChainEditor({
  backend,
  status,
  onSaved,
}: {
  backend: string;
  status?: BackendCredentialStatus;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    (status?.sources ?? []).map((s) => ({ kind: s.kind, ref: s.ref ?? "" })),
  );
  const [localValue, setLocalValue] = useState("");
  const [error, setError] = useState("");
  const hasLocal = rows.some((r) => r.kind === "local");
  const used = new Set(rows.map((r) => r.kind));

  const add = (kind: SourceKind) => setRows((rs) => [...rs, { kind, ref: "" }]);
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const setRef = (i: number, ref: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ref } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  async function save() {
    setError("");
    const sources: SourceConfig[] = rows.map((r) => ({
      kind: r.kind,
      ref: r.kind === "env" ? r.ref : null,
    }));
    try {
      await putCredential(backend, {
        sources,
        ...(hasLocal && localValue ? { local_value: localValue } : {}),
      });
      setLocalValue("");
      onSaved();
    } catch (e) {
      setError(String(e));
    }
  }

  const chip = "rounded border px-1.5 py-0.5 text-[10px]";
  const field = "rounded border border-border bg-surface px-1.5 py-0.5 text-[11px]";

  return (
    <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
      <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-accent">
        credential chain — {backend}
      </div>

      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={`${r.kind}-${i}`} className="flex items-center gap-2">
            <div className="flex flex-col">
              <button
                type="button"
                aria-label={`move ${KIND_LABEL[r.kind]} up`}
                onClick={() => move(i, -1)}
                className="text-[8px] text-muted hover:text-fg"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`move ${KIND_LABEL[r.kind]} down`}
                onClick={() => move(i, 1)}
                className="text-[8px] text-muted hover:text-fg"
              >
                ▼
              </button>
            </div>
            <span className={`${chip} border-accent/40 text-accent`}>{KIND_LABEL[r.kind]}</span>
            {r.kind === "env" ? (
              <input
                aria-label={`env var name ${i}`}
                placeholder="ANTHROPIC_API_KEY"
                value={r.ref}
                onChange={(e) => setRef(i, e.target.value)}
                className={`flex-1 font-mono ${field}`}
              />
            ) : (
              <span className="flex-1 text-[10px] text-muted">resolves from the local store</span>
            )}
            <button
              type="button"
              aria-label={`remove ${KIND_LABEL[r.kind]}`}
              onClick={() => remove(i)}
              className="text-xs text-muted hover:text-st-error"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {hasLocal && (
        <div className="mt-2">
          <label className="block text-[10px] text-muted">
            local secret value (write-only)
            <input
              type="password"
              aria-label="local secret value"
              placeholder={status?.sources.some((s) => s.kind === "local" && s.configured) ? "•••••• (set — type to replace)" : "paste the key"}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              className={`mt-0.5 w-full font-mono ${field}`}
            />
          </label>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-[9px] uppercase text-muted">add source</span>
        {REAL_KINDS.filter((k) => !used.has(k)).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
          >
            {KIND_LABEL[k]}
          </button>
        ))}
        {GATED_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            disabled
            title="waits on CR-2 / CR-3"
            className="cursor-not-allowed rounded border border-border px-1.5 py-0.5 text-[10px] text-muted opacity-60"
          >
            🔒 {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {error && <div className="mt-2 text-[10px] text-st-error">{error}</div>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg"
        >
          Save
        </button>
        {status &&
          (status.resolved ? (
            <span className="text-[10px] text-st-ok">✓ resolves via {status.resolved_via}</span>
          ) : (
            <span className="text-[10px] text-muted">🔒 unresolved</span>
          ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes** — `cd web && npx vitest run src/providers/CredentialChainEditor.test.tsx` → PASS (2 tests). `pnpm typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/credentials.ts web/src/providers/CredentialChainEditor.tsx web/src/providers/CredentialChainEditor.test.tsx
git commit -m "feat(web): credentials API client + credential chain editor"
```

---

## Task 5: Providers screen — status join + inline-expand editor + test

**Files:** Modify `web/src/providers/ProvidersPage.tsx`, `web/src/providers/ProvidersPage.test.tsx`.

- [ ] **Step 1: Rewrite `web/src/providers/ProvidersPage.tsx`** (join credential status, replace the gated button with a status badge + inline-expand editor)

```tsx
import { Fragment, useEffect, useState } from "react";
import type { Provider } from "../types/Provider";
import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import { getProviders } from "../api/providers";
import { installPackage } from "../api/config";
import { getCredentials } from "../api/credentials";
import { CredentialChainEditor } from "./CredentialChainEditor";

export function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [creds, setCreds] = useState<Record<string, BackendCredentialStatus>>({});
  const [url, setUrl] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const reloadProviders = () =>
    getProviders()
      .then(setProviders)
      .catch(() => {});
  const reloadCreds = () =>
    getCredentials()
      .then((cs) => setCreds(Object.fromEntries(cs.map((c) => [c.backend, c]))))
      .catch(() => {});
  useEffect(() => {
    reloadProviders();
    reloadCreds();
  }, []);

  async function onAdd() {
    if (!url.trim()) return;
    await installPackage(url).catch(() => {});
    setUrl("");
    reloadProviders();
  }

  const btn = "rounded-md px-2.5 py-1 text-xs font-medium";
  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const badge = "rounded px-1.5 py-0.5 text-[10px] font-medium";

  function credBadge(name: string) {
    const c = creds[name];
    if (c?.resolved) {
      return (
        <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ via {c.resolved_via}</span>
      );
    }
    return <span className={`${badge} bg-amber-100 text-amber-800`}>🔒 none</span>;
  }

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Providers</h2>
      <p className="max-w-2xl text-xs text-muted">
        LLM backends available to this project&apos;s agents. The <b>recommended</b> one is the
        most-used backend across your agents. Credentials are <b>per machine</b> and resolve through
        an ordered source chain (first that resolves wins).
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <input
          aria-label="add provider git url"
          placeholder="https://github.com/org/llm-backend.git"
          className={`min-w-0 flex-1 ${input}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={onAdd} className={`${btn} bg-accent text-accent-fg`}>
          Add provider
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-3 py-2 font-medium">provider</th>
              <th className="px-3 py-2 font-medium">source</th>
              <th className="px-3 py-2 font-medium">installed</th>
              <th className="px-3 py-2 font-medium">recommended</th>
              <th className="px-3 py-2 font-medium">credential</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <Fragment key={p.name}>
                <tr className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted">{p.source}</td>
                  <td className="px-3 py-2">
                    {p.installed ? (
                      <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ installed</span>
                    ) : (
                      <span className="text-[10px] text-muted">not installed</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.recommended && (
                      <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ recommended</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {credBadge(p.name)}
                      <button
                        type="button"
                        onClick={() => setExpanded((cur) => (cur === p.name ? null : p.name))}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:text-fg"
                      >
                        {expanded === p.name ? "close" : "set credential"}
                      </button>
                    </span>
                  </td>
                </tr>
                {expanded === p.name && (
                  <tr className="border-b border-border/60 bg-accent/5">
                    <td colSpan={5} className="px-3 py-3">
                      <CredentialChainEditor
                        backend={p.name}
                        status={creds[p.name]}
                        onSaved={() => {
                          reloadCreds();
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `web/src/providers/ProvidersPage.test.tsx`**

The pre-existing tests asserted a disabled "Set API key" button (removed) — update them. Replace the file's body with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProvidersPage } from "./ProvidersPage";

const providers = [
  { name: "anthropic", installed: true, recommended: true, source: "well-known", credentials_gated: true },
  { name: "openai", installed: false, recommended: false, source: "well-known", credentials_gated: true },
];
const credentials = [
  {
    backend: "anthropic",
    sources: [{ kind: "local", ref: null, configured: true, gated: false }],
    resolved: true,
    resolved_via: "local",
  },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/api/credentials"))
        return Promise.resolve({ ok: true, json: async () => credentials, text: async () => "" });
      if (url.includes("/providers"))
        return Promise.resolve({ ok: true, json: async () => providers, text: async () => "" });
      if (url.includes("/packages/install"))
        return Promise.resolve({ ok: true, json: async () => ({ package: { name: "added" } }), text: async () => "" });
      return Promise.resolve({ ok: true, json: async () => ({}), text: async () => "" });
    }),
  );
});

describe("ProvidersPage", () => {
  it("renders providers with their credential status badge", async () => {
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    expect(screen.getByText("✓ via local")).toBeInTheDocument(); // anthropic resolved
    expect(screen.getByText("🔒 none")).toBeInTheDocument(); // openai unconfigured
  });

  it("expands a row into the credential chain editor", async () => {
    const user = userEvent.setup();
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    // each row has a "set credential" toggle; open anthropic's
    await user.click(screen.getAllByRole("button", { name: "set credential" })[0]);
    expect(screen.getByText(/credential chain — anthropic/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Local" })).toBeInTheDocument();
  });

  it("Add provider posts an install", async () => {
    const user = userEvent.setup();
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    await user.type(screen.getByLabelText("add provider git url"), "https://github.com/org/llm.git");
    await user.click(screen.getByRole("button", { name: "Add provider" }));
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
        .mock.calls;
      expect(calls.some(([u, o]) => u.includes("/packages/install") && o?.method === "POST")).toBe(true);
    });
  });
});
```

- [ ] **Step 3: Run + typecheck** — `cd web && npx vitest run src/providers/ && pnpm typecheck` → green (3 ProvidersPage + 2 editor tests).

- [ ] **Step 4: Commit**

```bash
git add web/src/providers/ProvidersPage.tsx web/src/providers/ProvidersPage.test.tsx
git commit -m "feat(web): providers screen credential status + inline chain editor"
```

---

## Task 6: E2e + final gate

**Files:** Modify `web/e2e/run.spec.ts`.

- [ ] **Step 1: Read `web/e2e/run.spec.ts`** for conventions, then append a top-level `test(...)`:

```ts
test("providers: set a Local credential via the inline chain editor", async ({ page }) => {
  await page.goto("/projects/demo/providers");
  const row = page.getByRole("row").filter({ hasText: "anthropic" });
  await expect(row).toBeVisible({ timeout: 5000 });
  // open the chain editor for anthropic
  await row.getByRole("button", { name: "set credential" }).click();
  await expect(page.getByText(/credential chain — anthropic/i)).toBeVisible();
  // a gated source is disabled
  await expect(page.getByRole("button", { name: /🔒 Vault/ })).toBeDisabled();
  // add a Local source, type a value, save
  await page.getByRole("button", { name: "Local" }).click();
  await page.getByLabel("local secret value").fill("sk-demo");
  await page.getByRole("button", { name: /^save$/i }).click();
  // the row badge flips to "✓ via local"
  await expect(row.getByText(/✓ via local/i)).toBeVisible();
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. `web/playwright.config.ts` auto-starts the servers (`reuseExistingServer: !CI`). REAL ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; if not permitted, `pnpm exec playwright test --list` to confirm parse + note e2e deferred to CI, then proceed with Steps 3–5 (unit gate must be green).

**Note — e2e writes a real credential** into the gateway's data dir (the dev `data_root`, NOT the repo). This is a per-machine store outside `fixtures/`, so it does not dirty `fixtures/demo`. (If you want a clean slate afterward, the dev gateway's `credentials.*` files live under its data root, e.g. `~/.tau-ui/` or the configured `--data-dir`; leaving the demo `anthropic` credential set is harmless.)

- [ ] **Step 3: Restore fixtures** (mandatory even if e2e fails)

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm format && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green. (Run `pnpm format` FIRST — new files from Tasks 4–5 may not be prettier-clean; include the formatting in the commit.)

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (check git status)
git commit -m "test(web): e2e set a Local credential via the chain editor"
```

---

## Self-Review

**Spec coverage** (`2026-06-09-credentials-chain-cr1-design.md`):
- §3.1 types (`SourceKind`/`SourceConfig`/`SourceStatus`/`BackendCredentialStatus`) → Task 1. §3.3 resolver (`source_configured`/`resolve`, injectable env, first-match) → Task 1. ✓
- §3.2 two-file 0600 store; at-most-one-kind; local keyed by backend; drop-local-clears-secret → Task 2. §3.4 `Mutex`-guarded writes + `ProjectRegistry::credentials()` → Tasks 2–3. ✓
- §4 global routes `GET /api/credentials`, `PUT/DELETE /:backend`, 422 validation, never-echo → Task 3 (+ integration test). ✓
- §3.1 ts-rs export → Task 3 Step 5. ✓
- §5.1 global `credentials.ts` client → Task 4. §5.3 `CredentialChainEditor` (ordered rows, reorder, Env ref, Local masked write-only, gated disabled, Save, resolve line) → Task 4. §5.2 Providers join + status badge + inline expand → Task 5. ✓
- §6 tests: resolver/store units (Tasks 1–2), integration without env mutation (Task 3), editor + page (Tasks 4–5), e2e + security (no value echoed: asserted in Task 3 integration; 0600: Task 2) → covered. ✓

**Placeholder scan:** none.

**Type consistency:** Rust `SourceConfig { kind: SourceKind, reference: Option<String> }` with `#[serde(rename="ref")]`/`#[ts(rename="ref")]` ⇒ ts-rs `SourceConfig { kind, ref: string | null }` ⇒ the editor builds `{ kind, ref: kind==="env" ? r.ref : null }` and the resolver/store read `.reference`. `SourceKind` snake_case union (`env`/`local`/`vault`/`aws_kv`/`gcp_kv`/`azure_kv`/`token_broker`/`workload_identity`) is used identically in `KIND_LABEL`, `REAL_KINDS`, `GATED_KINDS`, and `resolved_via`. `BackendCredentialStatus { backend, sources: SourceStatus[], resolved, resolved_via }` is consistent across the gateway status, the `getCredentials` client, the editor `status` prop, and the ProvidersPage `creds` map. `putCredential(backend, { sources, local_value? })` matches the `PutBody { sources, local_value }` handler. Routes are global (`/api/credentials`), not `scopedPath` — matched in `credentials.ts` and the e2e/integration tests.

**Note for executor:** the credential store writes to the gateway `data_root` (per machine), never `fixtures/` — so `git status --porcelain fixtures/demo` stays clean. The `ref` JSON key comes from `#[serde(rename="ref")]` (Rust field is `reference`); verify the regenerated `web/src/types/SourceConfig.ts` shows `ref` (Task 3 Step 5). The old Providers "🔒 Set API key" disabled button is replaced by the status badge + "set credential" toggle; the pre-existing ProvidersPage tests are rewritten in Task 5 Step 2.
