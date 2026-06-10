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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildRequest {
    pub target: String,
}

/// Build failure mapped to HTTP 400 by the handler.
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

/// Source of targets/bundles + the build action. Mock-first; the CLI path stays
/// empty until tau ships `targets`/`build`.
pub trait ShipSource: Send + Sync {
    fn list_targets(&self) -> Vec<Target>;
    fn list_bundles(&self) -> Vec<Bundle>;
    fn build(&self, target: &str) -> Result<Bundle, BuildError>;
}

/// The fixed target registry mirroring `tau target list --json`.
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

/// CLI seam — wired in a later task.
pub struct CliShip;

impl ShipSource for CliShip {
    fn list_targets(&self) -> Vec<Target> {
        vec![]
    }
    fn list_bundles(&self) -> Vec<Bundle> {
        vec![]
    }
    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        Err(BuildError::Invalid(format!("unknown target '{target}'")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
