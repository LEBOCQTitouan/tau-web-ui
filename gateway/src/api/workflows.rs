use axum::{http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;

pub async fn list(Scoped(state): Scoped) -> Json<Value> {
    Json(json!({ "workflows": state.list_workflows() }))
}

#[derive(Deserialize)]
pub struct RunBody {
    pub workflow: String,
    pub input: String,
}

pub async fn run(
    Scoped(state): Scoped,
    Json(body): Json<RunBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let run_id = state
        .launch_workflow(body.workflow, body.input)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    Ok(Json(json!({ "run_id": run_id })))
}
