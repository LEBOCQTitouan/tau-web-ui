import { useEffect } from "react";
import { useStore } from "../store/store";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const refreshRuns = useStore((s) => s.refreshRuns);
  const openTrace = useStore((s) => s.openTrace);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  return (
    <section className="p-4">
      <h2 className="mb-3 text-base font-semibold">Runs</h2>
      <Launcher />
      <RunsTable runs={runs} onOpen={openTrace} />
    </section>
  );
}
