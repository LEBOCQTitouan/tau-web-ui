import type { Span } from "../types/Span";
import { buildForest } from "./forest";

export interface TimelineRow {
  span: Span;
  depth: number;
  resolvedParent: string | null;
  hasChildren: boolean;
  offsetPct: number;
  widthPct: number;
}

const MIN_WIDTH_PCT = 1.5;

/**
 * Waterfall layout: each span gets a horizontal bar positioned within the run's
 * [t0, t1] window. Running spans (no ended_at) extend to t1. `now` overrides the
 * window end for live runs; if omitted, the latest known timestamp is used.
 */
export function spansToTimeline(spans: Span[], now?: string): TimelineRow[] {
  const rows = buildForest(spans);
  const starts = spans.map((s) => Date.parse(s.started_at));
  const ends = spans.map((s) => (s.ended_at ? Date.parse(s.ended_at) : Number.NaN));
  const known = [...starts, ...ends.filter((n) => Number.isFinite(n))];
  const nowMs = now ? Date.parse(now) : known.length ? Math.max(...known) : 0;
  const t0 = starts.length ? Math.min(...starts) : 0;
  const t1 = Math.max(nowMs, ...starts);
  const span = t1 - t0;

  return rows.map((r) => {
    const start = Date.parse(r.span.started_at);
    const end = r.span.ended_at ? Date.parse(r.span.ended_at) : t1;
    const offsetPct = span > 0 ? ((start - t0) / span) * 100 : 0;
    const rawWidth = span > 0 ? ((end - start) / span) * 100 : MIN_WIDTH_PCT;
    return {
      span: r.span,
      depth: r.depth,
      resolvedParent: r.resolvedParent,
      hasChildren: r.hasChildren,
      offsetPct,
      widthPct: Math.max(MIN_WIDTH_PCT, rawWidth),
    };
  });
}
