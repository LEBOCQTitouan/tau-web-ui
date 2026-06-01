use axum::Json;

use crate::api::scope::Scoped;
use crate::plugins::PluginDetail;

pub async fn list(Scoped(state): Scoped) -> Json<Vec<PluginDetail>> {
    Json(state.list_plugins())
}
