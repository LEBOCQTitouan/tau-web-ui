import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCrossRuns } from "../api/projects";
import type { CrossProjectRun } from "../types/CrossProjectRun";

const STATUS_CLASS: Record<string, string> = {
  failed: "bg-st-error/15 text-st-error",
  completed: "bg-st-ok/15 text-st-ok",
  running: "bg-st-running/15 text-st-running",
  cancelled: "bg-st-cancelled/15 text-st-cancelled",
};

export function ActivityFeed() {
  const [mode, setMode] = useState<"failures" | "all">("failures");
  const [rows, setRows] = useState<CrossProjectRun[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const status = mode === "failures" ? "failed" : undefined;
    getCrossRuns(status, 30)
      .then(setRows)
      .catch(() => setRows([]));
  }, [mode]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold">
        Activity
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setMode("failures")}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              mode === "failures" ? "bg-accent text-accent-fg" : "border border-border text-muted"
            }`}
          >
            Failures
          </button>
          <button
            onClick={() => setMode("all")}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              mode === "all" ? "bg-accent text-accent-fg" : "border border-border text-muted"
            }`}
          >
            All runs
          </button>
        </div>
      </div>
      {rows.length === 0 && <div className="px-3 py-4 text-xs text-muted">No activity.</div>}
      {rows.map((r) => (
        <button
          key={`${r.project_id}-${r.run.id}`}
          onClick={() => navigate(`/projects/${r.project_id}/runs/${r.run.id}`)}
          className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-xs last:border-0 hover:bg-accent/5"
        >
          <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-semibold text-muted">
            {r.project_name}
          </span>
          <b className="truncate">{r.run.agent_id}</b>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              STATUS_CLASS[r.run.status] ?? "bg-bg text-muted"
            }`}
          >
            {r.run.status}
          </span>
        </button>
      ))}
    </div>
  );
}
