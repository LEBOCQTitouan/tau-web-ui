import { useMemo } from "react";
import { useStore } from "../store/store";
import { computeMetrics } from "../dashboard/metrics";
import { StatCard } from "../dashboard/StatCard";

const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

export function RunsOverview() {
  const runs = useStore((s) => s.runs);
  const m = useMemo(() => computeMetrics(runs), [runs]);
  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
      <StatCard label="Runs" value={m.total} />
      <StatCard
        label="Success rate"
        tone="text-st-ok"
        value={m.successRate == null ? "—" : `${Math.round(m.successRate * 100)}%`}
      />
      <StatCard label="Running" tone="text-st-running" value={m.byStatus.running} />
      <StatCard label="Tokens" value={fmtTok(m.tokens.total)} />
      <StatCard
        label="Latency p50"
        value={m.durations ? `${(m.durations.p50 / 1000).toFixed(1)}s` : "—"}
      />
    </div>
  );
}
