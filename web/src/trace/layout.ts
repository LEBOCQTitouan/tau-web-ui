import type { Node, Edge } from "@xyflow/react";
import type { Span } from "../types/Span";
import { buildForest } from "./forest";

export interface SpanNodeData extends Record<string, unknown> {
  label: string;
  kind: Span["kind"];
  status: Span["status"];
}

const X_GAP = 220;
const Y_GAP = 70;

/** Deterministic tree layout: x = depth, y = DFS order. Edges follow resolved parents. */
export function spansToFlow(spans: Span[]): { nodes: Node<SpanNodeData>[]; edges: Edge[] } {
  const rows = buildForest(spans);
  const nodes: Node<SpanNodeData>[] = rows.map((r, i) => ({
    id: r.span.id,
    position: { x: r.depth * X_GAP, y: i * Y_GAP },
    data: { label: r.span.name, kind: r.span.kind, status: r.span.status },
    type: "span",
  }));
  const edges: Edge[] = rows
    .filter((r) => r.resolvedParent !== null)
    .map((r) => ({
      id: `${r.resolvedParent}->${r.span.id}`,
      source: r.resolvedParent as string,
      target: r.span.id,
    }));
  return { nodes, edges };
}
