import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectsHome } from "./ProjectsHome";
import { useStore } from "../store/store";

function item(id: string, runs: number, failed: number) {
  return {
    meta: { id, name: id, path: `/p/${id}`, source: { kind: "local" } },
    summary: {
      runs,
      running: 1,
      failed_24h: failed,
      success_rate: 0.9,
      tokens: 1_200_000,
      last_activity: null,
      agents: 2,
      engine_ok: true,
    },
  };
}

beforeEach(() => {
  useStore.setState({ projects: [item("demo", 10, 1), item("acme-bot", 5, 0)] as never });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

describe("ProjectsHome", () => {
  it("renders a card per project and the global summary", () => {
    render(
      <MemoryRouter>
        <ProjectsHome />
      </MemoryRouter>,
    );
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText("acme-bot")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByLabelText("project path")).toBeInTheDocument();
  });
});
