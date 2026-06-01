import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useStore } from "../store/store";

function renderNavbar() {
  render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>,
  );
}

describe("Navbar", () => {
  it("shows the project path and tau version inside a project", () => {
    useStore.setState({
      project: { project_path: "/p/demo", agents: ["greeter"], tau_version: "0.0.0-mock" },
      projects: [],
      activeProjectId: "demo",
    });
    renderNavbar();
    expect(screen.getByText(/\/p\/demo/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
  });

  it("shows 'All projects' and no Save-as on the overview", () => {
    useStore.setState({ project: null, projects: [], activeProjectId: "" });
    renderNavbar();
    expect(screen.getByLabelText("project switcher")).toHaveTextContent("All projects");
    expect(screen.queryByLabelText("save as project")).not.toBeInTheDocument();
  });

  it("shows Save-as only inside the workspace", () => {
    useStore.setState({ project: null, projects: [], activeProjectId: "workspace" });
    renderNavbar();
    expect(screen.getByLabelText("save as project")).toBeInTheDocument();
  });
});
