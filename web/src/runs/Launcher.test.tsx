import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Launcher } from "./Launcher";
import { useStore } from "../store/store";

beforeEach(() => {
  useStore.setState({
    project: { project_path: "/p", agents: ["greeter"], tau_version: "x" },
    workflows: ["nightly-research"],
  });
});

describe("Launcher", () => {
  it("switches to Workflow mode and calls launchWorkflow", async () => {
    const launchWorkflow = vi.fn().mockResolvedValue("R1");
    useStore.setState({ launchWorkflow });
    render(
      <MemoryRouter>
        <Launcher />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Workflow" }));
    expect(screen.getByRole("option", { name: "nightly-research" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("prompt"), { target: { value: "q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(launchWorkflow).toHaveBeenCalledWith("nightly-research", "q3");
  });
});
