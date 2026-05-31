import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "../store/store";

describe("Sidebar", () => {
  beforeEach(() => useStore.setState({ runs: [] }));

  it("renders nav links with hrefs", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /runs/i })).toHaveAttribute("href", "/runs");
    expect(screen.getByRole("link", { name: /health/i })).toHaveAttribute("href", "/health");
  });

  it("shows a running-count badge when runs are in flight", () => {
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
