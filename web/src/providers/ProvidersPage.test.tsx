import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProvidersPage } from "./ProvidersPage";

const providers = [
  { name: "anthropic", installed: true, recommended: true, source: "well-known", credentials_gated: true },
  { name: "openai", installed: false, recommended: false, source: "well-known", credentials_gated: true },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/providers"))
        return Promise.resolve({ ok: true, json: async () => providers });
      if (url.includes("/packages/install"))
        return Promise.resolve({ ok: true, json: async () => ({ package: { name: "added" } }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
});

describe("ProvidersPage", () => {
  it("renders the providers table; Set API key is gated", async () => {
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    expect(screen.getByText("openai")).toBeInTheDocument();
    // anthropic: installed + recommended badges
    expect(screen.getByText("✓ installed")).toBeInTheDocument();
    expect(screen.getByText("✓ recommended")).toBeInTheDocument();
    // openai: not installed
    expect(screen.getByText("not installed")).toBeInTheDocument();
    // every Set API key button is gated (disabled)
    const gated = screen.getAllByRole("button", { name: /Set API key/i });
    expect(gated.length).toBe(2);
    gated.forEach((b) => expect(b).toBeDisabled());
  });

  it("Add provider posts an install and reloads", async () => {
    const user = userEvent.setup();
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    await user.type(
      screen.getByLabelText("add provider git url"),
      "https://github.com/org/llm.git",
    );
    await user.click(screen.getByRole("button", { name: "Add provider" }));
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
        .mock.calls;
      const install = calls.find(([u]) => u.includes("/packages/install"));
      expect(install).toBeTruthy();
      expect(install?.[1]?.method).toBe("POST");
    });
  });
});
