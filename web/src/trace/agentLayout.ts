import type { Node, Edge } from "@xyflow/react";
import type { AgentMapData, AgentNode } from "./agentMap";

export interface AgentNodeData extends Record<string, unknown> {
  name: string;
  status: AgentNode["status"];
  toolCount: number;
  tokens: number | null;
  isRoot: boolean;
}

const X_GAP = 240;
const Y_GAP = 76;

/** Tree layout: x = spawn depth, y = sibling order within a depth. */
export function agentMapToFlow(map: AgentMapData): { nodes: Node<AgentNodeData>[]; edges: Edge[] } {
  const yAt = new Map<number, number>();
  const nodes: Node<AgentNodeData>[] = map.agents.map((a) => {
    const y = yAt.get(a.depth) ?? 0;
    yAt.set(a.depth, y + 1);
    return {
      id: a.id,
      type: "agent",
      position: { x: a.depth * X_GAP, y: y * Y_GAP },
      data: {
        name: a.name,
        status: a.status,
        toolCount: a.toolCount,
        tokens: a.tokens,
        isRoot: a.parentAgentId === null,
      },
    };
  });
  const running = new Set(map.agents.filter((a) => a.status === "running").map((a) => a.id));
  const edges: Edge[] = map.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    animated: running.has(e.target),
    style: { stroke: "rgb(var(--accent))", strokeDasharray: "5 3" },
  }));
  return { nodes, edges };
}
