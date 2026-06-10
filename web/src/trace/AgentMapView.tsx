import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { Span } from "../types/Span";
import type { Run } from "../types/Run";
import type { SpanStatus } from "../types/SpanStatus";
import { buildAgentMap, ROOT_AGENT_ID } from "./agentMap";
import { agentMapToFlow, type AgentNodeData } from "./agentLayout";
import { useStore } from "../store/store";

const DOT: Record<SpanStatus, string> = {
  running: "bg-st-running animate-pulse",
  ok: "bg-st-ok",
  error: "bg-st-error",
};

function runToSpanStatus(s: Run["status"]): SpanStatus {
  return s === "completed" ? "ok" : s === "running" ? "running" : "error";
}

function AgentNodeView({ data, id }: NodeProps<Node<AgentNodeData>>) {
  const selected = useStore((s) => s.selectedSpanId === id);
  const handle = "!h-2 !w-2 !border !border-border !bg-muted";
  return (
    <div
      className={`min-w-[150px] rounded-xl border bg-surface px-3 py-2 text-xs shadow-sm ${
        selected ? "ring-2 ring-accent" : "border-accent/30"
      }`}
    >
      <Handle type="target" position={Position.Left} className={handle} />
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-accent text-[11px] text-white">
          ◆
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate font-semibold">{data.name}</span>
            {data.isRoot && (
              <span className="rounded bg-bg px-1 text-[8px] font-bold uppercase text-muted">
                root
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[data.status]}`} />
            {data.status} · {data.toolCount} tools
            {data.tokens !== null && <span>· {data.tokens} tok</span>}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={handle} />
    </div>
  );
}

const nodeTypes = { agent: AgentNodeView };

export function AgentMap({ spans, run }: { spans: Span[]; run: Run }) {
  const select = useStore((s) => s.selectSpan);
  const { nodes, edges } = useMemo(
    () => agentMapToFlow(buildAgentMap(spans, run.agent_id, runToSpanStatus(run.status))),
    [spans, run.agent_id, run.status],
  );
  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_, n) => select(n.id === ROOT_AGENT_ID ? null : n.id)}
        onPaneClick={() => select(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
