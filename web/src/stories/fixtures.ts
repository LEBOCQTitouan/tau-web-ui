// Static fixtures for Storybook so store-coupled components render without a
// live gateway. Timestamps are fixed ISO strings (deterministic snapshots).
import type { Run } from "../types/Run";
import type { Span } from "../types/Span";
import type { Event } from "../types/Event";
import type { Health, Project, Trace } from "../api/client";

export const health: Health = {
  gateway_ok: true,
  tau_bin: "/usr/local/bin/tau",
  tau_version: "0.4.2",
  engine_ok: true,
};

export const healthDown: Health = {
  gateway_ok: true,
  tau_bin: "/usr/local/bin/tau",
  tau_version: "0.4.2",
  engine_ok: false,
};

export const project: Project = {
  project_path: "/Users/dev/projects/acme-agents",
  agents: ["researcher", "coder", "reviewer"],
  tau_version: "0.4.2",
};

export const runs: Run[] = [
  {
    id: "run-001",
    agent_id: "researcher",
    prompt: "Summarize the latest changes in the repo.",
    substrate: "host",
    mode: "dev",
    status: "completed",
    started_at: "2026-05-31T14:02:11Z",
    ended_at: "2026-05-31T14:02:19Z",
    total_turns: 3,
    token_usage: { input_tokens: 1820, output_tokens: 540, total_tokens: 2360 },
    stop_reason: "end_turn",
    error: null,
    source: "serve",
  },
  {
    id: "run-002",
    agent_id: "coder",
    prompt: "Implement the new endpoint.",
    substrate: "wasm",
    mode: "prod",
    status: "running",
    started_at: "2026-05-31T14:05:00Z",
    ended_at: null,
    total_turns: 1,
    token_usage: { input_tokens: 640, output_tokens: 120, total_tokens: 760 },
    stop_reason: null,
    error: null,
    source: "serve",
  },
  {
    id: "run-003",
    agent_id: "reviewer",
    prompt: "Review the open PR.",
    substrate: "c-abi",
    mode: "dev",
    status: "failed",
    started_at: "2026-05-31T13:48:30Z",
    ended_at: "2026-05-31T13:48:34Z",
    total_turns: 2,
    token_usage: { input_tokens: 980, output_tokens: 210, total_tokens: 1190 },
    stop_reason: "error",
    error: { kind: "tool_error", detail: "write_file: permission denied" },
    source: "log",
  },
  {
    id: "run-004",
    agent_id: "coder",
    prompt: "Refactor the parser.",
    substrate: "mcu",
    mode: "prod",
    status: "cancelled",
    started_at: "2026-05-31T13:30:00Z",
    ended_at: "2026-05-31T13:30:12Z",
    total_turns: 1,
    token_usage: null,
    stop_reason: "cancelled",
    error: null,
    source: "otlp",
  },
];

export const runningRun: Run = runs[1];

export const spans: Span[] = [
  {
    id: "s-run",
    parent_id: null,
    run_id: "run-002",
    kind: "run",
    name: "run",
    status: "running",
    started_at: "2026-05-31T14:05:00Z",
    ended_at: null,
    attributes: {},
  },
  {
    id: "s-turn1",
    parent_id: "s-run",
    run_id: "run-002",
    kind: "turn",
    name: "turn 1",
    status: "ok",
    started_at: "2026-05-31T14:05:00Z",
    ended_at: "2026-05-31T14:05:04Z",
    attributes: { usage: { input_tokens: 320, output_tokens: 60 } },
  },
  {
    id: "s-tool1",
    parent_id: "s-turn1",
    run_id: "run-002",
    kind: "tool_call",
    name: "read_file",
    status: "ok",
    started_at: "2026-05-31T14:05:01Z",
    ended_at: "2026-05-31T14:05:01Z",
    attributes: {
      args: { path: "src/server.ts" },
      result: { bytes: 4096 },
      usage: { input_tokens: 120, output_tokens: 10 },
    },
  },
  {
    id: "s-tool2",
    parent_id: "s-turn1",
    run_id: "run-002",
    kind: "tool_call",
    name: "search",
    status: "running",
    started_at: "2026-05-31T14:05:03Z",
    ended_at: null,
    attributes: { args: { query: "router endpoint" } },
  },
  {
    id: "s-tool3",
    parent_id: "s-turn1",
    run_id: "run-002",
    kind: "tool_call",
    name: "write_file",
    status: "error",
    started_at: "2026-05-31T14:05:02Z",
    ended_at: "2026-05-31T14:05:02Z",
    attributes: {
      args: { path: "/etc/hosts" },
      error: { kind: "io", detail: "permission denied" },
    },
  },
];

export const assistantText =
  "I'll start by reading the server entrypoint to understand the existing routes, " +
  "then add the new endpoint and wire it up.\n\nReading src/server.ts…";

// text_delta events the store replays into assistantText (assistantTextFromEvents).
export const events: Event[] = [
  {
    run_id: "run-002",
    span_id: "s-turn1",
    ts: "2026-05-31T14:05:00Z",
    kind: "text_delta",
    payload: { text: assistantText },
  },
];

export const trace: Trace = { run: runningRun, spans, events };
