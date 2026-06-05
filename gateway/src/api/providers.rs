use axum::Json;

use crate::api::scope::Scoped;
use crate::providers::Provider;

pub async fn list(Scoped(state): Scoped) -> Json<Vec<Provider>> {
    Json(state.providers())
}
