import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ runs: [] }));

describe("Sidebar", () => {
  it("renders the Build and Operate group labels", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Operate")).toBeInTheDocument();
  });

  it("renders all surface links with correct hrefs", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const expected: [RegExp, string][] = [
      [/dashboard/i, "/dashboard"],
      [/agents/i, "/agents"],
      [/workflows/i, "/workflows"],
      [/tools/i, "/tools"],
      [/packages/i, "/packages"],
      [/config/i, "/config"],
      [/runs/i, "/runs"],
      [/ship/i, "/ship"],
      [/health/i, "/health"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("badges the partially-gated areas (Workflows, Config, Ship)", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/gated/i)).toHaveLength(3);
  });

  it("shows a running-count badge on Runs when runs are in flight", () => {
    useStore.setState({
      runs: [{ id: "a", status: "running" } as never, { id: "b", status: "completed" } as never],
    });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
