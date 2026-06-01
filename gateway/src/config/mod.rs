//! ConfigStore: real read/write of the project's `tau.toml`.
//! Reads the `[project]` + `[agents.*]` overview; writes `[project]` name/description
//! and new `[agents.<id>]` tables via toml_edit (preserving the rest of the file).

use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentInfo {
    pub id: String,
    pub llm_backend: Option<String>,
    pub package: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectConfig {
    pub name: String,
    pub description: Option<String>,
    pub agents: Vec<AgentInfo>,
}

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

fn source_of(package: Option<&str>) -> String {
    match package {
        Some(p) if p.contains('/') || p.contains("github") => {
            p.split('@').next().unwrap_or(p).to_string()
        }
        _ => "local".to_string(),
    }
}

pub fn read(project: &Path) -> Result<ProjectConfig> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    let doc: toml::Value = toml::from_str(&text).context("parse tau.toml")?;
    let name = doc
        .get("project")
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let description = doc
        .get("project")
        .and_then(|p| p.get("description"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let mut agents = vec![];
    if let Some(tbl) = doc.get("agents").and_then(|a| a.as_table()) {
        for (id, v) in tbl {
            let llm_backend = v
                .get("llm_backend")
                .and_then(|x| x.as_str())
                .map(String::from);
            let package = v.get("package").and_then(|x| x.as_str()).map(String::from);
            let source = source_of(package.as_deref());
            agents.push(AgentInfo {
                id: id.clone(),
                llm_backend,
                package,
                source,
            });
        }
        agents.sort_by(|a, b| a.id.cmp(&b.id));
    }
    Ok(ProjectConfig {
        name,
        description,
        agents,
    })
}

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

pub fn write_project(project: &Path, name: &str, description: Option<&str>) -> Result<()> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml_edit::DocumentMut = text.parse().context("parse tau.toml")?;
    doc["project"]["name"] = toml_edit::value(name);
    match description {
        Some(d) => doc["project"]["description"] = toml_edit::value(d),
        None => {
            if let Some(t) = doc["project"].as_table_mut() {
                t.remove("description");
            }
        }
    }
    std::fs::write(&path, doc.to_string()).with_context(|| format!("write {path:?}"))?;
    Ok(())
}

pub fn add_agent(
    project: &Path,
    id: &str,
    display_name: &str,
    package: &str,
    llm_backend: &str,
) -> Result<()> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml_edit::DocumentMut = text.parse().context("parse tau.toml")?;
    doc["agents"][id]["display_name"] = toml_edit::value(display_name);
    doc["agents"][id]["package"] = toml_edit::value(package);
    doc["agents"][id]["llm_backend"] = toml_edit::value(llm_backend);
    std::fs::write(&path, doc.to_string()).with_context(|| format!("write {path:?}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_fixture(dir: &Path) {
        std::fs::write(
            dir.join("tau.toml"),
            r#"[project]
name = "demo"
description = "old"

[agents.greeter]
display_name = "Greeter"
package = "greeter@^0.1"
llm_backend = "anthropic"
"#,
        )
        .unwrap();
    }

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

    #[test]
    fn reads_project_and_agents() {
        let d = tempfile::tempdir().unwrap();
        write_fixture(d.path());
        let c = read(d.path()).unwrap();
        assert_eq!(c.name, "demo");
        assert_eq!(c.agents.len(), 1);
        assert_eq!(c.agents[0].id, "greeter");
        assert_eq!(c.agents[0].llm_backend.as_deref(), Some("anthropic"));
    }

    #[test]
    fn writes_project_preserving_agents() {
        let d = tempfile::tempdir().unwrap();
        write_fixture(d.path());
        write_project(d.path(), "renamed", Some("new desc")).unwrap();
        let c = read(d.path()).unwrap();
        assert_eq!(c.name, "renamed");
        assert_eq!(c.description.as_deref(), Some("new desc"));
        assert_eq!(c.agents.len(), 1);
    }

    #[test]
    fn add_agent_registers_a_runnable_agent() {
        let d = tempfile::tempdir().unwrap();
        write_fixture(d.path());
        add_agent(
            d.path(),
            "researcher-pro",
            "researcher-pro",
            "researcher-pro@^1.0",
            "anthropic",
        )
        .unwrap();
        let c = read(d.path()).unwrap();
        let a = c.agents.iter().find(|a| a.id == "researcher-pro").unwrap();
        assert_eq!(a.package.as_deref(), Some("researcher-pro@^1.0"));
        assert_eq!(a.llm_backend.as_deref(), Some("anthropic"));
    }
}
