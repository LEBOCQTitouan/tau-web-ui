import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ActivityFeed } from "./ActivityFeed";

function run(pid: string, agent: string, status: string) {
  return {
    project_id: pid,
    project_name: pid,
    run: { id: `${pid}-${agent}`, agent_id: agent, status, started_at: "t" },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("ActivityFeed", () => {
  it("loads failures first, then toggles to all runs", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [run("demo", "summariser", "failed")] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [run("demo", "greeter", "completed")],
      });
    vi.stubGlobal("fetch", f);

    render(
      <MemoryRouter>
        <ActivityFeed />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("summariser")).toBeInTheDocument());
    expect(f.mock.calls[0][0]).toContain("status=failed");

    await userEvent.click(screen.getByRole("button", { name: "All runs" }));
    await waitFor(() => expect(screen.getByText("greeter")).toBeInTheDocument());
    expect(f.mock.calls[1][0]).not.toContain("status=");
  });
});
