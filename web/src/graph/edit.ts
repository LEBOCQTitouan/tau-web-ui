import type { Node, Edge } from "@xyflow/react";
import { type StepNodeData, X_GAP } from "./layout";

export interface StepPick {
  kind: "agent.run" | "tool.call";
  agent?: string | null;
}

type Graph = { nodes: Node<StepNodeData>[]; edges: Edge[] };

/** Next `step-N` id (one past the highest existing numeric suffix). */
export function nextStepId(nodes: Node<StepNodeData>[]): string {
  let max = 0;
  for (const node of nodes) {
    const m = /^step-(\d+)$/.exec(node.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `step-${max + 1}`;
}

function buildStepNode(
  id: string,
  pick: StepPick,
  recommended: string,
  position: { x: number; y: number },
): Node<StepNodeData> {
  const isAgent = pick.kind === "agent.run";
  return {
    id,
    type: "step",
    position,
    data: {
      label: id,
      kind: pick.kind,
      agent: isAgent ? (pick.agent ?? "researcher") : null,
      tool: isAgent ? null : "fs-write",
      input: null,
      provider: isAgent ? recommended || null : null,
      tools: [],
      disabled: false,
    },
  };
}

/** Add a step after `fromId` and connect them. No-op if `fromId` is missing. */
export function addNextStep(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
  fromId: string,
  pick: StepPick,
  recommended: string,
): Graph {
  const from = nodes.find((node) => node.id === fromId);
  if (!from) return { nodes, edges };
  const id = nextStepId(nodes);
  const node = buildStepNode(id, pick, recommended, {
    x: from.position.x + X_GAP,
    y: from.position.y,
  });
  return {
    nodes: [...nodes, node],
    edges: [...edges, { id: `${fromId}->${id}`, source: fromId, target: id, type: "step" }],
  };
}

/** Insert a step on `edgeId`, rewiring A->B into A->new->B. No-op if missing. */
export function insertStepOnEdge(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
  edgeId: string,
  pick: StepPick,
  recommended: string,
): Graph {
  const edge = edges.find((ed) => ed.id === edgeId);
  if (!edge) return { nodes, edges };
  const a = nodes.find((node) => node.id === edge.source);
  const b = nodes.find((node) => node.id === edge.target);
  const id = nextStepId(nodes);
  const position =
    a && b
      ? { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 }
      : { x: (a?.position.x ?? 0) + X_GAP, y: a?.position.y ?? 0 };
  const node = buildStepNode(id, pick, recommended, position);
  return {
    nodes: [...nodes, node],
    edges: [
      ...edges.filter((ed) => ed.id !== edgeId),
      { id: `${edge.source}->${id}`, source: edge.source, target: id, type: "step" },
      { id: `${id}->${edge.target}`, source: id, target: edge.target, type: "step" },
    ],
  };
}

/** Remove a node and any edge touching it. */
export function deleteNode(nodes: Node<StepNodeData>[], edges: Edge[], id: string): Graph {
  return {
    nodes: nodes.filter((node) => node.id !== id),
    edges: edges.filter((ed) => ed.source !== id && ed.target !== id),
  };
}

/** Clone a node with a fresh id + offset position (no edges copied). */
export function duplicateNode(
  nodes: Node<StepNodeData>[],
  id: string,
): { nodes: Node<StepNodeData>[]; newId: string | null } {
  const src = nodes.find((node) => node.id === id);
  if (!src) return { nodes, newId: null };
  const newId = nextStepId(nodes);
  const copy: Node<StepNodeData> = {
    ...src,
    id: newId,
    position: { x: src.position.x + 40, y: src.position.y + 50 },
    selected: false,
    data: { ...src.data, label: newId },
  };
  return { nodes: [...nodes, copy], newId };
}

/** Toggle the local `disabled` flag on one node (visual marker; Save is gated). */
export function toggleDisabled(nodes: Node<StepNodeData>[], id: string): Node<StepNodeData>[] {
  return nodes.map((node) =>
    node.id === id ? { ...node, data: { ...node.data, disabled: !node.data.disabled } } : node,
  );
}
