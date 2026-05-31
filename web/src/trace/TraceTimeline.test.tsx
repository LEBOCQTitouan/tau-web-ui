import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TraceTimeline } from "./TraceTimeline";
import { useStore } from "../store/store";
import type { Span } from "../types/Span";

function span(id: string, parent: string | null): Span {
  return {
    id,
    parent_id: parent,
    run_id: "R1",
    kind: "tool_call",
    name: id,
    status: "ok",
    started_at: "2026-05-31T00:00:00.000Z",
    ended_at: "2026-05-31T00:00:01.000Z",
    attributes: {},
  };
}

beforeEach(() => useStore.setState({ selectedSpanId: null }));

describe("TraceTimeline", () => {
  it("renders a row per span and selects on click", () => {
    render(<TraceTimeline spans={[span("turn1", null), span("fs-read", "turn1")]} />);
    expect(screen.getByText("turn1")).toBeInTheDocument();
    const row = screen.getByText("fs-read");
    fireEvent.click(row);
    expect(useStore.getState().selectedSpanId).toBe("fs-read");
  });
});
