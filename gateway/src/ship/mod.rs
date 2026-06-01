//! Ship / Targets & Build: a mock-backed catalog of compile targets plus a
//! synchronous `build` that produces a `.tau` bundle. Mirrors the tools/plugins
//! seam, with an in-memory bundle list (like packages' `MockOps`). tau has no
//! real build engine yet — `CliShip` is the empty seam.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Target {
    pub name: String,         // "host" | "wasm" | "c-abi" | "mcu"
    pub substrate: String,    // "native" | "wasm32" | "cdylib" | "embedded"
    pub status: String,       // "ready" | "gated"
    pub gate: Option<String>, // "γ" for gated; None for host
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildStep {
    pub name: String,   // "resolve deps" | "typecheck" | "compile" | "bundle"
    pub status: String, // "ok"
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Bundle {
    pub artifact: String, // "<project>.tau"
    pub target: String,
    pub size_bytes: u64,
    pub hash: String,  // "sha256:…"
    pub drift: String, // "clean" | "drifted"
    pub built_at: String,
    pub steps: Vec<BuildStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildRequest {
    pub target: String,
}

/// Build failure mapped to HTTP 400 by the handler.
#[derive(Debug)]
pub enum BuildError {
    Gated(String),
    UnknownTarget(String),
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildError::Gated(t) => write!(f, "target '{t}' is gated (phase γ)"),
            BuildError::UnknownTarget(t) => write!(f, "unknown target '{t}'"),
        }
    }
}

impl std::error::Error for BuildError {}

/// Source of targets/bundles + the build action. Mock-first; the CLI path stays
/// empty until tau ships `targets`/`build`.
pub trait ShipSource: Send + Sync {
    fn list_targets(&self) -> Vec<Target>;
    fn list_bundles(&self) -> Vec<Bundle>;
    fn build(&self, target: &str) -> Result<Bundle, BuildError>;
}

/// The fixed target registry (host ready; the three substrates gated at γ).
fn targets() -> Vec<Target> {
    let gated = |name: &str, substrate: &str| Target {
        name: name.into(),
        substrate: substrate.into(),
        status: "gated".into(),
        gate: Some("γ".into()),
    };
    vec![
        Target {
            name: "host".into(),
            substrate: "native".into(),
            status: "ready".into(),
            gate: None,
        },
        gated("wasm", "wasm32"),
        gated("c-abi", "cdylib"),
        gated("mcu", "embedded"),
    ]
}

fn step(name: &str, duration_ms: u32) -> BuildStep {
    BuildStep {
        name: name.into(),
        status: "ok".into(),
        duration_ms,
    }
}

pub struct MockShip {
    project: String,
    bundles: Mutex<Vec<Bundle>>,
}

impl MockShip {
    pub fn new(project: String) -> Self {
        let artifact = format!("{project}.tau");
        let seed = |size: u64, drift: &str, built_at: &str| Bundle {
            artifact: artifact.clone(),
            target: "host".into(),
            size_bytes: size,
            hash: "sha256:9f3c1a2b7e".into(),
            drift: drift.into(),
            built_at: built_at.into(),
            steps: vec![
                step("resolve deps", 120),
                step("typecheck", 340),
                step("compile", 2100),
                step("bundle", 90),
            ],
        };
        MockShip {
            project,
            bundles: Mutex::new(vec![
                seed(2_456_789, "clean", "2m ago"),
                seed(2_310_004, "drifted", "1d ago"),
            ]),
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
            .find(|t| t.name == target)
            .ok_or_else(|| BuildError::UnknownTarget(target.to_string()))?;
        if t.status != "ready" {
            return Err(BuildError::Gated(target.to_string()));
        }
        let bundle = Bundle {
            artifact: format!("{}.tau", self.project),
            target: target.to_string(),
            size_bytes: 2_460_512,
            hash: "sha256:1a2b3c4d5e".into(),
            drift: "clean".into(),
            built_at: "just now".into(),
            steps: vec![
                step("resolve deps", 118),
                step("typecheck", 352),
                step("compile", 2087),
                step("bundle", 94),
            ],
        };
        self.bundles.lock().unwrap().insert(0, bundle.clone());
        Ok(bundle)
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliShip;

impl ShipSource for CliShip {
    fn list_targets(&self) -> Vec<Target> {
        vec![]
    }
    fn list_bundles(&self) -> Vec<Bundle> {
        vec![]
    }
    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        Err(BuildError::UnknownTarget(target.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_seeds_targets_and_bundles() {
        let s = MockShip::new("demo".into());
        let targets = s.list_targets();
        assert_eq!(targets.len(), 4);
        let host = targets.iter().find(|t| t.name == "host").unwrap();
        assert_eq!(host.status, "ready");
        assert!(host.gate.is_none());
        let wasm = targets.iter().find(|t| t.name == "wasm").unwrap();
        assert_eq!(wasm.status, "gated");
        assert_eq!(wasm.gate.as_deref(), Some("γ"));
        assert!(!s.list_bundles().is_empty());
    }

    #[test]
    fn build_host_appends_bundle_with_steps() {
        let s = MockShip::new("demo".into());
        let before = s.list_bundles().len();
        let b = s.build("host").unwrap();
        assert_eq!(b.target, "host");
        assert_eq!(b.artifact, "demo.tau");
        assert!(!b.steps.is_empty());
        assert!(b.steps.iter().all(|st| st.status == "ok"));
        assert_eq!(s.list_bundles().len(), before + 1);
        // appended to the front
        assert_eq!(s.list_bundles()[0].built_at, "just now");
    }

    #[test]
    fn build_rejects_gated_and_unknown() {
        let s = MockShip::new("demo".into());
        assert!(matches!(s.build("wasm"), Err(BuildError::Gated(_))));
        assert!(matches!(s.build("nope"), Err(BuildError::UnknownTarget(_))));
    }

    #[test]
    fn cli_ship_is_empty() {
        assert!(CliShip.list_targets().is_empty());
        assert!(CliShip.list_bundles().is_empty());
        assert!(CliShip.build("host").is_err());
    }
}
