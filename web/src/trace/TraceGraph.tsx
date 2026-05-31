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
import { spansToFlow, type SpanNodeData } from "./layout";
import { useStore } from "../store/store";

const FILL: Record<string, string> = {
  running: "bg-st-running-soft border-st-running/40",
  ok: "bg-st-ok-soft border-st-ok/40",
  error: "bg-st-error-soft border-st-error/40",
};

function SpanNode({ data, id }: NodeProps<Node<SpanNodeData>>) {
  const selected = useStore((s) => s.selectedSpanId === id);
  return (
    <div
      className={`min-w-[120px] rounded-lg border px-2.5 py-1.5 text-xs ${
        FILL[data.status] ?? "border-border bg-surface"
      } ${selected ? "ring-2 ring-accent" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold">{data.label}</div>
      <div className="text-muted">
        {data.kind} · {data.status}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { span: SpanNode };

export function TraceGraph({ spans }: { spans: Span[] }) {
  const select = useStore((s) => s.selectSpan);
  const { nodes, edges } = useMemo(() => spansToFlow(spans), [spans]);
  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
