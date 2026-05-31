import { useStore } from "../store/store";
import { TraceGraph } from "./TraceGraph";
import { AssistantStream } from "./AssistantStream";
import { SpanInspector } from "./SpanInspector";
import { RunControls } from "./RunControls";

export function TraceView() {
  const trace = useStore((s) => s.currentTrace);
  const selectedId = useStore((s) => s.selectedSpanId);
  const close = useStore((s) => s.closeTrace);

  if (!trace) {
    return <section className="p-4 text-sm text-muted">Select a run to view its trace.</section>;
  }
  const selected = trace.spans.find((s) => s.id === selectedId) ?? null;

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <strong className="text-sm">Trace · {trace.run.agent_id}</strong>
        <button onClick={close} className="text-xs text-accent">
          ← Back to runs
        </button>
      </div>
      <RunControls />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[2] border-r border-border">
          <TraceGraph spans={trace.spans} />
        </div>
        <div className="min-w-[280px] flex-1 overflow-auto">
          <SpanInspector span={selected} />
        </div>
      </div>
      <AssistantStream />
    </section>
  );
}
