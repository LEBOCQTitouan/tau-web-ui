import type { Run } from "../types/Run";
import { StatusBadge, SubstrateModeBadge } from "./badges";
import { formatTokens, formatDuration } from "./run-utils";

export function RunsTable({ runs, onOpen }: { runs: Run[]; onOpen: (id: string) => void }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted">No runs yet. Launch one above.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Agent</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Substrate/Mode</th>
            <th className="px-3 py-2 font-medium">Started</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
            >
              <td className="px-3 py-2 font-medium">{r.agent_id}</td>
              <td className="px-3 py-2">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2">
                <SubstrateModeBadge substrate={r.substrate} mode={r.mode} />
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted">
                {r.started_at.replace("T", " ").slice(0, 19)}
              </td>
              <td className="px-3 py-2 text-xs">{formatDuration(r)}</td>
              <td className="px-3 py-2 text-xs">{formatTokens(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
