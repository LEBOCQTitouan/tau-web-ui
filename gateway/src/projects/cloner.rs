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

/// Accept only remote git URLs with an explicit, known scheme — never a value
/// that begins with `-` (flag smuggling) or a bare local path.
fn is_safe_git_url(url: &str) -> bool {
    if url.starts_with('-') {
        return false;
    }
    const SCHEMES: [&str; 4] = ["https://", "http://", "ssh://", "git://"];
    let scheme_ok = SCHEMES.iter().any(|s| url.starts_with(s));
    // scp-like syntax (`git@host:org/repo.git`) is also common and safe: it has
    // no scheme but contains a ':' before any '/'.
    let scp_like = !url.contains("://")
        && url
            .find(':')
            .map(|c| url[..c].contains('@'))
            .unwrap_or(false);
    scheme_ok || scp_like
}

pub struct GitCloner;

impl ProjectCloner for GitCloner {
    fn clone(&self, url: &str, dest: &Path) -> Result<()> {
        // The URL is user-supplied (add-project request). Reject anything that
        // could be smuggled to `git` as a flag, and only allow known remote
        // schemes. The `--` end-of-options marker is a second line of defense.
        if !is_safe_git_url(url) {
            bail!("invalid git url: {url}");
        }
        let out = Command::new("git")
            .arg("clone")
            .arg("--depth")
            .arg("1")
            .arg("--")
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

    #[test]
    fn rejects_flag_smuggling_and_bare_paths() {
        assert!(is_safe_git_url("https://github.com/acme/bot.git"));
        assert!(is_safe_git_url("git@github.com:acme/bot.git"));
        assert!(!is_safe_git_url("--upload-pack=touch /tmp/pwned"));
        assert!(!is_safe_git_url("-oProxyCommand=evil"));
        assert!(!is_safe_git_url("/local/path"));
        assert!(!is_safe_git_url("ext::sh -c evil"));
    }
}
