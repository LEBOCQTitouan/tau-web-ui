//! Cloning a project from a git URL into a workspace dir. `GitCloner` shells
//! `git clone`; `MockCloner` seeds a minimal `tau.toml` so mock/e2e runs need no
//! network. Selected by the gateway based on the configured tau binary.

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Result};

pub trait ProjectCloner: Send + Sync {
    /// Clone `url` into `dest` (which must not already exist).
    fn clone(&self, url: &str, dest: &Path) -> Result<()>;
}

pub struct GitCloner;

impl ProjectCloner for GitCloner {
    fn clone(&self, url: &str, dest: &Path) -> Result<()> {
        let out = Command::new("git")
            .arg("clone")
            .arg("--depth")
            .arg("1")
            .arg(url)
            .arg(dest)
            .output()?;
        if !out.status.success() {
            bail!(
                "git clone failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Ok(())
    }
}

/// Test/mock cloner: creates `dest` with a minimal `tau.toml` named after the
/// repo's last path segment, so registration validation succeeds offline.
pub struct MockCloner;

impl ProjectCloner for MockCloner {
    fn clone(&self, url: &str, dest: &Path) -> Result<()> {
        std::fs::create_dir_all(dest)?;
        let name = crate::packages::name_from_url(url);
        std::fs::write(
            dest.join("tau.toml"),
            format!("[project]\nname = \"{name}\"\n"),
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_cloner_seeds_tau_toml() {
        let d = tempfile::tempdir().unwrap();
        let dest = d.path().join("repo");
        MockCloner
            .clone("https://github.com/acme/cool-bot.git", &dest)
            .unwrap();
        let toml = std::fs::read_to_string(dest.join("tau.toml")).unwrap();
        assert!(toml.contains("name = \"cool-bot\""));
    }
}
