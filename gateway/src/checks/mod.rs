//! Verify / Health checks: a mock-backed `tau check` report (SARIF-style findings
//! over categories + sandbox diagnostics). Mirrors the tools/ship seam. tau has no
//! real check endpoint yet — `CliChecks` is the empty seam.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FindingLocation {
    pub path: String,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckFinding {
    pub category: String,  // config|lockfile|packages|sandbox|plugins|skills
    pub severity: String,  // error | needs-setup | warning
    pub rule: String,      // tau's rule_id
    pub summary: String,
    pub detail: Option<String>,
    pub remediation: Option<String>,
    pub location: Option<FindingLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CategoryStatus {
    pub name: String,
    pub errors: u32,
    pub warnings: u32,
    pub needs_setup: u32, // pass = all zero
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

fn cat(name: &str, errors: u32, warnings: u32, needs_setup: u32) -> CategoryStatus {
    CategoryStatus { name: name.into(), errors, warnings, needs_setup }
}

fn finding(
    category: &str,
    severity: &str,
    rule: &str,
    summary: &str,
    remediation: Option<&str>,
    location: Option<(&str, Option<u32>)>,
) -> CheckFinding {
    CheckFinding {
        category: category.into(),
        severity: severity.into(),
        rule: rule.into(),
        summary: summary.into(),
        detail: None,
        remediation: remediation.map(|s| s.to_string()),
        location: location.map(|(p, l)| FindingLocation { path: p.into(), line: l }),
    }
}

pub struct MockChecks;

impl CheckSource for MockChecks {
    fn report(&self) -> CheckReport {
        CheckReport {
            categories: vec![
                cat("config", 1, 0, 0),
                cat("lockfile", 0, 0, 1),
                cat("packages", 0, 0, 0),
                cat("sandbox", 0, 0, 0),
                cat("plugins", 0, 0, 0),
                cat("skills", 0, 0, 0),
            ],
            findings: vec![
                finding(
                    "config", "error", "tau.config.endpoint",
                    "inference.endpoint not set",
                    Some("set inference.endpoint in tau.toml"),
                    Some(("tau.toml", Some(3))),
                ),
                finding(
                    "lockfile", "needs-setup", "tau.lockfile.missing",
                    "no lockfile — packages not installed",
                    Some("run `tau install`"),
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
            vec!["config", "lockfile", "packages", "sandbox", "plugins", "skills"]
        );
        let config = r.categories.iter().find(|c| c.name == "config").unwrap();
        assert_eq!(config.errors, 1);
        let lock = r.categories.iter().find(|c| c.name == "lockfile").unwrap();
        assert_eq!((lock.errors, lock.warnings, lock.needs_setup), (0, 0, 1));
        let err = r.findings.iter().find(|f| f.severity == "error").unwrap();
        assert_eq!(err.rule, "tau.config.endpoint");
        assert_eq!(err.location.as_ref().unwrap().path, "tau.toml");
        assert!(r.findings.iter().any(|f| f.severity == "needs-setup"));
        assert!(err.remediation.is_some());
        assert_eq!(r.sandbox.tier, "seatbelt");
    }

    #[test]
    fn cli_checks_is_empty() {
        let r = CliChecks.report();
        assert!(r.categories.is_empty());
        assert!(r.findings.is_empty());
    }
}
