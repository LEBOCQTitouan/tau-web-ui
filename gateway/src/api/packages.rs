use axum::{extract::Path, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;

pub async fn list(Scoped(state): Scoped) -> Json<Value> {
    Json(json!({ "packages": state.packages() }))
}

#[derive(Deserialize)]
pub struct InstallBody {
    pub git_url: String,
}

pub async fn install(
    Scoped(state): Scoped,
    Json(b): Json<InstallBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_install(&b.git_url)
        .map(|p| Json(json!({ "package": p })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn uninstall(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_uninstall(&name)
        .map(|_| Json(json!({ "ok": true })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[derive(Deserialize)]
pub struct UpdateBody {
    pub to: Option<String>,
}

pub async fn update(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
    Json(b): Json<UpdateBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_update(&name, b.to)
        .map(|p| Json(json!({ "package": p })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn resolve(Scoped(state): Scoped) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_resolve()
        .map(|pkgs| Json(json!({ "packages": pkgs })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn verify(Scoped(state): Scoped) -> Json<Value> {
    Json(json!({ "results": state.package_verify() }))
}
