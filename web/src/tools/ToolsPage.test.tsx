import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ToolsPage } from "./ToolsPage";

beforeEach(() => {
  // both SkillsIndex and ToolsTab fetch on mount — stub to empty arrays
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

function renderAt() {
  render(
    <MemoryRouter initialEntries={["/projects/demo/tools"]}>
      <Routes>
        <Route path="/projects/:pid/tools" element={<ToolsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ToolsPage tabs", () => {
  it("defaults to Skills, switches to Tools, Plugins is disabled", async () => {
    const user = userEvent.setup();
    renderAt();
    // Skills tab shows the import-skill control
    expect(screen.getByLabelText("import skill git url")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    // Tools tab shows the tools table header "provides"
    expect(screen.getByText("provides")).toBeInTheDocument();
    expect(screen.queryByLabelText("import skill git url")).not.toBeInTheDocument();

    // Plugins is a disabled element, not a switchable tab
    expect(screen.getByText(/plugins/i).closest("[aria-disabled]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
