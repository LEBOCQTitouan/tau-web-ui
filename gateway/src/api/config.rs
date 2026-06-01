use axum::{http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;
use crate::config::ProjectConfig;

pub async fn get(Scoped(state): Scoped) -> Result<Json<ProjectConfig>, (StatusCode, String)> {
    state
        .config_read()
        .map(Json)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[derive(Deserialize)]
pub struct PutBody {
    pub name: String,
    pub description: Option<String>,
}

pub async fn put(
    Scoped(state): Scoped,
    Json(b): Json<PutBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .config_write(&b.name, b.description.as_deref())
        .map(|_| Json(json!({ "ok": true })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
