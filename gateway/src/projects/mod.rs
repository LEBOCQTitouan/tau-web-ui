//! Project registry: owns one AppState per tau project, persisted to
//! `<data_root>/projects.json`, each project's runs under
//! `<data_root>/projects/<id>/runs/`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod cloner;

pub type ProjectId = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectSource {
    Local,
    Git { url: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub name: String,
    pub path: String,
    pub source: ProjectSource,
}

/// Lowercase, collapse non-[a-z0-9-] runs to a single '-', trim leading/trailing '-'.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_normalizes() {
        assert_eq!(slug("Acme Bot"), "acme-bot");
        assert_eq!(slug("research_kit!!"), "research-kit");
        assert_eq!(slug("  --demo--  "), "demo");
    }
}
