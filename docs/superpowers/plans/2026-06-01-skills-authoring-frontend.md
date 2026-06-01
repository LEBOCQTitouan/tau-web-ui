# Skills Authoring — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gated Tools & Skills stub with a real Skills surface: a tabbed page (Skills active; Tools/Plugins gated "soon"), a skills index (local + installed), and a deep-linkable skill editor (create/edit/delete local skills, view+export installed) with capabilities + requires sub-editors.

**Architecture:** A scoped `api/skills.ts`; a `ToolsPage` tab shell; `SkillsIndex` + `SkillEditorPage` mirroring the Agents index/editor; focused `CapabilitiesEditor` and `PackageDepEditor` sub-components; Export is a client-side file download. Pages hold local state (no store changes).

**Tech Stack:** React 18, react-router-dom v6, TypeScript, Tailwind, Vitest + Testing Library + user-event, Playwright.

This is **Plan 2 of 2** for Skills authoring (see `docs/superpowers/specs/2026-06-01-skills-authoring-design.md`). It depends on Plan 1's API + generated types (`Capability`, `PackageDep`, `SkillSummary`, `SkillDetail`).

---

## File Structure

**New:**
- `web/src/api/skills.ts` — `listSkills`/`getSkill`/`putSkill`/`deleteSkill`/`importSkill`.
- `web/src/tools/ToolsPage.tsx` — tab shell (Skills | Tools(soon) | Plugins(soon)) + SkillsIndex.
- `web/src/tools/SkillsIndex.tsx` — table + New + Import.
- `web/src/tools/SkillEditorPage.tsx` — create/edit/delete/view + export.
- `web/src/tools/CapabilitiesEditor.tsx` — kind + typed list params.
- `web/src/tools/PackageDepEditor.tsx` — `{name,source,version}` rows.
- Tests: `web/src/api/skills.test.ts`, `web/src/tools/CapabilitiesEditor.test.tsx`, `web/src/tools/SkillsIndex.test.tsx`, `web/src/tools/SkillEditorPage.test.tsx`.

**Modified:**
- `web/src/App.tsx` — swap the `tools` StubPage route for `ToolsPage` + skill editor routes.
- `web/e2e/run.spec.ts` — add a skill create/edit/delete + import spec.

---

## Task 1: `api/skills.ts`

**Files:**
- Create: `web/src/api/skills.ts`, `web/src/api/skills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listSkills, getSkill, putSkill, deleteSkill, importSkill } from "./skills";
import { setActiveProject } from "./client";

beforeEach(() => {
  vi.restoreAllMocks();
  setActiveProject("demo");
});

const skill = {
  name: "critic",
  description: null,
  version: null,
  source: "local://critic",
  editable: true,
  content: "x",
  capabilities: [],
  requires_tools: [],
  requires_skills: [],
};

describe("skills api", () => {
  it("listSkills GETs the scoped path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listSkills();
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills");
  });

  it("getSkill GETs one", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => skill });
    vi.stubGlobal("fetch", f);
    await getSkill("critic");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/critic");
  });

  it("putSkill PUTs; create adds ?create=1", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => skill });
    vi.stubGlobal("fetch", f);
    await putSkill(skill, { create: true });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/critic?create=1");
    expect(f.mock.calls[0][1].method).toBe("PUT");
  });

  it("deleteSkill DELETEs", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    vi.stubGlobal("fetch", f);
    await deleteSkill("critic");
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });

  it("importSkill POSTs git_url", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ skill: "x" }) });
    vi.stubGlobal("fetch", f);
    await importSkill("https://x/y.git");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/import");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ git_url: "https://x/y.git" });
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd web && pnpm test -- src/api/skills.test.ts` → FAIL.

- [ ] **Step 3: Create `web/src/api/skills.ts`**

```ts
import type { SkillSummary } from "../types/SkillSummary";
import type { SkillDetail } from "../types/SkillDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listSkills = () => fetch(scopedPath("/skills")).then(json<SkillSummary[]>);

export const getSkill = (name: string) =>
  fetch(scopedPath(`/skills/${name}`)).then(json<SkillDetail>);

export const putSkill = (skill: SkillDetail, opts?: { create?: boolean }) =>
  fetch(scopedPath(`/skills/${skill.name}${opts?.create ? "?create=1" : ""}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(skill),
  }).then(json<SkillDetail>);

export const deleteSkill = (name: string) =>
  fetch(scopedPath(`/skills/${name}`), { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
  });

export const importSkill = (git_url: string) =>
  fetch(scopedPath("/skills/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  })
    .then(json<{ skill: string }>)
    .then((r) => r.skill);
```

- [ ] **Step 4: Run to confirm pass** — `cd web && pnpm test -- src/api/skills.test.ts` → PASS (5).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/skills.ts web/src/api/skills.test.ts
git commit -m "feat(web): scoped skills api module"
```

---

## Task 2: `CapabilitiesEditor` + `PackageDepEditor`

**Files:**
- Create: `web/src/tools/CapabilitiesEditor.tsx`, `web/src/tools/PackageDepEditor.tsx`, `web/src/tools/CapabilitiesEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

`web/src/tools/CapabilitiesEditor.test.tsx`:

```tsx
import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CapabilitiesEditor } from "./CapabilitiesEditor";
import type { Capability } from "../types/Capability";

function Harness() {
  const [caps, setCaps] = useState<Capability[]>([]);
  return <CapabilitiesEditor capabilities={caps} onChange={setCaps} />;
}

describe("CapabilitiesEditor", () => {
  it("adds a capability and edits its kind + a param list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /add capability/i }));

    // default kind fs.read exposes a "paths" field
    const paths = screen.getByLabelText("paths 0");
    await user.type(paths, "/tmp/**");
    expect(paths).toHaveValue("/tmp/**");

    // switch kind to net.http → hosts + methods fields appear, paths gone
    await user.selectOptions(screen.getByLabelText("capability kind 0"), "net.http");
    expect(screen.getByLabelText("hosts 0")).toBeInTheDocument();
    expect(screen.getByLabelText("methods 0")).toBeInTheDocument();
    expect(screen.queryByLabelText("paths 0")).not.toBeInTheDocument();
  });

  it("removes a capability", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /add capability/i }));
    expect(screen.getByLabelText("capability kind 0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove capability 0/i }));
    expect(screen.queryByLabelText("capability kind 0")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd web && pnpm test -- src/tools/CapabilitiesEditor.test.tsx` → FAIL.

- [ ] **Step 3: Create `web/src/tools/CapabilitiesEditor.tsx`**

```tsx
import type { Capability } from "../types/Capability";

// Which list params each capability kind exposes.
const CAP_FIELDS: Record<string, string[]> = {
  "fs.read": ["paths"],
  "fs.write": ["paths"],
  "net.http": ["hosts", "methods"],
  "process.spawn": ["commands"],
};
const KINDS = Object.keys(CAP_FIELDS);

const input = "rounded border border-border bg-surface px-2 py-1 text-xs";

export function CapabilitiesEditor({
  capabilities,
  onChange,
}: {
  capabilities: Capability[];
  onChange: (c: Capability[]) => void;
}) {
  const update = (i: number, patch: Partial<Capability>) =>
    onChange(capabilities.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  function setKind(i: number, kind: string) {
    const fields: Record<string, string[]> = {};
    for (const p of CAP_FIELDS[kind] ?? []) fields[p] = [];
    update(i, { kind, fields });
  }

  function setParam(i: number, param: string, csv: string) {
    const list = csv.split(",").map((s) => s.trim()).filter(Boolean);
    const fields = { ...capabilities[i].fields, [param]: list };
    update(i, { fields });
  }

  return (
    <div className="space-y-2">
      {capabilities.map((c, i) => (
        <div key={i} className="rounded-md border border-border p-2">
          <div className="flex items-center gap-2">
            <select
              aria-label={`capability kind ${i}`}
              className={input}
              value={c.kind}
              onChange={(e) => setKind(i, e.target.value)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`remove capability ${i}`}
              className="ml-auto px-2 text-st-error"
              onClick={() => onChange(capabilities.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
          {(CAP_FIELDS[c.kind] ?? []).map((param) => (
            <div key={param} className="mt-1.5">
              <label className="mb-0.5 block text-[9px] uppercase text-muted">{param}</label>
              <input
                aria-label={`${param} ${i}`}
                placeholder={`${param} (comma-separated)`}
                className={`w-full ${input}`}
                value={(c.fields[param] ?? []).join(", ")}
                onChange={(e) => setParam(i, param, e.target.value)}
              />
            </div>
          ))}
        </div>
      ))}
      <button
        type="button"
        className="rounded border border-dashed border-accent/50 px-2 py-1 text-xs font-semibold text-accent"
        onClick={() => onChange([...capabilities, { kind: "fs.read", fields: { paths: [] } }])}
      >
        + Add capability
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create `web/src/tools/PackageDepEditor.tsx`**

```tsx
import type { PackageDep } from "../types/PackageDep";

const input = "rounded border border-border bg-surface px-2 py-1 text-xs";

export function PackageDepEditor({
  label,
  deps,
  onChange,
}: {
  label: string;
  deps: PackageDep[];
  onChange: (d: PackageDep[]) => void;
}) {
  const update = (i: number, patch: Partial<PackageDep>) =>
    onChange(deps.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-1.5">
      {deps.map((d, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            aria-label={`${label} name ${i}`}
            placeholder="name"
            className={`flex-1 ${input}`}
            value={d.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            aria-label={`${label} source ${i}`}
            placeholder="source"
            className={`flex-[2] ${input}`}
            value={d.source}
            onChange={(e) => update(i, { source: e.target.value })}
          />
          <input
            aria-label={`${label} version ${i}`}
            placeholder="version"
            className={`w-20 ${input}`}
            value={d.version ?? ""}
            onChange={(e) => update(i, { version: e.target.value || null })}
          />
          <button
            type="button"
            aria-label={`remove ${label} ${i}`}
            className="px-2 text-st-error"
            onClick={() => onChange(deps.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="rounded border border-dashed border-accent/50 px-2 py-1 text-xs font-semibold text-accent"
        onClick={() => onChange([...deps, { name: "", source: "", version: null }])}
      >
        + Add {label}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run + commit**

Run: `cd web && pnpm test -- src/tools/CapabilitiesEditor.test.tsx && pnpm typecheck`
Expected: PASS (2), typecheck clean.

```bash
git add web/src/tools/CapabilitiesEditor.tsx web/src/tools/PackageDepEditor.tsx web/src/tools/CapabilitiesEditor.test.tsx
git commit -m "feat(web): capabilities + package-dep sub-editors"
```

---

## Task 3: `ToolsPage` + `SkillsIndex` + route swap

**Files:**
- Create: `web/src/tools/ToolsPage.tsx`, `web/src/tools/SkillsIndex.tsx`, `web/src/tools/SkillsIndex.test.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Write the failing test**

`web/src/tools/SkillsIndex.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SkillsIndex } from "./SkillsIndex";

const skills = [
  { name: "critic", version: "0.1.0", source: "local://critic", editable: true, capability_kinds: [], requires_count: 1 },
  { name: "web-search", version: "1.2.0", source: "github.com/tau/web-search", editable: false, capability_kinds: ["net.http"], requires_count: 0 },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => skills }));
});

function renderAt() {
  render(
    <MemoryRouter initialEntries={["/projects/demo/tools"]}>
      <Routes>
        <Route path="/projects/:pid/tools" element={<SkillsIndex />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SkillsIndex", () => {
  it("lists local + installed skills with links + New", async () => {
    renderAt();
    await waitFor(() => expect(screen.getByRole("link", { name: "critic" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "critic" })).toHaveAttribute(
      "href",
      "/projects/demo/tools/skills/critic",
    );
    expect(screen.getByText("web-search")).toBeInTheDocument();
    expect(screen.getByText("installed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new skill/i })).toHaveAttribute(
      "href",
      "/projects/demo/tools/skills/new",
    );
  });
});
```

- [ ] **Step 2: Run to confirm fail** — FAIL (module not found).

- [ ] **Step 3: Create `web/src/tools/SkillsIndex.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SkillSummary } from "../types/SkillSummary";
import { listSkills, importSkill } from "../api/skills";

export function SkillsIndex() {
  const { pid } = useParams();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [url, setUrl] = useState("");

  const reload = () => listSkills().then(setSkills).catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  async function onImport() {
    if (!url.trim()) return;
    await importSkill(url.trim()).catch(() => {});
    setUrl("");
    reload();
  }

  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-accent/40 bg-accent/5 p-2">
        <input
          aria-label="import skill git url"
          placeholder="https://github.com/org/skill.git"
          className={`flex-1 ${input}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={onImport} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold">
          Import skill
        </button>
        <Link
          to={`/projects/${pid}/tools/skills/new`}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          + New skill
        </Link>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 pr-2 font-medium">skill</th>
            <th className="px-2 py-1 font-medium">version</th>
            <th className="px-2 py-1 font-medium">source</th>
            <th className="px-2 py-1 font-medium">capabilities</th>
            <th className="px-2 py-1 font-medium">requires</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.name} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-2 font-medium">
                <Link to={`/projects/${pid}/tools/skills/${s.name}`} className="text-accent">
                  {s.name}
                </Link>{" "}
                <span
                  className={`rounded px-1 text-[8px] font-bold uppercase ${
                    s.editable ? "bg-accent/10 text-accent" : "bg-bg text-muted"
                  }`}
                >
                  {s.editable ? "local" : "installed"}
                </span>
              </td>
              <td className="px-2 py-1 text-muted">{s.version ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-muted">{s.source}</td>
              <td className="px-2 py-1 font-mono text-muted">{s.capability_kinds.join(", ") || "—"}</td>
              <td className="px-2 py-1 text-muted">{s.requires_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Create `web/src/tools/ToolsPage.tsx`**

```tsx
import { SkillsIndex } from "./SkillsIndex";

export function ToolsPage() {
  const tab = (active: boolean, soon = false) =>
    `rounded-md px-3 py-1 text-xs font-semibold ${
      active ? "bg-accent text-accent-fg" : "text-muted"
    } ${soon ? "cursor-not-allowed opacity-50" : ""}`;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Tools &amp; Skills</h2>
        <div className="ml-2 flex gap-1">
          <span className={tab(true)}>Skills</span>
          <span className={tab(false, true)}>
            Tools <span className="ml-1 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">soon</span>
          </span>
          <span className={tab(false, true)}>
            Plugins <span className="ml-1 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">soon</span>
          </span>
        </div>
      </div>
      <SkillsIndex />
    </div>
  );
}
```

- [ ] **Step 5: Swap routes in `web/src/App.tsx`**

Add imports near the other page imports:

```tsx
import { ToolsPage } from "./tools/ToolsPage";
import { SkillEditorPage } from "./tools/SkillEditorPage";
```

Replace the existing tools stub route:

```tsx
          <Route
            path="tools"
            element={<StubPage title="Tools & Skills" subtitle="Skills & plugins — coming soon." />}
          />
```
with:
```tsx
          <Route path="tools" element={<ToolsPage />} />
          <Route path="tools/skills/new" element={<SkillEditorPage />} />
          <Route path="tools/skills/:name" element={<SkillEditorPage />} />
```

(`SkillEditorPage` is created in Task 4. To keep this task green, create a minimal stub now and flesh it out next: `web/src/tools/SkillEditorPage.tsx` → `export function SkillEditorPage() { return null; }`.)

- [ ] **Step 6: Run the index test + typecheck + full suite**

Run: `cd web && pnpm test -- src/tools/SkillsIndex.test.tsx && pnpm typecheck && pnpm test`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/tools/ToolsPage.tsx web/src/tools/SkillsIndex.tsx web/src/tools/SkillsIndex.test.tsx web/src/tools/SkillEditorPage.tsx web/src/App.tsx
git commit -m "feat(web): Tools & Skills page + skills index + routes (editor stub)"
```

---

## Task 4: `SkillEditorPage` (create / edit / delete / view / export)

**Files:**
- Modify: `web/src/tools/SkillEditorPage.tsx`
- Create: `web/src/tools/SkillEditorPage.test.tsx`

- [ ] **Step 1: Write the failing test**

`web/src/tools/SkillEditorPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SkillEditorPage } from "./SkillEditorPage";
import { setActiveProject } from "../api/client";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:pid/tools/skills/new" element={<SkillEditorPage />} />
        <Route path="/projects/:pid/tools/skills/:name" element={<SkillEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  setActiveProject("demo");
});

describe("SkillEditorPage", () => {
  it("create mode PUTs a new skill with ?create=1", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderAt("/projects/demo/tools/skills/new");

    await user.type(screen.getByLabelText("skill name"), "summariser");
    await user.type(screen.getByLabelText("SKILL.md body"), "you summarise");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/summariser?create=1");
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.name).toBe("summariser");
    expect(body.content).toBe("you summarise");
  });

  it("installed skill is read-only (no Save/Delete, Export present)", async () => {
    const installed = {
      name: "web-search",
      description: "Search.",
      version: "1.2.0",
      source: "github.com/tau/web-search",
      editable: false,
      content: "search",
      capabilities: [],
      requires_tools: [],
      requires_skills: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => installed }));
    renderAt("/projects/demo/tools/skills/web-search");
    await waitFor(() => expect(screen.getByLabelText("skill name")).toHaveValue("web-search"));
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("rejects an invalid name in create mode", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    renderAt("/projects/demo/tools/skills/new");
    await user.type(screen.getByLabelText("skill name"), "Bad Name");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(screen.getByText(/invalid name/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm fail** — FAIL (stub).

- [ ] **Step 3: Replace `web/src/tools/SkillEditorPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { SkillDetail } from "../types/SkillDetail";
import { getSkill, putSkill, deleteSkill } from "../api/skills";
import { CapabilitiesEditor } from "./CapabilitiesEditor";
import { PackageDepEditor } from "./PackageDepEditor";

const NAME_RE = /^[a-z0-9-]+$/;

const blank = (): SkillDetail => ({
  name: "",
  description: null,
  version: null,
  source: "",
  editable: true,
  content: "",
  capabilities: [],
  requires_tools: [],
  requires_skills: [],
});

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SkillEditorPage() {
  const { pid, name } = useParams();
  const isNew = name === undefined;
  const navigate = useNavigate();

  const [s, setS] = useState<SkillDetail>(blank());
  const [error, setError] = useState<string | null>(null);
  const readOnly = !isNew && !s.editable;

  useEffect(() => {
    if (isNew || !name) return;
    getSkill(name)
      .then((d) => setS({ ...blank(), ...d, capabilities: d.capabilities ?? [] }))
      .catch(() => setError("could not load skill"));
  }, [isNew, name]);

  const label = "mb-1 block text-[10px] uppercase tracking-wide text-muted";
  const input = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const set = (patch: Partial<SkillDetail>) => setS((prev) => ({ ...prev, ...patch }));

  async function onSave() {
    setError(null);
    const id = isNew ? s.name.trim() : name!;
    if (isNew && !NAME_RE.test(id)) {
      setError("invalid name — use lowercase letters, digits, or -");
      return;
    }
    try {
      await putSkill({ ...s, name: id }, { create: isNew });
      navigate(`/projects/${pid}/tools/skills/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  async function onDelete() {
    if (isNew || !name) return;
    try {
      await deleteSkill(name);
      navigate(`/projects/${pid}/tools`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  }

  function onExport() {
    download(
      "SKILL.md",
      `---\nname: ${s.name}\ndescription: ${s.description ?? ""}\n---\n${s.content}\n`,
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4">
      <button onClick={() => navigate(`/projects/${pid}/tools`)} className="text-xs text-accent">
        ← all skills
      </button>
      <h2 className="text-base font-semibold">{isNew ? "New skill" : name}</h2>

      <div className="space-y-2.5 rounded-lg border border-border bg-surface p-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={label}>skill name</label>
            <input
              aria-label="skill name"
              className={input}
              disabled={!isNew}
              value={s.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="w-32">
            <label className={label}>version</label>
            <input
              aria-label="version"
              className={input}
              disabled={readOnly}
              placeholder="0.1.0"
              value={s.version ?? ""}
              onChange={(e) => set({ version: e.target.value || null })}
            />
          </div>
        </div>
        <div>
          <label className={label}>description</label>
          <input
            aria-label="description"
            className={input}
            disabled={readOnly}
            value={s.description ?? ""}
            onChange={(e) => set({ description: e.target.value || null })}
          />
        </div>
        <div>
          <label className={label}>SKILL.md body</label>
          <textarea
            aria-label="SKILL.md body"
            className="h-40 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
            disabled={readOnly}
            value={s.content}
            onChange={(e) => set({ content: e.target.value })}
          />
        </div>
        {!readOnly && (
          <>
            <div>
              <label className={label}>capabilities</label>
              <CapabilitiesEditor
                capabilities={s.capabilities}
                onChange={(c) => set({ capabilities: c })}
              />
            </div>
            <div>
              <label className={label}>requires.tools</label>
              <PackageDepEditor
                label="tool"
                deps={s.requires_tools}
                onChange={(d) => set({ requires_tools: d })}
              />
            </div>
            <div>
              <label className={label}>requires.skills</label>
              <PackageDepEditor
                label="skill"
                deps={s.requires_skills}
                onChange={(d) => set({ requires_skills: d })}
              />
            </div>
          </>
        )}
      </div>

      {error && <div className="text-xs text-st-error">{error}</div>}

      <div className="flex gap-2">
        {!readOnly && (
          <button
            onClick={onSave}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
          >
            Save
          </button>
        )}
        {!isNew && !readOnly && (
          <button
            onClick={onDelete}
            className="rounded-md border border-st-error/40 px-3 py-1.5 text-xs font-semibold text-st-error"
          >
            Delete
          </button>
        )}
        <button
          onClick={onExport}
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
        >
          Export
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm pass** — `cd web && pnpm test -- src/tools/SkillEditorPage.test.tsx` → PASS (3).

- [ ] **Step 5: Full suite + typecheck**

Run: `cd web && pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add web/src/tools/SkillEditorPage.tsx web/src/tools/SkillEditorPage.test.tsx
git commit -m "feat(web): skill editor page (create/edit/delete/view/export)"
```

---

## Task 5: E2e + final gate

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Append the spec**

```ts
test("skills: create, edit, delete, import", async ({ page }) => {
  await page.goto("/projects/demo/tools");
  await expect(page.getByRole("heading", { name: /tools & skills/i })).toBeVisible({ timeout: 5000 });
  // seeded local skill present
  await expect(page.getByRole("link", { name: "critic" })).toBeVisible();

  // create a new skill
  await page.getByRole("link", { name: /new skill/i }).click();
  await page.getByLabel("skill name").fill("e2e-skill");
  await page.getByLabel("description").fill("e2e skill");
  await page.getByLabel("SKILL.md body").fill("you do e2e things");
  await page.getByRole("button", { name: "+ Add capability" }).click();
  await page.getByLabel("paths 0").fill("/tmp/**");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // appears in the index
  await page.goto("/projects/demo/tools");
  await expect(page.getByRole("link", { name: "e2e-skill" })).toBeVisible({ timeout: 5000 });

  // edit + save
  await page.getByRole("link", { name: "e2e-skill" }).click();
  await expect(page.getByLabel("description")).toHaveValue("e2e skill");
  await page.getByLabel("SKILL.md body").fill("updated body");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // import an installed skill
  await page.goto("/projects/demo/tools");
  await page.getByLabel("import skill git url").fill("https://github.com/acme/translator.git");
  await page.getByRole("button", { name: "Import skill" }).click();
  await expect(page.getByRole("link", { name: "translator" })).toBeVisible({ timeout: 5000 });

  // delete the created skill
  await page.goto("/projects/demo/tools/skills/e2e-skill");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: "e2e-skill" })).toHaveCount(0);
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. A real assertion failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` and note e2e deferred to CI.

- [ ] **Step 3: Restore fixtures**

The skills e2e writes `fixtures/demo/skills/e2e-skill` (created then deleted) and the config/agents specs mutate `fixtures/demo/tau.toml`. Restore + clean any stray skill dir:

```bash
cd /Users/titouanlebocq/code/tau-ui && git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
# the committed seeded skills are critic + fact-checker; drop anything else under skills/
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null; true
```

- [ ] **Step 4: Full web gate**

Run: `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
Expected: green. If format:check fails, `pnpm format`, re-check, include formatting in the commit.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (git status)
git commit -m "test(web): e2e skill create/edit/delete/import"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-skills-authoring-design.md`):
- §5.1 api module → Task 1. §5.2 components: ToolsPage tab shell + SkillsIndex (local/installed badges, New, Import) → Task 3; SkillEditorPage (create/edit/delete, installed read-only, Export download) → Task 4; CapabilitiesEditor + PackageDepEditor → Task 2; route swap (replace StubPage) → Task 3. §5.3 validation (name regex create-only; installed read-only) → Tasks 2 & 4. §6 web + e2e tests → Tasks 1–5. All covered. The sidebar "Tools & Skills" item already routes to `/projects/:pid/tools` (it now resolves to `ToolsPage`).

**Placeholder scan:** none — every code step complete. Task 3's `SkillEditorPage` stub (`return null`) is intentional, fleshed out in Task 4.

**Type consistency:** `SkillSummary`/`SkillDetail`/`Capability`/`PackageDep` (generated by Plan 1) used identically across `api/skills.ts`, `SkillsIndex`, `SkillEditorPage`, and the sub-editors. `putSkill(skill, {create})` → `?create=1` matches the gateway `PutQuery`. Route params `:pid` + `:name` (create route omits `:name` → `isNew`). `editable === false` drives read-only in both the index badge and the editor. The `CapabilitiesEditor`'s `CAP_FIELDS` param names (`paths`/`hosts`/`methods`/`commands`) match the gateway's `fields` map keys.

**Cross-plan dependency:** the generated TS types come from Plan 1 Task 7 — apply/merge Plan 1 before Plan 2's typecheck.
```
