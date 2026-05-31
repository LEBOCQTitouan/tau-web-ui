import { useStore } from "../store/store";

export function AssistantStream() {
  const text = useStore((s) => s.assistantText);
  return (
    <div className="max-h-44 overflow-auto whitespace-pre-wrap border-t border-border bg-surface p-3 font-mono text-[13px]">
      {text || <span className="text-muted">No assistant output yet…</span>}
    </div>
  );
}
