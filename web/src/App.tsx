import { useStore } from "./store/store";
import { ProjectBar } from "./app/ProjectBar";
import { RunsView } from "./runs/RunsView";
import { TraceView } from "./trace/TraceView";

export function App() {
  const hasTrace = useStore((s) => s.currentTrace !== null);
  return (
    <div className="flex h-screen flex-col">
      <ProjectBar />
      <main className="min-h-0 flex-1">{hasTrace ? <TraceView /> : <RunsView />}</main>
    </div>
  );
}
