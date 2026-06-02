//! Verify / Health checks: a mock-backed `tau check` report (SARIF-style findings
//! over categories + sandbox diagnostics). Mirrors the tools/ship seam. tau has no
//! real check endpoint yet — `CliChecks` is the empty seam.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckFinding {
    pub category: String, // "config"|"lockfile"|"pkg"|"sandbox"|"plugin"|"skill"
    pub severity: String, // "error" | "warning" | "note"
    pub rule: String,
    pub message: String,
    pub location: Option<String>, // "tau.toml:3" | None
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CategoryStatus {
    pub name: String,
    pub errors: u32,
    pub warnings: u32,
    pub notes: u32, // pass = all zero
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SandboxDiag {
    pub tier: String,
    pub status: String,
    pub no_sandbox: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckReport {
    pub categories: Vec<CategoryStatus>,
    pub findings: Vec<CheckFinding>,
    pub sandbox: SandboxDiag,
}

/// Source of the check report. Mock-first; the CLI path stays empty until tau
/// exposes `tau check --sarif` over the gateway.
pub trait CheckSource: Send + Sync {
    fn report(&self) -> CheckReport;
}

fn cat(name: &str, errors: u32, warnings: u32, notes: u32) -> CategoryStatus {
    CategoryStatus {
        name: name.into(),
        errors,
        warnings,
        notes,
    }
}

fn finding(
    category: &str,
    severity: &str,
    rule: &str,
    message: &str,
    location: Option<&str>,
) -> CheckFinding {
    CheckFinding {
        category: category.into(),
        severity: severity.into(),
        rule: rule.into(),
        message: message.into(),
        location: location.map(|s| s.to_string()),
    }
}

pub struct MockChecks;

impl CheckSource for MockChecks {
    fn report(&self) -> CheckReport {
        CheckReport {
            categories: vec![
                cat("config", 1, 0, 0),
                cat("lockfile", 0, 1, 0),
                cat("pkg", 0, 0, 0),
                cat("sandbox", 0, 0, 1),
                cat("plugin", 0, 0, 0),
                cat("skill", 0, 0, 0),
            ],
            findings: vec![
                finding(
                    "config",
                    "error",
                    "TAU-CONFIG-ENDPOINT",
                    "inference.endpoint not set",
                    Some("tau.toml:3"),
                ),
                finding(
                    "lockfile",
                    "warning",
                    "TAU-LOCK-STALE",
                    "lockfile is stale vs tau.toml — run `tau resolve`",
                    Some("tau.lock:1"),
                ),
                finding(
                    "sandbox",
                    "note",
                    "TAU-SANDBOX-TIER",
                    "sandbox tier: seatbelt (macOS)",
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

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliChecks;

impl CheckSource for CliChecks {
    fn report(&self) -> CheckReport {
        CheckReport {
            categories: vec![],
            findings: vec![],
            sandbox: SandboxDiag {
                tier: "unknown".into(),
                status: "unknown".into(),
                no_sandbox: false,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_report_seeds_categories_and_findings() {
        let r = MockChecks.report();
        let names: Vec<&str> = r.categories.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["config", "lockfile", "pkg", "sandbox", "plugin", "skill"]
        );
        let config = r.categories.iter().find(|c| c.name == "config").unwrap();
        assert_eq!(config.errors, 1);
        let pkg = r.categories.iter().find(|c| c.name == "pkg").unwrap();
        assert_eq!((pkg.errors, pkg.warnings, pkg.notes), (0, 0, 0));
        assert_eq!(r.findings.len(), 3);
        let err = r.findings.iter().find(|f| f.severity == "error").unwrap();
        assert_eq!(err.rule, "TAU-CONFIG-ENDPOINT");
        assert_eq!(err.category, "config");
        assert_eq!(r.sandbox.tier, "seatbelt");
    }

    #[test]
    fn cli_checks_is_empty() {
        let r = CliChecks.report();
        assert!(r.categories.is_empty());
        assert!(r.findings.is_empty());
    }
}
