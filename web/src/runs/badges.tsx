import type { Run } from "../types/Run";

const STATUS_CLASS: Record<Run["status"], string> = {
  running: "bg-st-running-soft text-st-running",
  completed: "bg-st-ok-soft text-st-ok",
  failed: "bg-st-error-soft text-st-error",
  cancelled: "bg-st-cancelled-soft text-st-cancelled",
};

export function StatusBadge({ status }: { status: Run["status"] }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
    >
      {status}
    </span>
  );
}

export function SubstrateModeBadge({
  substrate,
  mode,
}: {
  substrate: Run["substrate"];
  mode: Run["mode"];
}) {
  return (
    <span className="inline-block rounded border border-border px-2 py-0.5 text-xs text-muted">
      {substrate} · {mode}
    </span>
  );
}
