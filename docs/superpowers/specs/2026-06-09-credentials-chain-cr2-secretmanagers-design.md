# Credentials chain — CR-2 (SecretManager providers) — design

**Status:** approved (brainstorm 2026-06-09)
**Builds on:** CR-1 (`2026-06-09-credentials-chain-cr1-design.md`) — the chain core + Env/Local. CR-2 ungates the SecretManager source kinds (`vault`, `aws_kv`, `gcp_kv`, `azure_kv`) and adds their resolution. **Next:** CR-3 (TokenBroker / WorkloadIdentity).
**Relates to:** the Providers screen (`/projects/:pid/providers`) credential chain editor.

## 1. Goal

Let an operator add a **SecretManager** source (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) to a backend's credential chain. Each source references a secret **path** within the manager; the manager's **connection comes from ambient environment** (tau's "default credential chain" model — `tau resolves; it doesn't store`). CR-2 makes these four kinds **addable and resolvable** in the chain, with a clear per-source status.

**No secret is ever fetched or stored** — identical to CR-1. "Configured/resolved" is a **presence/validation** check (the ref is set AND the manager's ambient connection env is present); the actual secret fetch + use stays the runtime seam that waits on tau's engine.

## 2. Locked decisions (brainstorm)

- **Resolution = configure + validate the reference** (not fetch). Chosen over a real SDK fetch (which would need 4 heavy cloud SDKs + live services, hold secrets in the gateway, and contradict "not a vault"). Matches CR-1's bar exactly: nothing in tau-web-ui fetches/uses a real credential value yet — the *use* is the universal runtime seam.
- **No `SourceConfig` change.** Each manager source keeps the single `ref` = the secret's path within that manager; the connection is ambient env. Per-source connection overrides are out of scope (future).
- **`gated()` shrinks** to only `token_broker` / `workload_identity` (CR-3). The four SecretManager kinds are accepted by `PUT` (no longer 422).
- **New `SourceStatus.detail: Option<String>`** — a non-secret per-source hint (e.g. `"VAULT_ADDR not set"`) so an unconfigured manager source explains what ambient env is missing.
- **Caveat (documented):** "configured" confirms the manager is *set up/reachable by config*, NOT that the specific secret *exists/is fetchable* — only a real fetch (future) proves that.

## 3. Per-manager resolution (gateway)

The pure resolver's `_ => false` arm (CR-1 `gateway/src/credentials/mod.rs`) becomes four arms. A manager source is **configured** iff its `ref` is non-empty AND its ambient-connection env is present:

| `SourceKind` | `ref` is | configured requires (besides non-empty `ref`) | `detail` when unconfigured |
|---|---|---|---|
| `Vault` | a Vault secret path (`secret/data/anthropic`) | `VAULT_ADDR` set | `"VAULT_ADDR not set"` (or `"ref is empty"`) |
| `AwsKv` | a Secrets Manager name/ARN (`prod/anthropic-key`) | `AWS_REGION` or `AWS_DEFAULT_REGION` set | `"AWS_REGION not set"` |
| `GcpKv` | a Secret Manager resource (`projects/P/secrets/anthropic`) | `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_CLOUD_PROJECT` set | `"GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_CLOUD_PROJECT not set"` |
| `AzureKv` | a Key Vault secret name (`anthropic`) | `AZURE_KEYVAULT_URL` set | `"AZURE_KEYVAULT_URL not set"` |

**Resolver shape.** `source_configured(s, has_local, env_get)` gains the four arms (each a pure check over `s.reference` + `env_get(<var>)`). `resolve` is unchanged (first-configured wins; `resolved_via` may now be a manager kind). `gated()` becomes `matches!(self, TokenBroker | WorkloadIdentity)`.

**`detail` computation.** A small helper `source_detail(s, has_local, env_get) -> Option<String>`:
- If the source is configured → `None`.
- Env: `Some("<ref> not set")` when the var is unset (or `"ref is empty"` when `ref` empty).
- A manager: `Some("ref is empty")` when `ref` empty, else `Some("<ENV_VAR> not set")` for the missing ambient var.
- Local: `Some("no value stored")` when `!has_local`.
- Gated kinds (token_broker/workload_identity): `Some("waits on CR-3")`.

`SourceStatus` gains `pub detail: Option<String>`, populated in `Credentials::status_for`. The `put` validation rejects (422): **gated** kinds (now only `token_broker`/`workload_identity`), **duplicate** kinds, and any **Env or manager source with an empty `ref`** — a non-empty `ref` is required for everything except Local (an empty-ref manager isn't addressable and only confuses the chain). So a stored source always carries a usable `ref`; the `detail` hint for a stored manager source is therefore about the missing **ambient env**, not an empty ref (the empty-ref branch of `source_detail` is defensive — it can't arise for a stored source).

## 4. API

No new routes. `GET /api/credentials` / `PUT/DELETE /api/credentials/:backend` unchanged. `PUT` validation: reject only `token_broker`/`workload_identity` (gated), duplicates, and any source (Env or manager) with an empty `ref`. ts-rs regenerates `SourceStatus` with `detail`.

## 5. Frontend (`CredentialChainEditor.tsx`)

- **Addable kinds** = `env`, `local`, `vault`, `aws_kv`, `gcp_kv`, `azure_kv` (the SecretManager four moved out of the gated group). **Disabled (🔒)** = `token_broker`, `workload_identity` only.
- **Manager rows get a `ref` input** (same control as the Env row), with a per-kind placeholder: Vault `secret/data/anthropic`, AWS `prod/anthropic-key`, GCP `projects/PROJECT/secrets/anthropic`, Azure `anthropic`. (Local unchanged: "resolves from the local store" + the masked write-only value field.)
- **Per-source `detail` hint.** Build `statusByKind = new Map(status?.sources.map(s => [s.kind, s]))` (kinds are unique per chain). For each editor row, if `statusByKind.get(row.kind)` exists and is `!configured`, render its `detail` inline as a small warning (e.g. `⚠ VAULT_ADDR not set`). Refreshes after Save (ProvidersPage re-fetches → new `status` → updated hints).
- **Save** builds `sources` with `ref` for env + the four managers (i.e. `ref: kind === "local" ? null : r.ref`); managers send their path, Local sends none. `local_value` logic unchanged.
- **ProvidersPage** badge already renders `✓ via {resolved_via}` → a Vault-resolved backend shows **✓ via vault** with no change.

## 6. Testing

**Gateway:**
- Unit (resolver): each manager resolves when `ref` + its env var are present (injected `env_get`); unconfigured when `ref` empty or env missing; `source_detail` returns the correct hint per case; `gated()` true only for token_broker/workload_identity; first-wins with a manager in the chain.
- Unit (store/status): a configured/unconfigured Vault source's `SourceStatus` carries `configured` + `detail`; `resolved_via` can be a manager.
- Integration (`gateway/tests/credentials_api.rs`, extend): `PUT` a `vault` source (with a non-empty ref) → **200**, `gated:false`, `configured:false`, a non-null `detail` (VAULT_ADDR unset in the test — **no process-env mutation**); `PUT token_broker` → **422**; `PUT vault` with empty `ref` → **422**. (Replaces CR-1's `vault`→422 assertion.)
- ts-rs drift gate for `SourceStatus.detail`.

**Web (vitest):**
- `CredentialChainEditor`: adding a Vault source renders a ref input; the add-menu shows vault/aws_kv/gcp_kv/azure_kv enabled and only token_broker/workload_identity disabled; given a `status` with an unconfigured source, the `detail` hint renders.
- `ProvidersPage`: a backend whose status `resolved_via:"vault"` shows the `✓ via vault` badge.

**E2e (Playwright):**
- In the chain editor, add a **Vault** source, type a ref, Save → the source persists and shows its **⚠ VAULT_ADDR not set** hint (dev env has no VAULT_ADDR); the **Token broker** add-button is disabled.

## 7. Out of scope (YAGNI) / roadmap

- **Real SDK fetch / reachability probe** — actually contacting Vault/AWS/GCP/Azure to retrieve (or health-check) the secret. A future increment; the resolver stays a pure presence check in CR-2. The real fetch + use lands for *all* kinds at once via the runtime seam when tau's β.5 credential mechanism ships.
- **Per-source connection overrides** (a specific Vault address per source, etc.) — CR-2 uses ambient env (tau's default-credential-chain model); a structured per-source connection is a future model extension.
- **CR-3 — TokenBroker / WorkloadIdentity** — the remaining two gated kinds (the browser-sanctioned BFF path + workload identity).
- **Secret rotation / expiry / audit** — not in CR-2.
