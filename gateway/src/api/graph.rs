use axum::extract::Path;
use axum::Json;

use crate::api::scope::Scoped;
use crate::graph::WorkflowGraph;

pub async fn graph(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Json<WorkflowGraph> {
    Json(state.workflow_graph(&name))
}
