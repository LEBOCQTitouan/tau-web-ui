# Graph editor (surface ①)

Built in this directory: the Workflow graph editor (gated β.2). See
`docs/superpowers/specs/2026-06-02-workflow-graph-editor-design.md`.

- `GraphEditor.tsx` — view-by-default editor (workflow picker, View↔Edit toggle,
  node inspector, add-step palette, gated "Build from IR").
- `GraphCanvas.tsx` + `StepNode.tsx` — the `@xyflow/react` canvas, shared in spirit
  with `trace/TraceGraph.tsx`; edit mode only differs by enabling drag/connect/add.
- `layout.ts` — pure `workflowToFlow` (deterministic DAG layout).

Graph data is mock-first via the gateway `WorkflowGraphSource` seam
(`gateway/src/graph/mod.rs`); `GET /api/projects/:pid/workflows/:name/graph`.

## Still deferred (the remaining seam — tau β.2 Workflow IR, framing D)

- **Edits don't persist.** Edit mode mutates local React state only; "Build from IR"
  is gated/disabled.
- When tau ships the Workflow IR: add a `declarations` module + IR (de)serializer,
  wire `CliGraph` to parse `workflows/*.toml` (replacing the mock), and add
  `POST /api/build-from-ir` so the edited graph can be saved back.
