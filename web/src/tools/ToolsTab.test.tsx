import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolsTab } from "./ToolsTab";

const tools = [
  {
    name: "fs-read",
    version: "1.0.0",
    source: "github.com/tau/fs-read",
    provides: "tool",
    plugin_kind: "rust-cargo",
    binary: "fs-read",
    capabilities: [{ kind: "fs.read", fields: { paths: ["/x/**"] } }],
    used_by: [{ kind: "skill", name: "critic" }],
  },
  {
    name: "shell",
    version: "0.2.0",
    source: "github.com/tau/shell",
    provides: "tool",
    plugin_kind: "rust-cargo",
    binary: "shell",
    capabilities: [{ kind: "process.spawn", fields: { commands: ["sh"] } }],
    used_by: [],
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => tools }));
});

describe("ToolsTab", () => {
  it("lists tools and expands one to show capability + used_by", async () => {
    const user = userEvent.setup();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText("fs-read")).toBeInTheDocument());
    expect(screen.getByText("shell")).toBeInTheDocument();

    // expand fs-read
    await user.click(screen.getByRole("button", { name: /fs-read/i }));
    expect(screen.getByText(/fs\.read/)).toBeInTheDocument();
    expect(screen.getByText("critic")).toBeInTheDocument();
  });

  it("shows 'unused' for a tool with no users when expanded", async () => {
    const user = userEvent.setup();
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText("shell")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /shell/i }));
    expect(screen.getByText(/unused/i)).toBeInTheDocument();
  });
});
