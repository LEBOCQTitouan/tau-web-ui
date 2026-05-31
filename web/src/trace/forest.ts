import type { Span } from "../types/Span";

export interface ForestRow {
  span: Span;
  depth: number;
  resolvedParent: string | null;
  hasChildren: boolean;
}

/** Depth-first rows. A parent_id that isn't present in `spans` is treated as a root. */
export function buildForest(spans: Span[]): ForestRow[] {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const childrenOf = new Map<string | null, Span[]>();
  for (const s of spans) {
    const key = s.parent_id && byId.has(s.parent_id) ? s.parent_id : null;
    const list = childrenOf.get(key) ?? [];
    list.push(s);
    childrenOf.set(key, list);
  }
  const rows: ForestRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of childrenOf.get(parent) ?? []) {
      const resolvedParent = s.parent_id && byId.has(s.parent_id) ? s.parent_id : null;
      rows.push({
        span: s,
        depth,
        resolvedParent,
        hasChildren: (childrenOf.get(s.id) ?? []).length > 0,
      });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
