use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;
use crate::trace::Run;

#[derive(Deserialize)]
pub struct LaunchBody {
    pub agent_id: String,
    pub prompt: String,
}

pub async fn launch(
    Scoped(state): Scoped,
    Json(body): Json<LaunchBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let run_id = state
        .launch(body.agent_id, body.prompt)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    Ok(Json(json!({ "run_id": run_id })))
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub status: Option<String>,
    pub agent: Option<String>,
}

pub async fn list(Scoped(state): Scoped, Query(q): Query<ListQuery>) -> Json<Vec<Run>> {
    let mut runs = state.list_runs().await;
    if let Some(s) = q.status.as_deref() {
        runs.retain(|r| {
            serde_json::to_value(&r.status)
                .ok()
                .and_then(|v| v.as_str().map(|x| x == s))
                .unwrap_or(false)
        });
    }
    if let Some(a) = q.agent.as_deref() {
        runs.retain(|r| r.agent_id == a);
    }
    Json(runs)
}

pub async fn get_one(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Result<Json<Value>, StatusCode> {
    match state.load_trace(&id) {
        Some((run, spans, events)) => Ok(Json(
            json!({ "run": run, "spans": spans, "events": events }),
        )),
        None => Err(StatusCode::NOT_FOUND),
    }
}

pub async fn cancel(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Json<Value> {
    let cancelled = state.cancel(&id).await.unwrap_or(false);
    Json(json!({ "cancelled": cancelled }))
}
