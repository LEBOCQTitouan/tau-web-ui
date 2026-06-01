import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaveAsProjectForm } from "./SaveAsProjectForm";

beforeEach(() => vi.restoreAllMocks());

describe("SaveAsProjectForm", () => {
  it("posts the name and calls onSaved with the new project", async () => {
    const meta = { id: "saved", name: "saved", path: "/p/saved", source: { kind: "local" } };
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => meta });
    vi.stubGlobal("fetch", f);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<SaveAsProjectForm onSaved={onSaved} />);

    await user.type(screen.getByLabelText("project name"), "My Bot");
    await user.click(screen.getByRole("button", { name: /save as project/i }));

    expect(f.mock.calls[0][0]).toBe("/api/workspace/save-as");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ name: "My Bot" });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(meta));
  });

  it("shows an error when the gateway rejects", async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, text: async () => "target exists" });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<SaveAsProjectForm onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText("project name"), "My Bot");
    await user.click(screen.getByRole("button", { name: /save as project/i }));
    await vi.waitFor(() => expect(screen.getByText(/target exists/i)).toBeInTheDocument());
  });
});
