# Skills Authoring — Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose skill authoring in the gateway: list/read/create/update/delete **local** skills as real files under `<project>/skills/<name>/` (`SKILL.md` + `tau.toml` kind="skill"), plus list/import **installed** skills via a mock seam, behind scoped CRUD endpoints with ts-rs types.

**Architecture:** A new `skills` module: real file ops for local skills (frontmatter parse + `toml_edit`), an `InstalledSkills` trait (`MockInstalled`/`CliInstalled`) for installed skills, and compose functions. `AppState` wrappers + scoped routes under `/api/projects/:pid/skills`. Local skill CRUD is real (works in mock mode); the demo fixture is seeded with two local skills.

**Tech Stack:** Rust, axum 0.7, serde, ts-rs, toml + toml_edit, reqwest (dev). Mock keyed off the `--tau-bin` basename containing `fake-tau-serve`.

This is **Plan 1 of 2** for Skills authoring (see `docs/superpowers/specs/2026-06-01-skills-authoring-design.md`), itself sub-project #1 of the "Tools & Skills" surface. Plan 2 (frontend) builds on this API.

---

## File Structure

**New:**
- `gateway/src/skills/mod.rs` — types, frontmatter parse/render, local file ops, `InstalledSkills` seam, compose functions.
- `gateway/src/api/skills.rs` — scoped handlers.
- `fixtures/demo/skills/critic/{SKILL.md,tau.toml}` + `fixtures/demo/skills/fact-checker/{SKILL.md,tau.toml}` — seeded local skills.
- `gateway/tests/skills_api.rs` — router-level CRUD test.

**Modified:**
- `gateway/src/lib.rs` — `pub mod skills;`.
- `gateway/src/state.rs` — `installed_skills` field + `list_skills`/`read_skill`/`write_skill`/`delete_skill`/`import_skill` wrappers.
- `gateway/src/api/mod.rs` — `/skills` routes.

---

## Task 1: Types + module skeleton

**Files:**
- Create: `gateway/src/skills/mod.rs`
- Modify: `gateway/src/lib.rs`

- [ ] **Step 1: Add the module to lib.rs**

In `gateway/src/lib.rs`, add after `pub mod projects;`:

```rust
pub mod skills;
```

- [ ] **Step 2: Create `gateway/src/skills/mod.rs` with the types**

```rust
//! Skill authoring: local skills are real files under `<project>/skills/<name>/`
//! (SKILL.md + tau.toml kind="skill"); installed skills come from a seam.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Capability {
    pub kind: String,
    pub fields: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PackageDep {
    pub name: String,
    pub source: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SkillSummary {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub editable: bool,
    pub capability_kinds: Vec<String>,
    pub requires_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SkillDetail {
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub source: String,
    pub editable: bool,
    pub content: String,
    pub capabilities: Vec<Capability>,
    pub requires_tools: Vec<PackageDep>,
    pub requires_skills: Vec<PackageDep>,
}

/// `^[a-z0-9-]+$` and non-empty.
pub fn valid_skill_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}
```

- [ ] **Step 3: Build + commit**

Run: `cargo build -p tau-gateway`
Expected: compiles.

```bash
git add gateway/src/lib.rs gateway/src/skills/mod.rs
git commit -m "feat(gateway): skill types + module skeleton"
```

---

## Task 2: Frontmatter parse/render + local read/list + seeded fixtures

**Files:**
- Modify: `gateway/src/skills/mod.rs`
- Create: `fixtures/demo/skills/critic/{SKILL.md,tau.toml}`, `fixtures/demo/skills/fact-checker/{SKILL.md,tau.toml}`

- [ ] **Step 1: Seed the demo fixtures**

Create `fixtures/demo/skills/critic/SKILL.md`:

```markdown
---
name: critic
description: Reviews drafts for clarity, completeness, and rhetoric.
---
You are a writing critic. Review the draft for clarity, completeness, and rhetorical quality. Cite specific lines.
```

Create `fixtures/demo/skills/critic/tau.toml`:

```toml
name = "critic"
version = "0.1.0"
description = "Reviews drafts for clarity, completeness, and rhetoric."
authors = []
source = "local://critic"
kind = "skill"
dependencies = []
capabilities = []

[skill]

[[skill.requires_tools]]
name = "fs-read"
source = "https://github.com/tau/fs-read.git"
version = "^0.1"
```

Create `fixtures/demo/skills/fact-checker/SKILL.md`:

```markdown
---
name: fact-checker
description: Validates claims against bundled references.
---
You verify claims. Use the bundled references to validate each claim.
```

Create `fixtures/demo/skills/fact-checker/tau.toml`:

```toml
name = "fact-checker"
version = "0.1.0"
description = "Validates claims against bundled references."
authors = []
source = "local://fact-checker"
kind = "skill"
dependencies = []

[[capabilities]]
kind = "fs.read"
paths = ["${SKILL_DIR}/references/**"]

[skill]
```

- [ ] **Step 2: Add the frontmatter helpers + local read/list to `gateway/src/skills/mod.rs`**

```rust
/// Parse SKILL.md: (name, description, body). Frontmatter is the YAML-ish block
/// between the first two `---` fences; only name/description are read.
fn parse_skill_md(text: &str) -> (Option<String>, Option<String>, String) {
    if !text.trim_start().starts_with("---") {
        return (None, None, text.to_string());
    }
    let mut parts = text.splitn(3, "---");
    let _before = parts.next();
    match (parts.next(), parts.next()) {
        (Some(front), Some(body)) => {
            let mut name = None;
            let mut description = None;
            for line in front.lines() {
                let l = line.trim();
                if let Some(v) = l.strip_prefix("name:") {
                    name = Some(v.trim().to_string());
                } else if let Some(v) = l.strip_prefix("description:") {
                    description = Some(v.trim().to_string());
                }
            }
            (name, description, body.trim_start_matches('\n').to_string())
        }
        _ => (None, None, text.to_string()),
    }
}

fn render_skill_md(name: &str, description: Option<&str>, body: &str) -> String {
    format!(
        "---\nname: {name}\ndescription: {desc}\n---\n{body}\n",
        desc = description.unwrap_or("")
    )
}

fn skills_dir(project: &Path) -> std::path::PathBuf {
    project.join("skills")
}

/// Read one local skill (None if its dir/SKILL.md is absent).
pub fn read_local(project: &Path, name: &str) -> Result<Option<SkillDetail>> {
    let dir = skills_dir(project).join(name);
    let md_path = dir.join("SKILL.md");
    if !md_path.exists() {
        return Ok(None);
    }
    let md = std::fs::read_to_string(&md_path)?;
    let (md_name, description, content) = parse_skill_md(&md);
    let toml_text = std::fs::read_to_string(dir.join("tau.toml")).unwrap_or_default();
    let doc: toml::Value = toml::from_str(&toml_text).unwrap_or(toml::Value::Table(Default::default()));

    let version = doc.get("version").and_then(|v| v.as_str()).map(String::from);
    let source = doc
        .get("source")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("local://{name}"));

    let capabilities = doc
        .get("capabilities")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().filter_map(cap_from_value).collect())
        .unwrap_or_default();

    let requires_tools = deps_from(doc.get("skill").and_then(|s| s.get("requires_tools")));
    let requires_skills = deps_from(doc.get("skill").and_then(|s| s.get("requires_skills")));

    Ok(Some(SkillDetail {
        name: md_name.unwrap_or_else(|| name.to_string()),
        description,
        version,
        source,
        editable: true,
        content,
        capabilities,
        requires_tools,
        requires_skills,
    }))
}

fn cap_from_value(v: &toml::Value) -> Option<Capability> {
    let kind = v.get("kind")?.as_str()?.to_string();
    let mut fields = BTreeMap::new();
    if let Some(tbl) = v.as_table() {
        for (k, val) in tbl {
            if k == "kind" {
                continue;
            }
            if let Some(arr) = val.as_array() {
                let list: Vec<String> = arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                fields.insert(k.clone(), list);
            }
        }
    }
    Some(Capability { kind, fields })
}

fn deps_from(v: Option<&toml::Value>) -> Vec<PackageDep> {
    v.and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|d| {
                    Some(PackageDep {
                        name: d.get("name")?.as_str()?.to_string(),
                        source: d.get("source").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                        version: d.get("version").and_then(|s| s.as_str()).map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// List local skills (each dir under `<project>/skills/` with a SKILL.md).
pub fn list_local(project: &Path) -> Vec<SkillSummary> {
    let mut out = vec![];
    let dir = skills_dir(project);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Ok(Some(d)) = read_local(project, &name) {
                out.push(summary_of(&d));
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn summary_of(d: &SkillDetail) -> SkillSummary {
    SkillSummary {
        name: d.name.clone(),
        version: d.version.clone(),
        source: d.source.clone(),
        editable: d.editable,
        capability_kinds: d.capabilities.iter().map(|c| c.kind.clone()).collect(),
        requires_count: (d.requires_tools.len() + d.requires_skills.len()) as u32,
    }
}
```

- [ ] **Step 3: Write the failing test**

Add a `#[cfg(test)] mod tests` to `gateway/src/skills/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn demo() -> std::path::PathBuf {
        let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.pop();
        p.push("fixtures/demo");
        p
    }

    #[test]
    fn reads_seeded_local_skills() {
        let p = demo();
        let critic = read_local(&p, "critic").unwrap().unwrap();
        assert_eq!(critic.name, "critic");
        assert!(critic.editable);
        assert!(critic.content.contains("writing critic"));
        assert_eq!(critic.requires_tools.len(), 1);
        assert_eq!(critic.requires_tools[0].name, "fs-read");

        let fc = read_local(&p, "fact-checker").unwrap().unwrap();
        assert_eq!(fc.capabilities.len(), 1);
        assert_eq!(fc.capabilities[0].kind, "fs.read");
        assert_eq!(fc.capabilities[0].fields["paths"], vec!["${SKILL_DIR}/references/**"]);

        let names: Vec<String> = list_local(&p).into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"critic".to_string()));
        assert!(names.contains(&"fact-checker".to_string()));

        assert!(read_local(&p, "ghost").unwrap().is_none());
    }

    fn parse_helper() -> &'static str {
        "---\nname: x\ndescription: d\n---\nbody line\n"
    }

    #[test]
    fn frontmatter_roundtrips() {
        let (n, d, b) = parse_skill_md(parse_helper());
        assert_eq!(n.as_deref(), Some("x"));
        assert_eq!(d.as_deref(), Some("d"));
        assert_eq!(b.trim(), "body line");
        let rendered = render_skill_md("x", Some("d"), "body line");
        let (n2, _, _) = parse_skill_md(&rendered);
        assert_eq!(n2.as_deref(), Some("x"));
    }
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo test -p tau-gateway --lib skills::tests`
Expected: PASS (2 tests).

```bash
git add gateway/src/skills/mod.rs fixtures/demo/skills
git commit -m "feat(gateway): local skill read/list + frontmatter + demo fixtures"
```

---

## Task 3: Local write + delete

**Files:**
- Modify: `gateway/src/skills/mod.rs`

- [ ] **Step 1: Add `write_local` + `delete_local`**

```rust
/// Create/update a local skill's files. `editable`/`source` on the detail are
/// ignored for writing (a written skill is always local). Validates the name.
pub fn write_local(project: &Path, detail: &SkillDetail) -> Result<()> {
    if !valid_skill_name(&detail.name) {
        bail!("invalid skill name: {}", detail.name);
    }
    let dir = skills_dir(project).join(&detail.name);
    std::fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;

    std::fs::write(
        dir.join("SKILL.md"),
        render_skill_md(&detail.name, detail.description.as_deref(), &detail.content),
    )?;

    let mut doc = toml_edit::DocumentMut::new();
    doc["name"] = toml_edit::value(detail.name.as_str());
    doc["version"] = toml_edit::value(detail.version.as_deref().unwrap_or("0.1.0"));
    if let Some(d) = detail.description.as_deref() {
        doc["description"] = toml_edit::value(d);
    }
    doc["authors"] = toml_edit::Item::Value(toml_edit::Array::new().into());
    doc["source"] = toml_edit::value(format!("local://{}", detail.name));
    doc["kind"] = toml_edit::value("skill");
    doc["dependencies"] = toml_edit::Item::Value(toml_edit::Array::new().into());

    // [[capabilities]]
    let mut caps = toml_edit::ArrayOfTables::new();
    for c in &detail.capabilities {
        let mut t = toml_edit::Table::new();
        t["kind"] = toml_edit::value(c.kind.as_str());
        for (param, list) in &c.fields {
            let mut arr = toml_edit::Array::new();
            for v in list {
                arr.push(v.as_str());
            }
            t[param] = toml_edit::Item::Value(arr.into());
        }
        caps.push(t);
    }
    doc["capabilities"] = toml_edit::Item::ArrayOfTables(caps);

    // [skill] with requires arrays
    let mut skill_tbl = toml_edit::Table::new();
    skill_tbl.set_implicit(true);
    if !detail.requires_tools.is_empty() {
        skill_tbl["requires_tools"] = toml_edit::Item::ArrayOfTables(deps_to_aot(&detail.requires_tools));
    }
    if !detail.requires_skills.is_empty() {
        skill_tbl["requires_skills"] = toml_edit::Item::ArrayOfTables(deps_to_aot(&detail.requires_skills));
    }
    doc["skill"] = toml_edit::Item::Table(skill_tbl);

    std::fs::write(dir.join("tau.toml"), doc.to_string())?;
    Ok(())
}

fn deps_to_aot(deps: &[PackageDep]) -> toml_edit::ArrayOfTables {
    let mut aot = toml_edit::ArrayOfTables::new();
    for d in deps {
        let mut t = toml_edit::Table::new();
        t["name"] = toml_edit::value(d.name.as_str());
        t["source"] = toml_edit::value(d.source.as_str());
        if let Some(v) = d.version.as_deref().filter(|s| !s.is_empty()) {
            t["version"] = toml_edit::value(v);
        }
        aot.push(t);
    }
    aot
}

/// Remove a local skill dir. Returns false if absent.
pub fn delete_local(project: &Path, name: &str) -> Result<bool> {
    let dir = skills_dir(project).join(name);
    if !dir.join("SKILL.md").exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir).with_context(|| format!("remove {}", dir.display()))?;
    Ok(true)
}
```

- [ ] **Step 2: Write the failing test (write into a tempdir, not the fixture)**

Add to the `tests` module:

```rust
    #[test]
    fn write_then_read_roundtrips() {
        let d = tempfile::tempdir().unwrap();
        let detail = SkillDetail {
            name: "summariser".into(),
            description: Some("Summarises text.".into()),
            version: Some("0.2.0".into()),
            source: "ignored".into(),
            editable: true,
            content: "You summarise.".into(),
            capabilities: vec![Capability {
                kind: "net.http".into(),
                fields: BTreeMap::from([
                    ("hosts".to_string(), vec!["api.example.com".to_string()]),
                    ("methods".to_string(), vec!["GET".to_string()]),
                ]),
            }],
            requires_tools: vec![PackageDep {
                name: "web-search".into(),
                source: "https://x/web.git".into(),
                version: Some("^1".into()),
            }],
            requires_skills: vec![],
        };
        write_local(d.path(), &detail).unwrap();

        let back = read_local(d.path(), "summariser").unwrap().unwrap();
        assert_eq!(back.description.as_deref(), Some("Summarises text."));
        assert_eq!(back.version.as_deref(), Some("0.2.0"));
        assert_eq!(back.content.trim(), "You summarise.");
        assert_eq!(back.capabilities[0].kind, "net.http");
        assert_eq!(back.capabilities[0].fields["hosts"], vec!["api.example.com"]);
        assert_eq!(back.capabilities[0].fields["methods"], vec!["GET"]);
        assert_eq!(back.requires_tools[0].name, "web-search");

        assert!(delete_local(d.path(), "summariser").unwrap());
        assert!(read_local(d.path(), "summariser").unwrap().is_none());
        assert!(!delete_local(d.path(), "summariser").unwrap());

        // invalid name rejected
        let mut bad = detail.clone();
        bad.name = "Bad Name".into();
        assert!(write_local(d.path(), &bad).is_err());
    }
```

(Add `#[derive(Clone)]`? `SkillDetail` already derives `Clone`.)

- [ ] **Step 3: Run + commit**

Run: `cargo test -p tau-gateway --lib skills::tests`
Expected: PASS (3 tests).

```bash
git add gateway/src/skills/mod.rs
git commit -m "feat(gateway): write_local/delete_local skill files"
```

---

## Task 4: Installed-skills seam + compose functions

**Files:**
- Modify: `gateway/src/skills/mod.rs`

- [ ] **Step 1: Add the seam + compose**

```rust
/// Installed (non-editable) skills: a seam over real `tau` (kind="skill" packages
/// + `tau install`). The mock seeds one; the CLI seam is not exercised in v1.
pub trait InstalledSkills: Send + Sync {
    fn list(&self) -> Vec<SkillSummary>;
    fn read(&self, name: &str) -> Option<SkillDetail>;
    fn import(&self, git_url: &str) -> Result<String>;
}

pub struct MockInstalled {
    skills: std::sync::Mutex<Vec<SkillDetail>>,
}

impl MockInstalled {
    pub fn new() -> Self {
        MockInstalled {
            skills: std::sync::Mutex::new(vec![SkillDetail {
                name: "web-search".into(),
                description: Some("Search the web.".into()),
                version: Some("1.2.0".into()),
                source: "github.com/tau/web-search".into(),
                editable: false,
                content: "You can search the web.".into(),
                capabilities: vec![Capability {
                    kind: "net.http".into(),
                    fields: BTreeMap::from([("hosts".to_string(), vec!["*".to_string()])]),
                }],
                requires_tools: vec![],
                requires_skills: vec![],
            }]),
        }
    }
}

impl Default for MockInstalled {
    fn default() -> Self {
        Self::new()
    }
}

impl InstalledSkills for MockInstalled {
    fn list(&self) -> Vec<SkillSummary> {
        self.skills.lock().unwrap().iter().map(summary_of).collect()
    }
    fn read(&self, name: &str) -> Option<SkillDetail> {
        self.skills.lock().unwrap().iter().find(|s| s.name == name).cloned()
    }
    fn import(&self, git_url: &str) -> Result<String> {
        let name = crate::packages::name_from_url(git_url);
        let mut list = self.skills.lock().unwrap();
        if !list.iter().any(|s| s.name == name) {
            list.push(SkillDetail {
                name: name.clone(),
                description: Some("Imported skill.".into()),
                version: Some("1.0.0".into()),
                source: git_url.to_string(),
                editable: false,
                content: String::new(),
                capabilities: vec![],
                requires_tools: vec![],
                requires_skills: vec![],
            });
        }
        Ok(name)
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliInstalled;

impl InstalledSkills for CliInstalled {
    fn list(&self) -> Vec<SkillSummary> {
        vec![]
    }
    fn read(&self, _name: &str) -> Option<SkillDetail> {
        None
    }
    fn import(&self, _git_url: &str) -> Result<String> {
        bail!("skill import requires a real tau binary")
    }
}

/// Compose local + installed for the public surface.
pub fn list(project: &Path, installed: &dyn InstalledSkills) -> Vec<SkillSummary> {
    let mut out = list_local(project);
    out.extend(installed.list());
    out
}

pub fn read(project: &Path, name: &str, installed: &dyn InstalledSkills) -> Result<Option<SkillDetail>> {
    if let Some(local) = read_local(project, name)? {
        return Ok(Some(local));
    }
    Ok(installed.read(name))
}
```

- [ ] **Step 2: Write the failing test**

Add to the `tests` module:

```rust
    #[test]
    fn compose_local_and_installed() {
        let inst = MockInstalled::new();
        let p = demo();
        let all = list(&p, &inst);
        let names: Vec<&str> = all.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"critic")); // local
        assert!(names.contains(&"web-search")); // installed
        let ws = all.iter().find(|s| s.name == "web-search").unwrap();
        assert!(!ws.editable);

        // read falls through to installed
        let r = read(&p, "web-search", &inst).unwrap().unwrap();
        assert!(!r.editable);
        // import appends
        let n = inst.import("https://github.com/acme/translator.git").unwrap();
        assert_eq!(n, "translator");
        assert!(inst.read("translator").is_some());
    }
```

- [ ] **Step 3: Run + commit**

Run: `cargo test -p tau-gateway --lib skills::tests`
Expected: PASS (4 tests).

```bash
git add gateway/src/skills/mod.rs
git commit -m "feat(gateway): installed-skills seam + compose list/read"
```

---

## Task 5: `AppState` wrappers

**Files:**
- Modify: `gateway/src/state.rs`

- [ ] **Step 1: Add the `installed_skills` field + select it in `new`**

In `gateway/src/state.rs`, add to the `use` block:

```rust
use crate::skills::{self, InstalledSkills, SkillDetail, SkillSummary};
```

Add a field to `Inner` (near `package_ops`):

```rust
    installed_skills: Box<dyn InstalledSkills>,
```

In `AppState::new`, build it next to `package_ops` (the function already computes `is_mock`):

```rust
        let installed_skills: Box<dyn InstalledSkills> = if is_mock {
            Box::new(skills::MockInstalled::new())
        } else {
            Box::new(skills::CliInstalled)
        };
```

and include `installed_skills` in the `Inner { ... }` literal.

- [ ] **Step 2: Add the wrappers inside `impl AppState`**

```rust
    pub fn list_skills(&self) -> Vec<SkillSummary> {
        skills::list(&self.0.project, self.0.installed_skills.as_ref())
    }

    pub fn read_skill(&self, name: &str) -> anyhow::Result<Option<SkillDetail>> {
        skills::read(&self.0.project, name, self.0.installed_skills.as_ref())
    }

    pub fn write_skill(&self, detail: &SkillDetail) -> anyhow::Result<()> {
        skills::write_local(&self.0.project, detail)
    }

    pub fn delete_skill(&self, name: &str) -> anyhow::Result<bool> {
        skills::delete_local(&self.0.project, name)
    }

    pub fn import_skill(&self, git_url: &str) -> anyhow::Result<String> {
        self.0.installed_skills.import(git_url)
    }
```

- [ ] **Step 3: Build + commit**

Run: `cargo build -p tau-gateway`
Expected: compiles. (If `SkillSummary` is reported unused, it is used by `list_skills`'s return type — keep the import.)

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): AppState skill wrappers"
```

---

## Task 6: API handlers + routes + integration test

**Files:**
- Create: `gateway/src/api/skills.rs`, `gateway/tests/skills_api.rs`
- Modify: `gateway/src/api/mod.rs`

- [ ] **Step 1: Create `gateway/src/api/skills.rs`**

```rust
use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;
use crate::skills::{valid_skill_name, SkillDetail, SkillSummary};

pub async fn list(Scoped(state): Scoped) -> Json<Vec<SkillSummary>> {
    Json(state.list_skills())
}

pub async fn get_one(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Result<Json<SkillDetail>, (StatusCode, String)> {
    match state.read_skill(&name) {
        Ok(Some(s)) => Ok(Json(s)),
        Ok(None) => Err((StatusCode::NOT_FOUND, format!("unknown skill: {name}"))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct PutQuery {
    pub create: Option<String>,
}

pub async fn put(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
    Query(q): Query<PutQuery>,
    Json(mut body): Json<SkillDetail>,
) -> Result<Json<SkillDetail>, (StatusCode, String)> {
    if !valid_skill_name(&name) {
        return Err((StatusCode::BAD_REQUEST, format!("invalid skill name: {name}")));
    }
    let existing = state
        .read_skill(&name)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if let Some(s) = &existing {
        if !s.editable {
            return Err((StatusCode::CONFLICT, "installed skills are read-only".into()));
        }
    }
    if q.create.as_deref() == Some("1") && existing.is_some() {
        return Err((StatusCode::CONFLICT, format!("skill already exists: {name}")));
    }
    body.name = name;
    state
        .write_skill(&body)
        .map(|_| Json(body))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}

pub async fn remove(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    match state.read_skill(&name) {
        Ok(Some(s)) if !s.editable => {
            Err((StatusCode::BAD_REQUEST, "installed skills cannot be deleted".into()))
        }
        Ok(Some(_)) => match state.delete_skill(&name) {
            Ok(true) => Ok(StatusCode::NO_CONTENT),
            Ok(false) => Err((StatusCode::NOT_FOUND, format!("unknown skill: {name}"))),
            Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        },
        Ok(None) => Err((StatusCode::NOT_FOUND, format!("unknown skill: {name}"))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e.to_string())),
    }
}

#[derive(Deserialize)]
pub struct ImportBody {
    pub git_url: String,
}

pub async fn import(
    Scoped(state): Scoped,
    Json(b): Json<ImportBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .import_skill(&b.git_url)
        .map(|name| Json(json!({ "skill": name })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
```

- [ ] **Step 2: Wire routes in `gateway/src/api/mod.rs`**

Add `pub mod skills;` to the module list at the top, and add to the `scoped` router (near the agents routes):

```rust
        .route("/skills", get(skills::list))
        .route("/skills/import", post(skills::import))
        .route(
            "/skills/:name",
            get(skills::get_one).put(skills::put).delete(skills::remove),
        )
```

- [ ] **Step 3: Create `gateway/tests/skills_api.rs`**

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
async fn skill_crud_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();
    let pid = meta.id;

    // list shows seeded local skills + installed web-search
    let list: serde_json::Value = http
        .get(format!("{base}/api/projects/{pid}/skills"))
        .send().await.unwrap().json().await.unwrap();
    let names: Vec<String> = list.as_array().unwrap().iter()
        .map(|s| s["name"].as_str().unwrap().to_string()).collect();
    assert!(names.contains(&"critic".to_string()));
    assert!(names.contains(&"web-search".to_string()));

    // installed skill is read-only: PUT → 409
    let ro = http
        .put(format!("{base}/api/projects/{pid}/skills/web-search"))
        .json(&serde_json::json!({
            "name":"web-search","description":null,"version":null,"source":"x",
            "editable":false,"content":"","capabilities":[],"requires_tools":[],"requires_skills":[]
        }))
        .send().await.unwrap();
    assert_eq!(ro.status(), reqwest::StatusCode::CONFLICT);

    // create a new local skill
    let body = serde_json::json!({
        "name":"mytool","description":"d","version":"0.1.0","source":"x","editable":true,
        "content":"hi","capabilities":[{"kind":"fs.read","fields":{"paths":["/tmp/**"]}}],
        "requires_tools":[],"requires_skills":[]
    });
    let created = http
        .put(format!("{base}/api/projects/{pid}/skills/mytool?create=1"))
        .json(&body).send().await.unwrap();
    assert_eq!(created.status(), reqwest::StatusCode::OK);

    // dup create → 409
    let dup = http
        .put(format!("{base}/api/projects/{pid}/skills/mytool?create=1"))
        .json(&body).send().await.unwrap();
    assert_eq!(dup.status(), reqwest::StatusCode::CONFLICT);

    // get it back
    let one: serde_json::Value = http
        .get(format!("{base}/api/projects/{pid}/skills/mytool"))
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(one["capabilities"][0]["kind"], "fs.read");

    // delete → 204
    let del = http
        .delete(format!("{base}/api/projects/{pid}/skills/mytool"))
        .send().await.unwrap();
    assert_eq!(del.status(), reqwest::StatusCode::NO_CONTENT);
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test skills_api`
Expected: PASS. Then restore the fixture (the test added `fixtures/demo/skills/mytool` then deleted it; if any residue, `git status fixtures/demo/skills` should be clean — the seeded `critic`/`fact-checker` are committed and untouched; remove any stray `mytool` dir: `rm -rf fixtures/demo/skills/mytool`).

**Important:** this test runs against `fixtures/demo` directly, so it writes `fixtures/demo/skills/mytool` during the run. The test deletes it, but if it panics mid-way a stray dir remains. After running, verify `git status --porcelain fixtures/demo` is clean.

```bash
git add gateway/src/api/skills.rs gateway/src/api/mod.rs gateway/tests/skills_api.rs
git commit -m "feat(gateway): scoped skill CRUD routes + integration test"
```

---

## Task 7: ts-rs export + rust gate

**Files:**
- Regenerated: `web/src/types/{Capability,PackageDep,SkillSummary,SkillDetail}.ts`

- [ ] **Step 1: Regenerate**

Run: `cargo test -p tau-gateway`
Expected: PASS; new files under `web/src/types/`. Confirm `fixtures/demo` is clean afterward (`git status --porcelain fixtures/demo`).

- [ ] **Step 2: Verify the types**

Run: `ls web/src/types/ | grep -E "Capability|PackageDep|SkillSummary|SkillDetail"`
Expected: all four. `cat web/src/types/Capability.ts` should show `fields: { [key: string]: Array<string> }`.

- [ ] **Step 3: Full rust gate**

Run: `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway`
Expected: green. Fix fmt/clippy minimally (`cargo fmt --all`).

- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export skill TS bindings + fmt/clippy"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-skills-authoring-design.md`):
- §3 types → Task 1. §4.1 local file ops + installed seam → Tasks 2–4; demo fixtures seeded → Task 2. §4.2 read/write/delete rules + installed-read-only → Tasks 3, 4, 6 (handler enforces `editable`). §4.3 AppState wrappers → Task 5. §4.4 API (GET list/one, PUT `?create`, DELETE, import; 404/400/409) → Task 6. §7 ts-rs/CI → Task 7. All covered.

**Placeholder scan:** none — every step has complete code.

**Type consistency:** `Capability { kind, fields: BTreeMap<String, Vec<String>> }`, `PackageDep { name, source, version }`, `SkillSummary`, `SkillDetail` are used identically across the module, `AppState` wrappers, handlers, and tests. `valid_skill_name`, `read_local`/`write_local`/`delete_local`, `list`/`read`, and `InstalledSkills` signatures match their callers. The handler enforces `editable` via `read_skill` consistently for PUT and DELETE. The `?create=1` flag maps to `PutQuery{create: Option<String>}`, matching the frontend contract in Plan 2.

**Note for executor:** the integration test (Task 6) and `cargo test` (Task 7) write into `fixtures/demo/skills/` and clean up; verify `git status --porcelain fixtures/demo` is clean before committing, and never commit a stray `mytool` dir.
