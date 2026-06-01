# Plugins View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gated, read-only **Plugins** tab to the Tools & Skills surface: a two-pane (list · detail) view of the plugin binaries behind packages, each showing its mock **describe** (port, tool schema, capabilities, protocol version) and a **protocol-decode** transcript (handshake → describe → one representative call).

**Architecture:** A new gateway `plugins` module (mock catalog seam `PluginsSource`/`MockPlugins`/`CliPlugins` + a thin `list_plugins` accessor); one scoped read-only endpoint `GET /api/projects/:pid/plugins`; a frontend `PluginsTab` (two-pane, frame rows expand to pretty JSON) wired into `ToolsPage`'s tab switch, which makes the previously-disabled Plugins chip a real tab carrying an amber "gated" badge. `Capability` is reused from the skills module; `ProtocolFrame.payload` is `serde_json::Value` exported as `unknown` (mirroring `trace/mod.rs`).

**Tech Stack:** Rust, axum 0.7, serde, serde_json, ts-rs; React 18, react-router-dom v6, Vitest, Playwright.

This is the single plan for Plugins view (see `docs/superpowers/specs/2026-06-01-plugins-view-design.md`) — slice **#3 of 3** of the Tools & Skills surface.

---

## File Structure

**New:**
- `gateway/src/plugins/mod.rs` — `ProtocolFrame`/`ToolSchema`/`PluginDescribe`/`PluginDetail` types, `PluginsSource` seam (`MockPlugins`/`CliPlugins`), `list_plugins` accessor.
- `gateway/src/api/plugins.rs` — the `list` handler.
- `web/src/api/plugins.ts` — `listPlugins`.
- `web/src/tools/PluginsTab.tsx` — two-pane plugins view.
- Tests: `gateway/tests/plugins_api.rs`, `web/src/tools/PluginsTab.test.tsx`.

**Modified:**
- `gateway/src/lib.rs` — `pub mod plugins;`.
- `gateway/src/state.rs` — `plugins_source` field + `list_plugins` wrapper.
- `gateway/src/api/mod.rs` — `pub mod plugins;` + `/plugins` route.
- `web/src/tools/ToolsPage.tsx` — Plugins becomes a navigable tab (gated badge).
- `web/src/tools/ToolsPage.test.tsx` — update the Plugins-tab assertion (now navigable).
- `web/e2e/run.spec.ts` — plugins tab spec.

---

## Task 1: Types + `PluginsSource` seam

**Files:**
- Create: `gateway/src/plugins/mod.rs`
- Modify: `gateway/src/lib.rs`

- [ ] **Step 1: Add the module to lib.rs**

In `gateway/src/lib.rs`, insert `pub mod plugins;` alphabetically — after `pub mod packages;` and before `pub mod projects;`:

```rust
pub mod packages;
pub mod plugins;
pub mod projects;
```

- [ ] **Step 2: Create `gateway/src/plugins/mod.rs`**

```rust
//! Plugins view: a gated, read-only catalog of plugin binaries (the executables
//! behind packages that provide a tau port). Mock data — tau has no plugin
//! introspection yet — so this mirrors the tools `MockTools`/`CliTools` seam.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use crate::skills::Capability;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProtocolFrame {
    pub direction: String, // "out" (→ request to plugin) | "in" (← response/notification)
    pub method: String,    // "meta.handshake" | "result" | "plugin.describe" | "tool.invoke" | "llm.generate"
    #[ts(type = "unknown")]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolSchema {
    pub name: String,
    pub input_schema: BTreeMap<String, String>, // param → type
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDescribe {
    pub port: String, // "Tool" | "LlmBackend"
    pub protocol_version: u32,
    pub tool: Option<ToolSchema>,
    pub capabilities: Vec<Capability>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDetail {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub kind: String, // "rust-cargo"
    pub binary: String,
    pub port: String, // mirrors describe.port for list-row convenience
    pub protocol_version: u32,
    pub describe: PluginDescribe,
    pub transcript: Vec<ProtocolFrame>,
}

/// Source of the plugin catalog. Mock-first; the CLI path stays empty until tau
/// exposes plugin introspection.
pub trait PluginsSource: Send + Sync {
    fn catalog(&self) -> Vec<PluginDetail>;
}

fn cap(kind: &str, param: &str, vals: &[&str]) -> Capability {
    Capability {
        kind: kind.into(),
        fields: BTreeMap::from([(
            param.to_string(),
            vals.iter().map(|s| s.to_string()).collect(),
        )]),
    }
}

fn tool_schema(name: &str, params: &[(&str, &str)]) -> ToolSchema {
    ToolSchema {
        name: name.into(),
        input_schema: params
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    }
}

fn frame(direction: &str, method: &str, payload: Value) -> ProtocolFrame {
    ProtocolFrame {
        direction: direction.into(),
        method: method.into(),
        payload,
    }
}

/// The shared leading frames: handshake → describe request → describe result.
/// `describe_value` is the wire form of the plugin's `describe` (kept in sync by
/// serializing the typed `PluginDescribe`).
fn lead_frames(pkg: &str, describe_value: Value) -> Vec<ProtocolFrame> {
    vec![
        frame(
            "out",
            "meta.handshake",
            json!({"client_name":"tau-gateway","client_version":"0.1.0","protocol_version":1}),
        ),
        frame(
            "in",
            "result",
            json!({"server_name":"tau","server_version":"0.0.0","protocol_version":1}),
        ),
        frame("out", "plugin.describe", json!({ "package": pkg })),
        frame("in", "result", describe_value),
    ]
}

/// Assemble a plugin: typed describe + a 6-frame transcript (4 lead frames + the
/// 2 port-appropriate sample-call frames).
fn assemble(
    name: &str,
    version: &str,
    describe: PluginDescribe,
    mut sample: Vec<ProtocolFrame>,
) -> PluginDetail {
    let port = describe.port.clone();
    let protocol_version = describe.protocol_version;
    let describe_value = serde_json::to_value(&describe).expect("describe serializes");
    let mut transcript = lead_frames(name, describe_value);
    transcript.append(&mut sample);
    PluginDetail {
        name: name.into(),
        version: Some(version.into()),
        source: format!("github.com/tau/{name}"),
        kind: "rust-cargo".into(),
        binary: name.into(),
        port,
        protocol_version,
        describe,
        transcript,
    }
}

pub struct MockPlugins;

impl PluginsSource for MockPlugins {
    fn catalog(&self) -> Vec<PluginDetail> {
        vec![
            assemble(
                "fs-read",
                "1.0.0",
                PluginDescribe {
                    port: "Tool".into(),
                    protocol_version: 1,
                    tool: Some(tool_schema("fs-read", &[("path", "string")])),
                    capabilities: vec![cap("fs.read", "paths", &["${WORKDIR}/**"])],
                },
                vec![
                    frame(
                        "out",
                        "tool.invoke",
                        json!({"call_id":"c1","args":{"path":"${WORKDIR}/README.md"}}),
                    ),
                    frame(
                        "in",
                        "result",
                        json!({"ok":true,"content":[{"type":"text","text":"# tau\nA workflow compiler for portable agents."}],"is_error":false}),
                    ),
                ],
            ),
            assemble(
                "shell",
                "0.2.0",
                PluginDescribe {
                    port: "Tool".into(),
                    protocol_version: 1,
                    tool: Some(tool_schema("shell", &[("command", "string")])),
                    capabilities: vec![cap("process.spawn", "commands", &["sh"])],
                },
                vec![
                    frame(
                        "out",
                        "tool.invoke",
                        json!({"call_id":"c1","args":{"command":"ls"}}),
                    ),
                    frame(
                        "in",
                        "result",
                        json!({"ok":true,"content":[{"type":"text","text":"README.md\nCargo.toml"}],"is_error":false}),
                    ),
                ],
            ),
            assemble(
                "web-search",
                "1.2.0",
                PluginDescribe {
                    port: "Tool".into(),
                    protocol_version: 1,
                    tool: Some(tool_schema("web-search", &[("query", "string")])),
                    capabilities: vec![cap("net.http", "hosts", &["*"])],
                },
                vec![
                    frame(
                        "out",
                        "tool.invoke",
                        json!({"call_id":"c1","args":{"query":"tau agent framework"}}),
                    ),
                    frame(
                        "in",
                        "result",
                        json!({"ok":true,"content":[{"type":"text","text":"3 results for tau agent framework"}],"is_error":false}),
                    ),
                ],
            ),
            assemble(
                "anthropic",
                "0.1.0",
                PluginDescribe {
                    port: "LlmBackend".into(),
                    protocol_version: 1,
                    tool: None,
                    capabilities: vec![cap("net.http", "hosts", &["api.anthropic.com"])],
                },
                vec![
                    frame(
                        "out",
                        "llm.generate",
                        json!({"model":"claude-opus-4","messages":[{"role":"user","content":"hi"}]}),
                    ),
                    frame(
                        "in",
                        "result",
                        json!({"content":[{"type":"text","text":"Hello!"}],"usage":{"input_tokens":10,"output_tokens":3}}),
                    ),
                ],
            ),
        ]
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliPlugins;

impl PluginsSource for CliPlugins {
    fn catalog(&self) -> Vec<PluginDetail> {
        vec![]
    }
}
```

- [ ] **Step 3: Write the failing test**

Add a test module at the bottom of `gateway/src/plugins/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_catalog_seeds_four_plugins() {
        let cat = MockPlugins.catalog();
        let names: Vec<&str> = cat.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["fs-read", "shell", "web-search", "anthropic"]);

        let fsr = &cat[0];
        assert_eq!(fsr.port, "Tool");
        assert_eq!(fsr.describe.port, "Tool");
        assert_eq!(fsr.kind, "rust-cargo");
        assert_eq!(fsr.transcript.len(), 6);
        let last = fsr.transcript.last().unwrap();
        assert_eq!(last.method, "result");
        assert_eq!(last.payload["ok"], json!(true));

        let anthropic = cat.iter().find(|p| p.name == "anthropic").unwrap();
        assert_eq!(anthropic.port, "LlmBackend");
        assert!(anthropic.describe.tool.is_none());
        assert!(anthropic.transcript.iter().any(|f| f.method == "llm.generate"));

        assert!(CliPlugins.catalog().is_empty());
    }
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo test -p tau-gateway --lib plugins::tests::mock_catalog_seeds_four_plugins`
Expected: PASS. Also `cargo build -p tau-gateway` (compiles clean — no unused imports).

```bash
git add gateway/src/lib.rs gateway/src/plugins/mod.rs
git commit -m "feat(gateway): plugin types + mock catalog seam"
```

---

## Task 2: `list_plugins` accessor + AppState wrapper

**Files:**
- Modify: `gateway/src/plugins/mod.rs`, `gateway/src/state.rs`

- [ ] **Step 1: Add `list_plugins` to `gateway/src/plugins/mod.rs`** (after `CliPlugins`, before the `#[cfg(test)]` module):

```rust
/// Return the plugin catalog. Unlike tools' `list_tools`, there is no per-project
/// computation — the describe/transcript are project-independent mock data — so
/// this is a thin pass-through that gives `CliPlugins` a single composition point
/// for the future real path.
pub fn list_plugins(source: &dyn PluginsSource) -> Vec<PluginDetail> {
    source.catalog()
}
```

- [ ] **Step 2: Write the failing test** (append to the `tests` module, after `mock_catalog_seeds_four_plugins`):

```rust
    #[test]
    fn list_plugins_returns_catalog() {
        assert_eq!(list_plugins(&MockPlugins).len(), 4);
        assert!(list_plugins(&CliPlugins).is_empty());
    }
```

- [ ] **Step 3: Add the AppState field + wrapper**

In `gateway/src/state.rs`, add to the `use` block (next to the `tools` import on line 19):

```rust
use crate::plugins::{self, PluginDetail, PluginsSource};
```

Add a field to `Inner` (right after `tools_source: Box<dyn ToolsSource>,`):

```rust
    plugins_source: Box<dyn PluginsSource>,
```

In `AppState::new`, build it right after the `tools_source` block (`is_mock` is in scope):

```rust
        let plugins_source: Box<dyn PluginsSource> = if is_mock {
            Box::new(plugins::MockPlugins)
        } else {
            Box::new(plugins::CliPlugins)
        };
```

and add `plugins_source` to the `Inner { ... }` literal (right after `tools_source,`):

```rust
            tools_source,
            plugins_source,
```

Add the wrapper inside `impl AppState`, right after the `list_tools` method (around line 472-474):

```rust
    pub fn list_plugins(&self) -> Vec<PluginDetail> {
        plugins::list_plugins(self.0.plugins_source.as_ref())
    }
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p tau-gateway && cargo test -p tau-gateway --lib plugins::tests`
Expected: PASS (2 tests). Also `cargo test -p tau-gateway --lib` to confirm no regressions.

```bash
git add gateway/src/plugins/mod.rs gateway/src/state.rs
git commit -m "feat(gateway): list_plugins accessor + AppState wrapper"
```

---

## Task 3: API route + integration test

**Files:**
- Create: `gateway/src/api/plugins.rs`, `gateway/tests/plugins_api.rs`
- Modify: `gateway/src/api/mod.rs`

- [ ] **Step 1: Create `gateway/src/api/plugins.rs`**

```rust
use axum::Json;

use crate::api::scope::Scoped;
use crate::plugins::PluginDetail;

pub async fn list(Scoped(state): Scoped) -> Json<Vec<PluginDetail>> {
    Json(state.list_plugins())
}
```

- [ ] **Step 2: Wire the route in `gateway/src/api/mod.rs`**

Add `pub mod plugins;` to the module list at the top — alphabetically, after `pub mod packages;` (line 7) and before `pub mod projects;` (line 8):

```rust
pub mod packages;
pub mod plugins;
pub mod projects;
```

In the scoped router, add the route immediately after the `/tools` route (the last `.route(...)` before the `;`):

```rust
        .route("/tools", get(tools::list))
        .route("/plugins", get(plugins::list));
```

(`get` is already imported via `axum::routing`.)

- [ ] **Step 3: Create `gateway/tests/plugins_api.rs`**

```rust
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn plugins_list_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!("{base}/api/projects/{}/plugins", meta.id))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let list: serde_json::Value = resp.json().await.unwrap();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 4);

    let fsr = arr.iter().find(|p| p["name"] == "fs-read").unwrap();
    assert_eq!(fsr["port"], "Tool");
    assert_eq!(fsr["describe"]["port"], "Tool");
    assert!(fsr["transcript"].as_array().unwrap().len() >= 1);

    let anthropic = arr.iter().find(|p| p["name"] == "anthropic").unwrap();
    assert_eq!(anthropic["port"], "LlmBackend");
    assert!(anthropic["transcript"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["method"] == "llm.generate"));
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test plugins_api`
Expected: PASS. (Read-only — `git status --porcelain fixtures/demo` stays clean.)

```bash
git add gateway/src/api/plugins.rs gateway/src/api/mod.rs gateway/tests/plugins_api.rs
git commit -m "feat(gateway): GET /plugins route + integration test"
```

---

## Task 4: ts-rs export + rust gate

**Files:**
- Regenerated: `web/src/types/{ProtocolFrame,ToolSchema,PluginDescribe,PluginDetail}.ts`

- [ ] **Step 1: Regenerate** — `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS; new files under `web/src/types/`. Confirm `git status --porcelain fixtures/demo` is empty.

- [ ] **Step 2: Verify** — `ls web/src/types/ | grep -E "ProtocolFrame|ToolSchema|PluginDescribe|PluginDetail"` → all four present. `cat web/src/types/PluginDetail.ts` should reference `PluginDescribe` and `ProtocolFrame`. `cat web/src/types/ProtocolFrame.ts` should show `payload: unknown`.

- [ ] **Step 3: Full rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green. Fix fmt minimally with `cargo fmt --all` if needed. The pre-existing ts-rs serde-attr note is benign.

- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export plugin TS bindings + fmt/clippy"
```

---

## Task 5: Frontend — `api/plugins.ts` + `PluginsTab` + `ToolsPage` tab

**Files:**
- Create: `web/src/api/plugins.ts`, `web/src/tools/PluginsTab.tsx`, `web/src/tools/PluginsTab.test.tsx`
- Modify: `web/src/tools/ToolsPage.tsx`, `web/src/tools/ToolsPage.test.tsx`

- [ ] **Step 1: Create `web/src/api/plugins.ts`**

```ts
import type { PluginDetail } from "../types/PluginDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listPlugins = () => fetch(scopedPath("/plugins")).then(json<PluginDetail[]>);
```

- [ ] **Step 2: Write the failing `PluginsTab` test `web/src/tools/PluginsTab.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginsTab } from "./PluginsTab";

const plugins = [
  {
    name: "fs-read",
    version: "1.0.0",
    source: "github.com/tau/fs-read",
    kind: "rust-cargo",
    binary: "fs-read",
    port: "Tool",
    protocol_version: 1,
    describe: {
      port: "Tool",
      protocol_version: 1,
      tool: { name: "fs-read", input_schema: { path: "string" } },
      capabilities: [{ kind: "fs.read", fields: { paths: ["/x/**"] } }],
    },
    transcript: [
      { direction: "out", method: "meta.handshake", payload: { protocol_version: 1 } },
      { direction: "in", method: "result", payload: { ok: true, content: [{ type: "text", text: "# tau" }] } },
    ],
  },
  {
    name: "anthropic",
    version: "0.1.0",
    source: "github.com/tau/anthropic",
    kind: "rust-cargo",
    binary: "anthropic",
    port: "LlmBackend",
    protocol_version: 1,
    describe: {
      port: "LlmBackend",
      protocol_version: 1,
      tool: null,
      capabilities: [{ kind: "net.http", fields: { hosts: ["api.anthropic.com"] } }],
    },
    transcript: [
      { direction: "out", method: "llm.generate", payload: { model: "claude-opus-4" } },
      { direction: "in", method: "result", payload: { content: [], usage: { input_tokens: 10 } } },
    ],
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => plugins }));
});

describe("PluginsTab", () => {
  it("lists plugins, selects the first by default, shows describe + transcript", async () => {
    render(<PluginsTab />);
    await waitFor(() => expect(screen.getByRole("button", { name: /fs-read/i })).toBeInTheDocument());
    // gated banner always present
    expect(screen.getByText(/mock data/i)).toBeInTheDocument();
    // default selection = fs-read → tool schema + a frame method
    expect(screen.getByText(/fs-read\(path: string\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /meta\.handshake/i })).toBeInTheDocument();
  });

  it("switches selection and expands a frame to show JSON", async () => {
    const user = userEvent.setup();
    render(<PluginsTab />);
    await waitFor(() => expect(screen.getByRole("button", { name: /anthropic/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /anthropic/i }));
    const frameBtn = screen.getByRole("button", { name: /llm\.generate/i });
    expect(frameBtn).toBeInTheDocument();
    await user.click(frameBtn);
    // expanded pretty JSON contains the model. Match the pretty form ("model": …
    // with a space) so we hit only the expanded <pre>, not the one-line preview
    // (which renders {"model":"claude-opus-4"} with no space).
    expect(screen.getByText(/"model": "claude-opus-4"/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Create `web/src/tools/PluginsTab.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { PluginDetail } from "../types/PluginDetail";
import type { ProtocolFrame } from "../types/ProtocolFrame";
import { listPlugins } from "../api/plugins";

export function PluginsTab() {
  const [plugins, setPlugins] = useState<PluginDetail[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    listPlugins()
      .then((p) => {
        setPlugins(p);
        setSelected((cur) => cur ?? p[0]?.name ?? null);
      })
      .catch(() => {});
  }, []);

  const current = plugins.find((p) => p.name === selected) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
        <span aria-hidden>⚠</span>
        <span>Mock data — gated until tau exposes plugin introspection.</span>
      </div>
      <div className="grid grid-cols-[160px_1fr] gap-3">
        <ul className="space-y-0.5">
          {plugins.map((p) => (
            <li key={p.name}>
              <button
                onClick={() => setSelected(p.name)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs ${
                  p.name === selected ? "bg-accent/10 text-accent" : "text-muted hover:text-fg"
                }`}
              >
                <span className="font-medium">{p.name}</span>
                <PortBadge port={p.port} />
              </button>
            </li>
          ))}
        </ul>
        {current ? (
          <PluginDetailPane plugin={current} />
        ) : (
          <p className="text-xs text-muted">No plugins.</p>
        )}
      </div>
    </div>
  );
}

function PortBadge({ port }: { port: string }) {
  const tone = port === "LlmBackend" ? "bg-blue-100 text-blue-800" : "bg-accent/10 text-accent";
  return (
    <span className={`rounded-full px-2 text-[9px] font-semibold ${tone}`}>{port}</span>
  );
}

function PluginDetailPane({ plugin }: { plugin: PluginDetail }) {
  const d = plugin.describe;
  return (
    <div className="space-y-3 text-xs">
      <section>
        <div className="mb-1 text-[9px] uppercase text-muted">describe</div>
        <div className="space-y-0.5">
          <div>
            port <b>{d.port}</b> · proto v{d.protocol_version} ·{" "}
            <span className="font-mono">{plugin.kind}</span> · binary{" "}
            <span className="font-mono">{plugin.binary}</span>
          </div>
          {d.tool && (
            <div className="font-mono text-muted">
              {d.tool.name}(
              {Object.entries(d.tool.input_schema)
                .map(([k, t]) => `${k}: ${t}`)
                .join(", ")}
              )
            </div>
          )}
          {d.capabilities.map((c) => (
            <div key={c.kind} className="font-mono text-[10px] text-muted">
              {c.kind}{" "}
              {Object.entries(c.fields)
                .filter((e): e is [string, string[]] => e[1] !== undefined)
                .map(([k, v]) => `${k}=[${v.join(", ")}]`)
                .join(" ")}
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-1 text-[9px] uppercase text-muted">protocol-decode</div>
        <div>
          {plugin.transcript.map((f, i) => (
            <FrameRow key={`${i}-${f.method}`} frame={f} />
          ))}
        </div>
      </section>
    </div>
  );
}

function FrameRow({ frame }: { frame: ProtocolFrame }) {
  const [open, setOpen] = useState(false);
  const out = frame.direction === "out";
  const preview = JSON.stringify(frame.payload);
  return (
    <div className="border-b border-border/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-baseline gap-2 py-1 text-left"
      >
        <span className={`w-3 shrink-0 font-bold ${out ? "text-sky-600" : "text-emerald-600"}`}>
          {out ? "→" : "←"}
        </span>
        <span className="w-32 shrink-0 font-mono font-semibold text-accent">{frame.method}</span>
        <span className="truncate font-mono text-[10px] text-muted">{preview}</span>
      </button>
      {open && (
        <pre className="m-0 mb-1 overflow-auto rounded-md bg-bg p-2 text-[10px]">
          {JSON.stringify(frame.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `web/src/tools/ToolsPage.tsx`** — widen the tab union and make Plugins a navigable tab.

Replace the whole file with:

```tsx
import { useState } from "react";
import { SkillsIndex } from "./SkillsIndex";
import { ToolsTab } from "./ToolsTab";
import { PluginsTab } from "./PluginsTab";

export function ToolsPage() {
  const [tab, setTab] = useState<"skills" | "tools" | "plugins">("skills");
  const chip = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs font-semibold ${
      active ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
    }`;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Tools &amp; Skills</h2>
        <div className="ml-2 flex gap-1">
          <button className={chip(tab === "skills")} onClick={() => setTab("skills")}>
            Skills
          </button>
          <button className={chip(tab === "tools")} onClick={() => setTab("tools")}>
            Tools
          </button>
          <button className={chip(tab === "plugins")} onClick={() => setTab("plugins")}>
            Plugins{" "}
            <span className="ml-1 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
              gated
            </span>
          </button>
        </div>
      </div>
      {tab === "skills" ? <SkillsIndex /> : tab === "tools" ? <ToolsTab /> : <PluginsTab />}
    </div>
  );
}
```

- [ ] **Step 5: Update `web/src/tools/ToolsPage.test.tsx`** — the Plugins tab is now navigable, not disabled. Replace the `describe` block (lines 22-40) with:

```tsx
describe("ToolsPage tabs", () => {
  it("switches Skills → Tools → Plugins (gated tab)", async () => {
    const user = userEvent.setup();
    renderAt();
    // Skills tab shows the import-skill control
    expect(screen.getByLabelText("import skill git url")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    // Tools tab shows the tools table header "provides"
    expect(screen.getByText("provides")).toBeInTheDocument();
    expect(screen.queryByLabelText("import skill git url")).not.toBeInTheDocument();

    // Plugins is now a real, navigable tab → renders the gated PluginsTab
    await user.click(screen.getByRole("button", { name: /plugins/i }));
    expect(screen.getByText(/mock data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run + commit**

Run: `cd web && pnpm test -- src/tools/PluginsTab.test.tsx src/tools/ToolsPage.test.tsx && pnpm test && pnpm typecheck`
Expected: all green.

```bash
git add web/src/api/plugins.ts web/src/tools/PluginsTab.tsx web/src/tools/PluginsTab.test.tsx web/src/tools/ToolsPage.tsx web/src/tools/ToolsPage.test.tsx
git commit -m "feat(web): gated Plugins tab (two-pane describe + protocol-decode)"
```

---

## Task 6: E2e + final gate

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Append the spec**

```ts
test("plugins tab: gated, two-pane describe + protocol-decode", async ({ page }) => {
  await page.goto("/projects/demo/tools");
  await page.getByRole("button", { name: /plugins/i }).click();
  await expect(page.getByText(/mock data/i)).toBeVisible({ timeout: 5000 });
  // select the LlmBackend plugin → its transcript has llm.generate
  await page.getByRole("button", { name: /^anthropic/i }).click();
  const frame = page.getByRole("button", { name: /llm\.generate/i });
  await expect(frame).toBeVisible();
  // expand the frame → pretty JSON payload visible. Match the spaced ("model": …)
  // pretty form so we target the expanded <pre>, not the one-line preview.
  await frame.click();
  await expect(page.getByText(/"model": "claude-opus-4"/)).toBeVisible();
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. Real ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` and note e2e deferred to CI. A strict-mode "N elements" error → fix the selector minimally (`exact:true`/`.first()`), report the fix.

- [ ] **Step 3: Restore fixtures** (the plugins surface is read-only, but other specs mutate `fixtures/demo/tau.toml` + may leave skill dirs):

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green. If format:check fails, `pnpm format`, re-check, include in the commit.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (git status)
git commit -m "test(web): e2e plugins tab + protocol-decode"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-plugins-view-design.md`):
- §2 types (`ProtocolFrame` w/ `payload: unknown`, `ToolSchema`, `PluginDescribe`, `PluginDetail`, reuse `Capability`) → Task 1. §3.1 `PluginsSource`/`MockPlugins` (4 plugins, 6-frame transcripts, port-appropriate sample calls)/`CliPlugins` → Task 1. §3.2 `list_plugins` accessor → Task 2. §3.3 AppState wrapper + `GET /plugins` → Tasks 2–3. ts-rs/CI (§6) → Task 4. §4.1 `api/plugins.ts` → Task 5. §4.2 `PluginsTab` (gated banner, two-pane list+port-badge, describe section, protocol-decode frame rows expand to pretty JSON) + `ToolsPage` Plugins-now-navigable → Task 5. §5 tests → Tasks 1, 2, 3, 5, 6. All covered.

**Placeholder scan:** none — every step has complete code.

**Type consistency:** `PluginDetail { name, version?, source, kind, binary, port, protocol_version, describe: PluginDescribe, transcript: ProtocolFrame[] }`, `PluginDescribe { port, protocol_version, tool: ToolSchema?, capabilities: Capability[] }`, `ToolSchema { name, input_schema: {[k]:string} }`, `ProtocolFrame { direction, method, payload: unknown }` are used identically across the module, the AppState wrapper, the handler, the integration test, and the frontend (`api/plugins.ts`, `PluginsTab`). `list_plugins(&dyn PluginsSource)` and `MockPlugins`/`CliPlugins::catalog()` signatures match their callers. The frontend reads `plugin.port` for the list badge and `plugin.describe.{port,protocol_version,tool,capabilities}` + `plugin.transcript[].{direction,method,payload}` for the detail — matching the gateway field names. Port badge keys off `port === "LlmBackend"`. `Capability.fields` (`{[k]?: string[]}`) is rendered with the same `.filter((e): e is [string,string[]] => …)` narrowing used in `ToolsTab`. The `GET /api/projects/:pid/plugins` path matches `listPlugins` (`scopedPath("/plugins")`).

**Note for executor:** `cargo test` + the integration test read `fixtures/demo` read-only (no writes); the plugins surface itself mutates nothing, but other e2e specs mutate fixtures, so Task 6 Step 3 restores them. Verify `git status --porcelain fixtures/demo` is empty before the final commit. The existing `ToolsPage.test.tsx` assertion about Plugins being `aria-disabled` is intentionally replaced in Task 5 Step 5 (Plugins is now navigable).
