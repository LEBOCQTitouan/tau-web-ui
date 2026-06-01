# Agents Authoring — Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the gateway to read, create/update, and delete full `[agents.<id>]` tables in a project's `tau.toml` (display_name, package, llm_backend, prompt, requires.tools), exposed as scoped agent CRUD endpoints with ts-rs types.

**Architecture:** New `AgentDetail`/`AgentPrompt`/`RequiredToolSpec` types in `config/mod.rs`; `read_agent`/`list_agents`/`write_agent`/`delete_agent` over `toml_edit` (preserving the rest of the file); `write_agent` replaces the narrow `add_agent` and becomes the single writer (community-import re-points to it). Thin `AppState` wrappers + scoped routes under `/api/projects/:pid/agents`.

**Tech Stack:** Rust, axum 0.7, serde, ts-rs, toml + toml_edit, reqwest (dev). Mock mode unchanged — config read/write is real `tau.toml` editing in all modes.

This is **Plan 1 of 2** for Agents authoring (see `docs/superpowers/specs/2026-06-01-agents-authoring-design.md`). Plan 2 (frontend) builds on this API.

---

## File Structure

**Modified:**
- `gateway/src/config/mod.rs` — add the three types + `read_agent`/`list_agents`/`write_agent`/`delete_agent`; remove `add_agent`.
- `gateway/src/state.rs` — `AppState` wrappers `list_agents`/`read_agent`/`write_agent`/`delete_agent`; re-point `import_agent` to `write_agent`.
- `gateway/src/api/agents.rs` — add `list`/`get_one`/`put`/`remove` handlers (keep `import`); a `valid_agent_id` helper.
- `gateway/src/api/mod.rs` — add the `/agents` + `/agents/:id` scoped routes.

**New test file:**
- `gateway/tests/agents_api.rs` — router-level CRUD (reqwest), mirroring `tests/projects_api.rs`.

---

## Task 1: Agent types + `read_agent`/`list_agents`

**Files:**
- Modify: `gateway/src/config/mod.rs`

- [ ] **Step 1: Add the types**

At the top of `gateway/src/config/mod.rs`, after the existing `ProjectConfig` struct (around line 26), add:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentPrompt {
    pub system: Option<String>,
    pub system_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RequiredToolSpec {
    pub name: String,
    pub source: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentDetail {
    pub id: String,
    pub display_name: Option<String>,
    pub package: Option<String>,
    pub llm_backend: Option<String>,
    pub prompt: AgentPrompt,
    pub requires_tools: Vec<RequiredToolSpec>,
}
```

- [ ] **Step 2: Add the parse helper + `read_agent` + `list_agents`**

Add to `gateway/src/config/mod.rs` (after the existing `read` function):

```rust
/// Build an `AgentDetail` from a parsed `[agents.<id>]` toml value.
fn parse_agent(id: &str, a: &toml::Value) -> AgentDetail {
    let str_field = |k: &str| a.get(k).and_then(|v| v.as_str()).map(String::from);
    let prompt = a
        .get("prompt")
        .map(|p| AgentPrompt {
            system: p.get("system").and_then(|v| v.as_str()).map(String::from),
            system_file: p.get("system_file").and_then(|v| v.as_str()).map(String::from),
        })
        .unwrap_or_default();
    let requires_tools = a
        .get("requires")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    Some(RequiredToolSpec {
                        name: t.get("name")?.as_str()?.to_string(),
                        source: t.get("source")?.as_str()?.to_string(),
                        version: t.get("version").and_then(|v| v.as_str()).map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    AgentDetail {
        id: id.to_string(),
        display_name: str_field("display_name"),
        package: str_field("package"),
        llm_backend: str_field("llm_backend"),
        prompt,
        requires_tools,
    }
}

/// Read one agent's full detail (None if the `[agents.<id>]` table is absent).
pub fn read_agent(project: &Path, id: &str) -> Result<Option<AgentDetail>> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    let doc: toml::Value = toml::from_str(&text).context("parse tau.toml")?;
    Ok(doc
        .get("agents")
        .and_then(|x| x.get(id))
        .map(|a| parse_agent(id, a)))
}

/// All agents (full detail), sorted by id.
pub fn list_agents(project: &Path) -> Result<Vec<AgentDetail>> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    let doc: toml::Value = toml::from_str(&text).context("parse tau.toml")?;
    let mut out = vec![];
    if let Some(tbl) = doc.get("agents").and_then(|a| a.as_table()) {
        for (id, a) in tbl {
            out.push(parse_agent(id, a));
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}
```

- [ ] **Step 3: Write the failing test**

In the `#[cfg(test)] mod tests` block at the bottom of `gateway/src/config/mod.rs`, add a richer fixture writer + tests:

```rust
    fn write_full_fixture(dir: &Path) {
        std::fs::write(
            dir.join("tau.toml"),
            r#"[project]
name = "demo"

[agents.researcher]
display_name = "Researcher"
package = "fs-read@^0.1"
llm_backend = "anthropic"

[agents.researcher.prompt]
system = "you are a researcher"

[[agents.researcher.requires.tools]]
name = "fs-read"
source = "https://example.com/fs-read.git"
version = "^0.1"
"#,
        )
        .unwrap();
    }

    #[test]
    fn reads_full_agent_detail() {
        let d = tempfile::tempdir().unwrap();
        write_full_fixture(d.path());
        let a = read_agent(d.path(), "researcher").unwrap().unwrap();
        assert_eq!(a.display_name.as_deref(), Some("Researcher"));
        assert_eq!(a.package.as_deref(), Some("fs-read@^0.1"));
        assert_eq!(a.prompt.system.as_deref(), Some("you are a researcher"));
        assert_eq!(a.requires_tools.len(), 1);
        assert_eq!(a.requires_tools[0].name, "fs-read");
        assert_eq!(a.requires_tools[0].version.as_deref(), Some("^0.1"));
        assert!(read_agent(d.path(), "ghost").unwrap().is_none());
    }

    #[test]
    fn lists_agents_sorted() {
        let d = tempfile::tempdir().unwrap();
        write_full_fixture(d.path());
        let list = list_agents(d.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "researcher");
    }
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p tau-gateway --lib config::tests::reads_full_agent_detail config::tests::lists_agents_sorted`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/config/mod.rs
git commit -m "feat(gateway): AgentDetail types + read_agent/list_agents"
```

---

## Task 2: `write_agent` (toml_edit upsert)

**Files:**
- Modify: `gateway/src/config/mod.rs`

- [ ] **Step 1: Add `write_agent` and remove `add_agent`**

Replace the existing `add_agent` function in `gateway/src/config/mod.rs` with `write_agent`:

```rust
fn set_or_remove(tbl: &mut toml_edit::Table, key: &str, val: &Option<String>) {
    match val.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => {
            tbl[key] = toml_edit::value(s);
        }
        None => {
            tbl.remove(key);
        }
    }
}

/// Upsert a full `[agents.<id>]` table, preserving everything else in the file.
/// Raw write with NO existence check — the create-time 409 guard lives in the
/// API layer.
pub fn write_agent(project: &Path, agent: &AgentDetail) -> Result<()> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml_edit::DocumentMut = text.parse().context("parse tau.toml")?;

    if !doc.contains_key("agents") {
        doc["agents"] = toml_edit::table();
    }
    let agents = doc["agents"].as_table_mut().context("agents not a table")?;
    if !agents.contains_key(&agent.id) {
        agents[&agent.id] = toml_edit::table();
    }
    let at = agents[&agent.id]
        .as_table_mut()
        .context("agent entry not a table")?;

    set_or_remove(at, "display_name", &agent.display_name);
    set_or_remove(at, "package", &agent.package);
    set_or_remove(at, "llm_backend", &agent.llm_backend);

    // prompt: at most one of system / system_file
    match (
        agent.prompt.system.as_deref().filter(|s| !s.is_empty()),
        agent.prompt.system_file.as_deref().filter(|s| !s.is_empty()),
    ) {
        (Some(s), _) => {
            at["prompt"] = toml_edit::table();
            at["prompt"]["system"] = toml_edit::value(s);
        }
        (None, Some(f)) => {
            at["prompt"] = toml_edit::table();
            at["prompt"]["system_file"] = toml_edit::value(f);
        }
        (None, None) => {
            at.remove("prompt");
        }
    }

    // requires.tools: rewrite the array-of-tables (remove when empty)
    if agent.requires_tools.is_empty() {
        at.remove("requires");
    } else {
        let mut aot = toml_edit::ArrayOfTables::new();
        for t in &agent.requires_tools {
            let mut tt = toml_edit::Table::new();
            tt["name"] = toml_edit::value(t.name.as_str());
            tt["source"] = toml_edit::value(t.source.as_str());
            if let Some(v) = t.version.as_deref().filter(|s| !s.is_empty()) {
                tt["version"] = toml_edit::value(v);
            }
            aot.push(tt);
        }
        at["requires"] = toml_edit::table();
        at["requires"]["tools"] = toml_edit::Item::ArrayOfTables(aot);
    }

    std::fs::write(&path, doc.to_string()).with_context(|| format!("write {path:?}"))?;
    Ok(())
}
```

- [ ] **Step 2: Write the failing tests**

Add to the `tests` module in `gateway/src/config/mod.rs`:

```rust
    #[test]
    fn write_agent_roundtrips_and_preserves() {
        let d = tempfile::tempdir().unwrap();
        write_full_fixture(d.path());
        // add a brand-new agent, leaving researcher + [project] intact
        let agent = AgentDetail {
            id: "writer".into(),
            display_name: Some("Writer".into()),
            package: Some("critic@^0.1".into()),
            llm_backend: Some("anthropic".into()),
            prompt: AgentPrompt {
                system: Some("you are a writer".into()),
                system_file: None,
            },
            requires_tools: vec![RequiredToolSpec {
                name: "web-search".into(),
                source: "https://example.com/web.git".into(),
                version: None,
            }],
        };
        write_agent(d.path(), &agent).unwrap();

        let back = read_agent(d.path(), "writer").unwrap().unwrap();
        assert_eq!(back.display_name.as_deref(), Some("Writer"));
        assert_eq!(back.prompt.system.as_deref(), Some("you are a writer"));
        assert_eq!(back.requires_tools.len(), 1);
        assert_eq!(back.requires_tools[0].name, "web-search");
        assert!(back.requires_tools[0].version.is_none());
        // preserved
        assert_eq!(read(d.path()).unwrap().name, "demo");
        assert!(read_agent(d.path(), "researcher").unwrap().is_some());
    }

    #[test]
    fn write_agent_toggles_prompt_and_clears_tools() {
        let d = tempfile::tempdir().unwrap();
        write_full_fixture(d.path());
        // update researcher: switch to system_file, drop required tools
        let mut a = read_agent(d.path(), "researcher").unwrap().unwrap();
        a.prompt = AgentPrompt {
            system: None,
            system_file: Some("agents/researcher.md".into()),
        };
        a.requires_tools = vec![];
        write_agent(d.path(), &a).unwrap();

        let back = read_agent(d.path(), "researcher").unwrap().unwrap();
        assert!(back.prompt.system.is_none());
        assert_eq!(back.prompt.system_file.as_deref(), Some("agents/researcher.md"));
        assert!(back.requires_tools.is_empty());
    }
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p tau-gateway --lib config::tests::write_agent`
Expected: PASS (2 tests). Note: the crate will NOT fully build until Task 4 re-points the `add_agent` caller (`state.rs::import_agent`). If `cargo test` reports an unresolved `add_agent` reference in `state.rs`, that is expected — proceed; Tasks 2–4 are committed in sequence but the build goes green at Task 4. To run JUST these unit tests now, they live in the lib; if the lib fails to compile because of the dangling `add_agent` call, temporarily comment that call is NOT allowed — instead do Task 3 and Task 4 before running. **Reorder note:** complete Task 4 Step 1 (re-point `import_agent`) before running this step's tests if the build breaks.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/config/mod.rs
git commit -m "feat(gateway): write_agent upsert via toml_edit (replaces add_agent)"
```

---

## Task 3: `delete_agent`

**Files:**
- Modify: `gateway/src/config/mod.rs`

- [ ] **Step 1: Add `delete_agent`**

Add to `gateway/src/config/mod.rs`:

```rust
/// Remove the `[agents.<id>]` table (and sub-tables). Returns false if absent.
pub fn delete_agent(project: &Path, id: &str) -> Result<bool> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml_edit::DocumentMut = text.parse().context("parse tau.toml")?;
    let present = doc
        .get("agents")
        .and_then(|a| a.as_table())
        .map(|t| t.contains_key(id))
        .unwrap_or(false);
    if present {
        if let Some(at) = doc["agents"].as_table_mut() {
            at.remove(id);
        }
        std::fs::write(&path, doc.to_string()).with_context(|| format!("write {path:?}"))?;
    }
    Ok(present)
}
```

- [ ] **Step 2: Write the failing test**

Add to the `tests` module:

```rust
    #[test]
    fn delete_agent_removes_table() {
        let d = tempfile::tempdir().unwrap();
        write_full_fixture(d.path());
        assert!(delete_agent(d.path(), "researcher").unwrap());
        assert!(read_agent(d.path(), "researcher").unwrap().is_none());
        assert!(!delete_agent(d.path(), "researcher").unwrap());
        // [project] preserved
        assert_eq!(read(d.path()).unwrap().name, "demo");
    }
```

- [ ] **Step 3: Run, then commit (after Task 4 makes the crate build)**

Run: `cargo test -p tau-gateway --lib config::tests::delete_agent_removes_table` (run after Task 4).
Expected: PASS.

```bash
git add gateway/src/config/mod.rs
git commit -m "feat(gateway): delete_agent"
```

---

## Task 4: `AppState` wrappers + re-point `import_agent`

**Files:**
- Modify: `gateway/src/state.rs`

- [ ] **Step 1: Re-point `import_agent` and add wrappers**

In `gateway/src/state.rs`, update the import at the top to pull the new types:

```rust
use crate::config::{self, AgentDetail};
```
(adjust the existing `use crate::config;` line to also bring in `AgentDetail`.)

Replace the body of `import_agent` (currently calls `config::add_agent`) with a `write_agent` call, and add the four wrappers. Find `import_agent` and replace it plus add the wrappers inside `impl AppState`:

```rust
    /// Import a community agent: install its package, then register `[agents.<id>]`.
    pub fn import_agent(&self, git_url: &str, llm_backend: &str) -> Result<String> {
        let id = name_from_url(git_url);
        let pkg = self.0.package_ops.install(git_url)?;
        let detail = AgentDetail {
            id: id.clone(),
            display_name: Some(id.clone()),
            package: Some(format!("{}@^{}", pkg.name, pkg.version)),
            llm_backend: Some(llm_backend.to_string()),
            prompt: config::AgentPrompt::default(),
            requires_tools: vec![],
        };
        config::write_agent(&self.0.project, &detail)?;
        Ok(id)
    }

    pub fn list_agents(&self) -> Result<Vec<AgentDetail>> {
        config::list_agents(&self.0.project)
    }

    pub fn read_agent(&self, id: &str) -> Result<Option<AgentDetail>> {
        config::read_agent(&self.0.project, id)
    }

    pub fn write_agent(&self, agent: &AgentDetail) -> Result<()> {
        config::write_agent(&self.0.project, agent)
    }

    pub fn delete_agent(&self, id: &str) -> Result<bool> {
        config::delete_agent(&self.0.project, id)
    }
```

Note: `name_from_url` is already imported in `state.rs` (used by the old `import_agent`). Keep that import.

- [ ] **Step 2: Build + run the config unit tests (now the crate compiles)**

Run: `cargo build -p tau-gateway && cargo test -p tau-gateway --lib config::tests`
Expected: PASS — all config tests including Task 2/3 ones.

- [ ] **Step 3: Run the existing import regression test**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test config_packages`
Expected: PASS (3 tests) — `import_agent_installs_and_registers` still passes (same resulting `tau.toml`).

- [ ] **Step 4: Commit (Tasks 2-4 build green together)**

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): AppState agent wrappers + import via write_agent"
```

---

## Task 5: API handlers + routes

**Files:**
- Modify: `gateway/src/api/agents.rs`
- Modify: `gateway/src/api/mod.rs`

- [ ] **Step 1: Add handlers to `gateway/src/api/agents.rs`**

Replace the entire `gateway/src/api/agents.rs` with (keeps `import`, adds the CRUD):

```rust
use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;
use crate::config::AgentDetail;

fn valid_agent_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub async fn list(Scoped(state): Scoped) -> Result<Json<Vec<AgentDetail>>, (StatusCode, String)> {
    state
        .list_agents()
        .map(Json)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn get_one(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Result<Json<AgentDetail>, (StatusCode, String)> {
    match state.read_agent(&id) {
        Ok(Some(a)) => Ok(Json(a)),
        Ok(None) => Err((StatusCode::NOT_FOUND, format!("unknown agent: {id}"))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct PutQuery {
    pub create: Option<String>,
}

pub async fn put(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
    Query(q): Query<PutQuery>,
    Json(mut body): Json<AgentDetail>,
) -> Result<Json<AgentDetail>, (StatusCode, String)> {
    if !valid_agent_id(&id) {
        return Err((StatusCode::BAD_REQUEST, format!("invalid agent id: {id}")));
    }
    if body.prompt.system.is_some() && body.prompt.system_file.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            "prompt: set at most one of system / system_file".to_string(),
        ));
    }
    let create = q.create.as_deref() == Some("1");
    if create {
        match state.read_agent(&id) {
            Ok(Some(_)) => {
                return Err((StatusCode::CONFLICT, format!("agent already exists: {id}")))
            }
            Err(e) => return Err((StatusCode::BAD_GATEWAY, e.to_string())),
            Ok(None) => {}
        }
    }
    body.id = id; // URL id is authoritative
    state
        .write_agent(&body)
        .map(|_| Json(body))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn remove(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    match state.delete_agent(&id) {
        Ok(true) => Ok(StatusCode::NO_CONTENT),
        Ok(false) => Err((StatusCode::NOT_FOUND, format!("unknown agent: {id}"))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct ImportBody {
    pub git_url: String,
    pub llm_backend: String,
}

pub async fn import(
    Scoped(state): Scoped,
    Json(b): Json<ImportBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .import_agent(&b.git_url, &b.llm_backend)
        .map(|id| Json(json!({ "agent_id": id })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
```

- [ ] **Step 2: Wire routes in `gateway/src/api/mod.rs`**

In the `scoped` router in `gateway/src/api/mod.rs`, replace the single agents route line:

```rust
        .route("/agents/import", post(agents::import))
```
with:
```rust
        .route("/agents", get(agents::list))
        .route("/agents/import", post(agents::import))
        .route(
            "/agents/:id",
            get(agents::get_one).put(agents::put).delete(agents::remove),
        )
```

(`/agents/import` is a static sibling of `/agents/:id` — matchit prioritizes the static segment, so `import` is never captured as an `:id`.)

- [ ] **Step 3: Build**

Run: `cargo build -p tau-gateway`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/api/agents.rs gateway/src/api/mod.rs
git commit -m "feat(gateway): scoped agent CRUD routes (list/get/put/delete)"
```

---

## Task 6: Router-level integration test

**Files:**
- Create: `gateway/tests/agents_api.rs`

- [ ] **Step 1: Write the test**

Create `gateway/tests/agents_api.rs`:

```rust
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

fn make_project() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("tau.toml"),
        "[project]\nname = \"demo\"\n\n[agents.greeter]\ndisplay_name = \"Greeter\"\nllm_backend = \"anthropic\"\n",
    )
    .unwrap();
    d
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
async fn agent_crud_over_http() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(proj.path()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // create
    let body = serde_json::json!({
        "id": "writer",
        "display_name": "Writer",
        "package": "critic@^0.1",
        "llm_backend": "anthropic",
        "prompt": { "system": "you are a writer", "system_file": null },
        "requires_tools": [{ "name": "web", "source": "https://x/web.git", "version": null }]
    });
    let created = http
        .put(format!("{base}/api/projects/demo/agents/writer?create=1"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), reqwest::StatusCode::OK);

    // duplicate create -> 409
    let dup = http
        .put(format!("{base}/api/projects/demo/agents/writer?create=1"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(dup.status(), reqwest::StatusCode::CONFLICT);

    // list shows greeter + writer
    let list: serde_json::Value = http
        .get(format!("{base}/api/projects/demo/agents"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list.as_array().unwrap().len(), 2);

    // get one
    let one: serde_json::Value = http
        .get(format!("{base}/api/projects/demo/agents/writer"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(one["prompt"]["system"], "you are a writer");

    // invalid id -> 400
    let bad = http
        .put(format!("{base}/api/projects/demo/agents/bad%20id"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);

    // delete -> 204 then 404
    let del = http
        .delete(format!("{base}/api/projects/demo/agents/writer"))
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), reqwest::StatusCode::NO_CONTENT);
    let del2 = http
        .delete(format!("{base}/api/projects/demo/agents/writer"))
        .send()
        .await
        .unwrap();
    assert_eq!(del2.status(), reqwest::StatusCode::NOT_FOUND);
}
```

- [ ] **Step 2: Run**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test agents_api`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add gateway/tests/agents_api.rs
git commit -m "test(gateway): agent CRUD router integration test"
```

---

## Task 7: ts-rs export + full gate

**Files:**
- Regenerated: `web/src/types/{AgentDetail,AgentPrompt,RequiredToolSpec}.ts`

- [ ] **Step 1: Regenerate bindings**

Run: `cargo test -p tau-gateway`
Expected: PASS; new files appear under `web/src/types/`.

- [ ] **Step 2: Verify types present**

Run: `ls web/src/types/ | grep -E "AgentDetail|AgentPrompt|RequiredToolSpec"`
Expected: `AgentDetail.ts`, `AgentPrompt.ts`, `RequiredToolSpec.ts`. `cat web/src/types/AgentDetail.ts` should reference `AgentPrompt` and `RequiredToolSpec`.

- [ ] **Step 3: Full rust gate (mirror CI)**

Run: `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway`
Expected: all green. Fix any fmt/clippy findings minimally (e.g. `cargo fmt --all`).

- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export agent TS bindings + fmt/clippy"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-agents-authoring-design.md`):
- §3 types → Task 1. §4.1 read_agent/list_agents → Task 1; write_agent (incl. prompt xor, requires.tools rewrite, preserve, clear) → Task 2; delete_agent → Task 3; replace add_agent + re-point import → Tasks 2 & 4. §4.2 API (GET list/one, PUT upsert with `?create=1` → 409, DELETE, 400 invalid id / both prompt fields) → Tasks 5 & 6. §4.3 ts-rs/CI → Task 7. All covered.

**Placeholder scan:** none — every step has complete code. (Task 2 Step 3 / Task 3 Step 3 carry an explicit ordering note that the crate compiles only after Task 4 re-points the `add_agent` caller; this is a sequencing instruction, not a placeholder.)

**Type consistency:** `AgentDetail { id, display_name, package, llm_backend, prompt: AgentPrompt{system, system_file}, requires_tools: Vec<RequiredToolSpec{name, source, version}> }` is identical across config functions, AppState wrappers, handlers, and the integration test. `write_agent`/`read_agent`/`list_agents`/`delete_agent` signatures match their callers in `state.rs` and `api/agents.rs`. The `?create=1` flag maps to `PutQuery{create: Option<String>}` and the frontend contract Plan 2 consumes.
