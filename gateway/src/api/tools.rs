use axum::Json;

use crate::api::scope::Scoped;
use crate::tools::ToolDetail;

pub async fn list(Scoped(state): Scoped) -> Json<Vec<ToolDetail>> {
    Json(state.list_tools())
}
