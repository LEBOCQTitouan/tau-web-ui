import { describe, it, expect } from "vitest";
import { spansToTimeline } from "./timeline";
import type { Span } from "../types/Span";

function span(id: string, parent: string | null, start: string, end: string | null): Span {
  return {
    id,
    parent_id: parent,
    run_id: "R1",
    kind: "tool_call",
    name: id,
    status: end ? "ok" : "running",
    started_at: start,
    ended_at: end,
    attributes: {},
  };
}

const T = (s: number) => `2026-05-31T00:00:0${s}.000Z`;

describe("spansToTimeline", () => {
  it("places sequential spans by offset and width across the run window", () => {
    const rows = spansToTimeline([span("A", null, T(0), T(1)), span("B", null, T(2), T(4))]);
    const a = rows.find((r) => r.span.id === "A")!;
    const b = rows.find((r) => r.span.id === "B")!;
    expect(a.offsetPct).toBeCloseTo(0, 1);
    expect(a.widthPct).toBeCloseTo(25, 1);
    expect(b.offsetPct).toBeCloseTo(50, 1);
    expect(b.widthPct).toBeCloseTo(50, 1);
  });

  it("extends a running span (no ended_at) to the window end", () => {
    const rows = spansToTimeline([span("A", null, T(0), null), span("B", null, T(1), T(3))]);
    const a = rows.find((r) => r.span.id === "A")!;
    expect(a.offsetPct).toBeCloseTo(0, 1);
    expect(a.widthPct).toBeCloseTo(100, 1);
  });

  it("preserves DFS nesting depth", () => {
    const rows = spansToTimeline([span("t", null, T(0), T(4)), span("c", "t", T(1), T(2))]);
    expect(rows.map((r) => r.span.id)).toEqual(["t", "c"]);
    expect(rows.find((r) => r.span.id === "c")!.depth).toBe(1);
    expect(rows.find((r) => r.span.id === "c")!.resolvedParent).toBe("t");
  });

  it("guards a zero-width window (all same timestamp) without NaN", () => {
    const rows = spansToTimeline([span("A", null, T(0), T(0))]);
    expect(Number.isFinite(rows[0].offsetPct)).toBe(true);
    expect(Number.isFinite(rows[0].widthPct)).toBe(true);
    expect(rows[0].widthPct).toBeGreaterThan(0);
  });
});
