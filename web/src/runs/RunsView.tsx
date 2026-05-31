import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { usePollRuns } from "./usePollRuns";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";
import { RunsOverview } from "./RunsOverview";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const navigate = useNavigate();
  usePollRuns();

  return (
    <section className="p-4">
      <h2 className="mb-3 text-base font-semibold">Runs</h2>
      <Launcher />
      <RunsOverview />
      <RunsTable runs={runs} onOpen={(id) => navigate(`/runs/${id}`)} />
    </section>
  );
}
