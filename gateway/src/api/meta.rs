use axum::Json;
use serde_json::{json, Value};

use crate::api::scope::Scoped;

pub async fn project(Scoped(state): Scoped) -> Json<Value> {
    match state.handshake().await {
        Ok(hs) => Json(json!({
            "project_path": hs.project_path, "agents": hs.agents,
            "tau_version": hs.server_version,
        })),
        Err(e) => Json(json!({ "error": e.to_string() })),
    }
}

pub async fn health(Scoped(state): Scoped) -> Json<Value> {
    let (ok, ver) = match state.handshake().await {
        Ok(hs) => (true, hs.server_version),
        Err(_) => (false, String::new()),
    };
    Json(json!({
        "gateway_ok": true,
        "tau_bin": state.0.bin.to_string_lossy(),
        "tau_version": ver,
        "engine_ok": ok,
    }))
}
