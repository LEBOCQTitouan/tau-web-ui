# Known v1 limitations (gateway)

Tracked here so Plan 2 (frontend) and future work don't mistake these for bugs.

1. **Assistant prose is live-only; not replayed.** `Event`s (incl. `text_delta`) are
   persisted to JSONL but `WsMessage::Snapshot` / `GET /api/runs/:id` return only the
   `Run` + `Vec<Span>`, not events. So reopening a *finished* run shows the full span
   tree and per-span I/O (tool args/results live in `span.attributes`), but NOT the
   streamed assistant text. Live runs show everything. To make replay byte-identical,
   add an `events: Vec<Event>` field to `Snapshot` + `load_trace` and reconstruct
   `assistantText` from it on the frontend. Deferred — the data is already on disk.

2. **`channels` map grows unbounded.** `AppState` never removes a run's
   `broadcast::Sender` after the run finalizes (`gateway/src/state.rs`). Negligible at
   v1 scale (tens of runs); for a long-lived production gateway, clean it up in
   `finalize` (publish the terminal `RunUpdate` first, then remove the entry).

3. **`TraceDelta::RunUpdated` is dormant.** The variant exists but no v1 adapter emits
   it; it publishes without persisting. Wire persistence if log/otlp adapters ever
   produce it.

4. **Fleet list shows stale token/turn data for in-flight runs.** `GET /api/runs`
   reflects the initial `Running` snapshot until `finalize`. A *completed* run never
   shows as Running (finalize updates the map atomically). Per-run live data is on the
   WS. Acceptable for v1.
