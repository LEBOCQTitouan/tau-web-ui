use axum::{http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;

#[derive(Deserialize)]
pub struct ImportBody {
    pub git_url: String,
    pub llm_backend: String,
}

pub async fn import(
    Scoped(state): Scoped,
    Json(b): Json<ImportBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .import_agent(&b.git_url, &b.llm_backend)
        .map(|id| Json(json!({ "agent_id": id })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
