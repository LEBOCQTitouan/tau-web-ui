import { describe, it, expect } from "vitest";
import { buildForest } from "./forest";
import type { Span } from "../types/Span";

function span(id: string, parent: string | null): Span {
  return {
    id,
    parent_id: parent,
    run_id: "R1",
    kind: "tool_call",
    name: id,
    status: "ok",
    started_at: "t",
    ended_at: null,
    attributes: {},
  };
}

describe("buildForest", () => {
  it("returns DFS order with depth and resolved parents", () => {
    const rows = buildForest([span("t1", null), span("a", "t1"), span("b", "a"), span("c", "t1")]);
    expect(rows.map((r) => r.span.id)).toEqual(["t1", "a", "b", "c"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
    expect(rows.find((r) => r.span.id === "b")!.resolvedParent).toBe("a");
  });

  it("flags hasChildren", () => {
    const rows = buildForest([span("t1", null), span("a", "t1")]);
    expect(rows.find((r) => r.span.id === "t1")!.hasChildren).toBe(true);
    expect(rows.find((r) => r.span.id === "a")!.hasChildren).toBe(false);
  });

  it("treats a missing parent as a root (orphan tolerance)", () => {
    const rows = buildForest([span("x", "ghost")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].resolvedParent).toBeNull();
  });
});
