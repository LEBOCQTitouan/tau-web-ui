//! log-adapter: maps tau workflow-run JSONL (StepRecord) onto the Trace model.
//! Each StepRecord is an already-completed step → one closed Span. Steps are a
//! flat ordered sequence (rendered as a waterfall).

use serde::Deserialize;

use crate::adapters::TraceDelta;
use crate::trace::{Span, SpanKind, SpanStatus};

/// One line of `<scope>/.tau/workflow-runs/<name>-<run-id>.jsonl`.
#[derive(Debug, Clone, Deserialize)]
pub struct StepRecord {
    pub ts: String,
    pub run_id: String,
    pub step_id: String,
    pub step_index: u32,
    pub kind: String, // "agent.run" | "tool.call"
    pub input: String,
    pub output: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: u64,
    pub status: String, // "ok" | "failed"
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

pub struct LogAdapter {
    run_id: String,
}

impl LogAdapter {
    pub fn new(run_id: String) -> Self {
        LogAdapter { run_id }
    }

    /// Map one completed StepRecord to a closed Span delta.
    pub fn on_step(&self, rec: &StepRecord) -> Vec<TraceDelta> {
        let kind = if rec.kind == "agent.run" {
            SpanKind::Agent
        } else {
            SpanKind::ToolCall
        };
        let status = if rec.status == "failed" {
            SpanStatus::Error
        } else {
            SpanStatus::Ok
        };
        let span = Span {
            id: format!("{}-step-{}", self.run_id, rec.step_index),
            parent_id: None,
            run_id: self.run_id.clone(),
            kind,
            name: rec.step_id.clone(),
            status,
            started_at: rec.started_at.clone(),
            ended_at: Some(rec.ended_at.clone()),
            attributes: serde_json::json!({
                "input": rec.input,
                "output": rec.output,
                "kind": rec.kind,
                "step_index": rec.step_index,
                "error": rec.error,
                "detail": rec.detail,
            }),
        };
        vec![TraceDelta::SpanOpened(span)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(kind: &str, status: &str) -> StepRecord {
        StepRecord {
            ts: "2026-05-31T00:00:00Z".into(),
            run_id: "R1".into(),
            step_id: "gather".into(),
            step_index: 0,
            kind: kind.into(),
            input: "hi".into(),
            output: "done".into(),
            started_at: "2026-05-31T00:00:00Z".into(),
            ended_at: "2026-05-31T00:00:01Z".into(),
            duration_ms: 1000,
            status: status.into(),
            error: None,
            detail: None,
        }
    }

    #[test]
    fn agent_step_maps_to_agent_span_ok() {
        let a = LogAdapter::new("R1".into());
        let d = a.on_step(&rec("agent.run", "ok"));
        let span = match &d[0] {
            TraceDelta::SpanOpened(s) => s.clone(),
            _ => panic!("expected SpanOpened"),
        };
        assert_eq!(span.kind, SpanKind::Agent);
        assert_eq!(span.status, SpanStatus::Ok);
        assert_eq!(span.name, "gather");
        assert_eq!(span.attributes["input"], "hi");
        assert_eq!(span.attributes["output"], "done");
    }

    #[test]
    fn tool_step_failed_maps_to_toolcall_error() {
        let a = LogAdapter::new("R1".into());
        let mut r = rec("tool.call", "failed");
        r.error = Some("tool_error".into());
        let d = a.on_step(&r);
        let span = match &d[0] {
            TraceDelta::SpanOpened(s) => s.clone(),
            _ => panic!("expected SpanOpened"),
        };
        assert_eq!(span.kind, SpanKind::ToolCall);
        assert_eq!(span.status, SpanStatus::Error);
        assert_eq!(span.attributes["error"], "tool_error");
    }
}
