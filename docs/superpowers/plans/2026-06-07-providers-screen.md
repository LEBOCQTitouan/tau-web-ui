# Providers screen (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `/projects/:pid/providers` screen (sub-project **D** of spec `2026-06-02-agent-providers-and-node-display-design.md` §4.4): a table of LLM providers (name · source · installed · recommended · gated "🔒 Set API key"), an **Add provider** control reusing the existing package install, and a **Sidebar** nav item — which also makes Plan 1's "⚙ Manage providers…" link land on a real route.

**Architecture:** Frontend-only. The gateway `GET /api/projects/:pid/providers` and `getProviders()` already exist (Plan 1). This adds a `ProvidersPage` React component (reads `getProviders()`, posts `installPackage()` to add), wires it into `App.tsx` routes and `Sidebar.tsx` nav, and covers it with a vitest component test + a Playwright e2e. The "Set API key" affordance is **gated/disabled** (tau β.5 credentials chain — the explicit NEXT sub-project).

**Tech Stack:** React 18, react-router-dom v6, Tailwind (semantic tokens), Vitest + Testing Library + user-event, Playwright. No gateway / Rust / ts-rs changes.

---

## File Structure

**New:** `web/src/providers/ProvidersPage.tsx`, `web/src/providers/ProvidersPage.test.tsx`.
**Modified:** `web/src/App.tsx` (route), `web/src/app/Sidebar.tsx` (nav item), `web/e2e/run.spec.ts` (e2e).

No gateway changes: `GET /providers` (returns `Provider[]`) and `installPackage(git_url)` (`POST /packages/install`) already exist and are reused as-is.

---

## Task 1: ProvidersPage component + unit test

**Files:** Create `web/src/providers/ProvidersPage.tsx`, `web/src/providers/ProvidersPage.test.tsx`.

Conventions to match (already in the codebase): `PackagesPage.tsx` is the closest sibling — same `reload()`/`useEffect` pattern, same install-by-git-url control, same table shell (`overflow-hidden rounded-lg border border-border bg-surface` + `<table className="w-full border-collapse text-xs">`). `ShipPage.test.tsx` is the page-test convention (renders the page directly — pages read the active project via the store-backed `scopedPath`, so no router wrapper is needed — and stubs `fetch` URL-by-URL). Known-good Tailwind tokens: `bg-st-ok-soft`/`text-st-ok` (the "ok" badge), `bg-amber-100`/`text-amber-800` (the gated/warning convention), `text-muted`, `border-border`, `bg-surface`, `bg-accent`/`text-accent-fg`.

- [ ] **Step 1: Write the failing test `web/src/providers/ProvidersPage.test.tsx`**

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test -- src/providers/ProvidersPage.test.tsx`
Expected: FAIL — cannot resolve `./ProvidersPage` (module doesn't exist yet).

- [ ] **Step 3: Create `web/src/providers/ProvidersPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { Provider } from "../types/Provider";
import { getProviders } from "../api/providers";
import { installPackage } from "../api/config";

export function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [url, setUrl] = useState("");

  const reload = () =>
    getProviders()
      .then(setProviders)
      .catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  async function onAdd() {
    if (!url.trim()) return;
    await installPackage(url).catch(() => {});
    setUrl("");
    reload();
  }

  const btn = "rounded-md px-2.5 py-1 text-xs font-medium";
  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const badge = "rounded px-1.5 py-0.5 text-[10px] font-medium";

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Providers</h2>
      <p className="max-w-2xl text-xs text-muted">
        LLM backends available to this project&apos;s agents. The <b>recommended</b> one is the
        most-used backend across your agents. A fully custom backend can also just be typed into an
        agent&apos;s provider field.
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <input
          aria-label="add provider git url"
          placeholder="https://github.com/org/llm-backend.git"
          className={`min-w-0 flex-1 ${input}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={onAdd} className={`${btn} bg-accent text-accent-fg`}>
          Add provider
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-3 py-2 font-medium">provider</th>
              <th className="px-3 py-2 font-medium">source</th>
              <th className="px-3 py-2 font-medium">installed</th>
              <th className="px-3 py-2 font-medium">recommended</th>
              <th className="px-3 py-2 font-medium">credentials</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.name} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted">{p.source}</td>
                <td className="px-3 py-2">
                  {p.installed ? (
                    <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ installed</span>
                  ) : (
                    <span className="text-[10px] text-muted">not installed</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {p.recommended && (
                    <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ recommended</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled
                    title="waits on tau β.5"
                    className={`${badge} cursor-not-allowed bg-amber-100 font-semibold text-amber-800 opacity-80`}
                  >
                    🔒 Set API key
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm test -- src/providers/ProvidersPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/providers/ProvidersPage.tsx web/src/providers/ProvidersPage.test.tsx
git commit -m "feat(web): Providers screen (table + add-provider + gated set-api-key)"
```

---

## Task 2: Wire the route + Sidebar nav

**Files:** Modify `web/src/App.tsx`, `web/src/app/Sidebar.tsx`.

- [ ] **Step 1: Add the import + route in `web/src/App.tsx`**

(a) Add the import alongside the other page imports (after the `PackagesPage` import on line 6):

```tsx
import { ProvidersPage } from "./providers/ProvidersPage";
```

(b) Add the route inside the `projects/:pid` scope, right after the `config` route (line 34 `<Route path="config" element={<ConfigPage />} />`):

```tsx
          <Route path="providers" element={<ProvidersPage />} />
```

- [ ] **Step 2: Add the Sidebar nav item in `web/src/app/Sidebar.tsx`**

In the `GROUPS` "Build" group `items` array, add a **Providers** item after the `config` item (the line `{ to: "config", label: "Config & Caps", icon: "⚙", gated: true },`):

```tsx
      { to: "providers", label: "Providers", icon: "⚡" },
```

(Un-gated — the surface is real; only the in-row "Set API key" credentials step is gated. The `Item` interface already supports this exact shape; no interface change.)

- [ ] **Step 3: Verify typecheck + the existing suite still pass**

Run: `cd web && pnpm typecheck && pnpm test`
Expected: green (the new route/nav don't break existing tests; `ProvidersPage.test.tsx` from Task 1 still passes).

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/app/Sidebar.tsx
git commit -m "feat(web): wire /providers route + Sidebar nav item"
```

---

## Task 3: E2e + final gate

**Files:** Modify `web/e2e/run.spec.ts`.

- [ ] **Step 1: Append the e2e spec** (match the file's existing top-level `test(...)` style — confirm by reading `web/e2e/run.spec.ts`, e.g. the Plan 1 agent-combobox test appended at the end)

```ts
test("providers: screen lists anthropic installed with a gated Set API key", async ({ page }) => {
  await page.goto("/projects/demo/providers");
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({ timeout: 5000 });
  // the anthropic row: installed + recommended, and a disabled (gated) Set API key
  const row = page.getByRole("row").filter({ hasText: "anthropic" });
  await expect(row.getByText("✓ installed")).toBeVisible();
  await expect(row.getByText("✓ recommended")).toBeVisible();
  await expect(row.getByRole("button", { name: /Set API key/i })).toBeDisabled();
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. `web/playwright.config.ts` auto-starts the gateway (4317) + vite (5173) via its `webServer` block (`reuseExistingServer: !CI`), so no manual server start is needed — the `lsof … kill` only clears stale listeners to avoid port conflicts. Real ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; if install is not permitted, run `pnpm exec playwright test --list` to confirm the new test parses/registers and note e2e execution deferred to CI, then proceed with Steps 3–5 (the unit gate must still be green).

- [ ] **Step 3: Restore fixtures** (mandatory even if e2e fails — mock runs can mutate the demo fixture)

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green (run `pnpm format` if format:check fails, and include the formatted files in the commit).

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (check git status)
git commit -m "test(web): e2e providers screen (installed + gated set-api-key)"
```

---

## Self-Review

**Spec coverage** (§4.4 of `2026-06-02-agent-providers-and-node-display-design.md`):
- New route `/projects/:pid/providers` (`App.tsx`) → Task 2. ✓
- Sidebar "Providers" nav item in the Build group, un-gated → Task 2. ✓
- Table from `getProviders()`: name · source · installed (✓ / "not installed") · recommended · per-row gated "🔒 Set API key" (disabled, amber, title "waits on tau β.5") → Task 1. ✓
- **Add provider** control reusing `installPackage` (`POST /packages/install`), re-fetching providers on success; a note that a custom backend can also be typed in an agent's provider field → Task 1. ✓
- Tests: component (table renders, Set API key disabled, Add-provider posts an install) → Task 1; e2e (`/projects/demo/providers` → anthropic installed + gated Set API key disabled) → Task 3. ✓
- Side effect: Plan 1's "⚙ Manage providers…" link (`/projects/:pid/providers`) now resolves to a real screen. ✓

**Placeholder scan:** none.

**Type consistency:** `ProvidersPage` consumes `Provider { name, installed, recommended, source, credentials_gated }` (the Plan 1 ts-rs binding) via the existing `getProviders(): Promise<Provider[]>`; `installPackage(git_url: string)` already exists in `api/config.ts` and returns `{ package }`. The route element `<ProvidersPage />` and the Sidebar `{ to: "providers", ... }` match the existing `Route`/`Item` shapes exactly. No new types, no gateway/ts-rs changes.

**Out of scope (per spec §7):** real credential capture/storage (the gated "Set API key" + the documented `POST /providers/:name/credentials` seam) — the explicit NEXT sub-project; per-provider endpoint editing stays on the Config surface. Plan 3 (n8n-grade workflow canvas, B) is separate.
